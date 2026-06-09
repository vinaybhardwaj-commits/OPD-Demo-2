/**
 * GET /api/admin/diagnostic-catalog
 *
 * Lists rows from diagnostic_catalog with optional search + modality
 * filter + pagination. Used by /admin/catalog and the future client-side
 * search in the doctor's strip + modal (which call this same shape).
 *
 * Query params:
 *   q         — free-text search (uses search_tsv GIN + display_name trgm)
 *   modality  — lab | imaging | cardiology | procedure (single filter)
 *   active    — 'true' | 'false' | undefined (default: true only)
 *   page      — 1-based (default 1)
 *   limit     — default 50, max 200
 *
 * Returns { rows, total, page, limit, took_ms }.
 *
 * Auth: admin session OR x-migration-secret (so the seed-side scripts
 * can also probe). Doctor/nurse roles also allowed because the doctor
 * strip + CCE pre-stage will both hit this endpoint in v3.2.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Auth — accept any signed-in user (catalog read is broadly useful)
  // OR migration-secret for server-side scripts.
  const headerSecret = req.headers.get('x-migration-secret');
  const expectedSecret = process.env.MIGRATION_SECRET;
  let authed = !!expectedSecret && headerSecret === expectedSecret;
  if (!authed) {
    const session = await getCurrentUser();
    if (session) authed = true;
  }
  if (!authed) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const modality = url.searchParams.get('modality');
  const activeParam = url.searchParams.get('active');
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  // active filter: default true; pass 'false' or 'all' to include inactive
  let activeFilterSql = `is_active = true`;
  if (activeParam === 'false') activeFilterSql = `is_active = false`;
  if (activeParam === 'all') activeFilterSql = `TRUE`;

  // Build the WHERE clauses
  const conditions: string[] = [activeFilterSql];
  const params: unknown[] = [];

  if (q.length > 0) {
    params.push(q);
    const qIdx = params.length;
    conditions.push(
      `(search_tsv @@ websearch_to_tsquery('english', $${qIdx}) ` +
      ` OR display_name ILIKE '%' || $${qIdx} || '%' ` +
      ` OR EXISTS (SELECT 1 FROM unnest(synonyms) s WHERE s ILIKE '%' || $${qIdx} || '%'))`,
    );
  }

  if (modality) {
    params.push(modality);
    conditions.push(`modality = $${params.length}`);
  }

  const whereSql = `WHERE ${conditions.join(' AND ')}`;
  const t0 = Date.now();

  // Order: if q is present, ts_rank first; otherwise alphabetic
  const orderSql = q.length > 0
    ? `ORDER BY ts_rank(search_tsv, websearch_to_tsquery('english', $1)) DESC NULLS LAST, display_name ASC`
    : `ORDER BY display_name ASC`;

  params.push(limit, offset);
  const limOff = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const listSql = `
    SELECT service_code, display_name, department, sub_department, service_type,
           modality, patient_types, is_active, is_outsourced, schedulable,
           multiple_sittings, description, patient_instructions, synonyms,
           standard_codes, tags, created_at::text AS created_at, updated_at::text AS updated_at
    FROM diagnostic_catalog
    ${whereSql}
    ${orderSql}
    ${limOff}
  `;

  // Count uses the same params except LIMIT/OFFSET
  const countParams = params.slice(0, params.length - 2);
  const countSql = `SELECT COUNT(*)::int AS n FROM diagnostic_catalog ${whereSql}`;

  const [listRes, countRes] = await Promise.all([
    pool.query(listSql, params),
    pool.query<{ n: number }>(countSql, countParams),
  ]);

  return NextResponse.json({
    ok: true,
    rows: listRes.rows,
    total: countRes.rows[0]?.n ?? 0,
    page,
    limit,
    took_ms: Date.now() - t0,
  });
}
