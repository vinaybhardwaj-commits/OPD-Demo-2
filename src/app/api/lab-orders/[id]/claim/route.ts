/**
 * POST /api/lab-orders/[id]/claim
 *
 * Lab tech claims an order — flips status pending → in_progress and
 * stamps claimed_by_lab_tech_id + claimed_at.
 *
 * Soft-claim model (v2.1.2 lock): another tech CAN still open the row
 * (it just shows a "Claimed by …" banner). Only one tech can be the
 * record-holder at a time, though, so re-claiming overwrites the
 * stamp.
 *
 * Allowed roles: lab_tech, admin.
 * Allowed source states: pending, in_progress.
 *   - pending → in_progress: normal claim
 *   - in_progress (by someone else) → still in_progress, claim
 *     transfers (this is what the "Take over" button does)
 *   - in_progress (by self) → no-op, return 200 with reclaimed=false
 *
 * Notifies on `queue:lab` so other tech screens refresh.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyQueue } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.role !== 'lab_tech' && session.role !== 'admin') {
    return NextResponse.json(
      { ok: false, error: 'forbidden_role', detail: 'Lab tech or admin only.' },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }

  // Resolve the tech's doctors-row id from email.
  const { rows: techRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const techId = techRows[0]?.id;
  if (!techId) {
    return NextResponse.json({ ok: false, error: 'tech_not_seeded' }, { status: 500 });
  }

  // Load + verify the order.
  const { rows } = await pool.query<{
    id: string;
    status: string;
    claimed_by_lab_tech_id: string | null;
  }>(
    `SELECT id, status, claimed_by_lab_tech_id
     FROM lab_orders
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  const order = rows[0];
  if (!order) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (order.status === 'resulted' || order.status === 'cancelled') {
    return NextResponse.json(
      { ok: false, error: 'order_closed', detail: `Order is ${order.status}.` },
      { status: 409 },
    );
  }
  if (order.status === 'pre_staged') {
    return NextResponse.json(
      {
        ok: false,
        error: 'not_confirmed_by_doctor',
        detail: 'Order is still pre_staged — wait for the doctor to confirm.',
      },
      { status: 409 },
    );
  }

  // No-op if already claimed by this tech and in_progress.
  if (order.status === 'in_progress' && order.claimed_by_lab_tech_id === techId) {
    return NextResponse.json({
      ok: true,
      noop: true,
      reclaimed: false,
      order_id: id,
    });
  }

  await pool.query(
    `UPDATE lab_orders
     SET status = 'in_progress',
         claimed_by_lab_tech_id = $2,
         claimed_at = NOW()
     WHERE id = $1`,
    [id, techId],
  );

  await notifyQueue('queue:lab', `claimed:${id}`);

  return NextResponse.json({
    ok: true,
    order_id: id,
    claimed_by: techId,
    reclaimed: order.claimed_by_lab_tech_id !== null,
  });
}
