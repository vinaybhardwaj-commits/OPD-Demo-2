/**
 * src/lib/plan-downstream.ts
 *
 * v5.0 — downstream integration stubs.
 *
 * When a plan is submitted, it needs to cascade into the rest of the
 * hospital system: a diagnostics plan creates lab orders, an admission
 * plan books a bed, a vaccinate plan inserts a vaccine_administrations
 * record, a surgical plan hits Vanshika's surgery booking webhook, etc.
 *
 * In v5.0 most of those integrations don't exist yet (Vanshika's webhook,
 * the IPD bed booking endpoint, the ambulance dispatch system). So this
 * file is a thin dispatch table — each per-kind handler logs what it
 * would do, and (where the integration DOES exist already) actually
 * performs the side effect.
 *
 * What's wired today (v5.0):
 *   - vaccinate            → insert vaccine_administrations rows (DB exists)
 *   - discharge            → log only (PDF gen lives elsewhere)
 *   - follow_up            → log only
 *   - refer                → log only
 *   - diagnostics          → log only (lab orders already created upstream)
 *   - imaging              → log only
 *   - medical_admission    → log only
 *   - surgical_plan        → log only (waiting on Vanshika's webhook contract)
 *   - day_care_procedure   → log only
 *   - emergency_transfer   → log only
 *   - counseling_only      → log only
 *   - refusal_of_advised_plan → log only
 *   - no_further_action    → log only
 *
 * Every handler MUST be idempotent — submitPlans may retry the cascade
 * if the encounter status transition fails downstream. Use the plan.id
 * as the idempotency key wherever the integration permits.
 *
 * Every handler MUST be soft-failing — a downstream error should not
 * block the encounter from closing. Log + return.
 */

import { pool } from './db';
import type { PlanKind } from './plan-schemas';
import type { PlanRow } from './encounter-plans';

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type DownstreamResult = {
  ok: boolean;
  kind: PlanKind;
  plan_id: string;
  /** Short tag for the action that fired (or would have fired). */
  action: string;
  /** Optional structured detail for the audit trail / debug surface. */
  detail?: Record<string, unknown>;
  /** Error message when ok=false. Never throws upstream. */
  error?: string;
};

// ---------------------------------------------------------------------------
// Dispatch entry point
// ---------------------------------------------------------------------------

/**
 * Apply downstream side effects for a single submitted plan. Never
 * throws. Returns a result describing what happened so the caller can
 * audit / surface it.
 */
export async function applyPlanDownstream(
  plan: PlanRow,
): Promise<DownstreamResult> {
  try {
    switch (plan.kind) {
      case 'vaccinate':
        return await applyVaccinate(plan);
      case 'discharge':
        return logOnly(plan, 'discharge_summary_pending', {
          note: 'Discharge summary + Rx PDF handled by /api/encounters/[id]/prescription.',
        });
      case 'follow_up':
        return logOnly(plan, 'followup_booking_pending', {
          note: 'Calendar / appointment booking integration is v5.2.',
          when: plan.payload.when,
        });
      case 'refer':
        return logOnly(plan, 'referral_letter_pending', {
          note: 'Internal referral routing + referral letter PDF is v5.2.',
          urgency: plan.payload.urgency,
          to_specialty: plan.payload.to_specialty,
        });
      case 'diagnostics':
        return logOnly(plan, 'lab_orders_queued', {
          note: 'Lab orders were created upstream during encounter; this plan binds them.',
          lab_order_ids: plan.payload.lab_order_ids ?? [],
          urgency: plan.payload.urgency,
        });
      case 'imaging':
        return logOnly(plan, 'imaging_order_pending', {
          note: 'Radiology queue integration is v5.2. External imaging gets a PDF requisition.',
          modality: plan.payload.modality,
          body_part: plan.payload.body_part,
          is_external: plan.payload.is_external,
        });
      case 'medical_admission':
        return logOnly(plan, 'ipd_admission_pending', {
          note: 'IPD bed booking integration is v5.2 (waiting on Sandhya).',
          bed_type: plan.payload.bed_type,
          admit_under_specialty: plan.payload.admit_under_specialty,
        });
      case 'surgical_plan':
        return logOnly(plan, 'surgery_booking_pending', {
          note: 'Surgery booking webhook is v5.2 (waiting on Vanshika contract).',
          procedure_name: plan.payload.procedure_name,
          urgency: plan.payload.urgency,
          planned_date: plan.payload.planned_date,
        });
      case 'day_care_procedure':
        return logOnly(plan, 'day_care_queued', {
          note: 'Day-care queue integration is v5.2.',
          procedure_name: plan.payload.procedure_name,
          scheduled_at: plan.payload.scheduled_at,
        });
      case 'emergency_transfer':
        return logOnly(plan, 'ambulance_dispatch_pending', {
          note: 'Ambulance dispatch integration is v5.2.',
          target_facility: plan.payload.target_facility,
          transfer_mode: plan.payload.transfer_mode,
        });
      case 'counseling_only':
        return logOnly(plan, 'counseling_recorded', {
          note: 'Counseling text persisted in plan payload; no further integration needed.',
          topics: plan.payload.topics,
        });
      case 'refusal_of_advised_plan':
        return logOnly(plan, 'refusal_form_pending', {
          note: 'Refusal form PDF generation is v5.2.',
          high_risk: plan.payload.high_risk,
          refused_plan_id: plan.refused_plan_id,
        });
      case 'no_further_action':
        return logOnly(plan, 'tracking_only', {
          note: 'No downstream action. Tracking item recorded.',
          tracking_item: plan.payload.tracking_item,
        });
      default: {
        // Exhaustiveness check — TS errors here if a PlanKind is missed.
        const _exhaustive: never = plan.kind;
        return {
          ok: false,
          kind: plan.kind,
          plan_id: plan.id,
          action: 'unknown_kind',
          error: `Unhandled plan kind: ${String(_exhaustive)}`,
        };
      }
    }
  } catch (e) {
    return {
      ok: false,
      kind: plan.kind,
      plan_id: plan.id,
      action: 'downstream_error',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Convenience: apply downstream side effects for an array of plans.
 * Runs them in parallel — they shouldn't depend on each other.
 */
export async function applyPlansDownstream(
  plans: PlanRow[],
): Promise<DownstreamResult[]> {
  return Promise.all(plans.map((p) => applyPlanDownstream(p)));
}

// ---------------------------------------------------------------------------
// Per-kind handlers
// ---------------------------------------------------------------------------

function logOnly(
  plan: PlanRow,
  action: string,
  detail?: Record<string, unknown>,
): DownstreamResult {
  console.log(
    `[plan-downstream] ${plan.kind} #${plan.id} — ${action}`,
    detail ?? {},
  );
  return { ok: true, kind: plan.kind, plan_id: plan.id, action, detail };
}

type VaccineRecord = {
  name?: string;
  site?: string;
  batch?: string;
  expiry?: string;
  manufacturer?: string;
  next_dose_due_date?: string;
};

/**
 * Inserts one vaccine_administrations row per vaccine listed in the
 * plan payload. Idempotent: it deletes existing rows for this plan_id
 * first, then re-inserts. (The doctor may have edited the vaccine list
 * after a previous submit if the plan was un-submitted in some flow.)
 */
async function applyVaccinate(plan: PlanRow): Promise<DownstreamResult> {
  const vaccines = Array.isArray(plan.payload.vaccines)
    ? (plan.payload.vaccines as VaccineRecord[])
    : [];
  if (vaccines.length === 0) {
    return logOnly(plan, 'vaccinate_empty', { note: 'No vaccines listed.' });
  }

  // Look up patient_id from encounter (we don't carry it on PlanRow).
  const { rows: encRows } = await pool.query<{ patient_id: string }>(
    `SELECT patient_id FROM encounters WHERE id = $1 LIMIT 1`,
    [plan.encounter_id],
  );
  if (!encRows[0]) {
    return {
      ok: false,
      kind: plan.kind,
      plan_id: plan.id,
      action: 'vaccinate_no_encounter',
      error: `Encounter ${plan.encounter_id} not found.`,
    };
  }
  const patient_id = encRows[0].patient_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency: clear existing rows for this plan, re-insert.
    await client.query(
      `DELETE FROM vaccine_administrations WHERE plan_id = $1`,
      [plan.id],
    );

    for (const v of vaccines) {
      await client.query(
        `INSERT INTO vaccine_administrations
           (patient_id, plan_id, vaccine_name, site, batch, expiry,
            manufacturer, next_dose_due_date, administered_at)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8::date, NOW())`,
        [
          patient_id,
          plan.id,
          (v.name ?? '').trim() || 'unspecified',
          v.site ?? null,
          v.batch ?? null,
          v.expiry ?? null,
          v.manufacturer ?? null,
          v.next_dose_due_date ?? null,
        ],
      );
    }

    await client.query('COMMIT');
    return {
      ok: true,
      kind: plan.kind,
      plan_id: plan.id,
      action: 'vaccinate_administered',
      detail: { vaccines_count: vaccines.length },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return {
      ok: false,
      kind: plan.kind,
      plan_id: plan.id,
      action: 'vaccinate_db_error',
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    client.release();
  }
}
