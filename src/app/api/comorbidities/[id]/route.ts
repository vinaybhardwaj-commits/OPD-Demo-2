/**
 * PATCH /api/comorbidities/[id]
 *   Body: { is_resolved: boolean, onset_date?: string | null }
 *   Toggles resolved state and/or updates onset_date.
 *
 * DELETE /api/comorbidities/[id]
 *   Hard delete. Use sparingly — usually mark resolved instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const body = (await req.json()) as { is_resolved?: boolean; onset_date?: string | null };
    const sets: string[] = [];
    const params: unknown[] = [];
    const addSet = (col: string, val: unknown, cast?: string) => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast ? '::' + cast : ''}`);
    };
    if (body.is_resolved !== undefined) {
      addSet('is_resolved', body.is_resolved);
      addSet('resolved_at', body.is_resolved ? new Date().toISOString() : null);
    }
    if (body.onset_date !== undefined) addSet('onset_date', body.onset_date, 'date');
    if (sets.length === 0) return NextResponse.json({ ok: false, error: 'no_fields' }, { status: 400 });
    sets.push('updated_at = NOW()');
    params.push(id);
    const { rowCount } = await pool.query(
      `UPDATE patient_comorbidities SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );
    if (rowCount === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const { id } = await ctx.params;
    const { rowCount } = await pool.query(
      `DELETE FROM patient_comorbidities WHERE id = $1`,
      [id],
    );
    if (rowCount === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
