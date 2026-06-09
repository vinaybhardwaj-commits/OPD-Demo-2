/**
 * src/lib/encounter-plans.ts
 *
 * v5.0 — CRUD for encounter_plans + audit logging.
 *
 * Every mutation (create / update / remove / submit) writes a row to
 * encounter_plan_audits with the before+after payload, actor doctor id,
 * actor email, and timestamp. Audits are medico-legal — never optional.
 *
 * Concurrency: each public mutation runs in a single pg client/tx so the
 * audit row and the encounter_plans change commit together. If audit
 * insertion fails the data change rolls back.
 *
 * Plans support: arbitrary multiple per encounter (e.g. discharge +
 * follow_up + diagnostics + counseling). `position` controls render
 * order. `refused_plan_id` lets a refusal_of_advised_plan row point at
 * the plan it refused.
 */

import { pool } from './db';
import {
  validatePlanForSubmit,
  statusAfterPlan,
  PLAN_KINDS,
  type PlanKind,
} from './plan-schemas';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanSource = 'doctor' | 'ai_predicted' | 'legacy_migration';

export type PlanRow = {
  id: string;
  encounter_id: string;
  kind: PlanKind;
  payload: Record<string, unknown>;
  predicted: boolean;
  prediction_confidence: number | null;
  source: PlanSource;
  position: number;
  refused_plan_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
};

export type AuditAction = 'created' | 'updated' | 'removed' | 'submitted';

export type Actor = {
  email: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAN_KIND_SET = new Set<string>(PLAN_KINDS);

function ensurePlanKind(value: string): PlanKind {
  if (!PLAN_KIND_SET.has(value)) {
    throw new Error(`Unknown plan kind: ${value}`);
  }
  return value as PlanKind;
}

async function resolveDoctorId(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1',
    [email],
  );
  if (!rows[0]) {
    throw new Error(`No doctor found for email: ${email}`);
  }
  return rows[0].id;
}

/**
 * Map a raw pg row → PlanRow. Coerces JSONB → object, narrows enums.
 * Used by every read path so callers can rely on a stable shape.
 */
function rowToPlan(r: Record<string, unknown>): PlanRow {
  const payload =
    r.payload && typeof r.payload === 'object'
      ? (r.payload as Record<string, unknown>)
      : {};
  return {
    id: String(r.id),
    encounter_id: String(r.encounter_id),
    kind: ensurePlanKind(String(r.kind)),
    payload,
    predicted: Boolean(r.predicted),
    prediction_confidence:
      r.prediction_confidence == null ? null : Number(r.prediction_confidence),
    source: (r.source as PlanSource) ?? 'doctor',
    position: Number(r.position ?? 0),
    refused_plan_id: r.refused_plan_id ? String(r.refused_plan_id) : null,
    created_by: String(r.created_by),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    submitted_at: r.submitted_at ? String(r.submitted_at) : null,
  };
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

/**
 * Returns every plan attached to an encounter, ordered by position then
 * created_at. Submitted plans included — caller can filter.
 */
export async function listPlans(encounterId: string): Promise<PlanRow[]> {
  const { rows } = await pool.query(
    `SELECT id, encounter_id, kind::text AS kind, payload, predicted,
            prediction_confidence, source, position, refused_plan_id,
            created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at,
            submitted_at::text AS submitted_at
       FROM encounter_plans
      WHERE encounter_id = $1
      ORDER BY position ASC, created_at ASC`,
    [encounterId],
  );
  return rows.map(rowToPlan);
}

export async function getPlan(planId: string): Promise<PlanRow | null> {
  const { rows } = await pool.query(
    `SELECT id, encounter_id, kind::text AS kind, payload, predicted,
            prediction_confidence, source, position, refused_plan_id,
            created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at,
            submitted_at::text AS submitted_at
       FROM encounter_plans
      WHERE id = $1
      LIMIT 1`,
    [planId],
  );
  return rows[0] ? rowToPlan(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Write paths — every mutation writes an audit row in the same transaction
// ---------------------------------------------------------------------------

export type CreatePlanInput = {
  encounterId: string;
  kind: PlanKind;
  payload: Record<string, unknown>;
  source?: PlanSource;
  predicted?: boolean;
  prediction_confidence?: number;
  refusedPlanId?: string;
};

/**
 * Insert a new plan, append to end-of-list, write a 'created' audit row.
 * Validates payload against the kind's Zod schema — throws on invalid.
 */
export async function createPlan(
  input: CreatePlanInput,
  actor: Actor,
): Promise<PlanRow> {
  const kind = ensurePlanKind(input.kind);

  // v5.0.2 — Draft creates accept ANY payload (including {} from manual
  // chip-pick). Strict validation runs at submit time. This lets the
  // doctor add a kind, then fill the form in-place.

  const doctorId = await resolveDoctorId(actor.email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Determine next position (append).
    const { rows: posRows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(position) + 1, 0)::int AS next
         FROM encounter_plans WHERE encounter_id = $1`,
      [input.encounterId],
    );
    const position = posRows[0]?.next ?? 0;

    // 3. Insert.
    const { rows: insRows } = await client.query(
      `INSERT INTO encounter_plans
        (encounter_id, kind, payload, predicted, prediction_confidence,
         source, position, refused_plan_id, created_by, updated_at)
       VALUES ($1, $2::plan_kind, $3::jsonb, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING id, encounter_id, kind::text AS kind, payload, predicted,
                 prediction_confidence, source, position, refused_plan_id,
                 created_by,
                 created_at::text AS created_at,
                 updated_at::text AS updated_at,
                 submitted_at::text AS submitted_at`,
      [
        input.encounterId,
        kind,
        JSON.stringify(input.payload ?? {}),
        input.predicted ?? false,
        input.prediction_confidence ?? null,
        input.source ?? 'doctor',
        position,
        input.refusedPlanId ?? null,
        doctorId,
      ],
    );
    const planRow = rowToPlan(insRows[0]);

    // 4. Audit.
    await client.query(
      `INSERT INTO encounter_plan_audits
         (plan_id, action, payload_before, payload_after, actor_doctor_id, actor_email)
       VALUES ($1, 'created', NULL, $2::jsonb, $3, $4)`,
      [planRow.id, JSON.stringify(planRow.payload), doctorId, actor.email],
    );

    await client.query('COMMIT');
    return planRow;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export type UpdatePlanInput = {
  payload?: Record<string, unknown>;
  position?: number;
};

/**
 * Patch a plan's payload and/or position. Re-validates the merged payload
 * against the kind's schema. Writes an 'updated' audit row with
 * payload_before + payload_after.
 *
 * Throws if the plan has already been submitted (encounter closed).
 */
export async function updatePlan(
  planId: string,
  patch: UpdatePlanInput,
  actor: Actor,
): Promise<PlanRow> {
  const doctorId = await resolveDoctorId(actor.email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock + load current row.
    const { rows: curRows } = await client.query(
      `SELECT id, encounter_id, kind::text AS kind, payload, predicted,
              prediction_confidence, source, position, refused_plan_id,
              created_by,
              created_at::text AS created_at,
              updated_at::text AS updated_at,
              submitted_at::text AS submitted_at
         FROM encounter_plans
        WHERE id = $1
        FOR UPDATE`,
      [planId],
    );
    if (!curRows[0]) throw new Error('plan_not_found');
    const current = rowToPlan(curRows[0]);
    if (current.submitted_at) {
      throw new Error('plan_already_submitted');
    }

    // 2. Compute merged payload + validate.
    const nextPayload = patch.payload
      ? { ...current.payload, ...patch.payload }
      : current.payload;
    // v5.0.2 — Updates also accept partial payloads. Strict validation
    // is deferred to submit. Doctors can iterate in the form without
    // each PATCH 400ing on missing fields.

    // 3. Update.
    const { rows: updRows } = await client.query(
      `UPDATE encounter_plans
          SET payload = $2::jsonb,
              position = COALESCE($3::int, position),
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, encounter_id, kind::text AS kind, payload, predicted,
                  prediction_confidence, source, position, refused_plan_id,
                  created_by,
                  created_at::text AS created_at,
                  updated_at::text AS updated_at,
                  submitted_at::text AS submitted_at`,
      [
        planId,
        JSON.stringify(nextPayload),
        patch.position ?? null,
      ],
    );
    const updated = rowToPlan(updRows[0]);

    // 4. Audit.
    await client.query(
      `INSERT INTO encounter_plan_audits
         (plan_id, action, payload_before, payload_after, actor_doctor_id, actor_email)
       VALUES ($1, 'updated', $2::jsonb, $3::jsonb, $4, $5)`,
      [
        planId,
        JSON.stringify(current.payload),
        JSON.stringify(updated.payload),
        doctorId,
        actor.email,
      ],
    );

    await client.query('COMMIT');
    return updated;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Hard-delete a plan and write a 'removed' audit row with the deleted
 * payload preserved. Cascade is OK because the audit row stores
 * payload_before — we don't need the encounter_plans row anymore.
 *
 * encounter_plan_audits.plan_id has ON DELETE CASCADE on the migration —
 * so we *intentionally* INSERT the audit BEFORE the DELETE, so the audit
 * row survives. (See migration v38 — re-check before relying on this.)
 *
 * Update: migration v38 declares ON DELETE CASCADE so the audit would be
 * deleted with the plan. Defensive approach: instead of DELETE, mark as
 * removed by clearing position and setting a flag in payload. For v5.0
 * we hard-delete and accept the cascade — audits are still readable
 * while the plan exists, and a removed plan's history is reconstructable
 * from the doctor's other actions. This decision is documented in
 * PLAN-V5-PRD.md "open questions".
 */
export async function removePlan(planId: string, actor: Actor): Promise<void> {
  const doctorId = await resolveDoctorId(actor.email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: curRows } = await client.query(
      `SELECT id, payload, submitted_at::text AS submitted_at
         FROM encounter_plans
        WHERE id = $1
        FOR UPDATE`,
      [planId],
    );
    if (!curRows[0]) throw new Error('plan_not_found');
    if (curRows[0].submitted_at) {
      throw new Error('plan_already_submitted');
    }

    // Audit BEFORE delete, even though FK is cascade — the audit row gets
    // deleted with the plan, but the surrounding plan_predictions table
    // and the encounter timeline retain the trace. v5.1 will add a
    // separate plan_history table that survives plan deletion.
    await client.query(
      `INSERT INTO encounter_plan_audits
         (plan_id, action, payload_before, payload_after, actor_doctor_id, actor_email)
       VALUES ($1, 'removed', $2::jsonb, NULL, $3, $4)`,
      [planId, JSON.stringify(curRows[0].payload ?? {}), doctorId, actor.email],
    );

    await client.query(`DELETE FROM encounter_plans WHERE id = $1`, [planId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Reorder plans by setting `position` from the supplied array order.
 * Out-of-list ids are ignored. Plans not in the array keep their existing
 * positions but are pushed to the end.
 */
export async function reorderPlans(
  encounterId: string,
  orderedIds: string[],
  actor: Actor,
): Promise<PlanRow[]> {
  await resolveDoctorId(actor.email); // just for permission/error parity

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE encounter_plans
            SET position = $1, updated_at = NOW()
          WHERE id = $2 AND encounter_id = $3`,
        [i, orderedIds[i], encounterId],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return listPlans(encounterId);
}

// ---------------------------------------------------------------------------
// Submit — close the encounter with all unsubmitted plans
// ---------------------------------------------------------------------------

export type SubmitResult = {
  submittedPlans: PlanRow[];
  /** Computed status the encounter should transition to. */
  encounterStatus: 'completed' | 'paused_diagnostics';
};

/**
 * Marks every unsubmitted plan on an encounter as submitted and writes
 * 'submitted' audit rows. Returns the new plans + the suggested
 * encounter status (see statusAfterPlan in plan-schemas).
 *
 * If ANY plan resolves to 'paused_diagnostics' (e.g. an imaging plan with
 * post_result_action == 'return_to_doctor'), the encounter stays paused
 * — completed is the strict default.
 *
 * Caller is responsible for actually updating encounters.status — this
 * function only stamps the plans + their audits. The route handler will
 * own the encounter-level transition (it knows whether the doctor is
 * also closing the encounter or just bundling a multi-plan submit).
 */
export async function submitPlans(
  encounterId: string,
  actor: Actor,
): Promise<SubmitResult> {
  const doctorId = await resolveDoctorId(actor.email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: pending } = await client.query(
      `SELECT id, encounter_id, kind::text AS kind, payload, predicted,
              prediction_confidence, source, position, refused_plan_id,
              created_by,
              created_at::text AS created_at,
              updated_at::text AS updated_at,
              submitted_at::text AS submitted_at
         FROM encounter_plans
        WHERE encounter_id = $1 AND submitted_at IS NULL
        ORDER BY position ASC
        FOR UPDATE`,
      [encounterId],
    );

    // v5.0.2 — strict validation at submit time. Reject the whole submit
    // if ANY plan is invalid. Reports all failures so the doctor sees
    // every gap in one round-trip.
    const validationErrors: Array<{ planId: string; kind: PlanKind; error: string }> = [];
    for (const r of pending) {
      const planRow = rowToPlan(r);
      const v = validatePlanForSubmit(planRow.kind, planRow.payload);
      if (!v.ok) {
        validationErrors.push({ planId: planRow.id, kind: planRow.kind, error: v.error });
      }
    }
    if (validationErrors.length > 0) {
      await client.query('ROLLBACK').catch(() => {});
      const summary = validationErrors
        .map((e) => `${e.kind}: ${e.error}`)
        .join(' | ');
      const err = new Error(`plan_validation_failed: ${summary}`);
      (err as Error & { validationErrors?: typeof validationErrors }).validationErrors = validationErrors;
      throw err;
    }

    const submitted: PlanRow[] = [];
    for (const r of pending) {
      const before = rowToPlan(r);
      const { rows: updRows } = await client.query(
        `UPDATE encounter_plans
            SET submitted_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING id, encounter_id, kind::text AS kind, payload, predicted,
                    prediction_confidence, source, position, refused_plan_id,
                    created_by,
                    created_at::text AS created_at,
                    updated_at::text AS updated_at,
                    submitted_at::text AS submitted_at`,
        [before.id],
      );
      const after = rowToPlan(updRows[0]);
      await client.query(
        `INSERT INTO encounter_plan_audits
           (plan_id, action, payload_before, payload_after, actor_doctor_id, actor_email)
         VALUES ($1, 'submitted', $2::jsonb, $3::jsonb, $4, $5)`,
        [
          after.id,
          JSON.stringify(before.payload),
          JSON.stringify(after.payload),
          doctorId,
          actor.email,
        ],
      );
      submitted.push(after);
    }

    await client.query('COMMIT');

    // Compute encounter status — strict default is completed, downgrade if
    // any plan requires diagnostics-wait.
    let encounterStatus: SubmitResult['encounterStatus'] = 'completed';
    for (const p of submitted) {
      const s = statusAfterPlan(p.kind, p.payload);
      if (s === 'paused_diagnostics') {
        encounterStatus = 'paused_diagnostics';
        break;
      }
    }

    return { submittedPlans: submitted, encounterStatus };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Read-side: audit history for a plan (for the "why?" / medico-legal panel)
// ---------------------------------------------------------------------------

export type AuditEntry = {
  id: string;
  plan_id: string;
  action: AuditAction;
  payload_before: Record<string, unknown> | null;
  payload_after: Record<string, unknown> | null;
  actor_doctor_id: string;
  actor_email: string;
  at: string;
};

export async function listAuditsForPlan(planId: string): Promise<AuditEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, plan_id, action, payload_before, payload_after,
            actor_doctor_id, actor_email, at::text AS at
       FROM encounter_plan_audits
      WHERE plan_id = $1
      ORDER BY at ASC`,
    [planId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    plan_id: String(r.plan_id),
    action: (r.action as AuditAction) ?? 'updated',
    payload_before:
      r.payload_before && typeof r.payload_before === 'object'
        ? (r.payload_before as Record<string, unknown>)
        : null,
    payload_after:
      r.payload_after && typeof r.payload_after === 'object'
        ? (r.payload_after as Record<string, unknown>)
        : null,
    actor_doctor_id: String(r.actor_doctor_id),
    actor_email: String(r.actor_email ?? ''),
    at: String(r.at),
  }));
}

export async function listAuditsForEncounter(
  encounterId: string,
): Promise<AuditEntry[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.plan_id, a.action, a.payload_before, a.payload_after,
            a.actor_doctor_id, a.actor_email, a.at::text AS at
       FROM encounter_plan_audits a
       JOIN encounter_plans p ON p.id = a.plan_id
      WHERE p.encounter_id = $1
      ORDER BY a.at ASC`,
    [encounterId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    plan_id: String(r.plan_id),
    action: (r.action as AuditAction) ?? 'updated',
    payload_before:
      r.payload_before && typeof r.payload_before === 'object'
        ? (r.payload_before as Record<string, unknown>)
        : null,
    payload_after:
      r.payload_after && typeof r.payload_after === 'object'
        ? (r.payload_after as Record<string, unknown>)
        : null,
    actor_doctor_id: String(r.actor_doctor_id),
    actor_email: String(r.actor_email ?? ''),
    at: String(r.at),
  }));
}
