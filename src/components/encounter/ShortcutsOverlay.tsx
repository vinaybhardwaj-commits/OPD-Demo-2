'use client';

/**
 * <ShortcutsOverlay /> — v4.0.8 keyboard shortcuts modal.
 *
 * Opens when the user presses '?' anywhere on the encounter page (and no
 * input/textarea is focused). Lists every keyboard shortcut available on
 * the page. Esc or the close button dismisses. Tiny — no dependencies.
 */
import { useEffect } from 'react';

export function ShortcutsOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-even-navy">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-0.5 text-xs text-even-ink-500 hover:bg-even-ink-50"
          >
            Esc
          </button>
        </div>

        <Group title="Navigation & help">
          <Row keys={['?']} label="Show this shortcuts panel" />
          <Row keys={['Esc']} label="Close any open modal or panel" />
        </Group>

        <Group title="Submit & save">
          <Row keys={['⌘', 'Enter']} label="Submit encounter (when complete)" />
          <Row keys={['⌘', 'S']} label="Force-save draft" />
        </Group>

        <Group title="Ask the chart side panel">
          <Row keys={['⌘', 'Enter']} label="Ask the chart (when focused)" />
        </Group>

        <Group title="Voice & dictation">
          <Row keys={['Hold mic']} label="Push-to-talk voice query (header)" />
        </Group>

        <p className="mt-4 text-[11px] italic text-even-ink-400">
          On Windows/Linux replace ⌘ with Ctrl.
        </p>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-even-ink-500">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs hover:bg-even-ink-50">
      <span className="text-even-navy">{label}</span>
      <span className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span
            key={i}
            className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-even-ink-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-even-navy shadow-sm"
          >
            {k}
          </span>
        ))}
      </span>
    </div>
  );
}
