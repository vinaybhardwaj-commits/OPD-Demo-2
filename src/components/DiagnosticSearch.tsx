'use client';

/**
 * <DiagnosticSearch /> — the shared search primitive.
 *
 * Renders a debounced search input + result list against
 * GET /api/admin/diagnostic-catalog. Stateless w.r.t. cart — calls
 * `onAdd(row)` when the doctor taps `+` on a result. Cart is managed
 * by the parent (the QuickAddStrip in v3.2a, the OrderModal in v3.2b).
 *
 * v3.5b (this version) — when encounterId is provided, exposes a
 * "Suggest with Qwen" button beside the input. Click (or press Enter)
 * → POST /api/diagnostics/interpret with free_text + encounter context
 * → renders curated suggestions below the deterministic instant matches.
 */
import { useEffect, useState } from 'react';

export type CatalogRow = {
  service_code: string;
  display_name: string;
  modality: 'lab' | 'imaging' | 'cardiology' | 'procedure';
  sub_department: string;
  patient_instructions: string | null;
  synonyms: string[];
};

type QwenSuggestion = {
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: CatalogRow['modality'];
  rationale: string;
  confidence: number;
};

const MODALITY_BADGE: Record<CatalogRow['modality'], string> = {
  lab: 'bg-blue-50 text-blue-700 border-blue-200',
  imaging: 'bg-violet-50 text-violet-700 border-violet-200',
  cardiology: 'bg-rose-50 text-rose-700 border-rose-200',
  procedure: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function DiagnosticSearch({
  onAdd,
  cartCodes,
  modality,
  placeholder,
  autoFocus,
  encounterId,
}: {
  onAdd: (row: CatalogRow) => void;
  cartCodes: Set<string>;
  modality?: CatalogRow['modality'];
  placeholder?: string;
  autoFocus?: boolean;
  encounterId?: string;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [took, setTook] = useState<number | null>(null);

  // Qwen NLP state — only used when encounterId is provided
  const [qwenLoading, setQwenLoading] = useState(false);
  const [qwenSuggestions, setQwenSuggestions] = useState<QwenSuggestion[] | null>(null);
  const [qwenLatency, setQwenLatency] = useState<number | null>(null);
  const [qwenErr, setQwenErr] = useState<string | null>(null);

  // Deterministic instant search on every keystroke
  useEffect(() => {
    if (q.trim().length === 0) { setRows([]); setTook(null); return; }
    const id = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('q', q.trim());
      if (modality) params.set('modality', modality);
      params.set('limit', '10');
      try {
        const res = await fetch(`/api/admin/diagnostic-catalog?${params}`);
        const json = await res.json();
        if (json.ok) {
          setRows(json.rows);
          setTook(json.took_ms);
        }
      } finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(id);
  }, [q, modality]);

  const submitQwen = async () => {
    if (!encounterId || q.trim().length < 2 || qwenLoading) return;
    setQwenLoading(true); setQwenErr(null); setQwenSuggestions(null);
    try {
      const res = await fetch('/api/diagnostics/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ encounter_id: encounterId, free_text: q.trim(), modality }),
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.suggestions)) {
        setQwenSuggestions(json.suggestions);
        setQwenLatency(json.latency_ms ?? null);
        if (json.suggestions.length === 0 && json.error) {
          setQwenErr(`AI unavailable — type more or use the instant matches above.`);
        }
      } else {
        setQwenErr('AI unavailable — type more or use the instant matches above.');
      }
    } catch (e) {
      setQwenErr(e instanceof Error ? e.message : String(e));
    } finally {
      setQwenLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && encounterId) {
      e.preventDefault();
      submitQwen();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder ?? 'Type tests in any words — e.g. "diabetic FU panel + thyroid + b12"'}
          autoFocus={autoFocus}
          className="flex-1 rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
        />
        {encounterId && (
          <button
            type="button"
            onClick={submitQwen}
            disabled={qwenLoading || q.trim().length < 2}
            title="Interpret clinical shorthand"
            className="shrink-0 rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {qwenLoading ? '⟳ Thinking…' : '✨ Suggest ↩'}
          </button>
        )}
      </div>

      {q.trim().length > 0 && (
        <div className="text-[11px] text-even-ink-400">
          {loading ? 'Searching…' : `${rows.length} instant match${rows.length === 1 ? '' : 'es'}${took !== null ? ` · ${took}ms` : ''}`}
        </div>
      )}

      {rows.length > 0 && (
        <div className="divide-y divide-even-ink-50 overflow-hidden rounded-md border border-even-ink-100 bg-white">
          {rows.map((r) => {
            const inCart = cartCodes.has(r.service_code);
            return (
              <div
                key={r.service_code}
                className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-even-blue-50/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-even-navy">{r.display_name}</span>
                    <span className={`shrink-0 rounded-full border px-1.5 py-0 text-[10px] ${MODALITY_BADGE[r.modality]}`}>
                      {r.modality}
                    </span>
                  </div>
                  <div className="text-[11px] text-even-ink-500">{r.sub_department}</div>
                  {r.patient_instructions && (
                    <div className="text-[11px] italic text-even-ink-500">{r.patient_instructions}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => !inCart && onAdd(r)}
                  disabled={inCart}
                  className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                    inCart
                      ? 'cursor-default bg-even-ink-100 text-even-ink-400'
                      : 'bg-even-blue text-white hover:bg-even-blue-700'
                  }`}
                >
                  {inCart ? '✓ Added' : '+ Add'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Qwen NLP suggestions block — only when encounterId set */}
      {encounterId && qwenLoading && (
        <div className="rounded-md border border-violet-200 bg-violet-50/40 px-3 py-2 text-[11px] italic text-violet-700">
          Interpreting &quot;{q}&quot;…
        </div>
      )}

      {encounterId && qwenSuggestions && qwenSuggestions.length > 0 && (
        <div className="rounded-md border border-violet-200 bg-violet-50/30 p-2">
          <div className="mb-1.5 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-wider text-violet-700">✨ AI suggestions</span>
              <span className="text-[10px] text-even-ink-400">
                {qwenSuggestions.length} match{qwenSuggestions.length === 1 ? '' : 'es'}
                {qwenLatency !== null && ` · ${(qwenLatency / 1000).toFixed(1)}s`}
              </span>
            </div>
            {(() => {
              const eligible = qwenSuggestions.filter((s) => s.confidence >= 0.75 && !cartCodes.has(s.service_code));
              if (eligible.length === 0) return null;
              return (
                <button
                  type="button"
                  onClick={() => eligible.forEach((s) => onAdd({
                    service_code: s.service_code,
                    display_name: s.display_name,
                    modality: s.modality,
                    sub_department: s.sub_department,
                    patient_instructions: null,
                    synonyms: [],
                  }))}
                  className="rounded-md bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-violet-700"
                >
                  Accept all ≥ 0.75 ({eligible.length})
                </button>
              );
            })()}
          </div>

          <div className="divide-y divide-violet-100 overflow-hidden rounded-md bg-white">
            {qwenSuggestions.map((s) => {
              const inCart = cartCodes.has(s.service_code);
              return (
                <div key={s.service_code} className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-violet-50/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-even-navy">{s.display_name}</span>
                      <span className={`shrink-0 rounded-full border px-1.5 py-0 text-[10px] ${MODALITY_BADGE[s.modality]}`}>
                        {s.modality}
                      </span>
                      <span className="shrink-0 text-[10px] text-violet-700">{(s.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div className="text-[11px] text-even-ink-500">{s.sub_department}</div>
                    {s.rationale && (
                      <div className="text-[11px] italic text-violet-600">{s.rationale}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => !inCart && onAdd({
                      service_code: s.service_code,
                      display_name: s.display_name,
                      modality: s.modality,
                      sub_department: s.sub_department,
                      patient_instructions: null,
                      synonyms: [],
                    })}
                    disabled={inCart}
                    className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                      inCart
                        ? 'cursor-default bg-even-ink-100 text-even-ink-400'
                        : 'bg-violet-600 text-white hover:bg-violet-700'
                    }`}
                  >
                    {inCart ? '✓' : '+ Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {encounterId && qwenErr && (
        <div className="text-[11px] italic text-even-ink-400">{qwenErr}</div>
      )}
    </div>
  );
}
