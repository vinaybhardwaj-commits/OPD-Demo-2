/**
 * POST /api/encounters/[id]/complete
 *
 * Final lifecycle transition for Sprint 2's flow:
 *   active | ready_to_resume → completed
 *
 * Validates disposition is set (required per design doc §4.6's
 * validation gate). Sets status='completed' + completed_at=NOW().
 *
 * Sprints 4-5 add prescription generation + recording finalisation
 * to this same transition; Sprint 7 adds Twilio/PDF dispatch. M2.3
 * just flips the row.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { notifyRoom } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const { rows } = await pool.query<{ id: string; status: string; disposition: string | null }>(
    `SELECT e.id, e.status::text AS status, e.disposition::text AS disposition
     FROM encounters e
     JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 AND lower(d.email) = $2
     LIMIT 1`,
    [id, session.email.toLowerCase()],
  );
  const enc = rows[0];
  if (!enc) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  if (enc.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'already_completed' },
      { status: 409 },
    );
  }
  if (!enc.disposition) {
    return NextResponse.json(
      { ok: false, error: 'disposition_required' },
      { status: 400 },
    );
  }
  if (enc.status === 'paused_diagnostics') {
    return NextResponse.json(
      {
        ok: false,
        error: 'paused_for_diagnostics',
        detail: 'Diagnostics are still pending. Wait for results, or cancel the pending order, before completing.',
      },
      { status: 409 },
    );
  }

  const { rows: upd } = await pool.query<{ room_id: string | null }>(
    `UPDATE encounters
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING room_id`,
    [id],
  );
  await notifyRoom(upd[0]?.room_id ?? null, `completed:${id}`);

  return NextResponse.json({ ok: true, encounter_id: id });
}
