'use client';

/**
 * <Section /> — v4.0.0 encounter section primitive.
 *
 * Replaces the inline <Section> previously defined in EncounterEditor.
 * Per the v4 UI Redesign PRD §5 + §8:
 *  - Sentence-case heading, NOT uppercase + tracking-wide
 *  - Optional numbered marker on the left (1. 2. 3. ...) in ink-300
 *  - No subtitle slot (PRD §3 — "no instructional copy in the workspace")
 *  - Required asterisk (*) supported
 *  - Right-side actions slot for icons / toggles (dictate, sparkle, live)
 *  - Optional collapsible behavior with sessionStorage persistence per encounter
 *  - When collapsed: heading + summary line; click chevron or heading to expand
 *
 * v4.0.0 keeps a back-compat `desc` prop accepted-but-ignored so the migration
 * from the old <Section> doesn't break existing call sites. v4.0.2 strips
 * the `desc` calls from every callsite.
 */
import { useCallback, useEffect, useState } from 'react';
import { DictateButton } from '../DictateButton';

export type SectionProps = {
  /** Display heading (sentence case, e.g. 'Reason for visit', 'Vitals'). */
  label: string;
  /** v4.0.9 — anchor id for jump-to-section / command palette navigation. */
  id?: string;
  /** Optional numbered marker on the left (1, 2, 3, ...). Set to render the v4 flow markers. */
  n?: number;
  /** Marks the section as required for submission — shows a small * after the label. */
  required?: boolean;
  /** Right-side actions slot. Pass icon buttons, toggles, etc. */
  actions?: React.ReactNode;
  /**
   * Optional summary rendered next to the heading when the section is
   * collapsed. Example: "Treatment — 2" or "Vitals — BP 130/82 · HR 92".
   */
  summary?: React.ReactNode;
  /** Whether the section can be collapsed. When true, a chevron renders. */
  collapsible?: boolean;
  /** Default collapsed state on first mount. Overridden by sessionStorage if encounterId+sectionKey provided. */
  defaultCollapsed?: boolean;
  /** sessionStorage key parts so state persists across reload on the same encounter. */
  encounterId?: string;
  /** Stable key (e.g. 'differential', 'diagnostics') for sessionStorage. */
  sectionKey?: string;
  /** Children render in the body. Hidden when collapsed. */
  children?: React.ReactNode;
  /**
   * v4.0.0 back-compat: previously the old Section had a `desc` subtitle.
   * Accepted but ignored — kept so v4.0.0 migration doesn't crash existing calls.
   * v4.0.2 will remove all desc props from call sites.
   */
  desc?: string;
  /**
   * v4.0.0 back-compat: previously a `dictate` config rendered DictateButton inline.
   * v4.0.0 keeps this working by passing it through; v4.0.3+ will redesign
   * the dictate UX as an icon in the actions slot.
   */
  dictate?: {
    encounterId: string;
    section: string;
    onTranscript?: (t: string) => void;
  };
};

export function Section({
  label,
  id,
  n,
  required,
  actions,
  summary,
  collapsible,
  defaultCollapsed,
  encounterId,
  sectionKey,
  children,
  dictate,
}: SectionProps) {
  const storageKey =
    encounterId && sectionKey ? `enc:${encounterId}:sec:${sectionKey}:collapsed` : null;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!collapsible) return false;
    if (typeof window === 'undefined') return !!defaultCollapsed;
    if (storageKey) {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored !== null) return stored === '1';
    }
    return !!defaultCollapsed;
  });

  useEffect(() => {
    if (!collapsible || !storageKey || typeof window === 'undefined') return;
    window.sessionStorage.setItem(storageKey, collapsed ? '1' : '0');
  }, [collapsed, collapsible, storageKey]);

  const toggle = useCallback(() => {
    if (collapsible) setCollapsed((c) => !c);
  }, [collapsible]);

  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          {typeof n === 'number' && (
            <span className="shrink-0 select-none text-[11px] font-medium tabular-nums text-even-ink-300">
              {n}.
            </span>
          )}
          <h2
            className={`text-base font-semibold text-even-navy ${collapsible ? 'cursor-pointer' : ''}`}
            onClick={collapsible ? toggle : undefined}
            title={collapsible ? (collapsed ? 'Expand' : 'Collapse') : undefined}
          >
            {label}
            {required && <span className="ml-1 text-even-pink-700">*</span>}
          </h2>
          {summary && (
            <span className="truncate text-[12px] text-even-ink-500">
              — {summary}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* v4.0.0 back-compat: render legacy DictateButton when dictate prop is passed.
              v4.0.3+ will replace with a proper icon in the actions slot. */}
          {dictate && <LegacyDictateSlot dictate={dictate} />}
          {actions}
          {collapsible && (
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Expand section' : 'Collapse section'}
              className="rounded p-0.5 text-even-ink-500 hover:bg-even-ink-50"
            >
              {collapsed ? '▸' : '▾'}
            </button>
          )}
        </div>
      </header>
      {!collapsed && children}
    </section>
  );
}

/**
 * Legacy adapter for the old <Section dictate={...}> calling convention.
 * v4.0.3 will retire this and move dictate into the actions slot as an icon.
 */
function LegacyDictateSlot({
  dictate,
}: {
  dictate: { encounterId: string; section: string; onTranscript?: (t: string) => void };
}) {
  return (
    // DictateButton's section prop is a string literal union in v3; cast at
    // the boundary since back-compat callers may pass any v3 value.
    <DictateButton
      encounterId={dictate.encounterId}
      section={dictate.section as Parameters<typeof DictateButton>[0]['section']}
      onTranscript={dictate.onTranscript}
    />
  );
}
