/**
 * POST /api/patients/[id]/tier-override
 *
 * v3.9.6 — clinician manually overrides the auto-computed panel tier.
 * Body: { state: 'T0' | 'T1' | 'T2' | 'T3' | null, reason?: string }
 *   - state = T0..T3 → sets override
 *   - state = null → clears override (auto tier resumes)
 *
 * Stamped with doctor + at for audit. Reason is optional but logged.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATES = new Set(['T0', 'T1', 'T2', 'T3']);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const { id: patientId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(patientId)) {
      return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
    }

    const body = (await req.json()) as { state?: string | null; reason?: string };
    if (body.state !== undefined && body.state !== null && !VALID_STATES.has(body.state)) {
      return NextResponse.json({ ok: false, error: 'invalid_state' }, { status: 400 });
    }

    const docRes = await pool.query<{ id: string }>(
      `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
      [session.email ?? ''],
    );
    const doctorId = docRes.rows[0]?.id ?? null;

    const result = await pool.query(
      `UPDATE patients
       SET tier_override_state = $2,
           tier_override_reason = $3,
           tier_override_by_doctor_id = $4,
           tier_override_at = NOW()
       WHERE id = $1
       RETURNING id, tier_override_state, tier_override_reason, tier_override_at::text AS tier_override_at`,
      [patientId, body.state ?? null, (body.reason ?? '').slice(0, 500) || null, doctorId],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, patient: result.rows[0] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
