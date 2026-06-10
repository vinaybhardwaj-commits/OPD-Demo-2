/**
 * POST /api/encounters/[id]/cdmss-items/[itemId] — P2.4 accept/ignore,
 * P4.1 SMART ROUTING on accept (design §12.3: accepted items drop into the
 * final disposition / orders). Locks (V, 10 Jun):
 *   what_to_do investigation → UNSUBMITTED diagnostics plan row
 *   what_to_do referral      → UNSUBMITTED refer plan row
 *   what_to_do follow_up / red_flag → UNSUBMITTED follow_up plan row
 *   what_to_do treatment     → Rx line via the RX.1 resolver (formulary
 *                              match + parsed sig; non-formulary as written)
 *   probability (differential group) → appends the dx to assessment_text
 *                              (provenance → ai_then_edited: doctor-approved)
 *   what_else / probability(risk)    → decision record only
 * Everything lands UNSUBMITTED — the doctor owns it at finalize.
 * 'reset' (undo) deletes the linked plan row IF still unsubmitted; Rx lines
 * and assessment appends stay (visible, doctor-editable) — reported back.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { resolveDrugText } from '@/lib/rx-resolve';
import { findSmartDefaults } from '@/lib/drug-defaults';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ACTIONS: Record<string, string> = { accept: 'accepted', ignore: 'ignored', reset: 'proposed' };

type ItemRow = {
  id: string;
  item_group: string;
  payload: Record<string, unknown>;
  status: string;
  linked_plan_id: string | null;
};

async function routeAccept(
  encounterId: string,
  doctorId: string,
  item: ItemRow,
): Promise<{ routed: string | null; linked_plan_id?: string }> {
  const p = item.payload;
  if (item.item_group === 'what_to_do') {
    const kind = String(p.kind ?? 'follow_up');
    const summary = String(p.summary ?? '').slice(0, 300);
    const reasoning = String(p.reasoning ?? '').slice(0, 400);
    if (!summary) return { routed: null };

    if (kind === 'treatment') {
      // Rx line via the resolver — formulary match + typed-sig override.
      const r = await resolveDrugText(summary);
      const best = r.matches[0] ?? null;
      const defaults = best ? findSmartDefaults(best.generic_name) : null;
      const line = best
        ? {
            item_code: best.item_code,
            brand_name: best.brand_name,
            generic_name: best.generic_name,
            dosage_form: best.dosage_form,
            strength: best.strength,
            schedule_dc: best.schedule_dc,
            is_high_risk: best.is_high_risk,
            frequency: r.parsed.frequency ?? defaults?.frequency ?? null,
            duration_days: r.parsed.duration_days ?? defaults?.duration_days ?? null,
            timing: r.parsed.timing ?? defaults?.timing ?? null,
            instructions: reasoning ? `CDMSS: ${reasoning}`.slice(0, 200) : '',
          }
        : {
            item_code: `NF-${Date.now().toString(36)}`,
            brand_name: r.resolved_name || summary,
            generic_name: r.resolved_name || summary,
            dosage_form: 'AS WRITTEN',
            strength: r.parsed.strength,
            schedule_dc: 'H',
            is_high_risk: false,
            frequency: r.parsed.frequency,
            duration_days: r.parsed.duration_days,
            timing: r.parsed.timing,
            instructions: 'CDMSS suggestion — non-formulary, as written',
            non_formulary: true,
          };
      const { rows: rx } = await pool.query<{ lines: unknown }>(
        `SELECT lines FROM prescriptions WHERE encounter_id = $1`,
        [encounterId],
      );
      const lines = Array.isArray(rx[0]?.lines) ? (rx[0].lines as Array<{ item_code?: string }>) : [];
      if (!lines.some((l) => l.item_code === line.item_code)) {
        const next = [...lines, line];
        const { rows: encRow } = await pool.query<{ encounter_number: string }>(
          `SELECT encounter_number FROM encounters WHERE id = $1`,
          [encounterId],
        );
        const rxNumber = (encRow[0]?.encounter_number ?? 'ENC-X').replace(/^ENC-/, 'RX-');
        await pool.query(
          `INSERT INTO prescriptions (encounter_id, prescription_number, lines)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (encounter_id) DO UPDATE SET lines = EXCLUDED.lines`,
          [encounterId, rxNumber, JSON.stringify(next)],
        );
      }
      return { routed: best ? `rx_line:${best.brand_name}` : 'rx_line_non_formulary' };
    }

    // Plan-row kinds — minimal schema-valid payloads + the cdmss context.
    let planKind: string;
    let payload: Record<string, unknown>;
    if (kind === 'investigation') {
      planKind = 'diagnostics';
      payload = { urgency: 'routine', post_result_action: 'return_to_doctor', lab_order_ids: [], cdmss: { summary, reasoning } };
    } else if (kind === 'referral') {
      planKind = 'refer';
      payload = { to_specialty: summary.slice(0, 80), urgency: 'routine', reason: reasoning || summary, cdmss: { summary, reasoning } };
    } else {
      planKind = 'follow_up';
      payload = { when: { kind: 'relative', days: 14 }, reason: summary, cdmss: { summary, reasoning } };
    }
    const { rows: plan } = await pool.query<{ id: string }>(
      `INSERT INTO encounter_plans (encounter_id, kind, payload, source, created_by)
       VALUES ($1, $2::plan_kind, $3::jsonb, 'cdmss', $4)
       RETURNING id`,
      [encounterId, planKind, JSON.stringify(payload), doctorId],
    );
    return { routed: `plan:${planKind}`, linked_plan_id: plan[0].id };
  }

  if (item.item_group === 'probability' && p.group === 'differential') {
    const label = String(p.label ?? '').slice(0, 160);
    const pct = typeof p.pct === 'number' ? p.pct : null;
    if (!label) return { routed: null };
    await pool.query(
      `UPDATE encounters
          SET assessment_text = COALESCE(assessment_text, '') ||
                CASE WHEN COALESCE(assessment_text, '') = '' THEN '' ELSE E'\n' END ||
                $2,
              field_provenance = COALESCE(field_provenance, '{}'::jsonb) || '{"assessment_text":"ai_then_edited"}'::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [encounterId, `• Accepted differential: ${label}${pct != null ? ` (~${pct}% likelihood)` : ''}`],
    );
    return { routed: 'assessment_append' };
  }

  return { routed: null }; // what_else + risk rows: decision record only
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id, itemId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const status = ACTIONS[body.action ?? ''];
  if (!status) return NextResponse.json({ ok: false, error: 'bad_action' }, { status: 400 });

  const { rows: docRows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1',
    [user.email],
  );
  const doctorId = docRows[0]?.id ?? null;
  if (!doctorId) return NextResponse.json({ ok: false, error: 'no_doctor_row' }, { status: 403 });

  const { rows: items } = await pool.query<ItemRow>(
    `SELECT id, item_group, payload, status, linked_plan_id
       FROM encounter_cdmss_items WHERE id = $2 AND encounter_id = $1`,
    [id, itemId],
  );
  if (items.length === 0) return NextResponse.json({ ok: false, error: 'item_not_found' }, { status: 404 });
  const item = items[0];

  let routed: string | null = null;
  let linkedPlanId: string | null = item.linked_plan_id;
  let undoNote: string | null = null;

  if (status === 'accepted' && item.status !== 'accepted') {
    try {
      const r = await routeAccept(id, doctorId, item);
      routed = r.routed;
      if (r.linked_plan_id) linkedPlanId = r.linked_plan_id;
    } catch (e) {
      // Decision still records; routing is best-effort and reported.
      routed = `route_failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
    }
  }
  if (status === 'proposed' && item.status === 'accepted') {
    // Undo: remove the linked plan row IF still unsubmitted.
    if (item.linked_plan_id) {
      const { rowCount } = await pool.query(
        `DELETE FROM encounter_plans WHERE id = $1 AND submitted_at IS NULL`,
        [item.linked_plan_id],
      );
      undoNote = rowCount ? 'plan_removed' : 'plan_kept_already_submitted';
      if (rowCount) linkedPlanId = null;
    } else if (item.item_group === 'what_to_do' && item.payload.kind === 'treatment') {
      undoNote = 'rx_line_kept_remove_in_composer';
    } else if (item.item_group === 'probability') {
      undoNote = 'assessment_append_kept_edit_inline';
    }
  }

  const { rows } = await pool.query<{ id: string; status: string }>(
    `UPDATE encounter_cdmss_items
        SET status = $3,
            acted_by = $4,
            acted_at = CASE WHEN $3 = 'proposed' THEN NULL ELSE NOW() END,
            linked_plan_id = $5
      WHERE id = $2 AND encounter_id = $1
      RETURNING id, status`,
    [id, itemId, status, status === 'proposed' ? null : doctorId, linkedPlanId],
  );
  return NextResponse.json({ ok: true, id: rows[0].id, status: rows[0].status, routed, undo: undoNote });
}
