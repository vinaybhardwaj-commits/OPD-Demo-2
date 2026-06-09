/**
 * GET /api/patients/[id]/summary
 *
 * Returns the cached Qwen summary for a patient. Authed-doctor only.
 *
 * Response shapes:
 *   200 { ok: true, summary: {...}, status, computed_at, qwen_latency_ms,
 *         source_encounter_count, source_window_start, source_window_end,
 *         fail_reason: string | null }
 *   200 { ok: true, summary: null, status: 'missing' } — patient exists
 *         but no summary row yet (cold-start; UI should kick recompute)
 *   401 { ok: false, error: 'unauthorized' }
 *   404 { ok: false, error: 'patient_not_found' }
 *
 * The endpoint never blocks on Qwen — recompute lives at
 * /api/internal/recompute-summary. This is a pure cache reader.
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SummaryRow = {
  summary: unknown;
  source_encounter_count: number;
  source_window_start: string;
  source_window_end: string;
  qwen_model: string;
  qwen_latency_ms: number | null;
  computed_at: string;
  status: string;
  fail_reason: string | null;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;

  // Confirm patient exists first so 404 vs missing-summary stays distinguishable.
  const { rows: pRows } = await pool.query<{ id: string; name: string; mrn: string }>(
    `SELECT id, name, mrn FROM patients WHERE id = $1 LIMIT 1`,
    [id],
  );
  const patient = pRows[0];
  if (!patient) {
    return NextResponse.json({ ok: false, error: 'patient_not_found' }, { status: 404 });
  }

  const { rows } = await pool.query<SummaryRow>(
    `SELECT summary, source_encounter_count,
            source_window_start::text AS source_window_start,
            source_window_end::text AS source_window_end,
            qwen_model, qwen_latency_ms, computed_at::text AS computed_at,
            status, fail_reason
       FROM patient_summaries
      WHERE patient_id = $1
      LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({
      ok: true,
      patient: { id: patient.id, name: patient.name, mrn: patient.mrn },
      summary: null,
      status: 'missing',
    });
  }

  return NextResponse.json({
    ok: true,
    patient: { id: patient.id, name: patient.name, mrn: patient.mrn },
    summary: row.summary,
    status: row.status,
    computed_at: row.computed_at,
    qwen_model: row.qwen_model,
    qwen_latency_ms: row.qwen_latency_ms,
    source_encounter_count: row.source_encounter_count,
    source_window_start: row.source_window_start,
    source_window_end: row.source_window_end,
    fail_reason: row.fail_reason,
  });
}
