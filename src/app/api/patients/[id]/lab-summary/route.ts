/**
 * GET /api/patients/[id]/lab-summary
 *
 * v4.0.1 — compact counts for the new patient context strip.
 * Returns total / in_progress / completed / abnormal lab counts for
 * the patient (across encounters).
 *
 * Soft-fail. Empty counts render gracefully in the strip.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const { id: patientId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(patientId)) {
      return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
    }
    // lab_orders is a view over diagnostic_orders post-v3.0b; use it for back-compat.
    const { rows } = await pool.query<{
      total: number;
      in_progress: number;
      completed: number;
      abnormal: number;
    }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('pending','in_progress','ordered','dispatched'))::int AS in_progress,
         COUNT(*) FILTER (WHERE status IN ('completed','resulted'))::int AS completed,
         COALESCE((
           SELECT COUNT(*)::int FROM lab_result_annotations a
           WHERE a.patient_id = $1 AND a.flag IN ('abnormal','critical')
         ), 0) AS abnormal
       FROM lab_orders
       WHERE patient_id = $1`,
      [patientId],
    );
    return NextResponse.json({ ok: true, summary: rows[0] ?? { total: 0, in_progress: 0, completed: 0, abnormal: 0 } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
