'use client';

/**
 * <DdiBanner /> — v2.2.1 always-warn-never-block drug interaction display.
 *
 * Mounted inside <PrescriptionCompose>. Auto-fires POST /ddi-scan
 * 2 seconds after prescription_lines stops changing (debounce). Renders
 * the findings as a severity-tiered banner ABOVE the prescription rows.
 *
 * Per PRD lock — "Always warn, never block":
 *   - low      → tiny inline pill, no banner
 *   - moderate → yellow banner, no Submit gate
 *   - high     → red banner, recommendation prominent, NO Submit gate
 *   - severe   → red banner with "DO NOT PRESCRIBE TOGETHER", NO Submit gate
 *
 * The Submit button stays enabled regardless. Doctor's call.
 *
 * Failure mode: if Qwen errored, show a small "DDI check unavailable"
 * line with a retry button. Doesn't block Submit either.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';

type DdiFinding = {
  severity: 'low' | 'moderate' | 'high' | 'severe';
  pair: [string, string];
  rationale: string;
  recommendation: string | null;
  scanned_at: string;
};

type DdiPayload =
  | { status: 'ok'; findings: DdiFinding[]; scanned_at: string; latency_ms: number }
  | { status: 'failed'; error: string; scanned_at: string };

export type DdiBannerProps = {
  encounterId: string;
  /**
   * A signature of the current prescription_lines — when it changes,
   * the banner re-runs the scan after a debounce. Parent computes this
   * (e.g. JSON.stringify of generic_name + dose per line).
   */
  linesSignature: string;
  /** Hide entirely if there are no lines to scan. */
  hasLines: boolean;
  /**
   * Initial cached findings from encounters.ddi_findings (avoids a
   * needless re-scan on page load).
   */
  initial?: DdiPayload | null;
};

export function DdiBanner({
  encounterId,
  linesSignature,
  hasLines,
  initial,
}: DdiBannerProps) {
  const [payload, setPayload] = useState<DdiPayload | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  // v6.0 Phase 3 — TracePanel state. The route always streams NDJSON.
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [traceTotalMs, setTraceTotalMs] = useState<number | undefined>(undefined);
  const [traceId, setTraceId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSigRef = useRef<string>(linesSignature);
  // Skip first-mount auto-scan if we already have initial findings for
  // this exact signature (page reload). Re-scan whenever sig changes.
  const initialSigRef = useRef<string>(linesSignature);
  const initialPresent = useRef<boolean>(!!initial);

  const runScan = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // Reset trace state for every fire.
    setTraceEvents([]);
    setTraceTotalMs(undefined);
    setTraceId(null);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/ddi-scan`, {
        method: 'POST',
        headers: { Accept: 'application/x-ndjson' },
      });
      const tid = res.headers.get('X-Trace-Id');
      if (tid) setTraceId(tid);
      // Route always streams NDJSON.
      type ResultBody = DdiPayload & { ok?: boolean };
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
      const j = resultRef.current;
      if (j && (j.status === 'ok' || j.status === 'failed')) {
        setPayload(j);
      }
    } catch (e) {
      setPayload({
        status: 'failed',
        error: e instanceof Error ? e.message : 'network_error',
        scanned_at: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, encounterId]);

  // Debounce re-scan on signature change.
  useEffect(() => {
    if (!hasLines) return;
    // First mount: if initial cached findings match the current
    // signature, don't re-scan. Otherwise scan immediately on first
    // sig change.
    if (
      initialPresent.current &&
      linesSignature === initialSigRef.current
    ) {
      initialPresent.current = false;
      return;
    }
    if (linesSignature === lastSigRef.current) return;
    lastSigRef.current = linesSignature;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runScan();
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [linesSignature, hasLines, runScan]);

  // Filter to renderable findings (drop 'low'; render them as a small
  // chip in the rationale-row instead).
  const displayed = useMemo(() => {
    if (!payload || payload.status !== 'ok') return [];
    return payload.findings.filter((f) => f.severity !== 'low');
  }, [payload]);

  const lowCount = useMemo(() => {
    if (!payload || payload.status !== 'ok') return 0;
    return payload.findings.filter((f) => f.severity === 'low').length;
  }, [payload]);

  if (!hasLines) return null;

  return (
    <div className="space-y-2">
      {(traceEvents.length > 0 || (busy && !payload)) && (
        <div>
          <TracePanel
            events={traceEvents}
            totalMs={traceTotalMs}
            traceId={traceId}
            surface="ddi-scan"
          />
        </div>
      )}

      {payload?.status === 'failed' && (
        <div className="flex items-center justify-between rounded-md border border-even-ink-200 bg-even-ink-50 px-3 py-2 text-[11px] text-even-ink-600">
          <span>DDI check unavailable. Doctor&apos;s judgment applies.</span>
          <button
            type="button"
            onClick={() => void runScan()}
            className="text-even-blue-700 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {displayed.length > 0 && (
        <ul className="space-y-1.5">
          {displayed.map((f, idx) => (
            <li key={idx}>
              <Finding f={f} />
            </li>
          ))}
        </ul>
      )}

      {payload?.status === 'ok' && (
        <div className="flex items-baseline justify-between gap-2 text-[10px] text-even-ink-400">
          <span>
            {displayed.length === 0 && lowCount === 0
              ? '✓ No significant interactions flagged'
              : displayed.length === 0
              ? `✓ ${lowCount} minor flag${lowCount === 1 ? '' : 's'} noted`
              : `${displayed.length} active warning${displayed.length === 1 ? '' : 's'}${lowCount > 0 ? ` · ${lowCount} minor` : ''}`}
            {' · '}
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={busy}
              className="underline hover:text-even-navy disabled:opacity-50"
            >
              {busy ? 'Rescanning…' : 'Rescan'}
            </button>
          </span>
          {payload.status === 'ok' && (
            <span>
              ✨ {new Date(payload.scanned_at).toLocaleTimeString('en-IN')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Finding({ f }: { f: DdiFinding }) {
  const isSevere = f.severity === 'severe';
  const isHigh = f.severity === 'high';
  const isModerate = f.severity === 'moderate';
  const tone = isSevere
    ? 'border-even-pink-400 bg-even-pink-50 text-even-pink-900'
    : isHigh
    ? 'border-even-pink-300 bg-even-pink-50/70 text-even-pink-900'
    : isModerate
    ? 'border-amber-300 bg-amber-50 text-amber-900'
    : 'border-even-ink-200 bg-white text-even-ink-700';

  const sevLabel = isSevere
    ? 'SEVERE — do not prescribe together'
    : isHigh
    ? 'HIGH'
    : isModerate
    ? 'MODERATE'
    : 'LOW';

  return (
    <div className={`rounded-md border px-3 py-2 text-[11px] ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-[10px]">
          {sevLabel}
        </span>
        <span className="font-mono text-[10px] opacity-80">
          {f.pair.join('  ⇄  ')}
        </span>
      </div>
      <p className="mt-0.5">{f.rationale}</p>
      {f.recommendation && (
        <p className="mt-1 italic opacity-90">→ {f.recommendation}</p>
      )}
    </div>
  );
}
