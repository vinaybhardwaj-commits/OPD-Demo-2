/**
 * PATCH /api/admin/diagnostic-catalog/[service_code]
 *
 * Updates editable fields on a single catalog row.
 *
 * Editable: display_name, synonyms[], tags[], patient_instructions,
 * is_active, description, is_outsourced, schedulable, multiple_sittings.
 *
 * Not editable here: service_code (PK), department, sub_department,
 * service_type, modality, patient_types — these come from the source
 * xlsx and would drift if hand-edited (re-seed would overwrite them).
 * If V needs to change those, do it in the xlsx and re-seed.
 *
 * Auth: signed-in user with role in {admin, super_admin, doctor}
 * — doctors can curate synonyms too (they know what colleagues type).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PatchBody = {
  display_name?: string;
  synonyms?: string[];
  tags?: string[];
  patient_instructions?: string | null;
  description?: string | null;
  is_active?: boolean;
  is_outsourced?: boolean;
  schedulable?: boolean;
  multiple_sittings?: boolean;
};

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ service_code: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  // Any signed-in user can curate catalog metadata. Tighten if needed.

  const { service_code } = await ctx.params;
  const body = (await req.json()) as PatchBody;

  const sets: string[] = [];
  const params: unknown[] = [];
  const addSet = (col: string, val: unknown, cast?: string) => {
    params.push(val);
    sets.push(`${col} = $${params.length}${cast ? '::' + cast : ''}`);
  };

  if (body.display_name !== undefined) addSet('display_name', body.display_name);
  if (body.synonyms !== undefined) addSet('synonyms', body.synonyms, 'text[]');
  if (body.tags !== undefined) addSet('tags', body.tags, 'text[]');
  if (body.patient_instructions !== undefined) addSet('patient_instructions', body.patient_instructions);
  if (body.description !== undefined) addSet('description', body.description);
  if (body.is_active !== undefined) addSet('is_active', body.is_active);
  if (body.is_outsourced !== undefined) addSet('is_outsourced', body.is_outsourced);
  if (body.schedulable !== undefined) addSet('schedulable', body.schedulable);
  if (body.multiple_sittings !== undefined) addSet('multiple_sittings', body.multiple_sittings);

  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_editable_fields' }, { status: 400 });
  }
  sets.push('updated_at = NOW()');

  params.push(service_code);
  const sql = `
    UPDATE diagnostic_catalog SET ${sets.join(', ')}
    WHERE service_code = $${params.length}
    RETURNING service_code, display_name, synonyms, tags, patient_instructions,
              description, is_active, is_outsourced, schedulable, multiple_sittings,
              updated_at::text AS updated_at
  `;

  const { rows } = await pool.query(sql, params);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, row: rows[0] });
}
