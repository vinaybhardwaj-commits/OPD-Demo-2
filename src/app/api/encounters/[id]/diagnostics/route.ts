/**
 * /api/encounters/[id]/diagnostics
 *
 * GET — returns the encounter's open diagnostic_orders (pre_staged /
 *       pending / in_progress / awaiting_confirmation, plus any
 *       recently cancelled in this encounter for audit visibility).
 *       Used by the v3.2a strip to pre-populate the cart with CCE
 *       pre-staged tests when the doctor opens the encounter.
 *
 * POST — confirms the doctor's intended cart. v3.3 expanded to handle:
 *   - Items with `existing_id` + action='keep' → promote pre_staged →
 *     pending (lab) or ordered (other modalities), stamp doctor as
 *     ordering_actor.
 *   - Items in `cancel_existing_ids[]` → status='cancelled', stamp
 *     cancelled_by_doctor_id + cancel_reason.
 *   - Items without existing_id → INSERT a new diagnostic_orders row.
 *   - Encounter flips to paused_diagnostics ONLY if at least one
 *     non-cancelled order remains.
 *
 * Provenance filter: every service_code is validated against
 * diagnostic_catalog before any DB write.
 */
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyQueue } from '@/lib/queueNotify';
import { generateImagingReferralPdf } from '@/lib/imaging-referral-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET ─────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id: encounterId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(encounterId)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }

  const { rows } = await pool.query<{
    id: string;
    service_code: string;
    display_name: string;
    sub_department: string;
    modality: string;
    status: string;
    ordering_actor: string;
    ordered_at: string;
    pre_staged_at: string | null;
    pre_staged_by_name: string | null;
    cancel_reason: string | null;
  }>(
    `SELECT do2.id, do2.service_code, dc.display_name, dc.sub_department,
            do2.modality, do2.status, do2.ordering_actor,
            do2.ordered_at::text AS ordered_at,
            do2.pre_staged_at::text AS pre_staged_at,
            cce.name AS pre_staged_by_name,
            do2.cancel_reason
     FROM diagnostic_orders do2
     JOIN diagnostic_catalog dc ON dc.service_code = do2.service_code
     LEFT JOIN doctors cce ON cce.id = do2.pre_staged_by_cce_id
     WHERE do2.encounter_id = $1
       AND do2.status IN ('pre_staged','pending','in_progress','awaiting_confirmation','cancelled','ordered','dispatched')
     ORDER BY do2.ordered_at ASC`,
    [encounterId],
  );

  return NextResponse.json({ ok: true, orders: rows });
}

// ── POST ────────────────────────────────────────────────────────────

type CartItem = {
  existing_id?: string;
  service_code: string;
  source: 'manual' | 'qwen_suggestion_accepted' | 'bundle' | 'context_chip' | 'cce_prestage';
  // v3.6 — optional imaging-only fields captured inline in the strip cart
  clinical_indication?: string | null;
  body_area?: string | null;
  laterality?: string | null;
};

type Body = {
  cart: CartItem[];
  cancel_existing_ids?: string[];
  cancel_reason?: string;
};

const SOURCE_TO_ACTOR: Record<string, string> = {
  manual: 'doctor',
  qwen_suggestion_accepted: 'ai_suggestion_accepted',
  bundle: 'auto_bundle',
  context_chip: 'ai_suggestion_accepted',
  cce_prestage: 'cce_prestage',
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id: encounterId } = await ctx.params;
  const body = (await req.json()) as Body;
  const cart = Array.isArray(body.cart) ? body.cart : [];
  const cancelIds = Array.isArray(body.cancel_existing_ids) ? body.cancel_existing_ids : [];
  if (cart.length === 0 && cancelIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'empty_payload' }, { status: 400 });
  }

  // Verify the encounter + look up doctor_id + patient_id
  const encRes = await pool.query<{
    id: string;
    doctor_id: string | null;
    patient_id: string | null;
    status: string;
  }>(
    `SELECT id, doctor_id, patient_id, status FROM encounters WHERE id = $1 LIMIT 1`,
    [encounterId],
  );
  if (encRes.rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
  }

  // Provenance filter: every NEW service_code must exist in diagnostic_catalog
  const newCodes = cart.filter((c) => !c.existing_id).map((c) => c.service_code);
  if (newCodes.length > 0) {
    const catRes = await pool.query<{
      service_code: string;
      modality: 'lab' | 'imaging' | 'cardiology' | 'procedure';
      display_name: string;
    }>(
      `SELECT service_code, modality, display_name FROM diagnostic_catalog
       WHERE service_code = ANY($1::text[])`,
      [newCodes],
    );
    const catalogByCode = new Map(catRes.rows.map((r) => [r.service_code, r]));
    const missing = newCodes.filter((c) => !catalogByCode.has(c));
    if (missing.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'unknown_service_codes', missing },
        { status: 400 },
      );
    }
    // Stash catalog map for INSERT loop below
    (globalThis as { __catalogByCode?: Map<string, { service_code: string; modality: 'lab' | 'imaging' | 'cardiology' | 'procedure'; display_name: string }> }).__catalogByCode = catalogByCode;
  }
  const catalogByCode = (globalThis as { __catalogByCode?: Map<string, { service_code: string; modality: 'lab' | 'imaging' | 'cardiology' | 'procedure'; display_name: string }> }).__catalogByCode ?? new Map();

  const insertedIds: string[] = [];
  const promotedIds: string[] = [];
  const cancelledIds: string[] = [];

  // 1) Cancel everything in cancel_existing_ids
  if (cancelIds.length > 0) {
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE diagnostic_orders
       SET status = 'cancelled',
           cancelled_at = NOW(),
           cancelled_by_doctor_id = $2,
           cancel_reason = $3,
           updated_at = NOW()
       WHERE encounter_id = $1
         AND id = ANY($4::uuid[])
         AND status NOT IN ('cancelled','posted','completed')
       RETURNING id`,
      [encounterId, session.id ?? null, body.cancel_reason ?? 'Cancelled by doctor at confirm', cancelIds],
    );
    cancelledIds.push(...rows.map((r) => r.id));
  }

  // 2) For each cart item:
  //    - existing_id → promote (pre_staged → pending/ordered, stamp doctor)
  //    - no existing_id → INSERT new diagnostic_orders row
  for (const item of cart) {
    if (item.existing_id) {
      // Promote — look up modality first to pick the right post-status
      const modRes = await pool.query<{ modality: string }>(
        `SELECT modality FROM diagnostic_orders WHERE id = $1 LIMIT 1`,
        [item.existing_id],
      );
      const mod = modRes.rows[0]?.modality;
      if (!mod) continue;
      const promotedStatus = mod === 'lab' ? 'pending' : 'ordered';
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE diagnostic_orders
         SET status = $2::text,
             ordered_by_doctor_id = COALESCE(ordered_by_doctor_id, $3),
             ordering_actor = CASE
                                WHEN ordering_actor = 'cce_prestage' THEN 'cce_prestage'
                                ELSE 'doctor'
                              END,
             updated_at = NOW()
         WHERE id = $1
           AND encounter_id = $4
           AND status IN ('pre_staged','cancelled')
         RETURNING id`,
        [item.existing_id, promotedStatus, session.id ?? null, encounterId],
      );
      if (rows.length > 0) promotedIds.push(rows[0].id);
    } else {
      const cat = catalogByCode.get(item.service_code)!;
      const initialStatus = cat.modality === 'lab' ? 'pending' : 'ordered';
      const orderingActor = SOURCE_TO_ACTOR[item.source] ?? 'doctor';

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO diagnostic_orders (
           encounter_id, patient_id, service_code, modality, status,
           ordered_by_doctor_id, ordering_actor, raw_text,
           clinical_indication, body_area, laterality
         ) VALUES ($1, $2, $3, $4::text, $5::text, $6, $7::text, $8, $9, $10, $11)
         RETURNING id`,
        [
          encounterId,
          encRes.rows[0].patient_id,
          item.service_code,
          cat.modality,
          initialStatus,
          session.id ?? null,
          orderingActor,
          cat.display_name,
          cat.modality === 'imaging' ? (item.clinical_indication ?? null) : null,
          cat.modality === 'imaging' ? (item.body_area ?? null) : null,
          cat.modality === 'imaging' ? (item.laterality ?? null) : null,
        ],
      );
      insertedIds.push(rows[0].id);
      // v3.6 — kick PDF generation for imaging items inline (sub-second).
      if (cat.modality === 'imaging') {
        try {
          await generateAndAttachImagingReferral(rows[0].id);
        } catch (e) {
          // PDF failure doesn't block the order — stays in 'ordered' status.
          console.error('imaging referral PDF failed for', rows[0].id, e);
        }
      }
    }
  }

  // 3) Encounter flip — only if any open (non-cancelled) orders remain
  const openCount = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM diagnostic_orders
     WHERE encounter_id = $1
       AND status IN ('pre_staged','pending','in_progress','awaiting_confirmation','ordered','dispatched')`,
    [encounterId],
  );
  const hasOpen = (openCount.rows[0]?.n ?? 0) > 0;

  if (hasOpen && encRes.rows[0].status !== 'paused_diagnostics' && encRes.rows[0].status !== 'completed') {
    await pool.query(
      `UPDATE encounters
       SET status = 'paused_diagnostics',
           pending_diagnostic_test = $2,
           paused_reason = 'diagnostic_orders',
           updated_at = NOW()
       WHERE id = $1`,
      [encounterId, `Diagnostic panel (${openCount.rows[0].n} test${openCount.rows[0].n === 1 ? '' : 's'})`],
    );
  }

  // SSE refresh
  await notifyQueue('queue:global', `diagnostic_orders:${encounterId}`).catch(() => {});
  await notifyQueue('queue:lab', `lab_orders:${encounterId}`).catch(() => {});

  return NextResponse.json({
    ok: true,
    encounter_id: encounterId,
    inserted_ids: insertedIds,
    promoted_ids: promotedIds,
    cancelled_ids: cancelledIds,
    open_count: openCount.rows[0]?.n ?? 0,
  });
}


// ── v3.6 imaging referral PDF generation + Blob upload + status flip ──

async function generateAndAttachImagingReferral(orderId: string): Promise<void> {
  // Load every field the PDF needs
  const { rows } = await pool.query<{
    id: string;
    service_code: string;
    display_name: string;
    sub_department: string;
    modality: string;
    body_area: string | null;
    laterality: string | null;
    clinical_indication: string | null;
    ordered_at: string;
    encounter_number: string;
    encounter_date: string;
    chief_complaint_text: string | null;
    patient_name: string;
    patient_mrn: string;
    patient_age_years: number;
    patient_sex: string;
    patient_phone_e164: string | null;
    doctor_name: string | null;
    doctor_mci: string | null;
  }>(
    `SELECT do2.id, do2.service_code, dc.display_name, dc.sub_department,
            do2.modality, do2.body_area, do2.laterality, do2.clinical_indication,
            do2.ordered_at::text AS ordered_at,
            e.encounter_number, e.encounter_date::text AS encounter_date,
            e.chief_complaint_text,
            p.name AS patient_name, p.mrn AS patient_mrn,
            p.age_years AS patient_age_years, p.sex AS patient_sex,
            p.phone_e164 AS patient_phone_e164,
            d.name AS doctor_name, d.mci_registration_number AS doctor_mci
     FROM diagnostic_orders do2
     JOIN diagnostic_catalog dc ON dc.service_code = do2.service_code
     JOIN encounters e ON e.id = do2.encounter_id
     JOIN patients p ON p.id = do2.patient_id
     LEFT JOIN doctors d ON d.id = do2.ordered_by_doctor_id
     WHERE do2.id = $1 LIMIT 1`,
    [orderId],
  );
  if (rows.length === 0) return;
  const r = rows[0];

  const pdfBytes = await generateImagingReferralPdf({
    encounter: {
      encounter_number: r.encounter_number,
      encounter_date: r.encounter_date,
      chief_complaint_text: r.chief_complaint_text,
    },
    patient: {
      name: r.patient_name,
      mrn: r.patient_mrn,
      age_years: r.patient_age_years,
      sex: r.patient_sex,
      phone_e164: r.patient_phone_e164,
    },
    doctor: {
      name: r.doctor_name ?? 'Doctor',
      mci_registration_number: r.doctor_mci,
    },
    order: {
      service_code: r.service_code,
      display_name: r.display_name,
      sub_department: r.sub_department,
      modality: r.modality,
      body_area: r.body_area,
      laterality: r.laterality,
      clinical_indication: r.clinical_indication,
      ordered_at: r.ordered_at,
    },
    demo: process.env.DEMO_MODE !== 'false',
  });

  const blobPath = `imaging-referrals/${r.encounter_number}-${orderId.slice(0, 8)}.pdf`;
  const { url } = await put(blobPath, Buffer.from(pdfBytes), {
    access: 'public',
    contentType: 'application/pdf',
    addRandomSuffix: true,
  });

  await pool.query(
    `UPDATE diagnostic_orders
     SET referral_pdf_url = $2, status = 'dispatched', updated_at = NOW()
     WHERE id = $1`,
    [orderId, url],
  );

  // DEMO_MODE WhatsApp log only (no Meta API call yet)
  if (process.env.DEMO_MODE !== 'false') {
    console.log(`[DEMO_MODE WhatsApp] Radiology referral for order ${orderId} → ${url}`);
  }
}

