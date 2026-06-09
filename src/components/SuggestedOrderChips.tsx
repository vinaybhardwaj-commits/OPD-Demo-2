'use client';

/**
 * <SuggestedOrderChips /> — v3.5a passive AI context chips.
 *
 * Auto-fetches Qwen-derived suggestions from the encounter context on
 * mount (or when context_hash changes server-side). Renders chips above
 * the strip's search input. Click chip → onAdd(row). "Accept all ≥ 0.75"
 * bulk-adds.
 *
 * Failure-silent per PRD: no chips, no toast, just hides.
 */
import { useEffect, useState } from 'react';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';
import type { CatalogRow } from './DiagnosticSearch';

type Suggestion = {
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: CatalogRow['modality'];
  rationale: string;
  confidence: number;
  /** v3.10.2 — KB chunk numbers (1-based) that ground this suggestion. */
  citation_numbers?: number[];
};

type CitationChunk = {
  n: number;
  source: string;
  book: string;
  chapter: string | null;
  section: string | null;
  page: number | null;
  text_excerpt: string;
};

type Payload =
  | {
      status: 'ok';
      findings: Suggestion[];
      citations?: CitationChunk[];
      generated_at: string;
      latency_ms: number;
      kb_latency_ms?: number;
    }
  | { status: 'failed'; error: string; generated_at: string };

const MODALITY_BADGE: Record<CatalogRow['modality'], string> = {
  lab: 'bg-blue-50 text-blue-700 border-blue-200',
  imaging: 'bg-violet-50 text-violet-700 border-violet-200',
  cardiology: 'bg-rose-50 text-rose-700 border-rose-200',
  procedure: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function SuggestedOrderChips({
  encounterId,
  onAdd,
  alreadyInCart,
}: {
  encounterId: string;
  onAdd: (row: { service_code: string; display_name: string; sub_department: string; modality: CatalogRow['modality'] }) => void;
  alreadyInCart: Set<string>;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [cached, setCached] = useState(false);

  // v6.0 Phase 2D — TracePanel state. Renders only when the server
  // returns NDJSON (i.e. the cache missed and qwen had to fire).
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [traceTotalMs, setTraceTotalMs] = useState<number | undefined>(undefined);
  const [traceId, setTraceId] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/encounters/${encounterId}/suggest-orders`, {
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
          if (body && body.ok) {
            setPayload(body.payload ?? null);
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
    // (i.e. server isn't serving from cache). Otherwise show the legacy
    // italic line — the cache hit will land in <100ms and the loader
    // disappears.
    if (traceEvents.length > 0) {
      return (
        <div>
          <TracePanel
            events={traceEvents}
            totalMs={traceTotalMs}
            traceId={traceId}
            surface="suggest-orders"
          />
        </div>
      );
    }
    return (
      <div className="rounded-md border border-even-blue-100 bg-even-blue-50/30 px-3 py-2 text-[11px] italic text-even-blue-700">
        Suggesting orders from this encounter&apos;s context…
      </div>
    );
  }

  if (!payload || payload.status === 'failed') {
    return null; // Silent failure per PRD §6.A
  }

  if (payload.findings.length === 0) return null;

  const eligibleForAcceptAll = payload.findings.filter(
    (f) => f.confidence >= 0.75 && !alreadyInCart.has(f.service_code),
  );

  return (
    <div className="rounded-md border border-even-blue-100 bg-even-blue-50/30 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-even-blue-700">
            ✨ Suggested orders
          </span>
          {cached && <span className="text-[10px] text-even-ink-400">cached</span>}
        </div>
        {eligibleForAcceptAll.length > 0 && (
          <button
            type="button"
            onClick={() => eligibleForAcceptAll.forEach((f) => onAdd(f))}
            className="rounded-md bg-even-blue px-2 py-0.5 text-[11px] font-medium text-white hover:bg-even-blue-700"
          >
            Accept all ≥ 0.75 ({eligibleForAcceptAll.length})
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {payload.findings.map((f) => (
          <SuggestedOrderChip
            key={f.service_code}
            finding={f}
            inCart={alreadyInCart.has(f.service_code)}
            citations={(payload.status === 'ok' ? payload.citations : undefined) ?? []}
            onAdd={onAdd}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * v3.10.2 — single suggestion chip with KB citation reveal.
 * - The chip itself still adds to cart on click.
 * - If the suggestion has citation_numbers, a small violet "i" button
 *   appears beside it; clicking it reveals a tiny citation list under
 *   the chip row.
 */
function SuggestedOrderChip({
  finding,
  inCart,
  citations,
  onAdd,
}: {
  finding: Suggestion;
  inCart: boolean;
  citations: CitationChunk[];
  onAdd: (s: Suggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const cits = finding.citation_numbers ?? [];
  const myCitations = citations.filter((c) => cits.includes(c.n));
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-baseline gap-1">
        <button
          type="button"
          onClick={() => !inCart && onAdd(finding)}
          disabled={inCart}
          title={`${finding.rationale} · confidence ${(finding.confidence * 100).toFixed(0)}%`}
          className={`inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
            inCart
              ? 'cursor-default border-even-ink-200 bg-even-ink-100 text-even-ink-400'
              : 'border-even-blue-200 bg-white text-even-navy hover:bg-even-blue-50'
          } ${MODALITY_BADGE[finding.modality]}`}
        >
          <span>{inCart ? '✓' : '+'}</span>
          <span className="font-medium">{finding.display_name}</span>
          <span className="text-[10px] opacity-70">{(finding.confidence * 100).toFixed(0)}%</span>
        </button>
        {myCitations.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[9px] font-semibold ring-1 ${
              open
                ? 'bg-violet-200 text-violet-900 ring-violet-300'
                : 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100'
            }`}
            title={`${myCitations.length} clinical reference${myCitations.length === 1 ? '' : 's'}`}
          >
            {open ? '▾' : 'i'}{myCitations.length > 1 ? `·${myCitations.length}` : ''}
          </button>
        )}
      </span>
      {open && myCitations.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-l border-violet-200 pl-2">
          {myCitations.map((c) => (
            <li key={c.n} className="text-[10px] text-violet-800">
              <span className="font-mono mr-1 text-violet-500">[{c.n}]</span>
              <span className="font-medium">{c.book}</span>
              {c.chapter && <span className="text-even-ink-600"> — {c.chapter}</span>}
              {c.section && <span className="text-even-ink-500"> › {c.section}</span>}
              {c.page && <span className="font-mono text-even-ink-400"> p{c.page}</span>}
              <div className="mt-0.5 italic text-even-ink-600">{c.text_excerpt.slice(0, 280)}{c.text_excerpt.length > 280 ? '…' : ''}</div>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
