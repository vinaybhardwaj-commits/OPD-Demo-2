'use client';

/**
 * <DrugTypeahead /> — drug-master search combobox.
 *
 * Behavior:
 *   - Debounced search (200ms) against /api/drugs/search
 *   - Keyboard: ↑ ↓ to navigate, Enter to select, Escape to close
 *   - Mouse: hover changes active index, click selects
 *   - Match highlight: the query substring is bolded inside the brand
 *     and generic names
 *   - Loading + empty-result states inline
 *
 * Visual encoding:
 *   - Schedule chips: OTC/H neutral, H1 amber-pink (register entry),
 *     X deeper pink (narcotic / psychotropic)
 *   - ⚠ high-risk badge: ISMP high-alert medication
 *   - LASA alternates rendered as a tertiary line so doctors see
 *     look-alike/sound-alike alternates while typing
 *
 * The component is reusable — Sprint 4's prescription-compose row
 * will drop it in with a different `onSelect` callback. The demo at
 * /dashboard/drugs shows it standalone.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { DrugSearchResult, DrugSearchResponse } from '@/lib/types';

export type DrugTypeaheadProps = {
  onSelect: (drug: DrugSearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
  clearOnSelect?: boolean;
  /** Max results shown — caps API limit and visible list. Defaults to 8. */
  limit?: number;
};

export function DrugTypeahead({
  onSelect,
  placeholder = 'Type a brand or generic name…',
  autoFocus = false,
  clearOnSelect = true,
  limit = 8,
}: DrugTypeaheadProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DrugSearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setActiveIdx(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/drugs/search?q=${encodeURIComponent(q)}&limit=${limit}`,
          { signal: ctrl.signal },
        );
        const j = (await res.json()) as DrugSearchResponse;
        if (ctrl.signal.aborted) return;
        setResults(j.results ?? []);
        setLatencyMs(j.latency_ms ?? null);
        setActiveIdx(0);
        setOpen(true);
      } catch (e) {
        if ((e as { name?: string }).name !== 'AbortError') {
          setResults([]);
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, limit]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIdx(0);
  }, []);

  const pick = useCallback(
    (drug: DrugSearchResult) => {
      onSelect(drug);
      if (clearOnSelect) {
        setQuery('');
        setResults([]);
      }
      close();
      inputRef.current?.focus();
    },
    [onSelect, clearOnSelect, close],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (results.length > 0) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (results[activeIdx]) {
        e.preventDefault();
        pick(results[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      close();
      inputRef.current?.blur();
    }
  }

  const showPanel = open && (loading || results.length > 0 || query.trim().length >= 2);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-activedescendant={
          results[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Delay close so click-on-result can register first
          setTimeout(close, 120);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-even-ink-200 bg-white px-4 py-3 text-sm text-even-navy placeholder-even-ink-300 shadow-sm focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
      />

      {showPanel && (
        <div
          role="listbox"
          id={listboxId}
          className="absolute left-0 right-0 z-10 mt-2 max-h-[26rem] overflow-y-auto rounded-xl border border-even-ink-200 bg-white shadow-lg"
        >
          {loading && results.length === 0 && (
            <div className="px-4 py-3 text-xs text-even-ink-500">
              Searching…
            </div>
          )}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div className="px-4 py-3 text-xs text-even-ink-500">
              No matches for{' '}
              <span className="font-mono text-even-navy">{query}</span>
            </div>
          )}
          {results.map((r, i) => (
            <DrugOption
              key={r.item_code}
              id={`${listboxId}-opt-${i}`}
              drug={r}
              query={query}
              active={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                // mousedown (not click) so onBlur's timeout doesn't beat it
                e.preventDefault();
                pick(r);
              }}
            />
          ))}
          {results.length > 0 && latencyMs != null && (
            <div className="border-t border-even-ink-100 px-4 py-1.5 text-[10px] font-mono text-even-ink-400">
              {results.length} results · {latencyMs} ms
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DrugOption({
  id,
  drug,
  query,
  active,
  onMouseEnter,
  onMouseDown,
}: {
  id: string;
  drug: DrugSearchResult;
  query: string;
  active: boolean;
  onMouseEnter: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="option"
      id={id}
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onMouseDown={onMouseDown}
      className={`cursor-pointer border-b border-even-ink-100 px-4 py-2.5 last:border-b-0 ${
        active ? 'bg-even-blue-50' : 'bg-white'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-even-navy">
            <Highlighted text={drug.brand_name} q={query} />
            {drug.strength && (
              <span className="ml-2 text-xs font-normal text-even-ink-500">
                {drug.strength}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-even-ink-600">
            <Highlighted text={drug.generic_name} q={query} />
            <span className="text-even-ink-400"> · {drug.dosage_form}</span>
          </div>
          {drug.lasa_alternates.length > 0 && (
            <div className="mt-0.5 truncate text-[11px] text-even-ink-400">
              LASA: {drug.lasa_alternates.join(', ')}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ScheduleChip schedule={drug.schedule_dc} />
          {drug.is_high_risk && <HighRiskBadge />}
        </div>
      </div>
    </div>
  );
}

function Highlighted({ text, q }: { text: string; q: string }) {
  const query = q.trim();
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const target = query.toLowerCase();
  const idx = lower.indexOf(target);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-even-blue-700">
        {text.slice(idx, idx + target.length)}
      </span>
      {text.slice(idx + target.length)}
    </>
  );
}

function ScheduleChip({ schedule }: { schedule: DrugSearchResult['schedule_dc'] }) {
  const tone =
    schedule === 'X'
      ? 'bg-even-pink-200 text-even-pink-900'
      : schedule === 'H1'
      ? 'bg-even-pink-100 text-even-pink-800'
      : schedule === 'H'
      ? 'bg-even-ink-100 text-even-ink-700'
      : 'bg-even-ink-50 text-even-ink-500'; // OTC
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {schedule}
    </span>
  );
}

function HighRiskBadge() {
  return (
    <span
      title="ISMP high-alert medication"
      className="inline-flex items-center gap-1 rounded-full bg-even-pink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-even-pink-800"
    >
      <span aria-hidden>⚠</span> High risk
    </span>
  );
}
