/**
 * POST /api/encounters/[id]/cancel-diagnostics — v4.1.0
 *
 * Doctor-side escape hatch: cancels every still-incomplete diagnostic
 * order on the encounter and flips the encounter back to 'active' so
 * the doctor can submit. Use case: doctor sent labs/imaging, then
 * decided the answer doesn't depend on the result (e.g. switched
 * disposition to discharge/follow-up).
 *
 * State machine:
 *   paused_diagnostics → active                     OK
 *   ready_to_resume    → active                     OK (idempotent-ish)
 *   active             → active   (200 noop)
 *   completed          → 409 encounter_completed_immutable
 *
 * Cancels diagnostic_orders WHERE status NOT IN ('cancelled','completed',
 * 'posted'). Stamps cancelled_at, cancelled_by_doctor_id, cancel_reason.
 * Clears encounters.pending_diagnostic_test.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { notifyRoom } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: { reason?: string } = {};
  try { body = await req.json(); } catch { /* allow empty body */ }
  const reason = (body.reason ?? 'Doctor cancelled pending diagnostics to finish encounter').slice(0, 280);

  const { rows: encRows } = await pool.query<{ status: string; room_id: string | null }>(
    `SELECT status, room_id FROM encounters WHERE id = $1 LIMIT 1`,
    [id],
  );
  const enc = encRows[0];
  if (!enc) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  if (enc.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_completed_immutable' },
      { status: 409 },
    );
  }

  // Cancel all incomplete diagnostic orders on this encounter.
  const { rows: cancelled } = await pool.query<{ id: string; service_code: string }>(
    `UPDATE diagnostic_orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancelled_by_doctor_id = $2,
         cancel_reason = $3,
         updated_at = NOW()
     WHERE encounter_id = $1
       AND status NOT IN ('cancelled','completed','posted')
     RETURNING id, service_code`,
    [id, session.id ?? null, reason],
  );

  // Flip the encounter back to active + clear the pending test name.
  await pool.query(
    `UPDATE encounters
     SET status = 'active',
         pending_diagnostic_test = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [id],
  );

  await notifyRoom(enc.room_id, `diagnostics_cancelled:${id}`);

  return NextResponse.json({
    ok: true,
    encounter_id: id,
    cancelled_count: cancelled.length,
    cancelled_ids: cancelled.map((r) => r.id),
  });
}
