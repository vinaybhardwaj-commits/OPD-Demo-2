/**
 * PATCH  /api/encounters/[id]/plans/[planId]  — update payload / position
 * DELETE /api/encounters/[id]/plans/[planId]  — remove plan
 *
 * Encounter ownership is enforced by joining encounter_plans → encounters
 * → doctors and matching the session's email.
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { updatePlan, removePlan } from '@/lib/encounter-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ownsPlan(
  planId: string,
  encounterId: string,
  doctorEmail: string,
): Promise<{ ok: true } | { ok: false; status_code: number; error: string }> {
  const { rows } = await pool.query<{
    encounter_id: string;
    doctor_email: string;
    encounter_status: string;
  }>(
    `SELECT ep.encounter_id::text,
            d.email AS doctor_email,
            e.status::text AS encounter_status
       FROM encounter_plans ep
       JOIN encounters e ON e.id = ep.encounter_id
       JOIN doctors d ON d.id = e.doctor_id
      WHERE ep.id = $1
      LIMIT 1`,
    [planId],
  );
  const row = rows[0];
  if (!row) return { ok: false, status_code: 404, error: 'plan_not_found' };
  if (row.encounter_id !== encounterId) {
    return { ok: false, status_code: 404, error: 'plan_not_on_encounter' };
  }
  if (row.doctor_email.toLowerCase() !== doctorEmail.toLowerCase()) {
    return { ok: false, status_code: 403, error: 'forbidden' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

type PatchBody = {
  payload?: Record<string, unknown>;
  position?: number;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; planId: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id, planId } = await ctx.params;

  const own = await ownsPlan(planId, id, session.email);
  if (!own.ok) {
    return NextResponse.json(
      { ok: false, error: own.error },
      { status: own.status_code },
    );
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (
    body.payload === undefined &&
    body.position === undefined
  ) {
    return NextResponse.json(
      { ok: false, error: 'nothing_to_update' },
      { status: 400 },
    );
  }
  if (body.payload !== undefined && (typeof body.payload !== 'object' || body.payload === null)) {
    return NextResponse.json(
      { ok: false, error: 'payload must be an object' },
      { status: 400 },
    );
  }
  if (body.position !== undefined && !Number.isFinite(body.position)) {
    return NextResponse.json(
      { ok: false, error: 'position must be a number' },
      { status: 400 },
    );
  }

  try {
    const plan = await updatePlan(
      planId,
      {
        payload: body.payload,
        position: body.position,
      },
      { email: session.email },
    );
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'plan_already_submitted') {
      return NextResponse.json({ ok: false, error: msg }, { status: 409 });
    }
    if (msg === 'plan_not_found') {
      return NextResponse.json({ ok: false, error: msg }, { status: 404 });
    }
    const isValidation = msg.startsWith('Invalid plan payload');
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isValidation ? 400 : 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; planId: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id, planId } = await ctx.params;

  const own = await ownsPlan(planId, id, session.email);
  if (!own.ok) {
    return NextResponse.json(
      { ok: false, error: own.error },
      { status: own.status_code },
    );
  }

  try {
    await removePlan(planId, { email: session.email });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'plan_already_submitted') {
      return NextResponse.json({ ok: false, error: msg }, { status: 409 });
    }
    if (msg === 'plan_not_found') {
      return NextResponse.json({ ok: false, error: msg }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
