/**
 * GET /api/encounters/[id]/traces
 *
 * v6.0 Phase 4 — backs the encounter AI-activity tab (decision Q7).
 *
 * Returns the most-recent llm_traces rows tied to this encounter as a
 * thin list { id, surface, status, total_ms, started_at }. The
 * BackgroundTraceToaster also polls this endpoint every 3s and filters
 * for status='in_progress' rows so server-side background fires
 * (recomputePatientSummary, etc.) appear as toasts on the encounter
 * page they originated from.
 *
 * Auth: encounter owner or admin.
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { listTracesForEncounter } from '@/lib/llm-trace/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const { rows } = await pool.query<{ doctor_email: string }>(
    `SELECT d.email AS doctor_email
       FROM encounters e
       JOIN doctors d ON d.id = e.doctor_id
      WHERE e.id = $1 LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (session.role !== 'admin' && row.doctor_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const traces = await listTracesForEncounter(id, 200);
  return NextResponse.json({ ok: true, traces });
}
