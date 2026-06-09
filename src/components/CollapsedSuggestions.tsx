'use client';

/**
 * <CollapsedSuggestions /> — v4.1.6
 *
 * Wraps the AI / static chip walls (Reason for visit, Exam findings,
 * Diagnostics quick-add, Assessment ICD-10 suggestions, etc.) so they
 * are HIDDEN by default and accessed via a small "✨ show suggestions"
 * link. Click to expand inline; click "hide" to collapse.
 *
 * Why hidden by default
 * ---------------------
 * Pulse 2.0 check-in 25 May 2026 decided that transcription is the
 * primary input mode. Chips become a fallback for cases where voice
 * fails or the doctor wants a one-click option. Defaulting them
 * collapsed reduces visual noise and trains doctors to lean on the
 * dictate button.
 *
 * Usage
 * -----
 *   <CollapsedSuggestions count={CC_CHIPS.length}>
 *     <CcChipGrid {...props} />
 *   </CollapsedSuggestions>
 *
 * Use `count` to surface a hint of how many suggestions are hiding.
 */
import { useState, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Optional pre-expansion hint, e.g. "26 options" */
  count?: number;
  /** Override the default label text. */
  label?: string;
  /** Auto-expand on mount — useful when a transcript fails. */
  defaultOpen?: boolean;
  /** Compact mode reduces vertical padding (used inline in sections). */
  compact?: boolean;
};

export function CollapsedSuggestions({
  children,
  count,
  label = 'Show suggestions',
  defaultOpen = false,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const triggerClass = compact
    ? 'inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 hover:text-violet-900'
    : 'inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClass}
        aria-expanded={false}
      >
        <span aria-hidden>✨</span>
        <span>{label}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="font-mono text-even-ink-400">
            ({count})
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className={`${triggerClass} text-even-ink-500 hover:text-even-ink-700`}
        aria-expanded={true}
      >
        <span aria-hidden>−</span>
        <span>Hide suggestions</span>
      </button>
      <div>{children}</div>
    </div>
  );
}
