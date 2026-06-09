'use client';

/**
 * <KbEvidenceReveal /> — v3.10.3
 *
 * Small reusable "i" button that lazy-loads KB evidence chunks for a
 * single query string (an ICD-10 label, a comorbidity name, etc.).
 *
 * On first click: POSTs to /api/kb/evidence with the query, caches
 * the result, reveals a tiny list of citations with snippets. Second
 * click collapses.
 *
 * Used by:
 *  - Icd10Typeahead Qwen suggestion rows (v3.10.3)
 *  - ComorbidityBand demographics-suggest chips (v3.10.3)
 *  - ComorbidityEditModal history-suggest list (v3.10.3)
 *
 * Soft-fails: KB unreachable → click does nothing visible (no error
 * toast — doctor wasn't promised this works).
 */
import { useCallback, useState } from 'react';

type EvidenceChunk = {
  source: string;
  book: string;
  chapter: string | null;
  section: string | null;
  page: number | null;
  text_excerpt: string;
};

export function KbEvidenceReveal({
  query,
  topK = 2,
  sources,
  ariaLabel,
}: {
  /** What to search for, e.g. 'E11.65 Type 2 diabetes mellitus with hyperglycemia'. */
  query: string;
  topK?: 1 | 2 | 3;
  sources?: string[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<EvidenceChunk[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (chunks !== null) return; // cached
    setLoading(true);
    try {
      const res = await fetch('/api/kb/evidence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, topK, sources }),
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.chunks)) {
        setChunks(json.chunks);
      } else {
        setChunks([]);
      }
    } catch {
      setChunks([]);
    } finally {
      setLoading(false);
    }
  }, [open, chunks, query, topK, sources]);

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={toggle}
        aria-label={ariaLabel ?? 'View evidence'}
        title={ariaLabel ?? 'View clinical evidence'}
        className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-semibold ring-1 ${
          open
            ? 'bg-violet-200 text-violet-900 ring-violet-300'
            : 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100'
        }`}
      >
        {loading ? '…' : open ? '▾' : 'i'}
      </button>
      {open && (
        <div className="mt-1 max-w-[26rem] rounded-md border border-violet-200 bg-violet-50/40 px-2 py-1.5 text-[10px]">
          {loading && <span className="italic text-violet-500">Loading evidence…</span>}
          {!loading && chunks && chunks.length === 0 && (
            <span className="italic text-even-ink-500">No KB match found for this concept.</span>
          )}
          {!loading && chunks && chunks.length > 0 && (
            <ul className="space-y-1">
              {chunks.map((c, i) => (
                <li key={i} className="text-violet-800">
                  <div className="font-medium">
                    {c.book}
                    {c.chapter && <span className="text-even-ink-600"> — {c.chapter}</span>}
                    {c.section && <span className="text-even-ink-500"> › {c.section}</span>}
                    {c.page && <span className="font-mono text-even-ink-400"> p{c.page}</span>}
                    <span className="ml-1 text-[8px] uppercase text-even-ink-400">{c.source}</span>
                  </div>
                  <div className="mt-0.5 italic text-even-ink-700">{c.text_excerpt}{c.text_excerpt.length >= 360 ? '…' : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
