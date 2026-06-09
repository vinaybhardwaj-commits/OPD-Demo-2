/**
 * GET /api/patients/[id]/traces
 *
 * v6.0 Phase 4 — backs the patient AI-activity tab (decision Q7).
 *
 * Includes both encounter-bound traces (joined via patient_id) AND
 * patient-level fires (recomputePatientSummary, comorbidity-history)
 * that aren't tied to a specific encounter.
 *
 * Auth: any logged-in doctor (patients are not silo'd by ownership in
 * OPD; medico-legal review benefits from any clinician being able to
 * audit any patient's AI activity).
 */

import { NextResponse } from 'next/server';
import { getCurrentDoctor } from '@/lib/auth';
import { listTracesForPatient } from '@/lib/llm-trace/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const traces = await listTracesForPatient(id, 200);
  return NextResponse.json({ ok: true, traces });
}
