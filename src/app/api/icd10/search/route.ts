/**
 * GET /api/icd10/search?q=<query>&limit=<n>
 *
 * In-memory ranked search over the ~150-entry curated GP/OPD ICD-10
 * list in src/lib/icd10.ts. No DB hit needed.
 *
 * Min q length 1 (vs 2 for drug search) — most ICD-10 codes lead with
 * a single letter (J*, I*, E*, etc.) and a doctor reaching for the
 * typeahead wants to narrow by category right away.
 */
import { NextResponse } from 'next/server';
import { searchIcd10 } from '@/lib/icd10';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
    : DEFAULT_LIMIT;

  if (q.length < 1) {
    return NextResponse.json({ ok: true, q, count: 0, results: [] });
  }

  const t0 = Date.now();
  const results = searchIcd10(q, limit);
  return NextResponse.json({
    ok: true,
    q,
    count: results.length,
    latency_ms: Date.now() - t0,
    results,
  });
}
