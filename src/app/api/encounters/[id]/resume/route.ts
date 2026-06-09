/**
 * POST /api/encounters/[id]/resume
 *
 * Flips ready_to_resume → active.
 *
 * State machine:
 *   ready_to_resume → active                        ✓
 *   active          → active   (idempotent — 200 noop)
 *   paused_diagnostics → 409 still_paused
 *     (Sprint 6's intent: only after the diagnostic-ready event fires
 *     can a paused encounter become resumable. Demo Controls'
 *     "Mark diagnostic ready" simulates that event.)
 *   completed       → 409 encounter_completed_immutable
 *
 * Does not touch pending_diagnostic_test — keeping it set means the
 * resume banner can still show the test name for context.
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

  const { rows } = await pool.query<{ id: string; status: string }>(
    `SELECT e.id, e.status::text AS status
     FROM encounters e JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 AND lower(d.email) = $2 LIMIT 1`,
    [id, session.email.toLowerCase()],
  );
  const enc = rows[0];
  if (!enc) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  if (enc.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_completed_immutable' },
      { status: 409 },
    );
  }
  if (enc.status === 'paused_diagnostics') {
    return NextResponse.json(
      {
        ok: false,
        error: 'still_paused',
        detail: 'Encounter is awaiting the diagnostic result. The Mark diagnostic ready admin action (or Pulse event) flips it to Ready to resume first.',
      },
      { status: 409 },
    );
  }
  if (enc.status === 'active') {
    return NextResponse.json({ ok: true, status: 'active', noop: true });
  }

  // ready_to_resume → active
  const { rows: upd } = await pool.query<{ room_id: string | null }>(
    `UPDATE encounters SET status = 'active', updated_at = NOW()
     WHERE id = $1
     RETURNING room_id`,
    [id],
  );
  await notifyRoom(upd[0]?.room_id ?? null, `resumed:${id}`);
  return NextResponse.json({ ok: true, status: 'active' });
}
