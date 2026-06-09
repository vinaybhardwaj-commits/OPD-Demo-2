/**
 * POST /api/lab-orders/[id]/release
 *
 * Lab tech releases their claim on an in_progress order — flips status
 * back to pending and clears claimed_by_lab_tech_id + claimed_at.
 *
 * Allowed roles: lab_tech, admin.
 * Permission: only the claiming tech (or admin) can release.
 * Allowed source states: in_progress only.
 *
 * v2.1.2 lock — soft-claim model. Release is manual; the auto-release
 * after-N-minutes pattern is deferred to v2.1.x polish.
 *
 * Notifies on `queue:lab`.
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

  const { rows: techRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const techId = techRows[0]?.id;
  if (!techId) {
    return NextResponse.json({ ok: false, error: 'tech_not_seeded' }, { status: 500 });
  }

  const { rows } = await pool.query<{
    id: string;
    status: string;
    claimed_by_lab_tech_id: string | null;
  }>(
    `SELECT id, status, claimed_by_lab_tech_id
     FROM lab_orders WHERE id = $1 LIMIT 1`,
    [id],
  );
  const order = rows[0];
  if (!order) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (order.status !== 'in_progress') {
    return NextResponse.json(
      { ok: false, error: 'not_in_progress', detail: `Order is ${order.status}.` },
      { status: 409 },
    );
  }
  if (
    session.role !== 'admin' &&
    order.claimed_by_lab_tech_id !== techId
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: 'not_your_claim',
        detail: 'Only the claiming tech (or an admin) can release this order.',
      },
      { status: 403 },
    );
  }

  await pool.query(
    `UPDATE lab_orders
     SET status = 'pending',
         claimed_by_lab_tech_id = NULL,
         claimed_at = NULL
     WHERE id = $1`,
    [id],
  );

  await notifyQueue('queue:lab', `released:${id}`);

  return NextResponse.json({ ok: true, order_id: id });
}
