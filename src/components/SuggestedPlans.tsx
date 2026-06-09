'use client';

/**
 * src/components/SuggestedPlans.tsx
 *
 * v5.1 — AI-predicted plan suggestions.
 *
 * Fetches /api/encounters/[id]/predict-plans (GET), renders the top 5
 * with confidence + reasoning + [Add plan] / [why?] buttons. Re-fetches
 * with POST when the user clicks ↻. Polls (debounced) when the encounter
 * surface signals a "predict-trigger" event (chief_complaint, exam,
 * assessment, Rx, vitals changes).
 *
 * Visual style matches v4 ✨ chip wall — no card border, brand-faint
 * accents, [Add plan] is the primary action.
 *
 * Soft-fails: if the LLM is unavailable the block renders nothing
 * (returns null). UI never blocks on prediction.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';
import { PLAN_KINDS, PLAN_META, type PlanKind } from '@/lib/plan-schemas';

// ---------------------------------------------------------------------------
// Types — mirror server response shape
// ---------------------------------------------------------------------------

type PredictedPlan = {
  rank: number;
  kind: PlanKind;
  confidence: number;
  reasoning: string;
  prefill: Record<string, unknown>;
};

type PredictionResponse =
  | {
      ok: true;
      result:
        | {
            ok: true;
            predictions: PredictedPlan[];
            severity_estimate: 'low' | 'moderate' | 'high';
            model: string;
            latency_ms: number;
            snapshot_hash: string;
            generated_at: string;
            cached: boolean;
          }
        | {
            ok: false;
            predictions: [];
            reason: string;
          };
      stale?: boolean;
      current_snapshot_hash?: string;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SuggestedPlansProps = {
  encounterId: string;
  /**
   * Called when the doctor clicks [Add plan]. Caller is responsible for
   * actually POSTing /api/encounters/[id]/plans with this kind + prefill.
   * The caller will typically render PlanFormShell pre-filled.
   */
  onAdd: (kind: PlanKind, prefill: Record<string, unknown>, suggestion: PredictedPlan) => void;
  /**
   * Bump this number whenever the encounter mutates in a way that should
   * trigger a re-prediction (chief_complaint, exam, assessment, Rx, vitals,
   * transcription). The component debounces internally.
   */
  predictionTrigger?: number;
  /** Bypass auto-render when the encounter is already complete. */
  disabled?: boolean;
};

// ---------------------------------------------------------------------------
// Plan kind name guard (server should always return valid kinds, but defensive)
// ---------------------------------------------------------------------------

const PLAN_KIND_SET = new Set<string>(PLAN_KINDS);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SuggestedPlans({
  encounterId,
  onAdd,
  predictionTrigger = 0,
  disabled,
}: SuggestedPlansProps) {
  const [predictions, setPredictions] = useState<PredictedPlan[] | null>(null);
  const [severity, setSeverity] = useState<'low' | 'moderate' | 'high' | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [stale, setStale] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showWhyFor, setShowWhyFor] = useState<number | null>(null);
  const debounceRef = useRef<number | null>(null);

  // v6.0 Phase 2C — TracePanel state
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [traceTotalMs, setTraceTotalMs] = useState<number | undefined>(undefined);
  const [traceId, setTraceId] = useState<string | null>(null);

  const fetchPrediction = useCallback(
    async (force: boolean) => {
      if (disabled) return;
      setLoading(true);
      setError(null);
      // Reset trace state for every fire.
      setTraceEvents([]);
      setTraceTotalMs(undefined);
      setTraceId(null);
      try {
        // GET = cheap cached read (no LLM). POST = force fresh — stream
        // NDJSON so the TracePanel renders live.
        if (!force) {
          const res = await fetch(
            `/api/encounters/${encodeURIComponent(encounterId)}/predict-plans`,
            { method: 'GET', cache: 'no-store' },
          );
          const body = (await res.json()) as PredictionResponse;
          if (!body.ok) { setError(body.error); return; }
          if (body.result.ok) {
            const filtered = body.result.predictions.filter((p) => PLAN_KIND_SET.has(p.kind));
            setPredictions(filtered);
            setSeverity(body.result.severity_estimate);
            setLatencyMs(body.result.latency_ms);
            setGeneratedAt(body.result.generated_at);
            setStale(Boolean(body.stale));
          } else {
            setPredictions([]);
            setSeverity(null);
          }
          return;
        }

        // Force=true — POST with Accept: application/x-ndjson for live trace.
        const res = await fetch(
          `/api/encounters/${encodeURIComponent(encounterId)}/predict-plans`,
          {
            method: 'POST',
            headers: { Accept: 'application/x-ndjson' },
            cache: 'no-store',
          },
        );
        const tid = res.headers.get('X-Trace-Id');
        if (tid) setTraceId(tid);
        if (!res.ok) { setError(`HTTP ${res.status}`); return; }

        const resultRef: { current: PredictionResponse | null } = { current: null };
        await consumeNdjson(res, (ev) => {
          if (ev.type === 'progress') {
            setTraceEvents((prev) => {
              const next = prev.map((p, i) => (i === prev.length - 1 && !p.done ? { ...p, done: true } : p));
              return [...next, { stage: ev.stage, msg: ev.msg, ms: ev.ms, done: false, ts: Date.now() }];
            });
          } else if (ev.type === 'result') {
            resultRef.current = ev.data as PredictionResponse;
          } else if (ev.type === 'done') {
            setTraceTotalMs(ev.ms);
            setTraceEvents((prev) => [...prev, { stage: 'done', msg: '', ms: ev.ms, done: true, ts: Date.now() }]);
          } else if (ev.type === 'error') {
            setTraceEvents((prev) => [...prev, { stage: 'done', msg: ev.message, done: true, error: true, ts: Date.now() }]);
          }
        });

        const body = resultRef.current;
        if (!body || !body.ok) { setError(body?.error ?? 'predict_failed'); return; }
        if (body.result.ok) {
          const filtered = body.result.predictions.filter((p) => PLAN_KIND_SET.has(p.kind));
          setPredictions(filtered);
          setSeverity(body.result.severity_estimate);
          setLatencyMs(body.result.latency_ms);
          setGeneratedAt(body.result.generated_at);
          setStale(Boolean(body.stale));
        } else {
          setPredictions([]);
          setSeverity(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'predict_failed');
      } finally {
        setLoading(false);
      }
    },
    [encounterId, disabled],
  );

  // Initial load.
  useEffect(() => {
    void fetchPrediction(false);
  }, [fetchPrediction]);

  // Trigger debounced refresh on dependency change.
  useEffect(() => {
    if (predictionTrigger === 0) return;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      void fetchPrediction(true);
    }, 2000);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [predictionTrigger, fetchPrediction]);

  const headerMeta = useMemo(() => {
    if (loading && !predictions) return 'thinking…';
    if (!predictions) return null;
    if (predictions.length === 0) return null;
    const parts: string[] = [];
    if (latencyMs !== null) parts.push(`qwen ${(latencyMs / 1000).toFixed(1)}s`);
    if (generatedAt) {
      const ago = Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000));
      parts.push(`updated ${ago}s ago`);
    }
    if (stale) parts.push('stale');
    return parts.join(' · ');
  }, [loading, predictions, latencyMs, generatedAt, stale]);

  // Hidden states
  if (disabled) return null;
  if (error) return null; // Soft-fail
  if (predictions !== null && predictions.length === 0 && !loading) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-violet-700">
        <span>✨ Suggested plans</span>
        {headerMeta && (
          <span className="text-slate-400 tracking-normal normal-case">
            {headerMeta}
          </span>
        )}
        {severity && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full tracking-normal normal-case ${
              severity === 'high'
                ? 'bg-red-50 text-red-700'
                : severity === 'low'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
            }`}
          >
            severity: {severity}
          </span>
        )}
        <button
          type="button"
          onClick={() => void fetchPrediction(true)}
          disabled={loading}
          className="ml-auto text-violet-600 hover:text-violet-800 tracking-normal normal-case text-xs disabled:opacity-50"
          title="Re-run prediction"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {(traceEvents.length > 0 || (predictions === null && loading)) && (
        <div className="mb-2">
          <TracePanel
            events={traceEvents}
            totalMs={traceTotalMs}
            traceId={traceId}
            surface="predict-plans"
          />
        </div>
      )}

      {predictions !== null && (
        <ol className="space-y-1.5">
          {predictions.map((p) => {
            const meta = PLAN_META[p.kind];
            const isTop = p.rank === 1;
            return (
              <li key={`${p.rank}-${p.kind}`} className="flex flex-col gap-1 group">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="text-xs text-slate-400 w-4">{p.rank}.</span>
                  {isTop && <span className="text-amber-500">★</span>}
                  <span className="font-medium text-slate-800">
                    {meta?.icon} {meta?.label ?? p.kind}
                  </span>
                  <span className="text-xs text-slate-500">
                    {(p.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                {p.reasoning && (
                  <div className="pl-6 text-xs text-slate-600 leading-snug">
                    {p.reasoning}
                  </div>
                )}
                <div className="pl-6 flex gap-2">
                  <button
                    type="button"
                    className="text-xs px-2 py-0.5 rounded-full border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 transition"
                    onClick={() => onAdd(p.kind, p.prefill ?? {}, p)}
                  >
                    Add plan
                  </button>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline"
                    onClick={() => setShowWhyFor(showWhyFor === p.rank ? null : p.rank)}
                  >
                    {showWhyFor === p.rank ? 'hide' : 'why?'}
                  </button>
                </div>
                {showWhyFor === p.rank && (
                  <div className="pl-6 mt-1 text-xs text-slate-500 bg-slate-50 rounded-md p-2">
                    <div className="font-medium text-slate-600 mb-1">
                      Reasoning (model: qwen2.5:14b)
                    </div>
                    <div className="leading-relaxed">{p.reasoning}</div>
                    {Object.keys(p.prefill ?? {}).length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-slate-400 hover:text-slate-600">
                          prefill preview
                        </summary>
                        <pre className="mt-1 text-[10px] bg-white p-2 rounded overflow-x-auto">
                          {JSON.stringify(p.prefill, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
