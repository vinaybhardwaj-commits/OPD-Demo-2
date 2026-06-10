/**
 * POST /api/lab-orders/[id]/confirm
 *
 * Finalises a lab order — writes lab_results rows + flips the order to
 * 'resulted'. v2.1.3.
 *
 * Two call sites:
 *   - 10s auto-confirm countdown on the upload UI (auto_posted=true,
 *     items omitted → reuse extraction_raw)
 *   - Manual confirm after tech edited the values (v2.1.4 edit grid,
 *     auto_posted=false, items provided)
 *
 * Body: {
 *   items?: ExtractedLabItem[]   // optional override; falls back to extraction_raw.items
 *   auto_posted: boolean
 * }
 *
 * Side effects:
 *   1. INSERT one lab_results row per item.
 *   2. UPDATE lab_orders: status='resulted', auto_posted, resulted_at.
 *   3. Per v2.1.3 lock #1 — "Auto on FIRST lab resulted": if the
 *      encounter is paused_diagnostics, flip it to ready_to_resume
 *      immediately and notify the doctor's room channel. Subsequent
 *      labs on the same encounter no-op (encounter is already
 *      ready_to_resume).
 *
 * Auth: lab_tech | admin. Only the claimer (or admin) can confirm.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyQueue, notifyRoom } from '@/lib/queueNotify';
import type { ExtractedLabItem } from '@/lib/qwen-vision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  items?: ExtractedLabItem[];
  auto_posted?: boolean;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.role !== 'lab_tech' && session.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'forbidden_role' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  const autoPosted = body.auto_posted === true;

  const { rows: techRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const techId = techRows[0]?.id;
  if (!techId) {
    return NextResponse.json({ ok: false, error: 'tech_not_seeded' }, { status: 500 });
  }

  const { rows: orderRows } = await pool.query<{
    id: string;
    status: string;
    patient_id: string;
    encounter_id: string;
    claimed_by_lab_tech_id: string | null;
    extraction_raw: { items?: ExtractedLabItem[] } | null;
  }>(
    `SELECT id, status, patient_id, encounter_id, claimed_by_lab_tech_id, extraction_raw
     FROM lab_orders WHERE id = $1 LIMIT 1`,
    [id],
  );
  const order = orderRows[0];
  if (!order) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (order.status === 'resulted' || order.status === 'cancelled') {
    return NextResponse.json(
      { ok: false, error: 'already_finalised', detail: `Order is ${order.status}.` },
      { status: 409 },
    );
  }
  if (order.status !== 'awaiting_confirmation') {
    return NextResponse.json(
      {
        ok: false,
        error: 'not_extracted',
        detail: `Upload + extract first; order is ${order.status}.`,
      },
      { status: 409 },
    );
  }
  if (
    session.role !== 'admin' &&
    order.claimed_by_lab_tech_id !== techId
  ) {
    return NextResponse.json(
      { ok: false, error: 'not_your_claim' },
      { status: 403 },
    );
  }

  // Resolve items — body override OR extraction_raw fallback.
  const items: ExtractedLabItem[] = Array.isArray(body.items)
    ? body.items
    : Array.isArray(order.extraction_raw?.items)
    ? order.extraction_raw!.items!
    : [];
  if (items.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'no_items_to_post',
        detail: 'Provide items in body or re-run extraction first.',
      },
      { status: 400 },
    );
  }

  // Transactional confirm.
  const client = await pool.connect();
  let encounterFlipped = false;
  let roomId: string | null = null;
  try {
    await client.query('BEGIN');

    // 1. Insert lab_results.
    for (const it of items) {
      // Belt-and-braces: pgsql will reject if NOT NULL constraints
      // unmet — items must have canonical_key + display_name.
      if (!it.canonical_key || !it.display_name) continue;
      await client.query(
        `INSERT INTO lab_results (
           lab_order_id, patient_id, canonical_key, display_name,
           value_numeric, value_text, unit, reference_range,
           is_critical, source_pdf_url, entered_by,
           confidence_score, abnormal_flag, entered_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 (SELECT source_pdf_url FROM lab_orders WHERE id = $1),
                 $10, $11, $12, NOW())`,
        [
          id,
          order.patient_id,
          it.canonical_key,
          it.display_name,
          it.value_numeric,
          it.value_text,
          it.unit,
          it.reference_range,
          it.abnormal_flag === 'critical_low' || it.abnormal_flag === 'critical_high',
          techId,
          it.confidence,
          it.abnormal_flag,
        ],
      );
    }

    // 2. Flip the lab order.
    await client.query(
      `UPDATE lab_orders
       SET status = 'resulted',
           auto_posted = $2,
           resulted_at = NOW(),
           canonical_key = COALESCE(canonical_key, $3),
           display_name = COALESCE(display_name, $4)
       WHERE id = $1`,
      [
        id,
        autoPosted,
        items[0]?.canonical_key ?? null,
        items[0]?.display_name ?? null,
      ],
    );

    // 3. Encounter flip per lock #1 ("Auto on FIRST lab resulted").
    //    If encounter is paused_diagnostics, flip to ready_to_resume.
    //    Idempotent — UPDATE conditional on current status.
    const { rowCount } = await client.query<{ room_id: string | null }>(
      `UPDATE encounters
       SET status = 'ready_to_resume', updated_at = NOW()
       WHERE id = $1 AND status = 'paused_diagnostics'
       RETURNING room_id`,
      [order.encounter_id],
    );

    // 3b. P1.5 — same FIRST-result rule on the two-track lifecycle: a
    //     patient out for workup comes back ready on the first posted
    //     result. Same tx, same idempotent conditional-UPDATE style;
    //     out_for_workup→back_ready is a valid CLINICAL_TRANSITIONS edge.
    //     (Replaces the Room's demo-only button as the REAL hook; the
    //     button stays as a manual override.)
    await client.query(
      `UPDATE encounters
       SET clinical_status = 'back_ready', updated_at = NOW()
       WHERE id = $1 AND clinical_status = 'out_for_workup'`,
      [order.encounter_id],
    );
    if (rowCount && rowCount > 0) {
      encounterFlipped = true;
      const { rows: roomRows } = await client.query<{ room_id: string | null }>(
        `SELECT room_id FROM encounters WHERE id = $1 LIMIT 1`,
        [order.encounter_id],
      );
      roomId = roomRows[0]?.room_id ?? null;
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

  await notifyQueue('queue:lab', `posted:${id}`);
  if (encounterFlipped) {
    await notifyRoom(roomId, `lab_ready:${order.encounter_id}`);
  }

  return NextResponse.json({
    ok: true,
    order_id: id,
    posted_count: items.length,
    auto_posted: autoPosted,
    encounter_flipped_to_ready_to_resume: encounterFlipped,
  });
}
