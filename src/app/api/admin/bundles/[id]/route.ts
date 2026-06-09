/**
 * /api/admin/bundles/[id]
 *
 * GET    — single bundle + items (with display_name + modality joined)
 * PATCH  — atomic edit: optional name/description/specialty/is_active
 *          + optional items[] replacement (DELETE all + re-INSERT)
 * DELETE — soft delete (is_active=false). True DELETE only if no items.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  const [bRes, iRes] = await Promise.all([
    pool.query(
      `SELECT id, name, description, specialty_tag, is_active,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM diagnostic_bundles WHERE id = $1 LIMIT 1`,
      [id],
    ),
    pool.query(
      `SELECT i.service_code, i.order_n, i.is_optional,
              dc.display_name, dc.sub_department, dc.modality
       FROM diagnostic_bundle_items i
       JOIN diagnostic_catalog dc ON dc.service_code = i.service_code
       WHERE i.bundle_id = $1
       ORDER BY i.order_n ASC, dc.display_name ASC`,
      [id],
    ),
  ]);

  if (bRes.rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, bundle: bRes.rows[0], items: iRes.rows });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json()) as {
    name?: string;
    description?: string | null;
    specialty_tag?: string | null;
    is_active?: boolean;
    items?: { service_code: string; order_n?: number; is_optional?: boolean }[];
  };

  // Validate item service_codes if provided
  if (body.items && body.items.length > 0) {
    const codes = body.items.map((i) => i.service_code);
    const catRes = await pool.query<{ service_code: string }>(
      `SELECT service_code FROM diagnostic_catalog WHERE service_code = ANY($1::text[])`,
      [codes],
    );
    const known = new Set(catRes.rows.map((r) => r.service_code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length > 0) {
      return NextResponse.json({ ok: false, error: 'unknown_service_codes', missing }, { status: 400 });
    }
  }

  // Metadata UPDATE
  const sets: string[] = [];
  const params: unknown[] = [];
  const addSet = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (body.name !== undefined) addSet('name', body.name);
  if (body.description !== undefined) addSet('description', body.description);
  if (body.specialty_tag !== undefined) addSet('specialty_tag', body.specialty_tag);
  if (body.is_active !== undefined) addSet('is_active', body.is_active);

  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    params.push(id);
    try {
      const { rowCount } = await pool.query(
        `UPDATE diagnostic_bundles SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      if (rowCount === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('diagnostic_bundles_name_key')) {
        return NextResponse.json({ ok: false, error: 'name_taken' }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: 'db_error', detail: msg.slice(0, 300) }, { status: 500 });
    }
  }

  // Items replacement — wipe + re-insert (FK cascade handles delete)
  if (body.items !== undefined) {
    await pool.query(`DELETE FROM diagnostic_bundle_items WHERE bundle_id = $1`, [id]);
    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i];
      await pool.query(
        `INSERT INTO diagnostic_bundle_items (bundle_id, service_code, order_n, is_optional)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (bundle_id, service_code) DO NOTHING`,
        [id, it.service_code, it.order_n ?? i, it.is_optional ?? false],
      );
    }
  }

  return NextResponse.json({ ok: true, id });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  // Soft delete: is_active=false. Hard delete only via direct SQL.
  const { rowCount } = await pool.query(
    `UPDATE diagnostic_bundles SET is_active = false, updated_at = NOW() WHERE id = $1`,
    [id],
  );
  if (rowCount === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true, id, soft_deleted: true });
}
