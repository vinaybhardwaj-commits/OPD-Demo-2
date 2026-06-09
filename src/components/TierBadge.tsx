'use client';

/**
 * <TierBadge /> — patient panel risk tier (0-3) badge.
 *
 * Source of truth: src/lib/comorbidity-tier.ts computeTier() result.
 * Used in three surfaces:
 *   - <ComorbidityBand> top of encounter editor (large variant)
 *   - <HistoryPanel> ACTIVE COMORBIDITIES section header (medium)
 *   - dashboard queue card (small)
 *
 * Hover/click reveals the full breakdown tooltip: base score per
 * comorbidity, modifiers, trigger rules fired, review cadence.
 */
import { useState } from 'react';
import type { TierBreakdown } from '@/lib/comorbidity-tier';
import { TIER_LABEL, TIER_DESCRIPTION, TIER_REVIEW_CADENCE } from '@/lib/comorbidity-tier';

const TIER_STYLE: Record<0 | 1 | 2 | 3, string> = {
  0: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  1: 'bg-blue-50 text-blue-800 ring-blue-200',
  2: 'bg-amber-50 text-amber-800 ring-amber-200',
  3: 'bg-rose-50 text-rose-800 ring-rose-200',
};
const TIER_DOT: Record<0 | 1 | 2 | 3, string> = {
  0: 'bg-emerald-500',
  1: 'bg-blue-500',
  2: 'bg-amber-500',
  3: 'bg-rose-500',
};

export function TierBadge({
  breakdown,
  size = 'md',
  showScore = true,
  inline = false,
}: {
  breakdown: TierBreakdown;
  size?: 'sm' | 'md' | 'lg';
  showScore?: boolean;
  inline?: boolean;          // when true, render as inline-flex (queue card)
}) {
  const [open, setOpen] = useState(false);
  const t = breakdown.tier;
  const sizeCls = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs';

  return (
    <div className={inline ? 'relative inline-block' : 'relative'}>
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full ring-1 font-medium whitespace-nowrap ${TIER_STYLE[t]} ${sizeCls}`}
        aria-label={`Panel ${TIER_LABEL[t]}, score ${breakdown.score}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[t]}`} aria-hidden />
        <span>{TIER_LABEL[t]}</span>
        {showScore && <span className="opacity-75">· {breakdown.score}</span>}
        {breakdown.override_applied && <span className="opacity-75 italic">(override)</span>}
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-80 rounded-lg border border-even-ink-200 bg-white p-3 text-xs shadow-lg"
          style={{ left: 0 }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="mb-2 font-semibold text-even-navy">
            {TIER_LABEL[t]} (Score {breakdown.score})
          </div>
          <div className="mb-3 text-[11px] text-even-ink-500">{TIER_DESCRIPTION[t]}</div>

          {breakdown.base_score > 0 && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wider text-even-ink-500">Base score: {breakdown.base_score}</div>
            </div>
          )}

          {breakdown.modifiers.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-even-ink-500">Modifiers</div>
              <ul className="space-y-0.5">
                {breakdown.modifiers.map((m, i) => (
                  <li key={i} className="flex justify-between text-[11px]">
                    <span className="text-even-ink-700">{m.label}</span>
                    <span className="font-mono font-semibold text-even-ink-900">+{m.points}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {breakdown.trigger_reasons.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-even-ink-500">
                Trigger rules fired ({breakdown.extended_visible ? 'extended visible' : 'core only'})
              </div>
              <ul className="space-y-0.5">
                {breakdown.trigger_reasons.map((r, i) => (
                  <li key={i} className="text-[11px] text-even-ink-700">• {r}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 border-t border-even-ink-100 pt-2 text-[11px] text-even-ink-500">
            Review cadence: <span className="font-medium text-even-navy">{TIER_REVIEW_CADENCE[t]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
