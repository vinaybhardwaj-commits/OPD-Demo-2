/**
 * GET  /api/encounters/[id]/labs  — list lab orders for an encounter
 * POST /api/encounters/[id]/labs  — doctor adds N labs and "sends to lab"
 *
 * v2.1 Lab Workstation — doctor flow.
 *
 * GET response:
 *   { ok: true, orders: LabOrder[] }
 *   Includes pre_staged (CCE-added) and pending/in_progress/resulted/cancelled.
 *
 * POST body:
 *   { tests: string[], notes?: string }
 *
 * POST behavior (atomic, single transaction):
 *   1. Authorise: caller must be the encounter's owning doctor (or admin).
 *   2. INSERT a lab_orders row per test (status='pending', ordering_doctor=session).
 *   3. UPDATE any existing pre_staged rows for this encounter:
 *      status='pending', ordering_doctor_id=session, leave pre_staged_by_cce_id
 *      so we can show "Pre-staged by Lalitha · confirmed by you" on the lab tech UI.
 *   4. Flip the encounter to paused_diagnostics:
 *        pending_diagnostic_test = first new test name (legacy summary)
 *        paused_reason = `lab: ${test list}` (legacy free-text)
 *        status = 'paused_diagnostics'
 *      ONLY if the encounter was active or ready_to_resume — otherwise
 *      400 (CCE pre-stage doesn't pause; the doctor does).
 *   5. notifyRoom(room_id, 'labs_ordered:<encId>') so /lab + /dashboard refresh.
 *
 * Idempotency: hitting POST twice with the same tests creates duplicate
 * rows. That's intentional — the doctor may legitimately re-order the
 * same test. Pre-staged confirmation IS idempotent because it just
 * promotes existing rows.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyRoom } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LabOrder = {
  id: string;
  status: string;
  raw_text: string;
  canonical_key: string | null;
  display_name: string | null;
  ordered_at: string;
  pre_staged_by_cce_id: string | null;
  pre_staged_by_cce_name: string | null;
  pre_staged_at: string | null;
  ordering_doctor_id: string | null;
  ordering_doctor_name: string | null;
  source_pdf_url: string | null;
  extracted_at: string | null;
  extraction_confidence: number | null;
  auto_posted: boolean;
  resulted_at: string | null;
};

async function loadOrders(encId: string): Promise<LabOrder[]> {
  const { rows } = await pool.query<LabOrder>(
    `SELECT
       lo.id,
       lo.status,
       lo.raw_text,
       lo.canonical_key,
       lo.display_name,
       lo.ordered_at::text AS ordered_at,
       lo.pre_staged_by_cce_id,
       cce.name AS pre_staged_by_cce_name,
       lo.pre_staged_at::text AS pre_staged_at,
       lo.ordering_doctor_id,
       doc.name AS ordering_doctor_name,
       lo.source_pdf_url,
       lo.extracted_at::text AS extracted_at,
       lo.extraction_confidence,
       lo.auto_posted,
       lo.resulted_at::text AS resulted_at
     FROM lab_orders lo
     LEFT JOIN doctors cce ON cce.id = lo.pre_staged_by_cce_id
     LEFT JOIN doctors doc ON doc.id = lo.ordering_doctor_id
     WHERE lo.encounter_id = $1
     ORDER BY lo.ordered_at ASC`,
    [encId],
  );
  return rows;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }
  // Anyone signed-in can view (doctor, CCE, nurse, lab_tech, admin).
  const orders = await loadOrders(id);
  return NextResponse.json({ ok: true, orders });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
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

  const testsRaw = Array.isArray(body.tests) ? body.tests : [];
  const tests = testsRaw
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0 && t.length <= 200);

  // Doctor must be the encounter's owner. Admins can also push (rare
  // ops case). CCE/nurse/lab_tech use other endpoints.
  if (session.role !== 'doctor' && session.role !== 'admin') {
    return NextResponse.json(
      { ok: false, error: 'forbidden_role', detail: 'Only the encounter doctor can confirm labs.' },
      { status: 403 },
    );
  }

  const { rows: encRows } = await pool.query<{
    id: string;
    status: string;
    room_id: string | null;
    doctor_email: string;
  }>(
    `SELECT e.id, e.status::text AS status, e.room_id, d.email AS doctor_email
     FROM encounters e
     JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1
     LIMIT 1`,
    [encId],
  );
  const enc = encRows[0];
  if (!enc) {
    return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
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
  if (enc.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_completed_immutable' },
      { status: 409 },
    );
  }
  if (enc.status !== 'active' && enc.status !== 'ready_to_resume') {
    return NextResponse.json(
      {
        ok: false,
        error: 'encounter_not_actionable',
        detail: `Encounter is ${enc.status}; doctor can only send labs from active or ready_to_resume.`,
      },
      { status: 409 },
    );
  }

  // Resolve the doctor's id from email.
  const { rows: docRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const doctorId = docRows[0]?.id;
  if (!doctorId) {
    return NextResponse.json({ ok: false, error: 'doctor_not_seeded' }, { status: 500 });
  }

  // Transaction: confirm pre_staged + insert new + flip status.
  const client = await pool.connect();
  let inserted = 0;
  let confirmed = 0;
  const insertedOrders: { id: string; raw_text: string }[] = [];
  try {
    await client.query('BEGIN');

    // Confirm any pending pre_staged rows for this encounter.
    const { rowCount: confirmedCount } = await client.query(
      `UPDATE lab_orders
       SET status = 'pending', ordering_doctor_id = $2
       WHERE encounter_id = $1 AND status = 'pre_staged'`,
      [encId, doctorId],
    );
    confirmed = confirmedCount ?? 0;

    // Insert each new test as a separate row.
    for (const test of tests) {
      const { rows: insRows } = await client.query<{ id: string }>(
        `INSERT INTO lab_orders (
           encounter_id, patient_id, ordering_doctor_id,
           raw_text, display_name, status, ordered_at
         )
         SELECT e.id, e.patient_id, $2, $3, $3, 'pending', NOW()
         FROM encounters e
         WHERE e.id = $1
         RETURNING id`,
        [encId, doctorId, test],
      );
      if (insRows[0]) {
        inserted += 1;
        insertedOrders.push({ id: insRows[0].id, raw_text: test });
      }
    }

    if (confirmed === 0 && inserted === 0) {
      // Nothing to do — caller passed empty tests and there were no
      // pre-staged rows. Don't pause an encounter for no reason.
      await client.query('ROLLBACK');
      return NextResponse.json(
        { ok: false, error: 'no_labs_to_send' },
        { status: 400 },
      );
    }

    // Compose paused_reason text from the actual tests being sent now.
    // (For audit + the legacy pending_diagnostic_test summary text.)
    const allOrdered = [
      ...(await client.query<{ raw_text: string }>(
        `SELECT raw_text FROM lab_orders
         WHERE encounter_id = $1 AND status = 'pending'`,
        [encId],
      )).rows,
    ].map((r) => r.raw_text);

    const summary = allOrdered.slice(0, 3).join(', ');
    const overflow = allOrdered.length > 3 ? ` + ${allOrdered.length - 3}` : '';
    const pendingTestLabel = `Lab: ${summary}${overflow}`;

    await client.query(
      `UPDATE encounters
       SET status = 'paused_diagnostics',
           paused_reason = $2,
           pending_diagnostic_test = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [encId, `lab_panel: ${allOrdered.join('; ')}`.slice(0, 500), pendingTestLabel],
    );

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

  // Fire-and-forget notify so /lab + /dashboard re-render.
  await notifyRoom(enc.room_id ?? null, `labs_ordered:${encId}`);

  return NextResponse.json({
    ok: true,
    encounter_id: encId,
    inserted_count: inserted,
    confirmed_pre_staged_count: confirmed,
    inserted_orders: insertedOrders,
  });
}
