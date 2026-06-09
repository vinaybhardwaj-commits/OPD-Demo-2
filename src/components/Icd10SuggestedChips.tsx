'use client';

/**
 * <Icd10SuggestedChips /> — v3.8 passive Qwen ICD-10 chips from
 * encounter context. Auto-fires on mount + when assessment text changes
 * server-side (context_hash recomputes).
 *
 * Renders above the Icd10Typeahead. Each chip clickable to add as
 * an ICD-10 code. Failure-silent.
 *
 * v6.0 Phase 3 — consumes NDJSON when the server-side cache misses
 * and renders <TracePanel surface="icd10-suggest" /> live. The cache-hit
 * path stays a plain JSON read (no panel needed, <100ms response).
 */
import { useEffect, useState } from 'react';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';

type Suggestion = { code: string; label: string; rationale: string; confidence: number };
type Payload =
  | { status: 'ok'; findings: Suggestion[]; generated_at: string; latency_ms: number }
  | { status: 'failed'; error: string; generated_at: string };

export function Icd10SuggestedChips({
  encounterId,
  alreadyAddedCodes,
  onAdd,
}: {
  encounterId: string;
  alreadyAddedCodes: Set<string>;
  onAdd: (item: { code: string; label: string }) => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [cached, setCached] = useState(false);

  // v6.0 Phase 3 — TracePanel state. Populated only on NDJSON cache-miss.
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [traceTotalMs, setTraceTotalMs] = useState<number | undefined>(undefined);
  const [traceId, setTraceId] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/encounters/${encounterId}/icd10-suggest`, {
          headers: { Accept: 'application/x-ndjson' },
        });
        if (!res.ok) {
          if (!cancel) setLoading(false);
          return;
        }
        const tid = res.headers.get('X-Trace-Id');
        if (tid && !cancel) setTraceId(tid);
        const ct = res.headers.get('content-type') ?? '';

        if (ct.includes('application/x-ndjson')) {
          // Streaming path — qwen is firing. Render the trace panel.
          type ResultBody = { ok?: boolean; cached?: boolean; payload?: Payload };
          const resultRef: { current: ResultBody | null } = { current: null };
          await consumeNdjson(res, (ev) => {
            if (cancel) return;
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
          if (cancel) return;
          const body = resultRef.current;
          if (body && body.ok && body.payload) {
            setPayload(body.payload);
            setCached(Boolean(body.cached));
          }
        } else {
          // Plain JSON cache-hit path.
          const json = await res.json();
          if (!cancel && json.ok) {
            setPayload(json.payload);
            setCached(json.cached);
          }
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [encounterId]);

  if (loading) {
    // Show the TracePanel only if we've started receiving NDJSON events
    // (cache-miss path). Otherwise show the legacy italic line — the
    // cache hit lands in <100ms and the loader disappears.
    if (traceEvents.length > 0) {
      return (
        <div>
          <TracePanel
            events={traceEvents}
            totalMs={traceTotalMs}
            traceId={traceId}
            surface="icd10-suggest"
          />
        </div>
      );
    }
    return (
      <p className="text-[11px] italic text-violet-700">
        Reading the encounter context for ICD-10 suggestions…
      </p>
    );
  }

  if (!payload || payload.status === 'failed') return null;
  if (payload.findings.length === 0) return null;

  // v4.0.6 — flat chip wall, no bordered card (matches Section 1 pattern).
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
        <span aria-hidden>✨</span>
        AI suggestions
      </span>
      {cached && <span className="text-[10px] text-even-ink-400">cached</span>}
      {payload.findings.map((f) => {
        const added = alreadyAddedCodes.has(f.code);
        return (
          <button
            key={f.code}
            type="button"
            onClick={() => !added && onAdd({ code: f.code, label: f.label })}
            disabled={added}
            title={`${f.label}${f.rationale ? ' · ' + f.rationale : ''} · ${(f.confidence * 100).toFixed(0)}%`}
            className={`inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1 text-xs transition ${
              added
                ? 'cursor-default bg-even-ink-50 text-even-ink-400 ring-1 ring-even-ink-200'
                : 'bg-violet-50 text-violet-900 ring-1 ring-violet-300 hover:ring-violet-500'
            }`}
          >
            <span>{added ? '✓' : '+'}</span>
            <span className="font-mono font-semibold">{f.code}</span>
            <span className="truncate max-w-[12rem] text-even-ink-600">{f.label}</span>
            <span className="text-[10px] text-violet-700">{(f.confidence * 100).toFixed(0)}%</span>
          </button>
        );
      })}
    </div>
  );
}
