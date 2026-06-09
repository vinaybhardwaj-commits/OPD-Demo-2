/**
 * POST /api/encounters/[id]/diagnostics/prestage
 *
 * v3.2b — CCE all-modality pre-stage. Same semantics as the v2.1.1
 * labs/prestage endpoint but writes directly to diagnostic_orders
 * (no lab-only restriction) for the doctor's <DiagnosticOrderModal>
 * + <DiagnosticsQuickAddStrip> to pick up.
 *
 * Contract:
 *   - Auth: role='cce' or role='admin'
 *   - Encounter must be in registered | at_triage | waiting_for_doctor
 *   - Inserts diagnostic_orders rows with:
 *       status='pre_staged', ordering_actor='cce_prestage',
 *       ordered_by_doctor_id=NULL,
 *       pre_staged_by_cce_id + pre_staged_at stamped from session.
 *   - Notifies the room channel so the doctor's screen sees them appear.
 *
 * Body: { service_codes: string[] }
 *   Each code must exist in diagnostic_catalog and be is_active.
 *   Duplicates against existing pre_staged/pending rows are silently
 *   skipped (the catalog has a UNIQUE(encounter_id, service_code)
 *   index on the open-status set).
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
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
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

    const body = (await req.json()) as { service_codes?: unknown };
    const codes = (Array.isArray(body.service_codes) ? body.service_codes : [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter((c) => c.length > 0 && c.length <= 80);

    if (codes.length === 0) {
      return NextResponse.json({ ok: false, error: 'no_codes_provided' }, { status: 400 });
    }

    const { rows: encRows } = await pool.query<{
      id: string;
      patient_id: string;
      status: string;
      room_id: string | null;
    }>(
      `SELECT id, patient_id, status::text AS status, room_id
       FROM encounters WHERE id = $1 LIMIT 1`,
      [encId],
    );
    const enc = encRows[0];
    if (!enc) return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
    if (!ALLOWED_STATES.has(enc.status)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'encounter_not_prestageable',
          detail: `Encounter is ${enc.status}; pre-stage only allowed before the doctor starts.`,
        },
        { status: 409 },
      );
    }

    // Validate codes against catalog
    const catRes = await pool.query<{ service_code: string; modality: string }>(
      `SELECT service_code, modality FROM diagnostic_catalog
       WHERE service_code = ANY($1::text[]) AND is_active = true`,
      [codes],
    );
    const validCodes = new Map<string, string>(catRes.rows.map((r) => [r.service_code, r.modality]));
    if (validCodes.size === 0) {
      return NextResponse.json({ ok: false, error: 'no_valid_codes' }, { status: 400 });
    }

    // CCE doctors-row id for audit
    const { rows: cceRows } = await pool.query<{ id: string }>(
      `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
      [session.email ?? ''],
    );
    const cceId = cceRows[0]?.id ?? null;
    if (!cceId) {
      return NextResponse.json({ ok: false, error: 'cce_not_seeded' }, { status: 500 });
    }

    const inserted: { id: string; service_code: string }[] = [];
    const skipped: string[] = [];

    for (const [code, modality] of validCodes.entries()) {
      // Skip if there's already an open order for the same service_code
      // on this encounter (the strip's source-of-truth dedup behavior).
      const dup = await pool.query(
        `SELECT 1 FROM diagnostic_orders
         WHERE encounter_id = $1 AND service_code = $2
           AND status IN ('pre_staged','pending','in_progress','awaiting_confirmation','ordered','dispatched')
         LIMIT 1`,
        [encId, code],
      );
      if (dup.rowCount && dup.rowCount > 0) {
        skipped.push(code);
        continue;
      }
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO diagnostic_orders (
           encounter_id, patient_id, service_code, modality, status,
           ordered_by_doctor_id, ordering_actor,
           pre_staged_by_cce_id, pre_staged_at
         ) VALUES ($1, $2, $3, $4::text, 'pre_staged'::text, NULL, 'cce_prestage'::text, $5, NOW())
         RETURNING id`,
        [encId, enc.patient_id, code, modality, cceId],
      );
      if (ins.rows[0]) inserted.push({ id: ins.rows[0].id, service_code: code });
    }

    // Notify the room channel so the doctor's queue/encounter screen refreshes
    if (enc.room_id) {
      try { await notifyRoom(enc.room_id, `diagnostics_prestaged:${encId}`); }
      catch { /* notify is best-effort */ }
    }

    return NextResponse.json({
      ok: true,
      inserted,
      skipped,
      stats: { requested: codes.length, inserted: inserted.length, skipped: skipped.length },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
