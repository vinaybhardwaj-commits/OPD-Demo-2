/**
 * POST /api/encounters/[id]/send-to-diagnostics
 *
 * Body: { test: string, notes?: string }
 *
 * State transitions:
 *   active           → paused_diagnostics
 *   ready_to_resume  → paused_diagnostics  (a second test mid-encounter)
 *   paused_diagnostics → 409 already_paused
 *   completed         → 409 encounter_completed_immutable
 *
 * Side effects:
 *   - sets pending_diagnostic_test = test
 *   - sets paused_reason = 'diagnostics' (or notes if provided — kept short)
 *   - touches updated_at
 *
 * The ambient recording's current snippet stays as-is (no separate
 * "finalise" call needed because each MediaRecorder stop in M5.2
 * already inserts a snippet). The doctor's next resume + record press
 * naturally allocates snippet_index = MAX+1.
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
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  let body: { test?: unknown; notes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const test = typeof body.test === 'string' ? body.test.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (!test) {
    return NextResponse.json({ ok: false, error: 'test_required' }, { status: 400 });
  }
  if (test.length > 80) {
    return NextResponse.json({ ok: false, error: 'test_too_long' }, { status: 400 });
  }

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
      { ok: false, error: 'already_paused' },
      { status: 409 },
    );
  }

  // Compose paused_reason — 'diagnostics' plus first chunk of notes if
  // any. Stays in the existing TEXT column; no schema change.
  const paused_reason = notes
    ? `diagnostics: ${notes.slice(0, 240)}`
    : 'diagnostics';

  const { rows: upd } = await pool.query<{ room_id: string | null }>(
    `UPDATE encounters
     SET status = 'paused_diagnostics',
         paused_reason = $2,
         pending_diagnostic_test = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING room_id`,
    [id, paused_reason, test],
  );
  await notifyRoom(upd[0]?.room_id ?? null, `sent_to_diagnostics:${id}`);

  return NextResponse.json({
    ok: true,
    encounter_id: id,
    pending_diagnostic_test: test,
    paused_reason,
    redirect: '/dashboard',
  });
}
