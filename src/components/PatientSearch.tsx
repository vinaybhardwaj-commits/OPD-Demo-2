/**
 * <PatientSearch> — global patient autocomplete (PH.5.2).
 *
 * Sits in the dashboard header. Debounced GET to /api/patients/search
 * after 2 chars. Up arrow / down arrow / Enter to navigate. Click on a
 * match → router.push('/patients/[id]'). Esc closes the dropdown.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Match = {
  id: string;
  mrn: string;
  name: string;
  age_years: number;
  sex: 'M' | 'F' | 'O' | null;
};

export function PatientSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const search = useCallback(async (query: string) => {
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/patients/search?q=${encodeURIComponent(query)}`,
        { signal: ac.signal, cache: 'no-store' },
      );
      if (!r.ok) {
        setMatches([]);
        return;
      }
      const j = (await r.json()) as { ok?: boolean; matches?: Match[] };
      setMatches(j.matches ?? []);
      setActive(0);
    } catch {
      // aborted or network — leave previous list
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setMatches([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      search(q.trim());
    }, 150);
  }, [q, search]);

  // Click outside to close
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(m: Match) {
    setOpen(false);
    setQ('');
    setMatches([]);
    router.push(`/patients/${m.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) {
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((cur) => Math.min(cur + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((cur) => Math.max(cur - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-sm">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search patient by name or MRN…"
        className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-1.5 text-sm text-even-navy placeholder-even-ink-400 focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
        aria-label="Search patients"
        aria-expanded={open && matches.length > 0}
        autoComplete="off"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-even-ink-200 bg-white shadow-lg">
          {busy && matches.length === 0 && (
            <div className="px-3 py-2 text-xs text-even-ink-500">Searching…</div>
          )}
          {!busy && matches.length === 0 && (
            <div className="px-3 py-2 text-xs text-even-ink-500">
              No matches.
            </div>
          )}
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(m)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                i === active ? 'bg-even-blue-50' : 'bg-white hover:bg-even-ink-50'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-even-navy">
                  {m.name}
                </span>
                <span className="block text-[10px] uppercase tracking-wider text-even-ink-500">
                  {m.age_years}
                  {m.sex ?? ''} · <span className="font-mono">{m.mrn}</span>
                </span>
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-even-ink-400">
                Open →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
