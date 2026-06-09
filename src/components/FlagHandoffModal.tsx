'use client';

/**
 * <FlagHandoffModal /> — v2.3 doctor-side handoff initiator.
 *
 * Mounted in the encounter action bar (next to "Submit & finish").
 * Current doctor types a handoff_note ("Suspected stable angina,
 * requesting cardio review") and submits. Server POSTs /flag-handoff
 * which sets the note + clears any prior ack. The encounter then
 * appears in the network-wide "Needs review" lane on every doctor's
 * /dashboard.
 *
 * The flagging doctor stays the owner until someone else claims it,
 * so they can keep working on the chart in the meantime.
 *
 * Closed via Cancel button / Escape / backdrop click.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type FlagHandoffModalProps = {
  encounterId: string;
  patientName: string;
  open: boolean;
  onClose: () => void;
};

const SUGGESTED_REASONS = [
  'Suspected cardiac — needs cardio review',
  'Requires endocrine review (uncontrolled diabetes)',
  'Possible TB — needs pulmonary review',
  'Second opinion on imaging interpretation',
  'Complex DDx — would benefit from senior input',
];

export function FlagHandoffModal({
  encounterId,
  patientName,
  open,
  onClose,
}: FlagHandoffModalProps) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setNote('');
      setError(null);
      return;
    }
    setTimeout(() => textareaRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onSubmit = useCallback(async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setError('Write a short note for the receiving doctor.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/encounters/${encounterId}/flag-handoff`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: trimmed }),
        },
      );
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.detail ?? j.error ?? 'flag_failed');
        setBusy(false);
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
      setBusy(false);
    }
  }, [note, encounterId, onClose, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-even-navy/40 px-4 pb-6 pt-12 sm:items-center sm:py-12"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-title"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-even-ink-100"
      >
        <header className="border-b border-even-ink-100 px-6 py-4">
          <h2
            id="handoff-title"
            className="text-base font-semibold tracking-tight text-even-navy"
          >
            Flag for handoff · {patientName}
          </h2>
          <p className="mt-0.5 text-xs text-even-ink-500">
            Writes a note for the next doctor. Encounter appears in
            everyone&apos;s &quot;Needs review&quot; queue until someone claims.
          </p>
        </header>

        <div className="space-y-3 px-6 py-4">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
              Quick prompts
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {SUGGESTED_REASONS.map((r) => (
                <li key={r}>
                  <button
                    type="button"
                    onClick={() => setNote(r)}
                    disabled={busy}
                    className="rounded-full border border-even-ink-200 bg-white px-2.5 py-1 text-[11px] text-even-ink-700 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {r}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <label
              htmlFor="handoff-note"
              className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500"
            >
              Handoff note
            </label>
            <textarea
              ref={textareaRef}
              id="handoff-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Suspected stable angina based on classic exertional chest pain — requesting cardiology review."
              rows={4}
              maxLength={1000}
              className="mt-1 w-full rounded-lg border border-even-ink-200 px-3 py-2 text-sm placeholder:text-even-ink-300 focus:border-even-navy focus:outline-none focus:ring-1 focus:ring-even-navy"
              disabled={busy}
            />
            <p className="mt-1 text-right text-[10px] text-even-ink-400">
              {note.length}/1000
            </p>
          </section>

          {error && (
            <p className="rounded-md bg-even-pink-50 px-3 py-2 text-[11px] text-even-pink-800">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-even-ink-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs font-medium text-even-ink-500 hover:text-even-navy"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !note.trim()}
            className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? 'Flagging…' : 'Send to handoff queue'}
          </button>
        </footer>
      </div>
    </div>
  );
}
