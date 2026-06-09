/**
 * POST /api/encounters/[id]/flag-handoff
 *
 * v2.3 — Multi-doctor handoff (pull model).
 *
 * Current doctor flags the encounter as needing a second opinion or
 * specialty review. Writes encounters.handoff_note. Does NOT change
 * doctor_id — that flip happens when another doctor calls
 * /claim-handoff.
 *
 * The encounter now appears in the network-wide "Needs review" lane
 * on every doctor's /dashboard until somebody claims it. The original
 * doctor can keep working on it in the meantime (it stays in their
 * own queue too).
 *
 * Auth: encounter doctor or admin.
 * Body: { note: string }   — required, non-empty, ≤ 1000 chars.
 *
 * State guards:
 *   - 409 if encounter is completed.
 *   - 409 if a pending handoff already exists (must withdraw first via
 *     /withdraw-handoff — not in v2.3 scope; just overwrite).
 *
 * Actually: we let overwrite happen — the doctor can rephrase the note
 * any time before someone claims.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyQueue } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.role !== 'doctor' && session.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'forbidden_role' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }

  let body: { note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) {
    return NextResponse.json({ ok: false, error: 'note_required' }, { status: 400 });
  }
  if (note.length > 1000) {
    return NextResponse.json({ ok: false, error: 'note_too_long' }, { status: 400 });
  }

  const { rows: encRows } = await pool.query<{
    id: string;
    status: string;
    doctor_email: string;
  }>(
    `SELECT e.id, e.status::text AS status, d.email AS doctor_email
     FROM encounters e JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 LIMIT 1`,
    [id],
  );
  const enc = encRows[0];
  if (!enc) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (enc.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_completed_immutable' },
      { status: 409 },
    );
  }
  if (
    session.role !== 'admin' &&
    enc.doctor_email.toLowerCase() !== session.email.toLowerCase()
  ) {
    return NextResponse.json(
      { ok: false, error: 'not_your_encounter' },
      { status: 403 },
    );
  }

  // Setting (or rewriting) the handoff_note. Clear any prior ack
  // because we're flagging it again — the next claimer is fresh.
  await pool.query(
    `UPDATE encounters
     SET handoff_note = $2,
         handoff_ack_by = NULL,
         handoff_ack_at = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [id, note],
  );

  await notifyQueue('queue:global', `handoff_flagged:${id}`);

  return NextResponse.json({
    ok: true,
    encounter_id: id,
    flagged_at: new Date().toISOString(),
  });
}
