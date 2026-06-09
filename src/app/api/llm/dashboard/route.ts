/**
 * GET /api/llm/dashboard?surface=&status=&doctor=&since=&until=&limit=
 *
 * v6.1 — admin trace dashboard backing data. Returns:
 *   - rows: list of traces matching the filters
 *   - aggregates: by-surface counts + p50/p90 latency over the filtered window
 *
 * All filters optional. Defaults: last 24h, all surfaces, all statuses,
 * all doctors. Limit defaults to 200, capped at 1000.
 *
 * Auth: admin only.
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RowOut = {
  id: string;
  surface: string;
  status: string;
  total_ms: number | null;
  started_at: string;
  doctor_email: string | null;
  encounter_id: string | null;
  patient_id: string | null;
};

type AggregateOut = {
  surface: string;
  count: number;
  errored_count: number;
  p50_ms: number | null;
  p90_ms: number | null;
};

export async function GET(req: Request) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'forbidden_role' }, { status: 403 });
  }

  const url = new URL(req.url);
  const surface = url.searchParams.get('surface');
  const status = url.searchParams.get('status');
  const doctor = url.searchParams.get('doctor');
  const since = url.searchParams.get('since'); // ISO date
  const until = url.searchParams.get('until');
  const limitRaw = Number(url.searchParams.get('limit') ?? '200');
  const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 200));

  const sinceISO = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const untilISO = until ?? new Date().toISOString();

  // 1. List query
  const whereParts: string[] = ['started_at BETWEEN $1 AND $2'];
  const params: unknown[] = [sinceISO, untilISO];
  let p = 3;
  if (surface) { whereParts.push(`surface = $${p}`); params.push(surface); p++; }
  if (status) { whereParts.push(`status = $${p}`); params.push(status); p++; }
  if (doctor) { whereParts.push(`doctor_email = $${p}`); params.push(doctor); p++; }

  const where = whereParts.join(' AND ');

  const listSql = `
    SELECT id::text, surface, status, total_ms,
           started_at::text AS started_at,
           doctor_email,
           encounter_id::text AS encounter_id,
           patient_id::text AS patient_id
      FROM llm_traces
     WHERE ${where}
     ORDER BY started_at DESC
     LIMIT $${p}`;
  params.push(limit);

  const { rows } = await pool.query<RowOut>(listSql, params);

  // 2. Aggregates (separate query so the LIMIT doesn't affect them)
  const aggSql = `
    SELECT surface,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE status = 'errored')::int AS errored_count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms) AS p50_ms,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY total_ms) AS p90_ms
      FROM llm_traces
     WHERE ${where}
     GROUP BY surface
     ORDER BY count DESC`;
  const aggParams = params.slice(0, -1); // drop the LIMIT
  const { rows: aggRows } = await pool.query<{
    surface: string;
    count: number;
    errored_count: number;
    p50_ms: string | null;
    p90_ms: string | null;
  }>(aggSql, aggParams);

  const aggregates: AggregateOut[] = aggRows.map((r) => ({
    surface: r.surface,
    count: r.count,
    errored_count: r.errored_count,
    p50_ms: r.p50_ms == null ? null : Math.round(Number(r.p50_ms)),
    p90_ms: r.p90_ms == null ? null : Math.round(Number(r.p90_ms)),
  }));

  return NextResponse.json({
    ok: true,
    filters: { surface, status, doctor, since: sinceISO, until: untilISO, limit },
    rows,
    aggregates,
    total: rows.length,
  });
}
