'use client';

/**
 * <ComorbidityBand /> — always-visible chip band at the top of the
 * encounter editor (between patient header and Lab orders section).
 *
 * v3.9.1. Per the v3.9 PRD §4.1, this is the dominant comorbidity
 * surface — visible without a click, sets context for everything
 * below. Layout per §4.2: tier badge (left) + chip row (centre) +
 * actions (right) + trigger reasons line.
 *
 * Clicking '+ Add' or 'Edit all →' opens <ComorbidityEditModal>.
 *
 * v3.9.3 — when active.length === 0 AND an encounterId is supplied,
 * auto-fetch passive demographics-driven suggestions and render a
 * dotted violet block of chips below the empty-state. "Just a guess,
 * confirm" framing. Dismiss-all session-only via sessionStorage keyed
 * on encounterId.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TierBadge } from './TierBadge';
import { ComorbidityEditModal } from './ComorbidityEditModal';
import type { TierBreakdown } from '@/lib/comorbidity-tier';
import { KbEvidenceReveal } from './KbEvidenceReveal';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';

type ApiComorbidity = {
  id: string;
  code: string;
  label: string;
  onset_date: string | null;
  is_resolved: boolean;
  tier: 'core' | 'extended' | null;
  triggers_extended_capture: boolean;
};

type DemographicsSuggestion = { code: string; label: string; rationale: string; confidence: number };
type DemographicsSuggestPayload =
  | { status: 'ok'; findings: DemographicsSuggestion[]; generated_at: string; latency_ms: number }
  | { status: 'failed'; error: string; generated_at: string }
  | { status: 'not_eligible'; reason: string; generated_at: string };

export function ComorbidityBand({
  patientId,
  patientName,
  patientAge,
  patientSex,
  encounterId,
  visitReasonHint,
  readOnly,
}: {
  patientId: string;
  patientName: string;
  patientAge: number;
  patientSex: string;
  encounterId?: string;
  visitReasonHint?: string;
  readOnly?: boolean;
}) {
  const [comorbidities, setComorbidities] = useState<ApiComorbidity[]>([]);
  const [tier, setTier] = useState<TierBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // v3.9.3 demographics-suggest state
  const [suggest, setSuggest] = useState<DemographicsSuggestPayload | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [acceptingCode, setAcceptingCode] = useState<string | null>(null);
  // v6.0 Phase 3 — TracePanel state for the demographics-suggest fetch.
  // Populated only on NDJSON cache-miss.
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [traceTotalMs, setTraceTotalMs] = useState<number | undefined>(undefined);
  const [traceId, setTraceId] = useState<string | null>(null);
  const dismissKey = useMemo(
    () => (encounterId ? `comorbidity-demo-suggest-dismissed:${encounterId}` : null),
    [encounterId],
  );
  const [dismissed, setDismissed] = useState(false);
  // D.2 (V, 10 Jun): suggestions live in a right slide-over, fetched ON OPEN —
  // never auto-fired on page load (it was distracting + burned an LLM call).
  const [panelOpen, setPanelOpen] = useState(false);

  // Restore session dismiss flag
  useEffect(() => {
    if (!dismissKey) return;
    try {
      if (sessionStorage.getItem(dismissKey) === '1') setDismissed(true);
    } catch {
      /* sessionStorage unavailable — ignore */
    }
  }, [dismissKey]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/comorbidities`);
      const json = await res.json();
      if (json.ok) {
        setComorbidities(json.comorbidities);
        setTier(json.tier);
      }
    } finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { reload(); }, [reload]);

  const active = comorbidities.filter((c) => !c.is_resolved);
  const empty = active.length === 0;

  // v3.9.3 demographics fetch — D.2: ON-DEMAND only. Fires when the doctor
  // opens the AI-suggestions slide-over (first open per mount; ↻ re-fires).
  useEffect(() => {
    if (readOnly) return;
    if (!encounterId) return;
    if (loading) return;
    if (!panelOpen) return;
    if (!empty) {
      setSuggest(null);
      return;
    }
    if (suggest) return; // already fetched this mount

    let cancelled = false;
    setSuggestLoading(true);
    // Reset trace state for every fire.
    setTraceEvents([]);
    setTraceTotalMs(undefined);
    setTraceId(null);
    (async () => {
      try {
        const res = await fetch(`/api/encounters/${encounterId}/comorbidities/suggest-from-context`, {
          headers: { Accept: 'application/x-ndjson' },
        });
        if (cancelled) return;
        if (!res.ok) return;
        const tid = res.headers.get('X-Trace-Id');
        if (tid) setTraceId(tid);
        const ct = res.headers.get('content-type') ?? '';

        if (ct.includes('application/x-ndjson')) {
          // Streaming path — qwen is firing.
          type ResultBody = { ok?: boolean; payload?: DemographicsSuggestPayload };
          const resultRef: { current: ResultBody | null } = { current: null };
          await consumeNdjson(res, (ev) => {
            if (cancelled) return;
            if (ev.type === 'progress') {
              setTraceEvents((prev) => {
                const next = prev.map((p, i) => (i === prev.length - 1 && !p.done ? { ...p, done: true } : p));
                return [...next, { stage: ev.stage, msg: ev.msg, ms: ev.ms, done: false, ts: Date.now() }];
              });
            } else if (ev.type === 'result') {
              resultRef.current = ev.data as ResultBody;
            } else if (ev.type === 'done') {
              setTraceTotalMs(ev.ms);
              setTraceEvents((prev) => {
                // Terminal event must close the last in-progress step too —
                // otherwise the final stage ('Saving — caching priors') spins forever.
                const next = prev.map((p, i) => (i === prev.length - 1 && !p.done ? { ...p, done: true } : p));
                return [...next, { stage: 'done', msg: '', ms: ev.ms, done: true, ts: Date.now() }];
              });
            } else if (ev.type === 'error') {
              setTraceEvents((prev) => {
                const next = prev.map((p, i) => (i === prev.length - 1 && !p.done ? { ...p, done: true } : p));
                return [...next, { stage: 'done', msg: ev.message, done: true, error: true, ts: Date.now() }];
              });
            }
          });
          if (cancelled) return;
          const body = resultRef.current;
          if (body && body.ok && body.payload) setSuggest(body.payload);
        } else {
          // Plain JSON cache-hit path.
          const json = await res.json();
          if (cancelled) return;
          if (json.ok && json.payload) setSuggest(json.payload as DemographicsSuggestPayload);
        }
      } catch {
        /* soft-fail */
      } finally {
        if (!cancelled) setSuggestLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [empty, encounterId, panelOpen, readOnly, loading, suggest]);

  const acceptSuggestion = useCallback(async (s: DemographicsSuggestion) => {
    if (acceptingCode) return;
    setAcceptingCode(s.code);
    try {
      const res = await fetch(`/api/patients/${patientId}/comorbidities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ code: s.code, label: s.label }] }),
      });
      const json = await res.json();
      if (json.ok) {
        await reload();
        // empty will flip to false on next render, useEffect above clears suggest
      }
    } catch {
      /* soft-fail */
    } finally {
      setAcceptingCode(null);
    }
  }, [acceptingCode, patientId, reload]);

  const dismissAll = useCallback(() => {
    setDismissed(true);
    setPanelOpen(false);
    if (dismissKey) {
      try { sessionStorage.setItem(dismissKey, '1'); } catch { /* ignore */ }
    }
  }, [dismissKey]);

  const sexLabel = patientSex === 'M' ? 'M' : patientSex === 'F' ? 'F' : patientSex === 'O' ? 'O' : '?';
  const ccLabel = (visitReasonHint || '').trim().slice(0, 40);

  const okSuggest = suggest && suggest.status === 'ok' ? suggest : null;
  // D.2 — the block renders inside the right slide-over, only while open.
  const showSuggestBlock = !readOnly && empty && encounterId && panelOpen;

  return (
    <>
      <section className="rounded-xl border border-even-ink-100 bg-white p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            Comorbidities &amp; Panel Tier
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-even-ink-400">v3.9</span>
        </div>

        {loading ? (
          <div className="text-xs italic text-even-ink-500">Loading…</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {tier && <TierBadge breakdown={tier} size="md" />}
              {empty ? (
                <span className="text-xs italic text-even-ink-500">No comorbidities recorded.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {active.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => !readOnly && setModalOpen(true)}
                      className="inline-flex items-baseline gap-1 rounded-full bg-even-blue-50 px-2 py-0.5 text-[11px] text-even-blue-800 ring-1 ring-even-blue-200 hover:bg-even-blue-100"
                      title={`${c.code} — ${c.label}${c.onset_date ? ' · ' + c.onset_date.slice(0, 4) : ''}`}
                    >
                      <span className="font-mono font-semibold">{c.code}</span>
                      <span className="truncate max-w-[12rem]">{c.label}</span>
                      {c.onset_date && <span className="text-even-blue-600">· {c.onset_date.slice(0, 4)}</span>}
                      {c.triggers_extended_capture && <span className="text-amber-600" title="Gateways extended catalog">⚡</span>}
                    </button>
                  ))}
                </div>
              )}
              {!readOnly && (
                <div className="ml-auto flex gap-1.5">
                  {empty && encounterId && (
                    <button
                      type="button"
                      onClick={() => { setDismissed(false); setPanelOpen(true); }}
                      className="rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
                      title="AI-suggested likely comorbidities for this demographic + complaint — opens in a side panel; nothing runs until you ask"
                    >
                      ✨ AI suggestions
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="rounded-md border border-dashed border-even-blue-300 px-2.5 py-1 text-[11px] font-medium text-even-blue-700 hover:bg-even-blue-50"
                  >
                    + Add comorbidity
                  </button>
                  {!empty && (
                    <button
                      type="button"
                      onClick={() => setModalOpen(true)}
                      className="rounded-md border border-even-ink-200 bg-white px-2.5 py-1 text-[11px] font-medium text-even-ink-700 hover:bg-even-ink-50"
                    >
                      Edit all →
                    </button>
                  )}
                </div>
              )}
            </div>

            {tier && tier.trigger_reasons.length > 0 && (
              <div className="mt-2 text-[10px] text-even-ink-500">
                Trigger reasons: {tier.trigger_reasons.join(' · ')}
              </div>
            )}

            {/* v3.9.3 → D.2 — demographics-suggest, now an on-demand right slide-over */}
            {showSuggestBlock && (
              <div className="fixed inset-0 z-40">
                <div
                  className="absolute inset-0 bg-even-navy-900/20 backdrop-blur-[1px]"
                  onClick={() => setPanelOpen(false)}
                />
                <aside className="absolute right-0 top-0 h-full w-full max-w-[480px] overflow-y-auto bg-white p-4 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-violet-700">✨ AI comorbidity suggestions</h3>
                    <button
                      type="button"
                      onClick={() => setPanelOpen(false)}
                      className="rounded-md bg-even-ink-50 px-2 py-0.5 text-xs font-semibold text-even-ink-600 hover:bg-even-ink-100"
                    >
                      ✕ Close
                    </button>
                  </div>
                  <div className="rounded-lg border border-dashed border-violet-300 bg-violet-50/40 p-3">
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[11px] font-medium text-violet-800">
                    ✨ Suggested for {patientAge}{sexLabel}
                    {ccLabel && <> with <em className="font-normal not-italic text-violet-700">{ccLabel}</em></>}
                    {' — '}
                    <span className="text-violet-600 italic font-normal">just a guess, confirm</span>
                  </div>
                  <button
                    type="button"
                    onClick={dismissAll}
                    className="text-[10px] uppercase tracking-wider text-violet-600 hover:text-violet-800"
                  >
                    Dismiss all
                  </button>
                </div>
                {(traceEvents.length > 0 || suggestLoading) && (
                  <div className="mb-2">
                    <TracePanel
                      events={traceEvents}
                      totalMs={traceTotalMs}
                      traceId={traceId}
                      surface="comorbidity-context"
                    />
                  </div>
                )}
                {suggestLoading && traceEvents.length === 0 ? (
                  <div className="text-[11px] italic text-violet-500">Thinking…</div>
                ) : okSuggest && (
                  <div className="flex flex-wrap gap-1.5">
                    {okSuggest.findings.map((s) => (
                      <span key={s.code} className="inline-flex items-start gap-1">
                        <button
                          type="button"
                          disabled={!!acceptingCode}
                          onClick={() => acceptSuggestion(s)}
                          title={s.rationale}
                          className="inline-flex items-baseline gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] text-violet-800 ring-1 ring-violet-300 hover:bg-violet-100 disabled:opacity-50"
                        >
                          <span className="font-semibold">+</span>
                          <span className="font-mono font-semibold">{s.code}</span>
                          <span className="truncate max-w-[10rem]">{s.label}</span>
                          <span className="text-violet-500">{Math.round(s.confidence * 100)}%</span>
                          {acceptingCode === s.code && <span className="text-violet-400">…</span>}
                        </button>
                        {/* v3.10.3 — KB evidence backfill */}
                        <KbEvidenceReveal
                          query={`${s.code} ${s.label}`}
                          ariaLabel={`View KB evidence for ${s.code}`}
                        />
                      </span>
                    ))}
                  </div>
                )}
                  </div>
                </aside>
              </div>
            )}
          </>
        )}
      </section>

      {modalOpen && (
        <ComorbidityEditModal
          patientId={patientId}
          patientName={patientName}
          patientAge={patientAge}
          patientSex={patientSex}
          encounterId={encounterId}
          onClose={() => setModalOpen(false)}
          onSaved={async () => { setModalOpen(false); await reload(); }}
        />
      )}
    </>
  );
}
