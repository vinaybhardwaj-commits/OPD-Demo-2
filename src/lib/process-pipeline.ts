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
 * P2.3 note-gen; P2.4 CDS.
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

  // Final status. 'ready' = all current pipeline stages done (P2.3 inserts
  // 'generating' between). Failures → 'errored' with the last error kept.
  const finalStatus = failed > 0 ? 'errored' : 'ready';
  await pool.query(
    `UPDATE encounters
        SET processing_status = $2,
            processing_error = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [encounterId, finalStatus, failed > 0 ? (lastError ?? 'unknown').slice(0, 300) : null],
  );

  return {
    ...base,
    ok: failed === 0,
    claimed: true,
    processing_status: finalStatus,
    sessions_done: done,
    sessions_failed: failed,
    sessions_diarized: dz.done,
    diarize_failed: dz.failed,
    error: lastError ?? undefined,
  };
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

/** Encounters with pipeline work left (untranscribed sessions OR
 *  transcribed-but-undiarized — the P2.2 diarize soft-fail retry path),
 *  for the cron sweep. */
export async function findUnprocessedEncounters(limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ encounter_id: string }>(
    `SELECT DISTINCT s.encounter_id
       FROM encounter_sessions s
       JOIN encounters e ON e.id = s.encounter_id
      WHERE s.audio_object_key IS NOT NULL
        AND ((s.status = 'uploaded' AND s.transcribed_at IS NULL)
             OR (s.transcribed_at IS NOT NULL AND s.diarized_at IS NULL))
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
