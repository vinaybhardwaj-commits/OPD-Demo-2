'use client';

/**
 * <ComorbiditySearch /> — shared search primitive for the comorbidity
 * edit modal (and reusable in v3.9.3 demographics-suggest).
 *
 * Hybrid pattern (same as DiagnosticSearch v3.5b + Icd10Typeahead v3.8):
 *   - Debounced 200ms deterministic search against
 *     GET /api/comorbidities/search (Core 30 default, All 110 via toggle)
 *   - Optional Qwen-NLP submit button → POST /api/comorbidities/interpret
 *     for clinician shorthand like "T2DM + HTN + CKD st3"
 *   - Both result blocks render with `+ Add` buttons; parent handles
 *     adding to cart-style staging.
 */
import { useEffect, useState } from 'react';

export type CatalogEntry = {
  catalog_id: string;
  condition_name: string;
  icd10_anchor: string;
  captured_as: string;
  panel_risk_weight: number;
  triggers_extended_capture: boolean;
  tier: 'core' | 'extended';
  notes: string | null;
};

type QwenSuggestion = {
  code: string;
  label: string;
  rationale: string;
  confidence: number;
};

export function ComorbiditySearch({
  onAddCatalog,
  onAddFree,
  excludeCatalogIds,
  excludeCodes,
  patientId,
  defaultScope = 'core',
  autoExpandToAll = false,
}: {
  onAddCatalog: (entry: CatalogEntry) => void;
  onAddFree: (item: { code: string; label: string }) => void;
  excludeCatalogIds: Set<string>;
  excludeCodes: Set<string>;
  patientId?: string;
  defaultScope?: 'core' | 'all';
  autoExpandToAll?: boolean;
}) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'core' | 'all'>(autoExpandToAll ? 'all' : defaultScope);
  const [results, setResults] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [took, setTook] = useState<number | null>(null);

  const [qwenLoading, setQwenLoading] = useState(false);
  const [qwenSuggestions, setQwenSuggestions] = useState<QwenSuggestion[] | null>(null);
  const [qwenLatency, setQwenLatency] = useState<number | null>(null);
  const [qwenErr, setQwenErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length === 0) { setResults([]); setTook(null); return; }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/comorbidities/search?q=${encodeURIComponent(q.trim())}&scope=${scope}&limit=15`);
        const json = await res.json();
        if (json.ok) {
          setResults(json.results);
          setTook(json.latency_ms);
        }
      } finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(id);
  }, [q, scope]);

  const submitQwen = async () => {
    if (q.trim().length < 2 || qwenLoading) return;
    setQwenLoading(true); setQwenSuggestions(null); setQwenErr(null);
    try {
      const res = await fetch('/api/comorbidities/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ free_text: q.trim(), patient_id: patientId }),
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.suggestions)) {
        setQwenSuggestions(json.suggestions);
        setQwenLatency(json.latency_ms ?? null);
      } else {
        setQwenErr(json.error ?? 'AI unavailable');
      }
    } catch (e) {
      setQwenErr(e instanceof Error ? e.message : String(e));
    } finally { setQwenLoading(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitQwen(); } }}
          placeholder='Search: HTN, T2DM, CKD, glyco, long-standing diabetic…'
          autoFocus
          className="flex-1 rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
        />
        <button
          type="button"
          onClick={submitQwen}
          disabled={qwenLoading || q.trim().length < 2}
          title="Interpret clinician shorthand"
          className="shrink-0 rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {qwenLoading ? '⟳ Thinking…' : '✨ Suggest ↩'}
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] text-even-ink-500">
        <div className="flex items-center gap-2">
          <span>Scope:</span>
          <button
            type="button"
            onClick={() => setScope('core')}
            className={`rounded-full px-2 py-0.5 ${scope === 'core' ? 'bg-even-blue text-white' : 'bg-even-ink-100 text-even-ink-700'}`}
          >Core 30</button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`rounded-full px-2 py-0.5 ${scope === 'all' ? 'bg-even-blue text-white' : 'bg-even-ink-100 text-even-ink-700'}`}
          >All 110</button>
        </div>
        {q.trim().length > 0 && (
          <span>{loading ? 'Searching…' : `${results.length} matches${took !== null ? ` · ${took}ms` : ''}`}</span>
        )}
      </div>

      {results.length > 0 && (
        <div className="divide-y divide-even-ink-50 overflow-hidden rounded-md border border-even-ink-100 bg-white">
          {results.map((r) => {
            const added = excludeCatalogIds.has(r.catalog_id) || excludeCodes.has(r.icd10_anchor);
            return (
              <div key={r.catalog_id} className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-even-blue-50/30">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[10px] text-even-ink-500">{r.catalog_id}</span>
                    <span className="shrink-0 font-mono text-xs font-semibold text-even-navy">{r.icd10_anchor}</span>
                    <span className="truncate text-sm text-even-ink-800">{r.condition_name}</span>
                  </div>
                  <div className="text-[10px] text-even-ink-400">
                    {r.tier === 'core' ? '● Core' : '○ Extended'} · weight {r.panel_risk_weight}
                    {r.triggers_extended_capture && ' · gateways extended'}
                    {r.captured_as !== 'binary' && ` · ${r.captured_as}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !added && onAddCatalog(r)}
                  disabled={added}
                  className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                    added ? 'cursor-default bg-even-ink-100 text-even-ink-400' : 'bg-even-blue text-white hover:bg-even-blue-700'
                  }`}
                >
                  {added ? '✓ On list' : '+ Add'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {qwenLoading && (
        <div className="rounded-md border border-violet-200 bg-violet-50/40 px-3 py-2 text-[11px] italic text-violet-700">
          Interpreting &quot;{q}&quot;…
        </div>
      )}

      {qwenSuggestions && qwenSuggestions.length > 0 && (
        <div className="rounded-md border border-violet-200 bg-violet-50/30 p-2">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-violet-700">✨ AI suggestions</span>
            <span className="text-[10px] text-even-ink-400">
              {qwenSuggestions.length} codes{qwenLatency !== null && ` · ${(qwenLatency / 1000).toFixed(1)}s`}
            </span>
          </div>
          <div className="divide-y divide-violet-100 overflow-hidden rounded-md bg-white">
            {qwenSuggestions.map((s) => {
              const added = excludeCodes.has(s.code);
              return (
                <div key={s.code} className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-violet-50/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 font-mono text-xs font-semibold text-even-navy">{s.code}</span>
                      <span className="truncate text-xs text-even-ink-700">{s.label}</span>
                      <span className="shrink-0 text-[10px] text-violet-700">{(s.confidence * 100).toFixed(0)}%</span>
                    </div>
                    {s.rationale && <div className="text-[10px] italic text-violet-600">{s.rationale}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => !added && onAddFree({ code: s.code, label: s.label })}
                    disabled={added}
                    className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                      added ? 'cursor-default bg-even-ink-100 text-even-ink-400' : 'bg-violet-600 text-white hover:bg-violet-700'
                    }`}
                  >{added ? '✓' : '+ Add'}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {qwenErr && <div className="text-[11px] italic text-rose-600">{qwenErr}</div>}
    </div>
  );
}
