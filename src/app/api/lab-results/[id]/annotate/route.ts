/**
 * POST /api/lab-results/[id]/annotate
 *
 * Polish #4 — Clinician annotation on a posted lab result.
 *
 * Per lock — annotation-only model (never edit the original):
 *   - The lab_results row stays untouched. Doctor adds a note that
 *     renders inline beneath the value + lives in the audit trail.
 *   - Multiple annotations per result are allowed (a doctor might add
 *     context now, then a clarification later).
 *
 * Auth: doctor or admin. Any doctor — not just the encounter's owner —
 * because labs can be reviewed by multiple doctors during handoff.
 *
 * Body: { note: string }   non-empty, ≤ 500 chars.
 *
 * On success returns the created annotation row.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

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
  if (note.length > 500) {
    return NextResponse.json({ ok: false, error: 'note_too_long' }, { status: 400 });
  }

  // Verify lab_result exists.
  const { rows: lr } = await pool.query<{ id: string }>(
    `SELECT id FROM lab_results WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!lr[0]) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  // Caller's doctors-row id.
  const { rows: meRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const doctorId = meRows[0]?.id;
  if (!doctorId) {
    return NextResponse.json({ ok: false, error: 'doctor_not_seeded' }, { status: 500 });
  }

  const { rows: ins } = await pool.query<{
    id: string;
    created_at: string;
  }>(
    `INSERT INTO lab_result_annotations (lab_result_id, doctor_id, note)
     VALUES ($1, $2, $3)
     RETURNING id, created_at::text AS created_at`,
    [id, doctorId, note],
  );

  return NextResponse.json({
    ok: true,
    annotation: {
      id: ins[0].id,
      lab_result_id: id,
      doctor_id: doctorId,
      doctor_name: session.email, // client will refetch with the resolved name on reload
      note,
      created_at: ins[0].created_at,
    },
  });
}
