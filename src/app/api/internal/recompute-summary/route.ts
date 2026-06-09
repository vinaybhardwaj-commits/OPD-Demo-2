/**
 * POST /api/internal/recompute-summary?patient_id=<uuid>
 *
 * Thin HTTP wrapper around `recomputePatientSummary()` (which lives in
 * src/lib/patient-summary.ts). The helper does the Qwen call, the
 * patient_summaries upsert, and the qwen_call_audit write. This route
 * adds auth + parameter parsing.
 *
 * Authentication paths:
 *   - Authed doctor session, OR
 *   - `x-internal-secret: <INTERNAL_API_SECRET>` header
 *
 * The shared-secret path is here for future server-to-server calls
 * (e.g. a post-/complete hook). PH.1.3's admin backfill calls the helper
 * directly via server action — it doesn't need this HTTP wrapper.
 *
 * Behaviour:
 *   - patient_id missing → 400
 *   - patient_id unknown → 404
 *   - Qwen / validation failure → 200 with { ok:false, reason, detail }
 *     and patient_summaries row left at status='failed'
 *   - Success → 200 with { ok:true, latency_ms, encounter_count, window }
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { recomputePatientSummary } from '@/lib/patient-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function isAuthorized(req: Request): Promise<{ ok: boolean; doctorId: string | null }> {
  const headerSecret = req.headers.get('x-internal-secret');
  const envSecret = process.env.INTERNAL_API_SECRET;
  if (headerSecret && envSecret && headerSecret === envSecret) {
    return { ok: true, doctorId: null };
  }
  const session = await getCurrentDoctor();
  if (!session) return { ok: false, doctorId: null };
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  return { ok: true, doctorId: rows[0]?.id ?? null };
}

export async function POST(req: Request) {
  const auth = await isAuthorized(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const patient_id = url.searchParams.get('patient_id');
  if (!patient_id) {
    return NextResponse.json({ ok: false, error: 'patient_id required' }, { status: 400 });
  }

  const outcome = await recomputePatientSummary({
    patientId: patient_id,
    doctorId: auth.doctorId,
  });

  if (!outcome.ok && outcome.reason === 'patient_not_found') {
    return NextResponse.json({ ok: false, error: 'patient_not_found' }, { status: 404 });
  }

  return NextResponse.json(outcome.ok ? { ...outcome, patient_id } : outcome);
}
