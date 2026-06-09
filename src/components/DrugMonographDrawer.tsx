'use client';

/**
 * <DrugMonographDrawer /> — v3.10.5
 *
 * Slides in from the right on click of the per-DrugRow 'i' button.
 * Pure OpenFDA labels — indication + key warnings/contraindications.
 * No LLM call; ~50-200ms fetch latency typical.
 *
 * Soft-fail: empty sections render with "no FDA label match" notice.
 */
import { useCallback, useEffect, useState } from 'react';

type MonographChunk = {
  book: string;
  chapter: string | null;
  section: string | null;
  chunk_type: string | null;
  text: string;
};

type Monograph = {
  drug_name: string;
  indication: MonographChunk[];
  warnings: MonographChunk[];
};

export function DrugMonographDrawer({
  drugName,
  open,
  onClose,
}: {
  drugName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<Monograph | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Lazy fetch on first open. Cache stays until drugName changes.
  useEffect(() => {
    if (!open) return;
    if (data && data.drug_name === drugName) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const res = await fetch(`/api/drugs/${encodeURIComponent(drugName)}/monograph`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setData(json.monograph as Monograph | null);
        } else {
          setErr(json.detail ?? json.error ?? 'load_failed');
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, drugName, data]);

  const closeOnEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', closeOnEsc);
    return () => window.removeEventListener('keydown', closeOnEsc);
  }, [open, closeOnEsc]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-baseline justify-between border-b border-even-ink-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-even-navy">
              💊 {drugName}
            </h3>
            <p className="mt-0.5 text-[10px] text-even-ink-500">
              OpenFDA monograph · indications + warnings only
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-even-ink-500 hover:bg-even-ink-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="text-xs italic text-even-ink-500">Loading FDA label…</div>
          )}
          {!loading && err && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {err}
            </div>
          )}
          {!loading && !err && data === null && (
            <div className="rounded-md border border-dashed border-even-ink-200 bg-even-ink-50 px-3 py-2 text-xs italic text-even-ink-500">
              No FDA label match for &ldquo;{drugName}&rdquo;. This drug may not be in
              the OpenFDA corpus, or the name may need to be normalised to
              the generic/INN.
            </div>
          )}
          {!loading && data && (
            <div className="space-y-4">
              <MonographSection
                title="Indication"
                tone="emerald"
                chunks={data.indication}
                emptyHint="No indication chunk found."
              />
              <MonographSection
                title="Warnings / Contraindications"
                tone="rose"
                chunks={data.warnings}
                emptyHint="No warning/contraindication chunk found."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonographSection({
  title,
  tone,
  chunks,
  emptyHint,
}: {
  title: string;
  tone: 'emerald' | 'rose';
  chunks: MonographChunk[];
  emptyHint: string;
}) {
  const headerCls = tone === 'emerald'
    ? 'text-emerald-700 border-emerald-200 bg-emerald-50/50'
    : 'text-rose-700 border-rose-200 bg-rose-50/50';
  return (
    <section>
      <div className={`mb-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${headerCls}`}>
        {title}
      </div>
      {chunks.length === 0 ? (
        <div className="text-[11px] italic text-even-ink-500">{emptyHint}</div>
      ) : (
        <ul className="space-y-2">
          {chunks.map((c, i) => (
            <li key={i} className="rounded-md border border-even-ink-100 bg-white p-2 text-[11px]">
              <div className="mb-1 flex flex-wrap items-baseline gap-1 text-[9px] text-even-ink-500">
                <span className="font-mono uppercase">{c.chunk_type ?? '—'}</span>
                {c.section && <span>· {c.section}</span>}
                {c.chapter && <span className="ml-auto font-medium text-even-ink-700">{c.chapter}</span>}
              </div>
              <div className="whitespace-pre-wrap leading-relaxed text-even-ink-800">
                {c.text.length > 1400 ? c.text.slice(0, 1400) + '…' : c.text}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
