/**
 * GET /api/drugs/search?q=<query>&limit=<n>
 *
 * Drug typeahead backend. Returns up to `limit` (default 10, max 50)
 * matches ranked by a blend of:
 *   1. case-insensitive PREFIX match on brand_name        score 1.00
 *   2. case-insensitive PREFIX match on generic_name      score 0.95
 *   3. trigram similarity on brand_name                   score 0.30–0.99
 *   4. trigram similarity on generic_name                 score 0.30–0.99
 *
 * Powered by the GIN trigram indexes on brand_name and generic_name (set
 * up in migration v1). The `%` operator only fires above
 * pg_trgm.similarity_threshold (default 0.3), so very-short queries
 * (< 3 chars) rely on the LIKE prefix branches.
 *
 * Returns the full row shape needed by the typeahead component:
 * item_code, brand_name, generic_name, dosage_form, strength,
 * major_grouping, schedule_dc, is_high_risk, lasa_alternates, score.
 *
 * Empty/too-short query returns 200 with results=[] (UI shows nothing).
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MIN_Q_LENGTH = 2;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
    : DEFAULT_LIMIT;

  if (q.length < MIN_Q_LENGTH) {
    return NextResponse.json({ ok: true, results: [], q, count: 0 });
  }

  const t0 = Date.now();
  const qLower = q.toLowerCase();
  const qPrefix = qLower + '%';

  // The ILIKE branches and the `%` similarity branches OR together so the
  // index can serve any of them. We pre-compute scores so ORDER BY
  // doesn't recompute per-row.
  const sql = `
    WITH candidates AS (
      SELECT
        item_code,
        brand_name,
        generic_name,
        dosage_form,
        strength,
        major_grouping,
        schedule_dc::text AS schedule_dc,
        is_high_risk,
        lasa_alternates,
        CASE
          WHEN lower(brand_name) LIKE $2 THEN 1.0
          WHEN lower(generic_name) LIKE $2 THEN 0.95
          ELSE GREATEST(
            similarity(brand_name, $1),
            similarity(generic_name, $1)
          )
        END AS score
      FROM drug_master
      WHERE
        lower(brand_name) LIKE $2
        OR lower(generic_name) LIKE $2
        OR brand_name % $1
        OR generic_name % $1
    )
    SELECT *
    FROM candidates
    ORDER BY score DESC, brand_name ASC
    LIMIT $3
  `;

  try {
    const { rows } = await pool.query(sql, [q, qPrefix, limit]);
    return NextResponse.json({
      ok: true,
      q,
      count: rows.length,
      latency_ms: Date.now() - t0,
      results: rows.map((r) => ({
        item_code: r.item_code,
        brand_name: r.brand_name,
        generic_name: r.generic_name,
        dosage_form: r.dosage_form,
        strength: r.strength,
        major_grouping: r.major_grouping,
        schedule_dc: r.schedule_dc,
        is_high_risk: r.is_high_risk,
        lasa_alternates: r.lasa_alternates ?? [],
        score: typeof r.score === 'string' ? parseFloat(r.score) : r.score,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'search_failed', detail: msg.slice(0, 200) },
      { status: 500 },
    );
  }
}
