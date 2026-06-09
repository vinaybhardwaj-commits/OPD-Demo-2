'use client';

/**
 * <AskTheChartRail /> — v3.10.4
 *
 * Persistent right-rail sidebar in the encounter editor. Doctor asks
 * any clinical question; server-side endpoint auto-prefixes full
 * encounter context (age + sex + comorbidities + allergies + cc +
 * assessment + active meds) then HyDE → retrieve → answer with
 * citations from the shared clinical KB.
 *
 * UX:
 *  - Textarea + Ask button at top.
 *  - Conversation history below (session-only; not persisted in v1).
 *  - Each Q&A: question, then grounded answer with inline [N] markers
 *    and a collapsible "Sources" list per answer. Same citation
 *    pattern as DdxOnDemand (v3.10.1) for consistency.
 *  - Loading state shows the in-flight question + a spinner.
 *  - 'Ask with deep mode' (qwen2.5:14b) checkbox for tough questions.
 *  - Soft-fail: KB unreachable → friendly error in the Q&A pair.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type Citation = {
  n: number;
  source: string;
  book: string;
  chapter: string | null;
  section: string | null;
  page: number | null;
  similarity: number;
};

type QAPair = {
  id: string;
  question: string;
  answer?: string;
  citations?: Citation[];
  error?: string;
  partial_chunks?: Citation[];
  latency_ms?: { total: number };
  model?: string;
  deep: boolean;
  asked_at: string;
};

export function AskTheChartRail({
  encounterId,
  readOnly,
}: {
  encounterId: string;
  readOnly?: boolean;
}) {
  // v4.0.8 — pin persists in localStorage so the doctor's choice
  // sticks across reloads and across encounters.
  const PIN_KEY = 'enc:ask-chart:pinned';
  const [pinned, setPinned] = useState<boolean>(true);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PIN_KEY);
      if (raw === '0') setPinned(false);
      else if (raw === '1') setPinned(true);
    } catch { /* localStorage blocked */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(PIN_KEY, pinned ? '1' : '0'); } catch { /* ignore */ }
  }, [pinned]);

  const [draft, setDraft] = useState('');
  const [deep, setDeep] = useState(false);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<QAPair[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const ask = useCallback(async () => {
    const q = draft.trim();
    if (q.length < 3 || pending) return;
    const pairId = crypto.randomUUID();
    const pair: QAPair = { id: pairId, question: q, deep, asked_at: new Date().toISOString() };
    setHistory((cur) => [pair, ...cur]);
    setDraft('');
    setPending(true);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, deep }),
      });
      const json = await res.json();
      setHistory((cur) => cur.map((p) =>
        p.id !== pairId ? p : {
          ...p,
          answer: json.ok ? json.answer : undefined,
          citations: json.ok ? json.citations : undefined,
          partial_chunks: !json.ok ? json.partial_chunks : undefined,
          error: json.ok ? undefined : (json.detail ?? json.error ?? 'ask_failed'),
          latency_ms: json.latency_ms,
          model: json.model,
        },
      ));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setHistory((cur) => cur.map((p) =>
        p.id !== pairId ? p : { ...p, error: msg.slice(0, 200) },
      ));
    } finally {
      setPending(false);
      taRef.current?.focus();
    }
  }, [draft, deep, pending, encounterId]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void ask();
    }
  };

  return (
    // v4.0.8 — outer wrapper handles sticky/relative based on pin state.
    <div className={pinned ? 'lg:sticky lg:top-6' : ''}>
    <aside
      className="rounded-xl border border-violet-200 bg-violet-50/30"
      aria-label="Ask the chart"
    >
      <div className="border-b border-violet-100 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-800">
            ✨ Ask the chart
          </h2>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-violet-500">v3.10.4 · KB-grounded</span>
            <button
              type="button"
              onClick={() => setPinned((v) => !v)}
              aria-label={pinned ? 'Unpin side panel' : 'Pin side panel'}
              title={pinned ? 'Unpin (let it scroll with the page)' : 'Pin (keep visible while scrolling)'}
              className={`rounded-md px-1.5 py-0.5 text-[10px] transition ${
                pinned
                  ? 'bg-violet-600 text-white hover:bg-violet-700'
                  : 'bg-white text-violet-700 ring-1 ring-violet-300 hover:bg-violet-50'
              }`}
            >
              {pinned ? '📌' : '📍'}
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-[10px] text-even-ink-500">
          Cited answers using this patient&rsquo;s full encounter context.
        </p>
      </div>

      {!readOnly && (
        <div className="px-3 py-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="What's the target HbA1c for elderly diabetics with CKD stage 3b?"
            rows={3}
            disabled={pending}
            className="w-full resize-none rounded-md border border-violet-200 bg-white px-2 py-1.5 text-xs text-even-ink-800 placeholder:text-even-ink-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <label className="inline-flex items-center gap-1 text-[10px] text-even-ink-500">
              <input
                type="checkbox"
                checked={deep}
                onChange={(e) => setDeep(e.target.checked)}
                disabled={pending}
                className="h-3 w-3"
              />
              Deep mode
            </label>
            <button
              type="button"
              onClick={() => void ask()}
              disabled={pending || draft.trim().length < 3}
              className="rounded-md bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? 'Asking…' : 'Ask ⌘↩'}
            </button>
          </div>
        </div>
      )}

      <div className="max-h-[60vh] overflow-y-auto px-3 pb-3">
        {history.length === 0 ? (
          <div className="rounded-md border border-dashed border-violet-200 bg-white/40 p-3 text-center text-[10px] italic text-even-ink-500">
            No questions yet. Ask anything; the answer arrives cited.
          </div>
        ) : (
          <ul className="space-y-3">
            {history.map((p) => (
              <QAItem key={p.id} pair={p} pending={pending && !p.answer && !p.error} />
            ))}
          </ul>
        )}
      </div>
    </aside>
    </div>
  );
}

function QAItem({ pair, pending }: { pair: QAPair; pending: boolean }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [openSnippet, setOpenSnippet] = useState<number | null>(null);
  const showCitations = (pair.citations?.length ?? 0) > 0;
  return (
    <li className="rounded-md border border-violet-100 bg-white p-2 text-xs">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
        Q · {pair.deep && <span className="text-amber-700">deep</span>}
      </div>
      <div className="mb-2 italic text-even-ink-700">{pair.question}</div>
      {pending && (
        <div className="text-[10px] italic text-violet-500">
          retrieving + grounding…
          {pair.deep ? ' (~15s)' : ' (~5s)'}
        </div>
      )}
      {!pending && pair.error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700">
          {pair.error}
        </div>
      )}
      {!pending && pair.answer && (
        <>
          <div className="text-even-ink-800 whitespace-pre-wrap leading-relaxed">
            <AnswerWithCitations text={pair.answer} citations={pair.citations ?? []} onCitationClick={(n) => setOpenSnippet(n)} />
          </div>
          {showCitations && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setSourcesOpen((o) => !o)}
                className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100"
              >
                {sourcesOpen ? '▾' : '▸'} Sources · {pair.citations!.length}
              </button>
              {sourcesOpen && (
                <ul className="mt-1 space-y-0.5 border-l border-violet-200 pl-2">
                  {pair.citations!.map((c) => (
                    <li key={c.n} className="text-[10px] text-violet-800">
                      <button
                        type="button"
                        onClick={() => setOpenSnippet(c.n === openSnippet ? null : c.n)}
                        className="block w-full text-left hover:underline"
                      >
                        <span className="font-mono mr-1 text-violet-500">[{c.n}]</span>
                        <span className="font-medium">{c.book}</span>
                        {c.chapter && <span className="text-even-ink-600"> — {c.chapter}</span>}
                        {c.section && <span className="text-even-ink-500"> › {c.section}</span>}
                        {c.page && <span className="font-mono text-even-ink-400"> p{c.page}</span>}
                        <span className="ml-1 text-[8px] uppercase text-even-ink-400">{c.source}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="mt-1 text-[9px] text-even-ink-400">
            {pair.model && <span>{pair.model}</span>}
            {pair.latency_ms?.total !== undefined && <span> · {Math.round(pair.latency_ms.total)}ms</span>}
            {!showCitations && <span> · no KB chunks matched</span>}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Parse `[N]` markers in answer text and render them as small clickable
 * chips. Unknown N renders as plain text (no broken chips).
 */
function AnswerWithCitations({
  text,
  citations,
  onCitationClick,
}: {
  text: string;
  citations: Citation[];
  onCitationClick: (n: number) => void;
}) {
  const validNumbers = new Set(citations.map((c) => c.n));
  const parts: Array<{ kind: 'text' | 'cite'; value: string | number }> = [];
  const regex = /\[(\d+)\]/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ kind: 'text', value: text.slice(lastIdx, m.index) });
    const n = parseInt(m[1], 10);
    if (validNumbers.has(n)) parts.push({ kind: 'cite', value: n });
    else parts.push({ kind: 'text', value: m[0] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push({ kind: 'text', value: text.slice(lastIdx) });
  if (parts.length === 0) parts.push({ kind: 'text', value: text });
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.value as string}</span>
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => onCitationClick(p.value as number)}
            className="ml-0.5 inline-flex items-baseline rounded bg-violet-100 px-1 py-0 align-baseline text-[9px] font-mono font-semibold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-200"
            title="Click to view source"
          >
            [{p.value}]
          </button>
        ),
      )}
    </>
  );
}
