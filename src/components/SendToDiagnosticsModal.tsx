'use client';

/**
 * <SendToDiagnosticsModal /> — per design doc §4.3.
 *
 * Common-test grid (CXR / ECG / USG abdomen / Echo / CBC / Urine routine
 * + Custom), optional notes textarea, Cancel | Send & pause encounter.
 *
 * On confirm:
 *   POST /api/encounters/[id]/send-to-diagnostics
 *   → encounter flips to paused_diagnostics, redirect to /dashboard.
 *
 * Closed via:
 *   - Cancel button
 *   - Escape key
 *   - Backdrop click
 *
 * Custom test mode reveals an input the doctor can type free-form.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const COMMON_TESTS: { label: string; icon: string }[] = [
  { label: 'Chest x-ray', icon: '🩻' },
  { label: 'ECG', icon: '❤️' },
  { label: 'USG abdomen', icon: '🫀' },
  { label: 'Echo', icon: '🫁' },
  { label: 'CBC', icon: '🩸' },
  { label: 'Urine routine', icon: '🧪' },
];

export type SendToDiagnosticsModalProps = {
  encounterId: string;
  patientName: string;
  open: boolean;
  onClose: () => void;
};

export function SendToDiagnosticsModal({
  encounterId,
  patientName,
  open,
  onClose,
}: SendToDiagnosticsModalProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [custom, setCustom] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setCustomMode(false);
      setCustom('');
      setNotes('');
      setBusy(false);
      setError(null);
    }
  }, [open]);

  // Escape-to-close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const chosen = customMode ? custom.trim() : selected;
  const canSubmit = !!chosen && !busy;

  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/send-to-diagnostics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: chosen, notes }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; redirect?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? 'Could not send.');
        return;
      }
      router.push(j.redirect ?? '/dashboard');
      router.refresh();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-even-navy/40 px-4 py-6 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Send to diagnostics"
        className="w-full max-w-lg rounded-2xl border border-even-ink-100 bg-white shadow-2xl"
      >
        {/* Header */}
        <header className="border-b border-even-ink-100 px-5 py-4">
          <h2 className="text-base font-semibold text-even-navy">
            Send {patientName} for diagnostics
          </h2>
          <p className="mt-1 text-xs text-even-ink-500">
            The encounter pauses while the patient is at the test.
            Returns as <span className="font-medium text-even-blue-700">Ready to resume</span> when done.
          </p>
        </header>

        {/* Test grid */}
        <div className="px-5 py-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
            Which test?
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {COMMON_TESTS.map((t) => {
              const on = !customMode && selected === t.label;
              return (
                <button
                  key={t.label}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCustomMode(false);
                    setSelected(t.label);
                  }}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    on
                      ? 'border-even-blue bg-even-blue-50 text-even-blue-800 ring-1 ring-even-blue-200'
                      : 'border-even-ink-200 bg-white text-even-navy hover:border-even-blue-300'
                  }`}
                >
                  <span aria-hidden>{t.icon}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCustomMode(true);
                setSelected(null);
              }}
              aria-pressed={customMode}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                customMode
                  ? 'border-even-blue bg-even-blue-50 text-even-blue-800 ring-1 ring-even-blue-200'
                  : 'border-dashed border-even-ink-200 bg-white text-even-ink-600 hover:border-even-blue-300'
              }`}
            >
              <span aria-hidden>＋</span>
              <span>Custom</span>
            </button>
          </div>

          {customMode && (
            <input
              type="text"
              autoFocus
              disabled={busy}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g., MRI lumbar spine"
              className="mt-3 w-full rounded-lg border border-even-ink-200 bg-white px-3 py-2 text-sm text-even-navy placeholder-even-ink-300 focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
            />
          )}

          {/* Notes */}
          <label className="mt-4 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
              Notes for the lab <span className="font-normal normal-case text-even-ink-400">— optional</span>
            </span>
            <textarea
              rows={2}
              disabled={busy}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., rule out consolidation, urgent read"
              className="w-full rounded-lg border border-even-ink-200 bg-white px-3 py-2 text-sm text-even-navy placeholder-even-ink-300 focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
            />
          </label>

          {error && (
            <p className="mt-3 rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-xs text-even-pink-800">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <footer className="flex items-center justify-end gap-2 border-t border-even-ink-100 px-5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-even-ink-200 bg-white px-4 py-2 text-sm font-semibold text-even-navy transition hover:border-even-ink-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSubmit}
            className="rounded-lg bg-even-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-even-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send & pause encounter'}
          </button>
        </footer>
      </div>
    </div>
  );
}
