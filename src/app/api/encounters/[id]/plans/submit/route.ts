/**
 * POST /api/encounters/[id]/plans/submit
 *
 * Marks every unsubmitted plan on the encounter as submitted, runs
 * downstream side effects (vaccine_administrations insert, lab order
 * binding, integration stubs), and transitions encounters.status to
 * either 'completed' or 'paused_diagnostics' based on which plans
 * gated the encounter.
 *
 * Why one endpoint rather than per-plan submit:
 *   - Atomicity: a doctor saying "I'm done" should atomically close
 *     the encounter. Per-plan submit would leak unfinished plans.
 *   - Status calculation: which plan dominates the encounter status
 *     is computed across all plans, not per-plan.
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { submitPlans } from '@/lib/encounter-plans';
import { applyPlansDownstream } from '@/lib/plan-downstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  // Ownership + status guard.
  const { rows: ownRows } = await pool.query<{
    status: string;
    doctor_email: string;
  }>(
    `SELECT e.status::text AS status, d.email AS doctor_email
       FROM encounters e
       JOIN doctors d ON d.id = e.doctor_id
      WHERE e.id = $1
      LIMIT 1`,
    [id],
  );
  const own = ownRows[0];
  if (!own) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (own.doctor_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (own.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_already_completed' },
      { status: 409 },
    );
  }

  // 1. Stamp every unsubmitted plan as submitted + write audit rows.
  let result;
  try {
    result = await submitPlans(id, { email: session.email });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'submit_failed';
    // v5.0.2 — surface plan_validation_failed as 400 + structured detail.
    const ve = (e as { validationErrors?: unknown }).validationErrors;
    if (msg.startsWith('plan_validation_failed')) {
      return NextResponse.json(
        { ok: false, error: 'plan_validation_failed', validationErrors: ve, detail: msg },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  if (result.submittedPlans.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'no_plans_to_submit' },
      { status: 400 },
    );
  }

  // 2. Run downstream side effects. Soft-fail per plan — don't block close.
  const downstream = await applyPlansDownstream(result.submittedPlans);

  // 3. Transition encounter status.
  const nextStatus = result.encounterStatus;
  try {
    if (nextStatus === 'completed') {
      await pool.query(
        `UPDATE encounters
            SET status = 'completed'::encounter_status,
                completed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1 AND status <> 'completed'`,
        [id],
      );
    } else {
      // paused_diagnostics
      await pool.query(
        `UPDATE encounters
            SET status = 'paused_diagnostics'::encounter_status,
                updated_at = NOW()
          WHERE id = $1`,
        [id],
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: 'encounter_status_update_failed',
        detail: e instanceof Error ? e.message : String(e),
        submittedPlans: result.submittedPlans,
        downstream,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    encounter_status: nextStatus,
    submittedPlans: result.submittedPlans,
    downstream,
  });
}
