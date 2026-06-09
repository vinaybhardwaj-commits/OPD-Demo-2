/**
 * POST /api/encounters/[id]/labs/prestage
 *
 * CCE pre-stage endpoint (v2.1.1 Round-extra decision: "Doctor + CCE").
 *
 * Lets a CCE on /reception drop in routine labs (CBC, urine R/E, RBS)
 * for a registered/at_triage/waiting_for_doctor encounter before the
 * doctor sees the patient. The labs sit in 'pre_staged' status until
 * the doctor confirms them (via POST /api/encounters/[id]/labs which
 * promotes pre_staged → pending and flips the encounter to
 * paused_diagnostics in one transaction).
 *
 * Critical contract differences from the doctor's POST:
 *   - Encounter status is NOT touched. Pre-staging is a suggestion, not
 *     a clinical order.
 *   - ordering_doctor_id is left NULL — set on confirm.
 *   - pre_staged_by_cce_id + pre_staged_at are stamped from the session.
 *   - Allowed encounter states: registered | at_triage | waiting_for_doctor.
 *     After the doctor has started consulting (active/+), pre-staging is
 *     no longer meaningful — the doctor orders directly.
 *
 * Auth: caller must have role='cce' or role='admin'.
 *
 * Body: { tests: string[] }
 *
 * On success, fires notifyRoom(room_id, 'labs_prestaged:<encId>') so the
 * doctor's encounter screen will see them appear when (s)he opens it.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyRoom } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATES = new Set(['registered', 'at_triage', 'waiting_for_doctor']);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.role !== 'cce' && session.role !== 'admin') {
    return NextResponse.json(
      { ok: false, error: 'forbidden_role', detail: 'CCE pre-stage endpoint.' },
      { status: 403 },
    );
  }

  const { id: encId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(encId)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }

  let body: { tests?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const tests = (Array.isArray(body.tests) ? body.tests : [])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0 && t.length <= 200);

  if (tests.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'no_tests_provided' },
      { status: 400 },
    );
  }

  const { rows: encRows } = await pool.query<{
    id: string;
    status: string;
    room_id: string | null;
  }>(
    `SELECT id, status::text AS status, room_id FROM encounters WHERE id = $1 LIMIT 1`,
    [encId],
  );
  const enc = encRows[0];
  if (!enc) {
    return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
  }
  if (!ALLOWED_STATES.has(enc.status)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'encounter_not_prestageable',
        detail: `Encounter is ${enc.status}; pre-stage is only allowed before the doctor starts.`,
      },
      { status: 409 },
    );
  }

  // Resolve the CCE's doctors-row id from the session email.
  const { rows: cceRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const cceId = cceRows[0]?.id;
  if (!cceId) {
    return NextResponse.json({ ok: false, error: 'cce_not_seeded' }, { status: 500 });
  }

  const client = await pool.connect();
  const insertedOrders: { id: string; raw_text: string }[] = [];
  try {
    await client.query('BEGIN');
    for (const test of tests) {
      const { rows: insRows } = await client.query<{ id: string }>(
        `INSERT INTO lab_orders (
           encounter_id, patient_id, ordering_doctor_id,
           raw_text, display_name, status,
           pre_staged_by_cce_id, pre_staged_at, ordered_at
         )
         SELECT e.id, e.patient_id, NULL, $3, $3, 'pre_staged', $2, NOW(), NOW()
         FROM encounters e WHERE e.id = $1
         RETURNING id`,
        [encId, cceId, test],
      );
      if (insRows[0]) {
        insertedOrders.push({ id: insRows[0].id, raw_text: test });
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'db_error', detail: msg.slice(0, 300) },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  await notifyRoom(enc.room_id ?? null, `labs_prestaged:${encId}`);

  return NextResponse.json({
    ok: true,
    encounter_id: encId,
    inserted_orders: insertedOrders,
  });
}
