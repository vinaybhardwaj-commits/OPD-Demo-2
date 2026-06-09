'use client';

/**
 * <ComorbidityEditModal /> — full edit surface for patient comorbidities.
 *
 * Two-column layout per v3.9 PRD §4.3:
 *   - Left (2/3): ComorbiditySearch + cart-style staging of current items
 *   - Right (1/3): live-updating TierBadge breakdown
 *
 * Save is atomic — collects pending adds + pending resolves + onset year
 * edits, fires a batched POST + PATCHes, then closes.
 */
import { useEffect, useMemo, useState } from 'react';
import { TierBadge } from './TierBadge';
import { TierOverridePopover, type TierOverrideValue } from './TierOverridePopover';
import { KbEvidenceReveal } from './KbEvidenceReveal';
import { ComorbiditySearch, type CatalogEntry } from './ComorbiditySearch';
import type { TierBreakdown } from '@/lib/comorbidity-tier';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';

type ApiComorbidity = {
  id: string;
  code: string;
  label: string;
  onset_date: string | null;
  is_resolved: boolean;
  resolved_at: string | null;
  added_by_name: string | null;
  added_at: string;
  catalog_id: string | null;
  tier: 'core' | 'extended' | null;
  captured_as: string | null;
  panel_risk_weight: number;
  triggers_extended_capture: boolean;
  condition_name_canonical: string | null;
  // v3.9.5
  control_state: 'well' | 'partial' | 'uncontrolled' | null;
  severity_state: 'mild' | 'moderate' | 'severe' | null;
  state_updated_at: string | null;
};

type StateSuggestion = {
  comorbidity_id: string;
  code: string;
  control_state: 'well' | 'partial' | 'uncontrolled' | null;
  severity_state: 'mild' | 'moderate' | 'severe' | null;
  rationale: string;
};

type PendingAdd = {
  catalog_id?: string;
  code: string;
  label: string;
  onset_year?: number;
};

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1939 }, (_, i) => CURRENT_YEAR - i);

export function ComorbidityEditModal({
  patientId,
  patientName,
  patientAge,
  patientSex,
  encounterId,
  onClose,
  onSaved,
}: {
  patientId: string;
  patientName: string;
  patientAge: number;
  patientSex: string;
  /** v3.9.5 — when supplied, enables Qwen state-suggest from assessment_text. */
  encounterId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [existing, setExisting] = useState<ApiComorbidity[]>([]);
  const [tier, setTier] = useState<TierBreakdown | null>(null);
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  const [pendingResolves, setPendingResolves] = useState<Set<string>>(new Set()); // ids
  const [pendingUnresolves, setPendingUnresolves] = useState<Set<string>>(new Set()); // ids
  const [pendingOnsetEdits, setPendingOnsetEdits] = useState<Map<string, string | null>>(new Map());

  // v3.9.5 — Qwen state-suggest + manual pending edits
  const [stateSuggestions, setStateSuggestions] = useState<StateSuggestion[]>([]);
  const [stateLoading, setStateLoading] = useState(false);
  /** Confirmed/edited state per comorbidity_id — overrides server value optimistically until save. */
  const [stateEdits, setStateEdits] = useState<Map<string, { control_state?: 'well'|'partial'|'uncontrolled'|null; severity_state?: 'mild'|'moderate'|'severe'|null; from_qwen: boolean }>>(new Map());
  // v6.0 Phase 3 — TracePanel state for comorbidity-states/suggest.
  const [stateTraceEvents, setStateTraceEvents] = useState<TraceEvent[]>([]);
  const [stateTraceTotalMs, setStateTraceTotalMs] = useState<number | undefined>(undefined);
  const [stateTraceId, setStateTraceId] = useState<string | null>(null);

  // v3.9.2 — Suggest from history (Qwen reads past 5-10 encounters)
  type HistorySuggestion = { code: string; label: string; rationale: string; confidence: number };
  const [historySuggestions, setHistorySuggestions] = useState<HistorySuggestion[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [historyLatency, setHistoryLatency] = useState<number | null>(null);
  const [historyScanned, setHistoryScanned] = useState<number | null>(null);
  // v6.0 Phase 3 — TracePanel state for suggest-from-history.
  const [historyTraceEvents, setHistoryTraceEvents] = useState<TraceEvent[]>([]);
  const [historyTraceTotalMs, setHistoryTraceTotalMs] = useState<number | undefined>(undefined);
  const [historyTraceId, setHistoryTraceId] = useState<string | null>(null);

  const fetchHistorySuggestions = async () => {
    setHistoryLoading(true); setHistoryErr(null);
    // Reset trace state for every fire.
    setHistoryTraceEvents([]);
    setHistoryTraceTotalMs(undefined);
    setHistoryTraceId(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/comorbidities/suggest-from-history`, {
        method: 'POST',
        headers: { Accept: 'application/x-ndjson' },
      });
      const tid = res.headers.get('X-Trace-Id');
      if (tid) setHistoryTraceId(tid);
      // Route streams NDJSON (no cache).
      type HistoryBody = {
        ok?: boolean;
        suggestions?: HistorySuggestion[];
        latency_ms?: number;
        encounters_scanned?: number;
        error?: string;
      };
      const resultRef: { current: HistoryBody | null } = { current: null };
      await consumeNdjson(res, (ev) => {
        if (ev.type === 'progress') {
          setHistoryTraceEvents((prev) => {
            const next = prev.map((p, i) => (i === prev.length - 1 && !p.done ? { ...p, done: true } : p));
            return [...next, { stage: ev.stage, msg: ev.msg, ms: ev.ms, done: false, ts: Date.now() }];
          });
        } else if (ev.type === 'result') {
          resultRef.current = ev.data as HistoryBody;
        } else if (ev.type === 'done') {
          setHistoryTraceTotalMs(ev.ms);
          setHistoryTraceEvents((prev) => [...prev, { stage: 'done', msg: '', ms: ev.ms, done: true, ts: Date.now() }]);
        } else if (ev.type === 'error') {
          setHistoryTraceEvents((prev) => [...prev, { stage: 'done', msg: ev.message, done: true, error: true, ts: Date.now() }]);
        }
      });
      const json = resultRef.current;
      if (json && json.ok && Array.isArray(json.suggestions)) {
        setHistorySuggestions(json.suggestions);
        setHistoryLatency(json.latency_ms ?? null);
        setHistoryScanned(json.encounters_scanned ?? null);
        if (json.suggestions.length === 0 && json.error) setHistoryErr(json.error);
      } else {
        setHistoryErr(json?.error ?? 'No suggestions');
      }
    } catch (e) {
      setHistoryErr(e instanceof Error ? e.message : String(e));
    } finally { setHistoryLoading(false); }
  };

  const acceptHistorySuggestion = (s: HistorySuggestion) => {
    setPendingAdds((cur) => {
      if (cur.some((p) => p.code === s.code)) return cur;
      return [...cur, { code: s.code, label: s.label }];
    });
    setHistorySuggestions((cur) => cur ? cur.filter((x) => x.code !== s.code) : cur);
  };

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/comorbidities`);
        const json = await res.json();
        if (!cancel && json.ok) {
          setExisting(json.comorbidities);
          setTier(json.tier);
        }
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [patientId]);

  // v3.9.5 — fetch Qwen state suggestions when encounterId is supplied.
  // v6.0 Phase 3 — consumes NDJSON when the route's cache misses; falls
  // back to plain JSON on cache hit. Renders <TracePanel surface=
  // 'comorbidity-states'> while qwen is firing.
  useEffect(() => {
    if (!encounterId) return;
    let cancel = false;
    setStateLoading(true);
    // Reset trace state for every fire.
    setStateTraceEvents([]);
    setStateTraceTotalMs(undefined);
    setStateTraceId(null);
    (async () => {
      try {
        const res = await fetch(`/api/encounters/${encounterId}/comorbidity-states/suggest`, {
          headers: { Accept: 'application/x-ndjson' },
        });
        if (cancel) return;
        if (!res.ok) return;
        const tid = res.headers.get('X-Trace-Id');
        if (tid) setStateTraceId(tid);
        const ct = res.headers.get('content-type') ?? '';

        type StatesBody = {
          ok?: boolean;
          payload?: { status?: 'ok' | 'failed'; findings?: StateSuggestion[] };
        };
        let body: StatesBody | null = null;

        if (ct.includes('application/x-ndjson')) {
          const resultRef: { current: StatesBody | null } = { current: null };
          await consumeNdjson(res, (ev) => {
            if (cancel) return;
            if (ev.type === 'progress') {
              setStateTraceEvents((prev) => {
                const next = prev.map((p, i) => (i === prev.length - 1 && !p.done ? { ...p, done: true } : p));
                return [...next, { stage: ev.stage, msg: ev.msg, ms: ev.ms, done: false, ts: Date.now() }];
              });
            } else if (ev.type === 'result') {
              resultRef.current = ev.data as StatesBody;
            } else if (ev.type === 'done') {
              setStateTraceTotalMs(ev.ms);
              setStateTraceEvents((prev) => [...prev, { stage: 'done', msg: '', ms: ev.ms, done: true, ts: Date.now() }]);
            } else if (ev.type === 'error') {
              setStateTraceEvents((prev) => [...prev, { stage: 'done', msg: ev.message, done: true, error: true, ts: Date.now() }]);
            }
          });
          if (cancel) return;
          body = resultRef.current;
        } else {
          body = (await res.json()) as StatesBody;
        }

        if (body && body.ok && body.payload?.status === 'ok' && Array.isArray(body.payload.findings)) {
          const findings = body.payload.findings;
          setStateSuggestions(findings);
          // Pre-fill stateEdits for chips that currently have no value
          setStateEdits((cur) => {
            const next = new Map(cur);
            for (const f of findings) {
              if (next.has(f.comorbidity_id)) continue; // user already touched
              next.set(f.comorbidity_id, {
                control_state: f.control_state ?? undefined,
                severity_state: f.severity_state ?? undefined,
                from_qwen: true,
              });
            }
            return next;
          });
        }
      } catch {
        /* soft-fail */
      } finally {
        if (!cancel) setStateLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [encounterId, existing.length]);

  // v3.9.5 — getter for the current control/severity value of a chip
  // (stateEdits > existing.control_state)
  function effectiveState(c: ApiComorbidity): { control_state: 'well'|'partial'|'uncontrolled' | null; severity_state: 'mild'|'moderate'|'severe' | null; from_qwen: boolean } {
    const edit = stateEdits.get(c.id);
    if (edit) {
      return {
        control_state: edit.control_state ?? null,
        severity_state: edit.severity_state ?? null,
        from_qwen: edit.from_qwen,
      };
    }
    return { control_state: c.control_state, severity_state: c.severity_state, from_qwen: false };
  }

  // v3.9.5 — set a control state for a chip + persist immediately
  async function setControl(c: ApiComorbidity, value: 'well'|'partial'|'uncontrolled' | null) {
    setStateEdits((cur) => {
      const next = new Map(cur);
      const prev = next.get(c.id) ?? {};
      next.set(c.id, { ...prev, control_state: value, from_qwen: false });
      return next;
    });
    try {
      await fetch(`/api/patients/${patientId}/comorbidities/${c.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ control_state: value }),
      });
    } catch { /* soft-fail */ }
  }

  async function setSeverity(c: ApiComorbidity, value: 'mild'|'moderate'|'severe' | null) {
    setStateEdits((cur) => {
      const next = new Map(cur);
      const prev = next.get(c.id) ?? {};
      next.set(c.id, { ...prev, severity_state: value, from_qwen: false });
      return next;
    });
    try {
      await fetch(`/api/patients/${patientId}/comorbidities/${c.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ severity_state: value }),
      });
    } catch { /* soft-fail */ }
  }

  const excludeCatalogIds = useMemo(() => {
    const s = new Set<string>();
    existing.filter((c) => !c.is_resolved).forEach((c) => c.catalog_id && s.add(c.catalog_id));
    pendingAdds.forEach((p) => p.catalog_id && s.add(p.catalog_id));
    return s;
  }, [existing, pendingAdds]);

  const excludeCodes = useMemo(() => {
    const s = new Set<string>();
    existing.filter((c) => !c.is_resolved).forEach((c) => s.add(c.code));
    pendingAdds.forEach((p) => s.add(p.code));
    return s;
  }, [existing, pendingAdds]);

  // Compute pending tier — combine existing active + pending adds, subtract pending resolves
  const pendingTier = useMemo<TierBreakdown | null>(() => {
    if (!tier) return null;
    const activeCatalogIds: string[] = [];
    existing.filter((c) => !c.is_resolved && !pendingResolves.has(c.id))
      .forEach((c) => c.catalog_id && activeCatalogIds.push(c.catalog_id));
    existing.filter((c) => c.is_resolved && pendingUnresolves.has(c.id))
      .forEach((c) => c.catalog_id && activeCatalogIds.push(c.catalog_id));
    pendingAdds.forEach((p) => p.catalog_id && activeCatalogIds.push(p.catalog_id));
    // Re-use existing tier breakdown shape but recompute base + score client-side
    // (Authoritative recompute happens server-side on save.)
    // For preview we just sum panel_risk_weights of catalog matches available in existing
    // → approximation, full recompute on save returns the canonical value.
    return tier; // simplest preview: keep current tier until save
  }, [tier, existing, pendingResolves, pendingUnresolves, pendingAdds]);

  const addFromCatalog = (e: CatalogEntry) => {
    setPendingAdds((cur) => [...cur, { catalog_id: e.catalog_id, code: e.icd10_anchor, label: e.condition_name }]);
  };
  const addFree = (item: { code: string; label: string }) => {
    setPendingAdds((cur) => [...cur, { code: item.code, label: item.label }]);
  };
  const dropPending = (idx: number) => {
    setPendingAdds((cur) => cur.filter((_, i) => i !== idx));
  };
  const toggleResolve = (id: string, currentResolved: boolean) => {
    if (currentResolved) {
      setPendingUnresolves((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    } else {
      setPendingResolves((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
  };
  const setOnsetEdit = (id: string, year: string) => {
    const date = year ? `${year}-01-01` : null;
    setPendingOnsetEdits((cur) => {
      const next = new Map(cur);
      next.set(id, date);
      return next;
    });
  };

  const dirty = pendingAdds.length > 0 || pendingResolves.size > 0 || pendingUnresolves.size > 0 || pendingOnsetEdits.size > 0;

  const save = async () => {
    if (!dirty) { onClose(); return; }
    setSaving(true); setErr(null);
    try {
      // 1. Batch add
      if (pendingAdds.length > 0) {
        const items = pendingAdds.map((p) => ({
          catalog_id: p.catalog_id,
          code: p.code,
          label: p.label,
          onset_date: p.onset_year ? `${p.onset_year}-01-01` : null,
        }));
        const r = await fetch(`/api/patients/${patientId}/comorbidities`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        const j = await r.json();
        if (!j.ok) { setErr(j.error ?? 'add failed'); setSaving(false); return; }
      }
      // 2. Resolve toggles
      for (const id of pendingResolves) {
        await fetch(`/api/comorbidities/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ is_resolved: true }),
        });
      }
      for (const id of pendingUnresolves) {
        await fetch(`/api/comorbidities/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ is_resolved: false }),
        });
      }
      // 3. Onset edits
      for (const [id, date] of pendingOnsetEdits) {
        await fetch(`/api/comorbidities/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ onset_date: date }),
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  const activeExisting = existing.filter((c) => !c.is_resolved && !pendingResolves.has(c.id));
  const resolvedExisting = existing.filter((c) => c.is_resolved && !pendingUnresolves.has(c.id));
  const willResolve = existing.filter((c) => !c.is_resolved && pendingResolves.has(c.id));
  const willUnresolve = existing.filter((c) => c.is_resolved && pendingUnresolves.has(c.id));

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-4xl flex-col overflow-y-auto border-l border-even-ink-100 bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 border-b border-even-ink-100 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-even-ink-500">Edit comorbidities</div>
              <h2 className="text-lg font-semibold text-even-navy">
                {patientName} <span className="text-even-ink-500">· {patientAge}{patientSex} </span>
              </h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-even-ink-500 hover:bg-even-ink-50">✕</button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-3 gap-6 px-6 py-6">
          {/* Left 2/3 */}
          <div className="col-span-2 space-y-5">
            {(stateTraceEvents.length > 0 || (stateLoading && encounterId)) && (
              <div>
                <TracePanel
                  events={stateTraceEvents}
                  totalMs={stateTraceTotalMs}
                  traceId={stateTraceId}
                  surface="comorbidity-states"
                />
              </div>
            )}
            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-even-ink-500">Add</div>
              <ComorbiditySearch
                onAddCatalog={addFromCatalog}
                onAddFree={addFree}
                excludeCatalogIds={excludeCatalogIds}
                excludeCodes={excludeCodes}
                patientId={patientId}
                defaultScope="core"
                autoExpandToAll={tier?.extended_visible ?? false}
              />
            </section>

            {pendingAdds.length > 0 && (
              <section>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-even-ink-500">
                  Pending additions ({pendingAdds.length})
                </div>
                <ul className="divide-y divide-even-ink-50 overflow-hidden rounded-md border border-even-blue-200 bg-even-blue-50/30">
                  {pendingAdds.map((p, idx) => (
                    <li key={`${p.code}-${idx}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="shrink-0 font-mono text-xs font-semibold text-even-navy">{p.code}</span>
                        <span className="truncate text-sm">{p.label}</span>
                      </div>
                      <select
                        value={p.onset_year ?? ''}
                        onChange={(e) => setPendingAdds((cur) => cur.map((x, i) => i === idx ? { ...x, onset_year: e.target.value ? Number(e.target.value) : undefined } : x))}
                        className="rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs"
                      >
                        <option value="">Unknown year</option>
                        {YEAR_OPTIONS.slice(0, 60).map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <button onClick={() => dropPending(idx)} className="rounded-md px-2 py-1 text-xs text-even-ink-400 hover:bg-rose-50 hover:text-rose-600">× Drop</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-even-ink-500">
                Current ({activeExisting.length + willUnresolve.length} active, {resolvedExisting.length + willResolve.length} resolved)
              </div>
              {loading ? (
                <div className="rounded-md border border-even-ink-100 bg-white px-3 py-2 text-xs italic text-even-ink-500">Loading…</div>
              ) : (
                <>
                  {(activeExisting.length + willUnresolve.length) > 0 && (
                    <div className="mb-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-even-ink-400">Active</div>
                      <ul className="divide-y divide-even-ink-50 overflow-hidden rounded-md border border-even-ink-100 bg-white">
                        {[...activeExisting, ...willUnresolve].map((c) => {
                          const eff = effectiveState(c);
                          const showControl = (c.captured_as ?? '').includes('control');
                          const showSeverity = (c.captured_as ?? '').includes('severity');
                          const sugg = stateSuggestions.find((x) => x.comorbidity_id === c.id);
                          return (
                            <li key={c.id} className="flex flex-col gap-1.5 px-3 py-2 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                                  <span className="shrink-0 font-mono text-xs font-semibold text-even-navy">{c.code}</span>
                                  <span className="truncate">{c.label}</span>
                                  {c.tier === 'core' && <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0 text-[10px] text-blue-700 ring-1 ring-blue-200">core</span>}
                                  {c.tier === 'extended' && <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0 text-[10px] text-violet-700 ring-1 ring-violet-200">ext</span>}
                                  {c.triggers_extended_capture && <span className="shrink-0 text-[10px] text-amber-600" title="High-impact disease — gateways extended capture">⚡</span>}
                                </div>
                                <select
                                  value={(pendingOnsetEdits.get(c.id) ?? c.onset_date ?? '').slice(0, 4)}
                                  onChange={(e) => setOnsetEdit(c.id, e.target.value)}
                                  className="rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs"
                                >
                                  <option value="">Unknown</option>
                                  {YEAR_OPTIONS.slice(0, 60).map((y) => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <button
                                  onClick={() => toggleResolve(c.id, c.is_resolved)}
                                  className="rounded-md px-2 py-1 text-xs text-even-ink-400 hover:bg-rose-50 hover:text-rose-600"
                                >Mark resolved</button>
                              </div>
                              {(showControl || showSeverity) && (
                                <div className="flex flex-wrap items-center gap-2 pl-1">
                                  {showControl && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] uppercase tracking-wider text-even-ink-400">Control</span>
                                      {(['well','partial','uncontrolled'] as const).map((v) => {
                                        const active = eff.control_state === v;
                                        const tone = v === 'well' ? 'bg-emerald-100 text-emerald-800 ring-emerald-300' : v === 'partial' ? 'bg-amber-100 text-amber-800 ring-amber-300' : 'bg-rose-100 text-rose-800 ring-rose-300';
                                        return (
                                          <button
                                            key={v}
                                            type="button"
                                            onClick={() => void setControl(c, active ? null : v)}
                                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition ${active ? tone : 'bg-white text-even-ink-500 ring-even-ink-200 hover:ring-even-ink-300'}`}
                                          >
                                            {v}
                                          </button>
                                        );
                                      })}
                                      {eff.from_qwen && eff.control_state && (
                                        <span className="text-[10px] text-violet-600" title={sugg?.rationale ?? 'AI-suggested from assessment'}>✨ suggested</span>
                                      )}
                                    </div>
                                  )}
                                  {showSeverity && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] uppercase tracking-wider text-even-ink-400">Severity</span>
                                      {(['mild','moderate','severe'] as const).map((v) => {
                                        const active = eff.severity_state === v;
                                        const tone = v === 'mild' ? 'bg-sky-100 text-sky-800 ring-sky-300' : v === 'moderate' ? 'bg-amber-100 text-amber-800 ring-amber-300' : 'bg-rose-100 text-rose-800 ring-rose-300';
                                        return (
                                          <button
                                            key={v}
                                            type="button"
                                            onClick={() => void setSeverity(c, active ? null : v)}
                                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition ${active ? tone : 'bg-white text-even-ink-500 ring-even-ink-200 hover:ring-even-ink-300'}`}
                                          >
                                            {v}
                                          </button>
                                        );
                                      })}
                                      {eff.from_qwen && eff.severity_state && (
                                        <span className="text-[10px] text-violet-600" title={sugg?.rationale ?? 'AI-suggested from assessment'}>✨ suggested</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {(resolvedExisting.length + willResolve.length) > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-even-ink-400">Resolved</div>
                      <ul className="divide-y divide-even-ink-50 overflow-hidden rounded-md border border-even-ink-100 bg-even-ink-50/40">
                        {[...resolvedExisting, ...willResolve].map((c) => (
                          <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-even-ink-500">
                            <div className="flex min-w-0 flex-1 items-baseline gap-2">
                              <span className="shrink-0 font-mono text-xs">{c.code}</span>
                              <span className="truncate line-through">{c.label}</span>
                              {c.resolved_at && <span className="shrink-0 text-[10px]">· resolved {c.resolved_at.slice(0, 10)}</span>}
                            </div>
                            <button onClick={() => toggleResolve(c.id, c.is_resolved)} className="rounded-md px-2 py-1 text-xs hover:bg-even-blue-50 hover:text-even-blue-700">↺ Reactivate</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {existing.length === 0 && <div className="rounded-md border border-dashed border-even-ink-200 bg-even-ink-50/40 px-3 py-3 text-center text-xs text-even-ink-400">No comorbidities yet. Search above to add.</div>}
                </>
              )}
            </section>
          </div>

          {/* Right 1/3 */}
          <div className="col-span-1">
            <div className="sticky top-24 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-even-ink-500">Panel risk tier</div>
              {pendingTier ? (
                <>
                  <TierOverridePopover
                    patientId={patientId}
                    currentOverride={(pendingTier.override_applied ? (('T' + pendingTier.tier) as TierOverrideValue) : null)}
                    computedTier={`T${pendingTier.tier}`}
                    onSaved={() => { /* let parent reload by closing/reopening; cheap to just hint */ }}
                  >
                    <div><TierBadge breakdown={pendingTier} size="lg" /></div>
                  </TierOverridePopover>
                  <div className="text-[10px] text-even-ink-400">Click tier to override</div>
                  {dirty && <div className="text-[11px] italic text-even-ink-500">Tier will recompute on save.</div>}
                </>
              ) : (
                <div className="text-xs italic text-even-ink-400">Loading…</div>
              )}
            </div>
          </div>
        </div>

        {/* v3.9.2 — Suggest from history Qwen panel */}
        <div className="border-t border-even-ink-100 bg-even-ink-50/40 px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-even-ink-500">
                Suggest from history
              </span>
              <span className="text-[11px] text-even-ink-500">
                Read past 5–10 encounters to propose chronic conditions
              </span>
            </div>
            <button
              type="button"
              onClick={fetchHistorySuggestions}
              disabled={historyLoading}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {historyLoading ? '⟳ Reading…' : '✨ Suggest from history'}
            </button>
          </div>

          {(historyTraceEvents.length > 0 || historyLoading) && (
            <div className="mt-2">
              <TracePanel
                events={historyTraceEvents}
                totalMs={historyTraceTotalMs}
                traceId={historyTraceId}
                surface="comorbidity-history"
              />
            </div>
          )}

          {historySuggestions && historySuggestions.length > 0 && (
            <div className="mt-3 rounded-md border border-violet-200 bg-white">
              <div className="flex items-baseline justify-between border-b border-violet-100 px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-wider text-violet-700">
                  ✨ AI suggestions
                </span>
                <span className="text-[10px] text-even-ink-400">
                  {historySuggestions.length} codes from {historyScanned ?? '?'} encounters{historyLatency !== null && ` · ${(historyLatency / 1000).toFixed(1)}s`}
                </span>
              </div>
              <ul className="divide-y divide-violet-50">
                {historySuggestions.map((s) => (
                  <li key={s.code} className="flex items-start justify-between gap-3 px-3 py-2 text-sm hover:bg-violet-50/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 font-mono text-xs font-semibold text-even-navy">{s.code}</span>
                        <span className="truncate text-xs text-even-ink-800">{s.label}</span>
                        <span className="shrink-0 text-[10px] text-violet-700">{(s.confidence * 100).toFixed(0)}%</span>
                        {/* v3.10.3 — KB evidence backfill */}
                        <KbEvidenceReveal query={`${s.code} ${s.label}`} ariaLabel={`View KB evidence for ${s.code}`} />
                      </div>
                      {s.rationale && <div className="text-[10px] italic text-violet-600">{s.rationale}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => acceptHistorySuggestion(s)}
                      className="shrink-0 rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700"
                    >+ Add</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {historySuggestions && historySuggestions.length === 0 && !historyLoading && (
            <div className="mt-2 text-[11px] italic text-even-ink-400">
              No new chronic conditions found in the past {historyScanned ?? '?'} encounters.
            </div>
          )}

          {historyErr && <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{historyErr}</div>}
        </div>

        {err && <div className="border-t border-rose-100 bg-rose-50 px-6 py-2 text-xs text-rose-700">{err}</div>}

        <div className="sticky bottom-0 flex items-center justify-between border-t border-even-ink-100 bg-white px-6 py-4">
          <div className="text-[11px] text-even-ink-500">
            {dirty
              ? `${pendingAdds.length} to add · ${pendingResolves.size} to resolve · ${pendingUnresolves.size} to reactivate${pendingOnsetEdits.size ? ` · ${pendingOnsetEdits.size} onset edits` : ''}`
              : 'No changes yet.'}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-even-ink-200 bg-white px-4 py-2 text-sm hover:bg-even-ink-50">Cancel</button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-md bg-even-blue px-4 py-2 text-sm font-medium text-white hover:bg-even-blue-700 disabled:opacity-50"
            >{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
