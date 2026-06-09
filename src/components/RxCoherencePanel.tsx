'use client';

/**
 * <RxCoherencePanel /> — v3.9.4
 *
 * Rx ↔ comorbidity coherence check. Two presentation modes from one
 * component:
 *
 *  - `mode="inline"` — yellow banner rendered below the prescription
 *    list. Always-visible while editing. Per-warning Add/Override row
 *    buttons.
 *  - `mode="modal"` — same content rendered as a blocking modal that
 *    EncounterEditor opens at submit-time IF any unresolved warnings
 *    remain. Always exits via "Confirm submit"; doctor judgment is
 *    never blocked.
 *
 * Both modes share `useRxCoherence` — a single fetch + state machine
 * that lives one level up in EncounterEditor (so submit-time modal sees
 * the latest warnings).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PrescriptionLine } from './DrugRow';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';

export type CoherenceWarning = {
  rx_index: number;
  drug_name: string;
  comorbidity_code: string;
  comorbidity_label: string;
  source: 'static' | 'qwen';
  confidence: number;
};

export type OverrideRecord = {
  drug_name: string;
  comorbidity_code: string;
  comorbidity_label: string;
  decision: 'added' | 'overridden';
  reason?: string;
  source: 'static' | 'qwen';
  confidence: number;
  at: string;
};

export type CoherenceState = {
  warnings: CoherenceWarning[];
  overrides: OverrideRecord[];
  loading: boolean;
  /** Recompute warnings now (used after manual addComorbidity / Override). */
  refresh: () => Promise<void>;
  /** Mark a warning addressed by adding the comorbidity to the patient. */
  addComorbidity: (w: CoherenceWarning) => Promise<void>;
  /** Mark a warning addressed by explicit override + optional reason. */
  overrideWarning: (w: CoherenceWarning, reason: string) => void;
  // v6.0 Phase 3 — trace panel state (qwen-fallback path only)
  traceEvents: TraceEvent[];
  traceTotalMs: number | undefined;
  traceId: string | null;
};

/**
 * useRxCoherence — hook that owns the warnings fetch, addComorbidity,
 * and override state. Hosted in EncounterEditor so the submit-time
 * modal sees the latest state.
 */
export function useRxCoherence({
  encounterId,
  patientId,
  lines,
  initialOverrides,
  readOnly,
  onOverridesChange,
}: {
  encounterId: string;
  patientId: string;
  lines: PrescriptionLine[];
  initialOverrides: OverrideRecord[] | null;
  readOnly?: boolean;
  /** Called whenever overrides change so EncounterEditor can persist via PATCH. */
  onOverridesChange?: (next: OverrideRecord[]) => void;
}): CoherenceState {
  const [warnings, setWarnings] = useState<CoherenceWarning[]>([]);
  const [overrides, setOverrides] = useState<OverrideRecord[]>(initialOverrides ?? []);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  // v6.0 Phase 3 — TracePanel state. Populated only when the server-side
  // static-pass classifier misses and qwen-fallback streams NDJSON.
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [traceTotalMs, setTraceTotalMs] = useState<number | undefined>(undefined);
  const [traceId, setTraceId] = useState<string | null>(null);

  const fetchWarnings = useCallback(async () => {
    if (readOnly) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    // Reset trace state for every fire.
    setTraceEvents([]);
    setTraceTotalMs(undefined);
    setTraceId(null);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/rx-coherence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ lines }),
      });
      const tid = res.headers.get('X-Trace-Id');
      if (tid) setTraceId(tid);
      const ct = res.headers.get('content-type') ?? '';

      if (ct.includes('application/x-ndjson')) {
        // qwen-fallback streaming path.
        type ResultBody = { ok?: boolean; warnings?: CoherenceWarning[] };
        const resultRef: { current: ResultBody | null } = { current: null };
        await consumeNdjson(res, (ev) => {
          if (ev.type === 'progress') {
            setTraceEvents((prev) => {
              const next = prev.map((p, i) => (i === prev.length - 1 && !p.done ? { ...p, done: true } : p));
              return [...next, { stage: ev.stage, msg: ev.msg, ms: ev.ms, done: false, ts: Date.now() }];
            });
          } else if (ev.type === 'result') {
            resultRef.current = ev.data as ResultBody;
          } else if (ev.type === 'done') {
            setTraceTotalMs(ev.ms);
            setTraceEvents((prev) => [...prev, { stage: 'done', msg: '', ms: ev.ms, done: true, ts: Date.now() }]);
          } else if (ev.type === 'error') {
            setTraceEvents((prev) => [...prev, { stage: 'done', msg: ev.message, done: true, error: true, ts: Date.now() }]);
          }
        });
        const body = resultRef.current;
        if (body && body.ok && Array.isArray(body.warnings)) {
          setWarnings(body.warnings);
        }
      } else {
        // Static-pass JSON path (most calls).
        const json = await res.json();
        if (json.ok && Array.isArray(json.warnings)) {
          setWarnings(json.warnings);
        }
      }
    } catch {
      /* soft-fail */
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [encounterId, lines, readOnly]);

  // Debounced fetch on lines change (800ms — matches prescription auto-save)
  useEffect(() => {
    if (readOnly) return;
    if (lines.length === 0) {
      setWarnings([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void fetchWarnings(); }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [lines, readOnly, fetchWarnings]);

  const addComorbidity = useCallback(async (w: CoherenceWarning) => {
    try {
      const res = await fetch(`/api/patients/${patientId}/comorbidities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ code: w.comorbidity_code, label: w.comorbidity_label }] }),
      });
      const json = await res.json();
      if (json.ok) {
        const rec: OverrideRecord = {
          drug_name: w.drug_name,
          comorbidity_code: w.comorbidity_code,
          comorbidity_label: w.comorbidity_label,
          decision: 'added',
          source: w.source,
          confidence: w.confidence,
          at: new Date().toISOString(),
        };
        const next = [...overrides, rec];
        setOverrides(next);
        onOverridesChange?.(next);
        // Re-fetch so the addressed warning disappears
        void fetchWarnings();
      }
    } catch {
      /* soft-fail */
    }
  }, [patientId, overrides, onOverridesChange, fetchWarnings]);

  const overrideWarning = useCallback((w: CoherenceWarning, reason: string) => {
    const rec: OverrideRecord = {
      drug_name: w.drug_name,
      comorbidity_code: w.comorbidity_code,
      comorbidity_label: w.comorbidity_label,
      decision: 'overridden',
      reason: reason.trim() || undefined,
      source: w.source,
      confidence: w.confidence,
      at: new Date().toISOString(),
    };
    const next = [...overrides, rec];
    setOverrides(next);
    onOverridesChange?.(next);
    // Locally drop the warning (server will agree on next fetch)
    setWarnings((cur) =>
      cur.filter((cw) => !(cw.drug_name === w.drug_name && cw.comorbidity_code === w.comorbidity_code)),
    );
  }, [overrides, onOverridesChange]);

  return { warnings, overrides, loading, refresh: fetchWarnings, addComorbidity, overrideWarning, traceEvents, traceTotalMs, traceId };
}

/**
 * <RxCoherencePanel mode="inline" /> — yellow banner below the
 * prescription list. Renders nothing when there are no warnings.
 */
export function RxCoherencePanel({
  state,
  mode,
  open,
  onClose,
  onConfirm,
}: {
  state: CoherenceState;
  mode: 'inline' | 'modal';
  /** Only used when mode === 'modal' */
  open?: boolean;
  /** Only used when mode === 'modal' */
  onClose?: () => void;
  /** Only used when mode === 'modal' — fired by 'Confirm submit'. */
  onConfirm?: () => void;
}) {
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const { warnings, loading, addComorbidity, overrideWarning } = state;

  const visibleWarnings = useMemo(() => {
    // De-duplicate by (drug_name + code) so two prescription lines that
    // map to the same comorbidity only show once in the panel.
    const seen = new Set<string>();
    return warnings.filter((w) => {
      const k = `${w.drug_name.toLowerCase()}::${w.comorbidity_code.toUpperCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [warnings]);

  if (mode === 'inline') {
    if (visibleWarnings.length === 0 && !loading && state.traceEvents.length === 0) return null;
    return (
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/70 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
            ⚠️ Rx coherence — {visibleWarnings.length} unaddressed
          </div>
          {loading && <span className="text-[10px] italic text-amber-600">checking…</span>}
        </div>
        {state.traceEvents.length > 0 && (
          <div className="mb-2">
            <TracePanel
              events={state.traceEvents}
              totalMs={state.traceTotalMs}
              traceId={state.traceId}
              surface="rx-coherence"
            />
          </div>
        )}
        <ul className="space-y-1.5">
          {visibleWarnings.map((w) => (
            <CoherenceRow
              key={`${w.drug_name}::${w.comorbidity_code}`}
              w={w}
              reason={reasonDrafts[`${w.drug_name}::${w.comorbidity_code}`] ?? ''}
              onReasonChange={(r) =>
                setReasonDrafts((d) => ({ ...d, [`${w.drug_name}::${w.comorbidity_code}`]: r }))
              }
              onAdd={() => void addComorbidity(w)}
              onOverride={() => overrideWarning(w, reasonDrafts[`${w.drug_name}::${w.comorbidity_code}`] ?? '')}
            />
          ))}
        </ul>
      </div>
    );
  }

  // mode === 'modal'
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-even-navy">
            Rx ↔ comorbidity coherence ({visibleWarnings.length})
          </h3>
          <p className="mt-1 text-xs text-even-ink-500">
            You&rsquo;re about to submit this encounter. The medications below typically
            imply chronic conditions the patient doesn&rsquo;t have on file. Address each
            one or confirm submit anyway.
          </p>
        </div>
        {visibleWarnings.length === 0 ? (
          <div className="rounded-md border border-even-ink-100 bg-even-ink-50 p-3 text-xs italic text-even-ink-600">
            All warnings addressed.
          </div>
        ) : (
          <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
            {visibleWarnings.map((w) => (
              <CoherenceRow
                key={`${w.drug_name}::${w.comorbidity_code}`}
                w={w}
                reason={reasonDrafts[`${w.drug_name}::${w.comorbidity_code}`] ?? ''}
                onReasonChange={(r) =>
                  setReasonDrafts((d) => ({ ...d, [`${w.drug_name}::${w.comorbidity_code}`]: r }))
                }
                onAdd={() => void addComorbidity(w)}
                onOverride={() => overrideWarning(w, reasonDrafts[`${w.drug_name}::${w.comorbidity_code}`] ?? '')}
              />
            ))}
          </ul>
        )}
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-even-ink-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-even-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-even-ink-700 hover:bg-even-ink-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-even-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-even-blue-700"
          >
            Confirm submit
          </button>
        </div>
      </div>
    </div>
  );
}

type FdaCitation = {
  source: string;
  book: string;
  chapter: string | null;
  section: string | null;
  text_excerpt: string;
};

function CoherenceRow({
  w,
  reason,
  onReasonChange,
  onAdd,
  onOverride,
}: {
  w: CoherenceWarning;
  reason: string;
  onReasonChange: (r: string) => void;
  onAdd: () => void;
  onOverride: () => void;
}) {
  // v3.10.2 — async FDA indication backfill. Fires on mount, soft-fails
  // silently. Doctor sees the warning instantly from the static map; the
  // FDA-label citation reveals moments later (~200ms typical) as a
  // "View FDA label" expandable below the action row.
  const [fda, setFda] = useState<FdaCitation[] | null>(null);
  const [fdaOpen, setFdaOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/drugs/${encodeURIComponent(w.drug_name)}/fda-indication`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.indication && Array.isArray(json.indication.citations)) {
          setFda(json.indication.citations);
        }
      } catch {
        /* soft-fail */
      }
    })();
    return () => { cancelled = true; };
  }, [w.drug_name]);

  return (
    <li className="rounded-md border border-amber-200 bg-white p-2.5 text-xs">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="font-mono font-semibold text-amber-900">{w.drug_name}</span>
        <span className="text-even-ink-500">typically treats</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-mono text-amber-900 ring-1 ring-amber-200">
          {w.comorbidity_code}
        </span>
        <span className="text-even-ink-700">{w.comorbidity_label}</span>
        <span className="text-[10px] uppercase tracking-wider text-even-ink-400">
          {w.source} · {Math.round(w.confidence * 100)}%
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md bg-even-blue px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-even-blue-700"
        >
          + Add {w.comorbidity_code}
        </button>
        <input
          type="text"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Override reason (optional)"
          className="flex-1 min-w-[12rem] rounded border border-even-ink-200 px-2 py-1 text-[11px] text-even-ink-800 placeholder:text-even-ink-400"
        />
        <button
          type="button"
          onClick={onOverride}
          className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
        >
          Override
        </button>
      </div>
      {fda && fda.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setFdaOpen((o) => !o)}
            className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100"
          >
            {fdaOpen ? '▾' : '▸'} View FDA label · {fda.length}
          </button>
          {fdaOpen && (
            <ul className="mt-1 space-y-1 border-l border-violet-200 pl-2">
              {fda.map((c, i) => (
                <li key={i} className="text-[10px] text-violet-800">
                  <span className="font-medium">{c.book}</span>
                  {c.chapter && <span className="text-even-ink-600"> — {c.chapter}</span>}
                  {c.section && <span className="text-even-ink-500"> › {c.section}</span>}
                  <div className="mt-0.5 italic text-even-ink-600">{c.text_excerpt.slice(0, 320)}{c.text_excerpt.length > 320 ? '…' : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
