/**
 * process-pipeline — OPD-Demo-2 P2.1 (the background pipeline core).
 *
 * Shared by POST /api/encounters/[id]/process (client fire-and-forget after
 * pause_for_workup / end_visit) and the hourly cron sweep (backstop +
 * stuck-processing reaper). The work persists to the DB regardless of
 * whether any client is listening — the ETA /process model.
 *
 * P2.1 stage: per-session canonical transcription.
 *   session audio (R2) → Whisper large-v3-turbo (English) or Sarvam batch
 *   translate w/ diarization entries (non-English, per the live engines'
 *   detected language) → encounter_sessions.transcript_en / diarized_json.
 * P2.2 stage: per-session diarize + voiceprint naming + speaker tagging.
 *   session audio → Mac Mini pyannote /diarize (doctor's voice_print
 *   centroid passed for naming; unenrolled → proceeds UNLABELED, P2.2 lock)
 *   → speakers_json; timed text entries (Sarvam diarized_json non-EN /
 *   Deepgram batch EN) reconciled onto pyannote speakers by time overlap +
 *   first-person Patient override → tagged_transcript (session) +
 *   encounters.tagged_transcript (seq-ordered concat). Passive voiceprint
 *   capture day one, strict 0.82 gate. Diarize SOFT-FAILS per session
 *   (diarize_error, diarized_at stays NULL → hourly sweep retries) and
 *   NEVER flips processing_status to errored.
 * P2.3 stage: per-session draft notes + whole-encounter note + Section fill.
 *   tagged (else plain) transcript → qwen2.5:14b → OPD note schema →
 *   encounter_sessions.note_json (the P3 stitch input); encounters.note_json
 *   = session 1's draft (N=1) or a provisional regen from the full tagged
 *   transcript (N>1; true hybrid stitch = P3). Field-provenance merge fills
 *   ONLY untouched Sections (chief_complaint_text/exam_findings/
 *   assessment_text): 'typed'/'ai_then_edited' inviolable; 'ai_generated'
 *   refreshable (P2.3 locks). llm_traces rows per generation (session-tied).
 *   Note-gen failure → 'errored' + sweep retry; empty transcript → stamped
 *   done, no retry loop.
 * P2.4 stage: KB-grounded CDS over the encounter draft note (ADVISORY).
 *   OpdNote seed → kbRetrieve (HyDE + pgvector) → cited 6-group draft
 *   (qwen2.5:14b) → citation critique (llama3.1:8b) → revise →
 *   encounters.cdmss_json + encounter_cdmss_items proposed rows
 *   (what_to_do/what_else accept-ignore; advisory groups display-only).
 *   SOFT-FAIL (P2.4 lock): cdmss_error + sweep retry; never blocks 'ready'.
 *   When the pipeline lands 'ready' and clinical_status='processing'
 *   (end-visit path) the card flips to ready_for_review (design §4;
 *   legacy status untouched — no legacy analogue, lossless).
 *
 * Concurrency: atomic claim on encounters.processing_status with a 30-min
 * stale-claim takeover (the reaper rule) — two simultaneous calls can't
 * double-process.
 */
import { pool } from './db';
import { getObjectBytes } from './r2';
import { transcribeWithWhisper } from './whisper';
import { sarvamBatchTranslate, isNonEnglish, SARVAM_MEDICAL_PROMPT } from './sarvam';
import {
  runDiarize,
  reconcileTagged,
  applyRoleOverrides,
  type DiarizeSpeaker,
  type DiarEntryLike,
  type SegLike,
  type TaggedEntry,
} from './diarize';
import { transcribeDiarized } from './transcribe';
import { capturePassiveSample } from './voice-samples';
import {
  generateOpdNote,
  transcriptForNote,
  noteHasContent,
  NOTE_MODEL,
  type OpdNote,
} from './note-generation';
import { openTrace } from './llm-trace/log';
import { runCdmssPipeline, type OpdCdmss } from './cdmss-pipeline';
import { generateStitchedNote, type StitchInputSession } from './stitch';

const STALE_CLAIM_MINUTES = 30;

export type ProcessOutcome = {
  ok: boolean;
  claimed: boolean;
  encounter_id: string;
  processing_status: string;
  sessions_done: number;
  sessions_failed: number;
  sessions_diarized: number;
  diarize_failed: number;
  notes_done: number;
  notes_failed: number;
  cdmss_done: boolean;
  cdmss_failed: boolean;
  skipped?: string;
  error?: string;
};

type SessionRow = {
  id: string;
  seq: number;
  audio_object_key: string | null;
  transcribed_at: string | null;
};

export async function processEncounter(
  encounterId: string,
  opts: { force?: boolean; detectedLanguage?: string | null } = {},
): Promise<ProcessOutcome> {
  const base: Omit<ProcessOutcome, 'ok' | 'processing_status'> = {
    claimed: false,
    encounter_id: encounterId,
    sessions_done: 0,
    sessions_failed: 0,
    sessions_diarized: 0,
    diarize_failed: 0,
    notes_done: 0,
    notes_failed: 0,
    cdmss_done: false,
    cdmss_failed: false,
  };

  // Record the live engines' language detection if we got one and the
  // encounter doesn't have one yet (the cron backstop has no client hint).
  if (opts.detectedLanguage) {
    await pool.query(
      `UPDATE encounters SET detected_language = COALESCE(detected_language, $2) WHERE id = $1`,
      [encounterId, opts.detectedLanguage],
    );
  }

  // Atomic claim. A fresh in-flight claim blocks us (claimed:false); a stale
  // one (crashed function) is taken over — the reaper rule.
  const { rows: claimRows } = await pool.query<{ detected_language: string | null }>(
    `UPDATE encounters
        SET processing_status = 'transcribing',
            processing_started_at = NOW(),
            processing_error = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND ($2::boolean
             OR processing_status NOT IN ('transcribing', 'generating')
             OR processing_started_at IS NULL
             OR processing_started_at < NOW() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
      RETURNING detected_language`,
    [encounterId, opts.force === true],
  );
  if (claimRows.length === 0) {
    const { rows } = await pool.query<{ processing_status: string }>(
      'SELECT processing_status FROM encounters WHERE id = $1',
      [encounterId],
    );
    if (rows.length === 0) {
      return { ...base, ok: false, processing_status: 'unknown', error: 'not_found' };
    }
    return {
      ...base,
      ok: true,
      processing_status: rows[0].processing_status,
      skipped: 'already_in_flight',
    };
  }
  const encounterLanguage = claimRows[0].detected_language;

  // Sessions needing the canonical transcript.
  const { rows: sessions } = await pool.query<SessionRow>(
    `SELECT id, seq, audio_object_key, transcribed_at::text AS transcribed_at
       FROM encounter_sessions
      WHERE encounter_id = $1
        AND status = 'uploaded'
        AND audio_object_key IS NOT NULL
        AND (transcribed_at IS NULL OR $2::boolean)
      ORDER BY seq ASC`,
    [encounterId, opts.force === true],
  );

  let done = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const s of sessions) {
    try {
      const bytes = s.audio_object_key ? await getObjectBytes(s.audio_object_key) : null;
      if (!bytes || bytes.length === 0) throw new Error('audio_missing_in_r2');

      if (isNonEnglish(encounterLanguage)) {
        // Non-English: Sarvam batch translate (full-context, medical prompt,
        // diarization entries for the P2.2/P3 stages).
        const r = await sarvamBatchTranslate(Buffer.from(bytes), 'audio/webm', {
          prompt: SARVAM_MEDICAL_PROMPT,
          withDiarization: true,
        });
        if (!r.ok) throw new Error(`sarvam_batch: ${r.error}`);
        await pool.query(
          `UPDATE encounter_sessions
              SET transcript_en = $2,
                  detected_language = $3,
                  diarized_json = $4::jsonb,
                  transcribed_at = NOW(),
                  transcribe_error = NULL,
                  status = 'transcribed'
            WHERE id = $1`,
          [s.id, r.transcript, r.languageCode ?? encounterLanguage, JSON.stringify(r.entries)],
        );
      } else {
        // English (or unknown → English default): Whisper large-v3-turbo.
        const r = await transcribeWithWhisper(Buffer.from(bytes), 'audio/webm');
        if (!r.ok) throw new Error(`whisper: ${r.error}`);
        await pool.query(
          `UPDATE encounter_sessions
              SET transcript_en = $2,
                  detected_language = COALESCE($3, detected_language),
                  transcribed_at = NOW(),
                  transcribe_error = NULL,
                  status = 'transcribed'
            WHERE id = $1`,
          [s.id, r.transcript, r.language ?? null],
        );
      }
      done++;
    } catch (e) {
      failed++;
      lastError = e instanceof Error ? e.message : String(e);
      await pool.query(
        `UPDATE encounter_sessions SET transcribe_error = $2 WHERE id = $1`,
        [s.id, lastError.slice(0, 300)],
      ).catch(() => { /* intentional: error bookkeeping is best-effort */ });
    }
  }

  // ---- P2.2 — diarize + voiceprint naming + speaker tagging ---------------
  // Runs over every transcribed-but-undiarized session (incl. ones from
  // earlier runs — the sweep retry path). SOFT-FAIL by design: diarize
  // problems never mark the encounter errored (P2.2 lock).
  const dz = await diarizeSessions(encounterId, opts.force === true);

  // ---- P2.3 — draft notes ('generating' stage) -----------------------------
  await pool.query(
    `UPDATE encounters SET processing_status = 'generating', updated_at = NOW() WHERE id = $1`,
    [encounterId],
  ).catch(() => { /* intentional: stage marker is cosmetic; claim still holds */ });
  const ng = await generateNotes(encounterId, opts.force === true);
  if (ng.failed > 0 && !lastError) lastError = ng.lastError;

  // ---- P2.4 — KB-grounded CDS (advisory; soft-fail) ------------------------
  const cd = await generateCdmss(encounterId, opts.force === true);

  // Final status. 'ready' = all current pipeline stages done. Transcription
  // or note-gen failures → 'errored' (the note IS the product; diarize and
  // CDS stay soft enrichments) — the sweep retries all of them.
  const anyFailed = failed > 0 || ng.failed > 0;
  const finalStatus = anyFailed ? 'errored' : 'ready';
  await pool.query(
    `UPDATE encounters
        SET processing_status = $2,
            processing_error = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [encounterId, finalStatus, anyFailed ? (lastError ?? 'unknown').slice(0, 300) : null],
  );

  // P2.4 — flip the board card to the Review queue (design §4): only on the
  // end-visit path (clinical 'processing'), only when the pipeline is clean.
  if (finalStatus === 'ready') {
    await pool.query(
      `UPDATE encounters
          SET clinical_status = 'ready_for_review', updated_at = NOW()
        WHERE id = $1 AND clinical_status = 'processing'`,
      [encounterId],
    ).catch(() => { /* intentional: flip is choreography, not data integrity */ });
  }

  return {
    ...base,
    ok: !anyFailed,
    claimed: true,
    processing_status: finalStatus,
    sessions_done: done,
    sessions_failed: failed,
    sessions_diarized: dz.done,
    diarize_failed: dz.failed,
    notes_done: ng.done,
    notes_failed: ng.failed,
    cdmss_done: cd.done,
    cdmss_failed: cd.failed,
    error: lastError ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// P2.4 — CDS/CDMSS stage (advisory, soft-fail)
// ---------------------------------------------------------------------------

/**
 * Run the KB-grounded CDS pipeline over encounters.note_json, persist
 * cdmss_json, and (re)propose encounter_cdmss_items rows for the two
 * actionable groups. Re-runs replace only status='proposed' rows —
 * accepted/ignored decisions are never clobbered. Never throws.
 */
async function generateCdmss(
  encounterId: string,
  force: boolean,
): Promise<{ done: boolean; failed: boolean }> {
  try {
    const { rows } = await pool.query<{
      note_json: unknown;
      cdmss_generated_at: string | null;
      patient_id: string;
      doctor_email: string | null;
    }>(
      `SELECT e.note_json, e.cdmss_generated_at::text AS cdmss_generated_at,
              e.patient_id, d.email AS doctor_email
         FROM encounters e LEFT JOIN doctors d ON d.id = e.doctor_id
        WHERE e.id = $1`,
      [encounterId],
    );
    if (rows.length === 0 || !rows[0].note_json) return { done: false, failed: false };
    if (rows[0].cdmss_generated_at && !force) return { done: false, failed: false };
    const enc = rows[0];

    const trace = await openTrace({
      surface: 'cdmss',
      encounter_id: encounterId,
      patient_id: enc.patient_id,
      doctor_email: enc.doctor_email,
      request_input: { scope: 'encounter', force },
    });
    const r = await runCdmssPipeline(enc.note_json as OpdNote, {
      onEvent: (stage, msg, ms) => trace.event(stage, msg, ms),
    });
    if (!r.ok) {
      await pool.query(
        `UPDATE encounters SET cdmss_error = $2, updated_at = NOW() WHERE id = $1`,
        [encounterId, r.error.slice(0, 300)],
      ).catch(() => { /* intentional: bookkeeping best-effort */ });
      await trace.finalise({ status: 'errored', error_message: r.error.slice(0, 300) });
      return { done: false, failed: true };
    }

    await pool.query(
      `UPDATE encounters
          SET cdmss_json = $2::jsonb, cdmss_generated_at = NOW(), cdmss_error = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [encounterId, JSON.stringify(r.cdmss)],
    );

    // (Re)propose the actionable item rows. Keep accepted/ignored history.
    try {
      await pool.query(
        `DELETE FROM encounter_cdmss_items WHERE encounter_id = $1 AND status = 'proposed'`,
        [encounterId],
      );
      const c: OpdCdmss = r.cdmss;
      for (const it of c.what_to_do) {
        await pool.query(
          `INSERT INTO encounter_cdmss_items (encounter_id, item_group, payload)
           VALUES ($1, 'what_to_do', $2::jsonb)`,
          [encounterId, JSON.stringify(it)],
        );
      }
      for (const it of c.what_else_to_ask) {
        await pool.query(
          `INSERT INTO encounter_cdmss_items (encounter_id, item_group, payload)
           VALUES ($1, 'what_else', $2::jsonb)`,
          [encounterId, JSON.stringify(it)],
        );
      }
      for (const it of c.probabilities ?? []) {
        await pool.query(
          `INSERT INTO encounter_cdmss_items (encounter_id, item_group, payload)
           VALUES ($1, 'probability', $2::jsonb)`,
          [encounterId, JSON.stringify(it)],
        );
      }
    } catch {
      /* intentional: cdmss_json is canonical; item rows are the action layer */
    }

    trace.event('persist', `CDS persisted (${r.cdmss.what_to_do.length} to-do, ${r.cdmss.what_else_to_ask.length} to-ask, ${(r.cdmss.probabilities ?? []).length} probability row(s))`, undefined, true);
    await trace.finalise({
      status: 'completed',
      result_summary: {
        what_to_do: r.cdmss.what_to_do.length,
        what_else_to_ask: r.cdmss.what_else_to_ask.length,
        differentials: r.cdmss.differentials_to_consider.length,
        probabilities: (r.cdmss.probabilities ?? []).length,
        sources: r.cdmss.sources.length,
        used_critique: r.cdmss.retrieval_meta?.used_critique,
        used_revise: r.cdmss.retrieval_meta?.used_revise,
      },
      model_calls: r.models,
    });
    return { done: true, failed: false };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await pool.query(
      `UPDATE encounters SET cdmss_error = $2 WHERE id = $1`,
      [encounterId, msg],
    ).catch(() => { /* intentional: bookkeeping best-effort */ });
    return { done: false, failed: true };
  }
}

// ---------------------------------------------------------------------------
// P2.3 — note generation stage
// ---------------------------------------------------------------------------

type NoteSessionRow = {
  id: string;
  seq: number;
  tagged_transcript: unknown;
  transcript_en: string | null;
};

/** §10.1 provenance rule: a Section may be (re)filled only when untouched —
 *  no provenance + empty column, an explicit 'empty' marker, or a previous
 *  'ai_generated' fill (refreshable, P2.3 lock). 'typed'/'ai_then_edited'
 *  are inviolable. */
function mayFill(prov: string | undefined, currentValue: string | null): boolean {
  if (prov === 'typed' || prov === 'ai_then_edited') return false;
  if (prov === 'ai_generated' || prov === 'empty') return true;
  return currentValue == null || currentValue.trim().length === 0;
}

/**
 * Per-session OPD draft notes (P3 stitch input) + the whole-encounter draft
 * + the §10.1 Section fill. Returns counters; never throws. LLM failures
 * leave note_error with note_generated_at NULL (sweep retries); empty or
 * non-clinical transcripts are STAMPED generated so they can't loop.
 */
async function generateNotes(
  encounterId: string,
  force: boolean,
): Promise<{ done: number; failed: number; lastError: string | null }> {
  let done = 0;
  let failed = 0;
  let lastError: string | null = null;
  try {
    const { rows: encRows } = await pool.query<{
      patient_id: string;
      doctor_email: string | null;
      tagged_transcript: unknown;
    }>(
      `SELECT e.patient_id, d.email AS doctor_email, e.tagged_transcript
         FROM encounters e LEFT JOIN doctors d ON d.id = e.doctor_id
        WHERE e.id = $1`,
      [encounterId],
    );
    if (encRows.length === 0) return { done, failed, lastError };
    const enc = encRows[0];

    const { rows: sessions } = await pool.query<NoteSessionRow>(
      `SELECT id, seq, tagged_transcript, transcript_en
         FROM encounter_sessions
        WHERE encounter_id = $1
          AND transcribed_at IS NOT NULL
          AND (note_generated_at IS NULL OR $2::boolean)
        ORDER BY seq ASC`,
      [encounterId, force],
    );

    let generatedAny = false;
    for (const s of sessions) {
      const text = transcriptForNote(s.tagged_transcript, s.transcript_en);
      if (text.length === 0) {
        // Nothing to draft from — stamp done (never re-picked; ETA #11 lesson).
        await pool.query(
          `UPDATE encounter_sessions
              SET note_generated_at = NOW(), note_error = 'empty_transcript'
            WHERE id = $1`,
          [s.id],
        ).catch(() => { /* intentional: bookkeeping best-effort */ });
        continue;
      }
      const trace = await openTrace({
        surface: 'note-gen',
        encounter_id: encounterId,
        patient_id: enc.patient_id,
        doctor_email: enc.doctor_email,
        session_id: s.id,
        request_input: { scope: 'session', seq: s.seq, transcript_chars: text.length, model: NOTE_MODEL },
      });
      trace.event('note', `Drafting session #${s.seq} note (${text.length} chars)`);
      const r = await generateOpdNote(text);
      if (r.ok) {
        await pool.query(
          `UPDATE encounter_sessions
              SET note_json = $2::jsonb, note_generated_at = NOW(), note_error = NULL
            WHERE id = $1`,
          [s.id, JSON.stringify(r.note)],
        );
        done++;
        generatedAny = true;
        trace.event('note', `Session #${s.seq} draft ready`, r.latency_ms, true);
        await trace.finalise({
          status: 'completed',
          result_summary: {
            chief_complaint: r.note.chief_complaint.slice(0, 120),
            has_content: noteHasContent(r.note),
          },
          model_calls: [{ model: r.model, latency_ms: r.latency_ms }],
        });
      } else {
        failed++;
        lastError = `note_gen: ${r.error}`;
        await pool.query(
          `UPDATE encounter_sessions SET note_error = $2 WHERE id = $1`,
          [s.id, r.error.slice(0, 300)],
        ).catch(() => { /* intentional: bookkeeping best-effort */ });
        trace.event('note', `Session #${s.seq} draft failed: ${r.error.slice(0, 120)}`, r.latency_ms, true, true);
        await trace.finalise({ status: 'errored', error_message: r.error.slice(0, 300) });
      }
    }

    // Whole-encounter note (Review Queue surface). N=1 → the session draft;
    // N>1 → P3a HYBRID STITCH (design §12.4, LOCKED): earlier sessions'
    // drafts + the final session's verbatim tagged transcript + the
    // orders/results chronology → one unified note (draft provisional,
    // results interleaved, awaited tests carried into the plan).
    if (generatedAny || force) {
      const { rows: allSessions } = await pool.query<StitchInputSession & { id: string }>(
        `SELECT id, seq, started_at::text AS started_at, ended_at::text AS ended_at,
                note_json, tagged_transcript, transcript_en
           FROM encounter_sessions
          WHERE encounter_id = $1 AND transcribed_at IS NOT NULL
          ORDER BY seq ASC`,
        [encounterId],
      );
      const noted = allSessions.filter((r) => r.note_json != null);
      let encNote: OpdNote | null = null;
      if (allSessions.length === 1 && noted.length === 1) {
        encNote = noted[0].note_json as OpdNote;
      } else if (allSessions.length > 1) {
        const trace = await openTrace({
          surface: 'note-gen',
          encounter_id: encounterId,
          patient_id: enc.patient_id,
          doctor_email: enc.doctor_email,
          request_input: { scope: 'stitch', sessions: allSessions.length, model: NOTE_MODEL },
        });
        trace.event('stitch', `Stitching ${allSessions.length} sessions (drafts + final verbatim + chronology)`);
        const st = await generateStitchedNote(encounterId, allSessions);
        if (st.ok) {
          encNote = st.note;
          trace.event(
            'stitch',
            `Unified note ready (${st.chronology.orders} order(s), ${st.chronology.results} result(s), ${st.chronology.awaited} awaited)`,
            st.latency_ms,
            true,
          );
          await trace.finalise({
            status: 'completed',
            result_summary: {
              chief_complaint: st.note.chief_complaint.slice(0, 120),
              sessions: allSessions.length,
              chronology: { orders: st.chronology.orders, results: st.chronology.results, awaited: st.chronology.awaited },
            },
            model_calls: [{ model: st.model, latency_ms: st.latency_ms }],
          });
        } else {
          // Fallback: full-transcript regen (the P2.3 provisional path) so a
          // stitch-specific failure can't strand the encounter without a note.
          trace.event('stitch', `Stitch failed (${st.error.slice(0, 100)}) — falling back to full-transcript draft`, st.latency_ms, false, true);
          const fullText = transcriptForNote(enc.tagged_transcript, null) ||
            allSessions.map((t) => transcriptForNote(t.tagged_transcript, t.transcript_en)).filter(Boolean).join('\n\n');
          if (fullText.trim().length > 0) {
            const r = await generateOpdNote(fullText);
            if (r.ok) {
              encNote = r.note;
              trace.event('note', 'Fallback whole-encounter draft ready', r.latency_ms, true);
              await trace.finalise({
                status: 'completed',
                result_summary: { chief_complaint: r.note.chief_complaint.slice(0, 120), sessions: allSessions.length, fallback: true },
                model_calls: [{ model: r.model, latency_ms: r.latency_ms }],
              });
            } else {
              failed++;
              lastError = `note_stitch: ${st.error}`;
              trace.event('note', `Fallback draft failed: ${r.error.slice(0, 120)}`, r.latency_ms, true, true);
              await trace.finalise({ status: 'errored', error_message: `stitch: ${st.error.slice(0, 140)} | fallback: ${r.error.slice(0, 140)}` });
            }
          } else {
            failed++;
            lastError = `note_stitch: ${st.error}`;
            await trace.finalise({ status: 'errored', error_message: st.error.slice(0, 300) });
          }
        }
      }

      if (encNote) {
        await pool.query(
          `UPDATE encounters SET note_json = $2::jsonb, updated_at = NOW() WHERE id = $1`,
          [encounterId, JSON.stringify(encNote)],
        );

        // §10.1 field-provenance merge — fill ONLY untouched text Sections.
        try {
          const { rows: cur } = await pool.query<{
            chief_complaint_text: string | null;
            exam_findings: string | null;
            assessment_text: string | null;
            field_provenance: Record<string, string> | null;
          }>(
            `SELECT chief_complaint_text, exam_findings, assessment_text, field_provenance
               FROM encounters WHERE id = $1`,
            [encounterId],
          );
          if (cur.length > 0) {
            const prov = cur[0].field_provenance ?? {};
            const sets: string[] = [];
            const vals: unknown[] = [encounterId];
            const newProv: Record<string, string> = {};
            const tryFill = (field: string, column: string, current: string | null, value: string) => {
              if (!value || !mayFill(prov[field], current)) return;
              vals.push(value);
              sets.push(`${column} = $${vals.length}`);
              newProv[field] = 'ai_generated';
            };
            tryFill('chief_complaint_text', 'chief_complaint_text', cur[0].chief_complaint_text, encNote.chief_complaint);
            tryFill('exam_findings', 'exam_findings', cur[0].exam_findings, encNote.examination);
            tryFill('assessment_text', 'assessment_text', cur[0].assessment_text, encNote.assessment);
            if (sets.length > 0) {
              vals.push(JSON.stringify(newProv));
              await pool.query(
                `UPDATE encounters
                    SET ${sets.join(', ')},
                        field_provenance = COALESCE(field_provenance, '{}'::jsonb) || $${vals.length}::jsonb,
                        updated_at = NOW()
                  WHERE id = $1`,
                vals,
              );
            }
          }
        } catch {
          /* intentional: Section fill is an enrichment over note_json */
        }
      }
    }
  } catch (e) {
    failed++;
    lastError = `note_stage: ${(e instanceof Error ? e.message : String(e)).slice(0, 280)}`;
  }
  return { done, failed, lastError };
}

type DiarizeSessionRow = {
  id: string;
  seq: number;
  audio_object_key: string;
  diarized_json: unknown;
};

/**
 * P2.2 stage core. For each transcribed session with audio:
 *   1. pyannote /diarize with the encounter doctor's voice_print centroid
 *      (if enrolled) → named speakers; unenrolled → anonymous Speaker 1/2
 *      roles (proceeds UNLABELED — P2.2 lock).
 *   2. timed English entries: Sarvam batch diarized_json (non-EN path,
 *      stored in P2.1) or Deepgram diarized batch (EN path) → reconcile
 *      onto pyannote speakers by time overlap → first-person → Patient
 *      override (never overrides the enrolled-clinician auto-match) →
 *      tagged_transcript.
 *   3. passive voiceprint capture (once per encounter, 0.82 include gate).
 * Soft-fail per session: diarize_error set, diarized_at stays NULL (sweep
 * retries hourly), loop continues. Never throws.
 */
async function diarizeSessions(
  encounterId: string,
  force: boolean,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  try {
    // Doctor + centroid (LEFT JOIN — unenrolled proceeds with no centroids).
    const { rows: encRows } = await pool.query<{
      doctor_id: string | null;
      doctor_name: string | null;
      centroid_b64: string | null;
    }>(
      `SELECT e.doctor_id, d.name AS doctor_name,
              encode(vp.centroid, 'base64') AS centroid_b64
         FROM encounters e
         LEFT JOIN doctors d ON d.id = e.doctor_id
         LEFT JOIN voice_print vp ON vp.doctor_id = e.doctor_id
        WHERE e.id = $1`,
      [encounterId],
    );
    if (encRows.length === 0) return { done, failed };
    const doctorId = encRows[0].doctor_id;
    const clinicianCentroids =
      doctorId && encRows[0].centroid_b64
        ? [{
            clinician_id: doctorId,
            full_name: encRows[0].doctor_name ?? 'Doctor',
            centroid_base64: encRows[0].centroid_b64,
          }]
        : [];

    const { rows: sessions } = await pool.query<DiarizeSessionRow>(
      `SELECT id, seq, audio_object_key, diarized_json
         FROM encounter_sessions
        WHERE encounter_id = $1
          AND transcribed_at IS NOT NULL
          AND audio_object_key IS NOT NULL
          AND (diarized_at IS NULL OR $2::boolean)
        ORDER BY seq ASC`,
      [encounterId, force],
    );
    if (sessions.length === 0) return { done, failed };

    let passiveCaptured = false;
    for (const s of sessions) {
      try {
        const bytes = await getObjectBytes(s.audio_object_key);
        if (!bytes || bytes.length === 0) throw new Error('audio_missing_in_r2');
        const buf = Buffer.from(bytes);

        const d = await runDiarize(buf, 'audio/webm', {
          encounterId,
          clinicianCentroids,
          manualRelabels: [],
        });
        if (!d.ok) throw new Error(d.error);
        let speakers: DiarizeSpeaker[] = d.result.speakers;

        // Timed English entries for tagging: the non-EN path already stored
        // Sarvam's diarized entries in P2.1; the EN path runs Deepgram batch.
        let entries: DiarEntryLike[] = Array.isArray(s.diarized_json)
          ? (s.diarized_json as DiarEntryLike[]).filter(
              (e) => typeof e?.transcript === 'string' && e.transcript.length > 0,
            )
          : [];
        if (entries.length === 0) {
          const dg = await transcribeDiarized(buf, 'audio/webm');
          if (dg.ok) entries = dg.entries;
        }

        let tagged: TaggedEntry[] = [];
        if (entries.length > 0) {
          const segs = d.result.transcript_segments as SegLike[];
          tagged = reconcileTagged(entries, segs, speakers);
          const refined = applyRoleOverrides(speakers, tagged);
          if (refined.changed) {
            speakers = refined.speakers;
            tagged = reconcileTagged(entries, segs, speakers);
          }
        }

        // Strip embeddings before persisting (kept only in-memory for the
        // passive-capture step below; voice_sample stores them properly).
        const persistSpeakers = speakers.map(({ embedding_base64: _e, ...rest }) => rest);
        await pool.query(
          `UPDATE encounter_sessions
              SET speakers_json = $2::jsonb,
                  tagged_transcript = $3::jsonb,
                  diarized_at = NOW(),
                  diarize_error = NULL
            WHERE id = $1`,
          [s.id, JSON.stringify(persistSpeakers), tagged.length > 0 ? JSON.stringify(tagged) : null],
        );
        done++;

        // Passive voiceprint capture — day one, strict 0.82 gate (P2.2 lock).
        // Once per encounter; capturePassiveSample also dedups in the DB.
        if (!passiveCaptured && doctorId) {
          const mine = speakers.find(
            (sp) =>
              sp.clinician_id === doctorId &&
              typeof sp.embedding_base64 === 'string' &&
              sp.embedding_base64.length > 0,
          );
          if (mine?.embedding_base64) {
            try {
              await capturePassiveSample({
                clinicianId: doctorId,
                embeddingBase64: mine.embedding_base64,
                encounterId,
                audioR2Key: s.audio_object_key,
                contentType: 'audio/webm',
                confidence: typeof mine.confidence === 'number' ? mine.confidence : null,
              });
              passiveCaptured = true;
            } catch {
              /* intentional: passive capture is fully non-blocking */
            }
          }
        }
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await pool.query(
          `UPDATE encounter_sessions SET diarize_error = $2 WHERE id = $1`,
          [s.id, msg.slice(0, 300)],
        ).catch(() => { /* intentional: error bookkeeping is best-effort */ });
      }
    }

    // Whole-encounter convenience view: seq-ordered concat of session turns.
    try {
      const { rows: tt } = await pool.query<{ tagged_transcript: unknown }>(
        `SELECT tagged_transcript FROM encounter_sessions
          WHERE encounter_id = $1 AND tagged_transcript IS NOT NULL
          ORDER BY seq ASC`,
        [encounterId],
      );
      const concat = tt.flatMap((r) =>
        Array.isArray(r.tagged_transcript) ? (r.tagged_transcript as TaggedEntry[]) : [],
      );
      if (concat.length > 0) {
        await pool.query(
          `UPDATE encounters SET tagged_transcript = $2::jsonb, updated_at = NOW() WHERE id = $1`,
          [encounterId, JSON.stringify(concat)],
        );
      }
    } catch {
      /* intentional: the concat is a convenience view; sessions are canonical */
    }
  } catch {
    /* intentional: the whole stage is soft-fail — never blocks the pipeline */
  }
  return { done, failed };
}

/** Encounters with pipeline work left (untranscribed sessions, transcribed-
 *  but-undiarized — P2.2 retry path — or transcribed-but-unnoted — P2.3
 *  retry path), for the cron sweep. */
export async function findUnprocessedEncounters(limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ encounter_id: string }>(
    `SELECT DISTINCT s.encounter_id
       FROM encounter_sessions s
       JOIN encounters e ON e.id = s.encounter_id
      WHERE s.audio_object_key IS NOT NULL
        AND ((s.status = 'uploaded' AND s.transcribed_at IS NULL)
             OR (s.transcribed_at IS NOT NULL AND s.diarized_at IS NULL)
             OR (s.transcribed_at IS NOT NULL AND s.note_generated_at IS NULL)
             OR (e.note_json IS NOT NULL AND e.cdmss_generated_at IS NULL))
        AND (e.processing_status NOT IN ('transcribing', 'generating')
             OR e.processing_started_at < NOW() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.encounter_id);
}

/** Reap encounters wedged in transcribing/generating past the stale window. */
export async function reapStuckProcessing(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE encounters
        SET processing_status = 'errored',
            processing_error = 'reaped_stuck_processing',
            updated_at = NOW()
      WHERE processing_status IN ('transcribing', 'generating')
        AND processing_started_at < NOW() - make_interval(mins => ${STALE_CLAIM_MINUTES * 2})`,
  );
  return rowCount ?? 0;
}
