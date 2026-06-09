/**
 * GET /api/comorbidities/search?q=&limit=&scope=core|all
 *
 * In-memory ranked search over the 110-entry EHS Catalog v1.0.
 * scope=core (default) returns Core 30 only; scope=all returns all 110.
 * Doctor can search the full catalog regardless of Extended visibility
 * per the doc's UX note ("Trigger rules govern default capture UI, not access").
 */
import { NextResponse } from 'next/server';
import { searchComorbidities } from '@/lib/comorbidities-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limit = Math.max(1, Math.min(30, parseInt(url.searchParams.get('limit') ?? '12', 10) || 12));
  const scope = url.searchParams.get('scope') === 'core' ? 'core' : 'all';
  if (q.length < 1) return NextResponse.json({ ok: true, q, scope, results: [] });
  const t0 = Date.now();
  const results = searchComorbidities(q, limit, scope);
  return NextResponse.json({ ok: true, q, scope, count: results.length, latency_ms: Date.now() - t0, results });
}
