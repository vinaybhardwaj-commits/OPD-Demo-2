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
 * P2.2 chains diarize+voiceprint; P2.3 note-gen; P2.4 CDS.
 *
 * Concurrency: atomic claim on encounters.processing_status with a 30-min
 * stale-claim takeover (the reaper rule) — two simultaneous calls can't
 * double-process.
 */
import { pool } from './db';
import { getObjectBytes } from './r2';
import { transcribeWithWhisper } from './whisper';
import { sarvamBatchTranslate, isNonEnglish, SARVAM_MEDICAL_PROMPT } from './sarvam';

const STALE_CLAIM_MINUTES = 30;

export type ProcessOutcome = {
  ok: boolean;
  claimed: boolean;
  encounter_id: string;
  processing_status: string;
  sessions_done: number;
  sessions_failed: number;
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
    error: lastError ?? undefined,
  };
}

/** Encounters with uploaded-but-untranscribed sessions, for the cron sweep. */
export async function findUnprocessedEncounters(limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ encounter_id: string }>(
    `SELECT DISTINCT s.encounter_id
       FROM encounter_sessions s
       JOIN encounters e ON e.id = s.encounter_id
      WHERE s.status = 'uploaded'
        AND s.audio_object_key IS NOT NULL
        AND s.transcribed_at IS NULL
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
