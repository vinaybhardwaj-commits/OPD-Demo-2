/**
 * PATCH /api/patients/[id]/comorbidities/[comorbidityId]
 *
 * v3.9.5 — Update control_state and/or severity_state on a single
 * patient_comorbidities row. Body: { control_state?, severity_state? }.
 * Either or both can be sent; null clears.
 *
 * state_updated_at + state_updated_by_doctor_id are stamped on every
 * non-noop write for audit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ControlState = 'well' | 'partial' | 'uncontrolled' | null;
type SeverityState = 'mild' | 'moderate' | 'severe' | null;

const CONTROL_VALUES = new Set(['well', 'partial', 'uncontrolled']);
const SEVERITY_VALUES = new Set(['mild', 'moderate', 'severe']);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; comorbidityId: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const { id: patientId, comorbidityId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(patientId) || !/^[0-9a-f-]{36}$/i.test(comorbidityId)) {
      return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
    }

    const body = (await req.json()) as {
      control_state?: ControlState;
      severity_state?: SeverityState;
    };

    if (body.control_state !== undefined && body.control_state !== null && !CONTROL_VALUES.has(body.control_state)) {
      return NextResponse.json({ ok: false, error: 'invalid_control_state' }, { status: 400 });
    }
    if (body.severity_state !== undefined && body.severity_state !== null && !SEVERITY_VALUES.has(body.severity_state)) {
      return NextResponse.json({ ok: false, error: 'invalid_severity_state' }, { status: 400 });
    }

    // Resolve doctor id for audit
    const docRes = await pool.query<{ id: string }>(
      `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
      [session.email ?? ''],
    );
    const doctorId = docRes.rows[0]?.id ?? null;

    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => {
      vals.push(val);
      sets.push(`${col} = $${vals.length}`);
    };
    if ('control_state' in body) push('control_state', body.control_state ?? null);
    if ('severity_state' in body) push('severity_state', body.severity_state ?? null);
    if (sets.length === 0) {
      return NextResponse.json({ ok: true, noop: true });
    }
    push('state_updated_at', new Date().toISOString());
    push('state_updated_by_doctor_id', doctorId);
    push('updated_at', new Date().toISOString());

    vals.push(comorbidityId, patientId);
    const sql = `UPDATE patient_comorbidities SET ${sets.join(', ')}
                 WHERE id = $${vals.length - 1} AND patient_id = $${vals.length}
                 RETURNING id, control_state, severity_state, state_updated_at::text AS state_updated_at`;

    const result = await pool.query(sql, vals);
    if (result.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, comorbidity: result.rows[0] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
