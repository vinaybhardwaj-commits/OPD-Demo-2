'use client';

/**
 * <AnnotateResultButton /> — Polish #4 doctor-side annotation control.
 *
 * Per row in <EncounterLabResults>. Click "+ Note" → inline textarea
 * appears in the same row → submit POSTs to /annotate. After success,
 * router.refresh() rehydrates the page with the new annotation from
 * the server (avoids client-side reconciliation).
 *
 * Per the locked annotation-only model — the original lab_results
 * row is never edited. This component only adds notes.
 */
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function AnnotateResultButton({
  labResultId,
}: {
  labResultId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setError('Type a note first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lab-results/${labResultId}/annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: trimmed }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; detail?: string };
      if (!j.ok) {
        setError(j.detail ?? j.error ?? 'annotate_failed');
        setBusy(false);
        return;
      }
      setOpen(false);
      setNote('');
      setBusy(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
      setBusy(false);
    }
  }, [labResultId, note, router]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => ref.current?.focus(), 50);
        }}
        className="text-[10px] uppercase tracking-wider text-even-ink-400 hover:text-even-navy"
        title="Add a clinical annotation"
      >
        + Note
      </button>
    );
  }

  return (
    <div className="mt-1 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-2">
      <textarea
        ref={ref}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Repeat CBC same day showed normal Hb — original sample likely hemolysed."
        rows={2}
        maxLength={500}
        className="w-full resize-y rounded border border-even-ink-200 bg-white px-2 py-1 text-[11px] placeholder:text-even-ink-300 focus:border-even-navy focus:outline-none focus:ring-1 focus:ring-even-navy"
        disabled={busy}
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[9px] text-even-ink-400">
          {note.length}/500 · Original value is never edited.
        </span>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-[10px] text-even-pink-800">{error}</span>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setNote('');
              setError(null);
            }}
            disabled={busy}
            className="text-[10px] uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !note.trim()}
            className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}
