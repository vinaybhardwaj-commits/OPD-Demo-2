/**
 * src/lib/llm-trace/log.ts
 *
 * Forensic trace logging — every LLM-firing route creates one
 * llm_traces row at the start, accumulates events through the pipeline,
 * and finalises status + total_ms + result_summary on completion or
 * error.
 *
 * Decision Q2: retention forever (no sweep). Decision Q7: encounter +
 * patient-level fires are queryable by tab on the respective pages.
 *
 * Usage pattern in a route:
 *
 *   const trace = await openTrace({ surface: 'ddx', encounter_id, doctor_email, request_input });
 *   const { stream, emit, close } = makeNdjsonStream();
 *   (async () => {
 *     try {
 *       emit({ type: 'progress', stage: 'expanding', msg: '…' });
 *       trace.event('expanding', '…');
 *       …
 *       const result = await withHeartbeat(emit, 'drafting', 'Drafting', async () => {
 *         trace.event('drafting', 'Drafting (start)');
 *         const r = await qwenJson(...);
 *         return r;
 *       });
 *       emit({ type: 'done', ms: Date.now() - t0 });
 *       trace.event('done', '', Date.now() - t0, true);
 *       await trace.finalise({ status: 'completed', result_summary: result });
 *     } catch (e) {
 *       emit({ type: 'error', message: String(e) });
 *       await trace.finalise({ status: 'errored', error_message: String(e) });
 *     } finally { close(); }
 *   })();
 *
 *   return new Response(stream, { headers: { ...ndjsonHeaders(), 'X-Trace-Id': trace.id }});
 */

import { pool } from '../db';

export type TraceEventLog = {
  ts: number;
  stage: string;
  msg: string;
  ms?: number;
  done?: boolean;
  error?: boolean;
};

export type TraceStatus = 'in_progress' | 'completed' | 'errored' | 'aborted';

export type OpenTraceArgs = {
  surface: string;
  encounter_id?: string | null;
  patient_id?: string | null;
  doctor_email?: string | null;
  request_input?: unknown;
};

export type TraceHandle = {
  /** UUID — also returned via the X-Trace-Id header to the client. */
  id: string;
  /** Append an event to the in-memory buffer. Persisted only on finalise. */
  event: (stage: string, msg: string, ms?: number, done?: boolean, error?: boolean) => void;
  /**
   * Persist the trace with terminal status. Writes a single UPDATE.
   * Soft-fails on DB error (logs to console). Returns nothing.
   */
  finalise: (args: {
    status: TraceStatus;
    result_summary?: unknown;
    error_message?: string;
    model_calls?: Array<{ model: string; latency_ms: number; tokens_in?: number; tokens_out?: number }>;
  }) => Promise<void>;
};

/**
 * Insert the trace row immediately (status='in_progress'), return a
 * handle that buffers events and writes them on finalise. Soft-fails
 * on initial insert — the pipeline still runs, just without audit.
 */
export async function openTrace(args: OpenTraceArgs): Promise<TraceHandle> {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const events: TraceEventLog[] = [];

  try {
    await pool.query(
      `INSERT INTO llm_traces
         (id, surface, encounter_id, patient_id, doctor_email,
          request_input, events, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'in_progress', $8)`,
      [
        id,
        args.surface,
        args.encounter_id ?? null,
        args.patient_id ?? null,
        args.doctor_email ?? null,
        args.request_input ? JSON.stringify(args.request_input) : null,
        JSON.stringify([]),
        startedAt,
      ],
    );
  } catch (e) {
    console.warn('[llm-trace] openTrace insert failed (continuing):', e);
  }

  return {
    id,
    event(stage, msg, ms, done = false, error = false) {
      events.push({ ts: Date.now(), stage, msg, ms, done, error });
    },
    async finalise({ status, result_summary, error_message, model_calls }) {
      const total_ms = events.length > 0 ? Date.now() - (events[0]?.ts ?? Date.now()) : null;
      const completed_at = new Date().toISOString();
      try {
        await pool.query(
          `UPDATE llm_traces
              SET events = $2::jsonb,
                  result_summary = $3::jsonb,
                  model_calls = $4::jsonb,
                  total_ms = $5,
                  status = $6,
                  error_message = $7,
                  completed_at = $8
            WHERE id = $1`,
          [
            id,
            JSON.stringify(events),
            result_summary ? JSON.stringify(result_summary) : null,
            model_calls ? JSON.stringify(model_calls) : null,
            total_ms,
            status,
            error_message ?? null,
            completed_at,
          ],
        );
      } catch (e) {
        console.warn('[llm-trace] finalise UPDATE failed (continuing):', e);
      }
    },
  };
}

/**
 * Convenience: load a trace row by id for the /llm/trace/[id] page.
 * Returns null if not found.
 */
export async function getTrace(id: string): Promise<{
  id: string;
  surface: string;
  encounter_id: string | null;
  patient_id: string | null;
  doctor_email: string | null;
  request_input: unknown;
  events: TraceEventLog[];
  result_summary: unknown;
  model_calls: unknown;
  total_ms: number | null;
  status: TraceStatus;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
} | null> {
  try {
    const { rows } = await pool.query(
      `SELECT id, surface, encounter_id, patient_id, doctor_email,
              request_input, events, result_summary, model_calls,
              total_ms, status, error_message,
              started_at::text AS started_at,
              completed_at::text AS completed_at
         FROM llm_traces WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      surface: String(r.surface),
      encounter_id: r.encounter_id ? String(r.encounter_id) : null,
      patient_id: r.patient_id ? String(r.patient_id) : null,
      doctor_email: r.doctor_email ? String(r.doctor_email) : null,
      request_input: r.request_input ?? null,
      events: Array.isArray(r.events) ? (r.events as TraceEventLog[]) : [],
      result_summary: r.result_summary ?? null,
      model_calls: r.model_calls ?? null,
      total_ms: r.total_ms == null ? null : Number(r.total_ms),
      status: (r.status as TraceStatus) ?? 'in_progress',
      error_message: r.error_message ? String(r.error_message) : null,
      started_at: String(r.started_at),
      completed_at: r.completed_at ? String(r.completed_at) : null,
    };
  } catch (e) {
    console.warn('[llm-trace] getTrace failed:', e);
    return null;
  }
}

/**
 * List traces tied to an encounter, newest first. Used by the
 * 'AI activity' tab on the encounter page (Q7).
 */
export async function listTracesForEncounter(
  encounterId: string,
  limit = 100,
): Promise<Array<{ id: string; surface: string; status: TraceStatus; total_ms: number | null; started_at: string }>> {
  try {
    const { rows } = await pool.query(
      `SELECT id, surface, status, total_ms, started_at::text AS started_at
         FROM llm_traces
        WHERE encounter_id = $1
        ORDER BY started_at DESC
        LIMIT $2`,
      [encounterId, limit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      surface: String(r.surface),
      status: (r.status as TraceStatus) ?? 'in_progress',
      total_ms: r.total_ms == null ? null : Number(r.total_ms),
      started_at: String(r.started_at),
    }));
  } catch (e) {
    console.warn('[llm-trace] listTracesForEncounter failed:', e);
    return [];
  }
}

/**
 * Same shape, but for a patient (covers patient-level fires like
 * recomputePatientSummary or suggest-comorbidities-from-history).
 */
export async function listTracesForPatient(
  patientId: string,
  limit = 100,
): Promise<Array<{ id: string; surface: string; status: TraceStatus; total_ms: number | null; started_at: string; encounter_id: string | null }>> {
  try {
    const { rows } = await pool.query(
      `SELECT id, surface, status, total_ms, encounter_id,
              started_at::text AS started_at
         FROM llm_traces
        WHERE patient_id = $1
        ORDER BY started_at DESC
        LIMIT $2`,
      [patientId, limit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      surface: String(r.surface),
      status: (r.status as TraceStatus) ?? 'in_progress',
      total_ms: r.total_ms == null ? null : Number(r.total_ms),
      started_at: String(r.started_at),
      encounter_id: r.encounter_id ? String(r.encounter_id) : null,
    }));
  } catch (e) {
    console.warn('[llm-trace] listTracesForPatient failed:', e);
    return [];
  }
}
