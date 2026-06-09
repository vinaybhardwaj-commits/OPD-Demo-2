/**
 * GET    /api/encounters/[id]/plans         — list all plans for an encounter
 * POST   /api/encounters/[id]/plans         — create a new plan { kind, payload, ...opts }
 * PATCH  /api/encounters/[id]/plans         — reorder { orderedIds: string[] }
 *
 * Per-plan mutations live at /api/encounters/[id]/plans/[planId]/route.ts:
 *   PATCH  → update payload / position
 *   DELETE → remove plan
 *
 * Submission of all unsubmitted plans (closes the encounter):
 *   POST /api/encounters/[id]/plans/submit
 *
 * Authorization: doctor must own the encounter (or be admin).
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import {
  listPlans,
  createPlan,
  reorderPlans,
  type PlanSource,
} from '@/lib/encounter-plans';
import { PLAN_KINDS, type PlanKind } from '@/lib/plan-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ownsEncounter(
  encId: string,
  doctorEmail: string,
): Promise<{ ok: true; status: string } | { ok: false; status_code: number }> {
  const { rows } = await pool.query<{ status: string; doctor_email: string }>(
    `SELECT e.status::text AS status, d.email AS doctor_email
       FROM encounters e
       JOIN doctors d ON d.id = e.doctor_id
      WHERE e.id = $1
      LIMIT 1`,
    [encId],
  );
  const row = rows[0];
  if (!row) return { ok: false, status_code: 404 };
  if (row.doctor_email.toLowerCase() !== doctorEmail.toLowerCase()) {
    return { ok: false, status_code: 403 };
  }
  return { ok: true, status: row.status };
}

const PLAN_KIND_SET = new Set<string>(PLAN_KINDS);

// ---------------------------------------------------------------------------
// GET — list plans
// ---------------------------------------------------------------------------

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const own = await ownsEncounter(id, session.email);
  if (!own.ok) {
    return NextResponse.json(
      { ok: false, error: own.status_code === 404 ? 'not_found' : 'forbidden' },
      { status: own.status_code },
    );
  }

  try {
    const plans = await listPlans(id);
    return NextResponse.json({ ok: true, plans });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'list_failed' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create a plan
// ---------------------------------------------------------------------------

type CreateBody = {
  kind?: string;
  payload?: Record<string, unknown>;
  source?: PlanSource;
  predicted?: boolean;
  prediction_confidence?: number;
  refusedPlanId?: string;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const own = await ownsEncounter(id, session.email);
  if (!own.ok) {
    return NextResponse.json(
      { ok: false, error: own.status_code === 404 ? 'not_found' : 'forbidden' },
      { status: own.status_code },
    );
  }
  if (own.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_completed' },
      { status: 409 },
    );
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!body.kind || !PLAN_KIND_SET.has(body.kind)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_kind', valid_kinds: PLAN_KINDS },
      { status: 400 },
    );
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'missing_payload' },
      { status: 400 },
    );
  }

  try {
    const plan = await createPlan(
      {
        encounterId: id,
        kind: body.kind as PlanKind,
        payload: body.payload,
        source: body.source ?? 'doctor',
        predicted: body.predicted ?? false,
        prediction_confidence: body.prediction_confidence,
        refusedPlanId: body.refusedPlanId,
      },
      { email: session.email },
    );
    return NextResponse.json({ ok: true, plan }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isValidation = msg.startsWith('Invalid plan payload');
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isValidation ? 400 : 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — reorder
// ---------------------------------------------------------------------------

type ReorderBody = {
  orderedIds?: unknown;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const own = await ownsEncounter(id, session.email);
  if (!own.ok) {
    return NextResponse.json(
      { ok: false, error: own.status_code === 404 ? 'not_found' : 'forbidden' },
      { status: own.status_code },
    );
  }

  let body: ReorderBody;
  try {
    body = (await req.json()) as ReorderBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!Array.isArray(body.orderedIds) || body.orderedIds.some((x) => typeof x !== 'string')) {
    return NextResponse.json(
      { ok: false, error: 'orderedIds must be string[]' },
      { status: 400 },
    );
  }

  try {
    const plans = await reorderPlans(id, body.orderedIds as string[], {
      email: session.email,
    });
    return NextResponse.json({ ok: true, plans });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'reorder_failed' },
      { status: 500 },
    );
  }
}
