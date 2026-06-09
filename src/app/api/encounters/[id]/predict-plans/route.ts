/**
 * GET  /api/encounters/[id]/predict-plans
 *   - Returns the most recent persisted prediction without spending an
 *     LLM call. If the latest prediction's snapshot_hash matches the
 *     current snapshot's hash, the response is `cached: true`. If it
 *     doesn't match, returns `cached: true` with a `stale: true` flag
 *     so the UI can decide whether to force a refresh.
 *   - If no prior prediction exists, transparently performs a fresh
 *     prediction (one LLM call), like POST.
 *
 * POST /api/encounters/[id]/predict-plans
 *   - Forces a fresh prediction. Bypasses in-process cache.
 *   - Use when the encounter has changed materially (new transcription,
 *     new Rx, new lab result) and the doctor wants up-to-date suggestions.
 *
 * The full snapshot used for the prediction is NOT returned to clients
 * (PHI minimization). Only the prediction hash + result.
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import {
  buildSnapshot,
  predictPlans,
  snapshotHash,
  getLatestPrediction,
} from '@/lib/plan-prediction';
import { makeNdjsonStream, ndjsonHeaders } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ownsEncounter(
  encId: string,
  doctorEmail: string,
): Promise<{ ok: true } | { ok: false; status_code: number }> {
  const { rows } = await pool.query<{ doctor_email: string }>(
    `SELECT d.email AS doctor_email
       FROM encounters e
       JOIN doctors d ON d.id = e.doctor_id
      WHERE e.id = $1
      LIMIT 1`,
    [encId],
  );
  const row = rows[0];
  if (!row) return { ok: false, status_code: 404 };
  if (row.doctor_email.toLowerCase() !== doctorEmail.toLowerCase()) {
    return { ok: false, status_code: 403 };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GET — return cached/persisted prediction; fall through to a fresh call
//       if none exists.
// ---------------------------------------------------------------------------

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const own = await ownsEncounter(id, session.email);
  if (!own.ok) {
    return NextResponse.json(
      { ok: false, error: own.status_code === 404 ? 'not_found' : 'forbidden' },
      { status: own.status_code },
    );
  }

  // Build current snapshot for hash comparison. Skip if encounter is gone.
  const snapshot = await buildSnapshot(id);
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  const currentHash = snapshotHash(snapshot);

  // Try persisted (most-recent) prediction first.
  const latest = await getLatestPrediction(id);
  if (latest && latest.ok) {
    const stale = latest.snapshot_hash !== currentHash;
    return NextResponse.json({
      ok: true,
      result: latest,
      stale,
      current_snapshot_hash: currentHash,
    });
  }

  // No prior prediction — fall through to a fresh call. This is the same
  // code path as POST, so callers can rely on GET always returning *some*
  // prediction (or a soft-fail body) on first visit.
  const fresh = await predictPlans(id, snapshot);
  return NextResponse.json({
    ok: true,
    result: fresh,
    stale: false,
    current_snapshot_hash: currentHash,
  });
}

// ---------------------------------------------------------------------------
// POST — force a fresh prediction
// ---------------------------------------------------------------------------

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const own = await ownsEncounter(id, session.email);
  if (!own.ok) {
    return NextResponse.json(
      { ok: false, error: own.status_code === 404 ? 'not_found' : 'forbidden' },
      { status: own.status_code },
    );
  }

  const snapshot = await buildSnapshot(id);
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  const currentHash = snapshotHash(snapshot);

  const accept = req.headers.get('accept') ?? '';
  const wantsStream = accept.includes('application/x-ndjson');

  if (wantsStream) {
    const trace = await openTrace({
      surface: 'predict-plans',
      encounter_id: id,
      doctor_email: session.email,
      request_input: { encounter_id: id, force: true },
    });
    const { stream, emit, close } = makeNdjsonStream();
    const abort = new AbortController();
    const tStart = Date.now();

    (async () => {
      try {
        const result = await predictPlans(id, snapshot, {
          force: true,
          signal: abort.signal,
          emit: (ev) => {
            emit(ev);
            if (ev.type === 'progress') trace.event(ev.stage, ev.msg, ev.ms);
          },
        });
        emit({
          type: 'result',
          data: {
            ok: true,
            result,
            stale: false,
            current_snapshot_hash: currentHash,
          },
        });
        emit({ type: 'done', ms: Date.now() - tStart });
        await trace.finalise({
          status: result.ok ? 'completed' : 'errored',
          result_summary: result.ok
            ? { count: result.predictions.length, severity: result.severity_estimate, latency_ms: result.latency_ms }
            : { reason: result.reason },
          error_message: result.ok ? undefined : result.reason,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emit({ type: 'error', message: msg });
        await trace.finalise({ status: 'errored', error_message: msg });
      } finally {
        close();
      }
    })();

    req.signal?.addEventListener('abort', () => abort.abort(), { once: true });

    return new Response(stream, {
      headers: {
        ...Object.fromEntries(ndjsonHeaders()),
        'X-Trace-Id': trace.id,
      },
    });
  }

  const result = await predictPlans(id, snapshot, { force: true });
  return NextResponse.json({
    ok: true,
    result,
    stale: false,
    current_snapshot_hash: currentHash,
  });
}
