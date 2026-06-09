'use client';

/**
 * /app/llm/dashboard/page.tsx
 *
 * v6.1 — admin trace dashboard. At-a-glance view of every LLM fire
 * across the system over a filterable window. Surface aggregates show
 * count + errored count + p50 + p90 latency per surface (the same
 * numbers Phase 5 will use to replace the hard-coded medians once
 * we have ~7 days of data).
 *
 * Filters: surface (dropdown), status, doctor email, since/until,
 * limit.
 *
 * Auth gating happens at the API; this page is client-only and just
 * surfaces a 403 if the doctor isn't admin.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDuration } from '@/lib/llm-trace/format-duration';

type Row = {
  id: string;
  surface: string;
  status: string;
  total_ms: number | null;
  started_at: string;
  doctor_email: string | null;
  encounter_id: string | null;
  patient_id: string | null;
};

type Aggregate = {
  surface: string;
  count: number;
  errored_count: number;
  p50_ms: number | null;
  p90_ms: number | null;
};

type DashboardResponse = {
  ok: boolean;
  filters?: {
    surface: string | null;
    status: string | null;
    doctor: string | null;
    since: string;
    until: string;
    limit: number;
  };
  rows?: Row[];
  aggregates?: Aggregate[];
  error?: string;
};

const SURFACES = [
  'ddx',
  'transcribe-compare',
  'suggest-orders',
  'icd10-suggest',
  'rx-coherence',
  'ddi-scan',
  'comorbidity-context',
  'comorbidity-states',
  'comorbidity-history',
  'voice-query',
  'patient-summary',
  'predict-plans',
  'diagnostics-interpret',
  'comorbidities-interpret',
  'icd10-interpret',
];

const STATUSES = ['in_progress', 'completed', 'errored', 'aborted'];

function isoToInputLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LlmDashboardPage() {
  const [surface, setSurface] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [doctor, setDoctor] = useState<string>('');
  const defaultSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const defaultUntil = new Date().toISOString();
  const [since, setSince] = useState<string>(isoToInputLocal(defaultSince));
  const [until, setUntil] = useState<string>(isoToInputLocal(defaultUntil));
  const [limit, setLimit] = useState<number>(200);

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (surface) params.set('surface', surface);
      if (status) params.set('status', status);
      if (doctor) params.set('doctor', doctor);
      params.set('since', new Date(since).toISOString());
      params.set('until', new Date(until).toISOString());
      params.set('limit', String(limit));
      const r = await fetch(`/api/llm/dashboard?${params.toString()}`, { cache: 'no-store' });
      const body = (await r.json()) as DashboardResponse;
      if (!body.ok) {
        setError(body.error ?? 'fetch_failed');
        return;
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 text-sm">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-even-navy">LLM trace dashboard</h1>
        <Link href="/dashboard" className="text-xs text-even-blue hover:underline">← Dashboard</Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-even-ink-100 bg-white p-4 sm:grid-cols-6 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-even-ink-500">Surface</span>
          <select
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            className="rounded border border-even-ink-200 px-2 py-1"
          >
            <option value="">all</option>
            {SURFACES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-even-ink-500">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border border-even-ink-200 px-2 py-1"
          >
            <option value="">all</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-even-ink-500">Doctor email</span>
          <input
            type="text"
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
            placeholder="any"
            className="rounded border border-even-ink-200 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-even-ink-500">Since</span>
          <input
            type="datetime-local"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="rounded border border-even-ink-200 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-even-ink-500">Until</span>
          <input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="rounded border border-even-ink-200 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-even-ink-500">Limit</span>
          <input
            type="number"
            value={limit}
            min={1}
            max={1000}
            onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 200)))}
            className="rounded border border-even-ink-200 px-2 py-1"
          />
        </label>
        <div className="sm:col-span-6">
          <button
            type="button"
            onClick={() => void fetchData()}
            disabled={loading}
            className="rounded-md bg-even-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-even-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}

      {data && data.aggregates && data.aggregates.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-even-navy">Aggregates ({data.aggregates.length} surfaces)</h2>
          <div className="overflow-x-auto rounded-lg border border-even-ink-100 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-even-ink-50 text-even-ink-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Surface</th>
                  <th className="px-3 py-2 text-right font-medium">Count</th>
                  <th className="px-3 py-2 text-right font-medium">Errored</th>
                  <th className="px-3 py-2 text-right font-medium">Error %</th>
                  <th className="px-3 py-2 text-right font-medium">p50</th>
                  <th className="px-3 py-2 text-right font-medium">p90</th>
                </tr>
              </thead>
              <tbody>
                {data.aggregates.map((a) => {
                  const errRate = a.count > 0 ? (a.errored_count / a.count) * 100 : 0;
                  return (
                    <tr key={a.surface} className="border-t border-even-ink-50">
                      <td className="px-3 py-2 font-medium text-even-navy">{a.surface}</td>
                      <td className="px-3 py-2 text-right">{a.count}</td>
                      <td className="px-3 py-2 text-right">{a.errored_count}</td>
                      <td className={`px-3 py-2 text-right ${errRate > 5 ? 'text-rose-700 font-medium' : 'text-even-ink-600'}`}>
                        {errRate.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right">{formatDuration(a.p50_ms)}</td>
                      <td className="px-3 py-2 text-right">{formatDuration(a.p90_ms)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && data.rows && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-even-navy">Traces ({data.rows.length})</h2>
          <div className="overflow-x-auto rounded-lg border border-even-ink-100 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-even-ink-50 text-even-ink-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Surface</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Duration</th>
                  <th className="px-3 py-2 text-left font-medium">Doctor</th>
                  <th className="px-3 py-2 text-left font-medium">Context</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-even-ink-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a href={`/llm/trace/${r.id}`} target="_blank" rel="noopener noreferrer" className="text-even-blue hover:underline">
                        {new Date(r.started_at).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </a>
                    </td>
                    <td className="px-3 py-2 font-medium text-even-navy">{r.surface}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        r.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                        r.status === 'errored' ? 'bg-rose-50 text-rose-700' :
                        r.status === 'in_progress' ? 'bg-amber-50 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{formatDuration(r.total_ms)}</td>
                    <td className="px-3 py-2 text-even-ink-600">{r.doctor_email ?? '—'}</td>
                    <td className="px-3 py-2 text-even-ink-500 font-mono text-[10px]">
                      {r.encounter_id ? <span title="encounter">enc:{r.encounter_id.slice(0, 6)}…</span> : null}
                      {r.encounter_id && r.patient_id ? ' · ' : ''}
                      {r.patient_id ? <span title="patient">pat:{r.patient_id.slice(0, 6)}…</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
