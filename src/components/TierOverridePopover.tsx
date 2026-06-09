'use client';

/**
 * <TierOverridePopover /> — v3.9.6
 *
 * Click-target popover for clinician tier override. Wraps a child
 * (typically <TierBadge>) and shows a small floating panel on click
 * with T0/T1/T2/T3/Auto buttons + optional reason field.
 *
 * Auto = clear override; computed tier resumes.
 *
 * onSaved is fired after a successful POST so the parent can refetch
 * (queue page can refresh tier pills, modal can re-pull breakdown).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type TierOverrideValue = 'T0' | 'T1' | 'T2' | 'T3' | null;

const TIER_TONES: Record<NonNullable<TierOverrideValue>, string> = {
  T0: 'bg-blue-100 text-blue-800 ring-blue-300',
  T1: 'bg-amber-100 text-amber-800 ring-amber-300',
  T2: 'bg-rose-100 text-rose-800 ring-rose-300',
  T3: 'bg-red-200 text-red-900 ring-red-400',
};

export function TierOverridePopover({
  patientId,
  currentOverride,
  computedTier,
  onSaved,
  readOnly,
  children,
}: {
  patientId: string;
  /** Server-side current override (null if no override active). */
  currentOverride: TierOverrideValue;
  /** Computed (auto) tier label for the 'Auto' button hint, e.g. 'T1'. */
  computedTier: string;
  onSaved?: () => void;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const save = useCallback(async (state: TierOverrideValue) => {
    if (readOnly) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/tier-override`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, reason: reason.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'save_failed');
      setOpen(false);
      setReason('');
      onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [patientId, reason, onSaved, readOnly]);

  return (
    <span ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!readOnly) setOpen((o) => !o); }}
        className="inline-block focus:outline-none"
        title={readOnly ? '' : 'Click to override tier'}
      >
        {children}
      </button>
      {open && !readOnly && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-even-ink-200 bg-white p-3 text-xs shadow-lg">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
            Override panel tier
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(['T0','T1','T2','T3'] as const).map((t) => {
              const active = currentOverride === t;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={saving}
                  onClick={() => void save(t)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition disabled:opacity-50 ${active ? TIER_TONES[t] : 'bg-white text-even-ink-600 ring-even-ink-200 hover:ring-even-ink-300'}`}
                >
                  {t}
                </button>
              );
            })}
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(null)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition disabled:opacity-50 ${currentOverride === null ? 'bg-emerald-50 text-emerald-700 ring-emerald-300' : 'bg-white text-even-ink-600 ring-even-ink-200 hover:ring-even-ink-300'}`}
              title={`Clear override (auto = ${computedTier})`}
            >
              Auto · {computedTier}
            </button>
          </div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional, audit log)"
            className="w-full rounded border border-even-ink-200 px-2 py-1 text-[11px] text-even-ink-800 placeholder:text-even-ink-400"
          />
          {err && <div className="mt-1.5 text-[10px] text-rose-600">{err}</div>}
          <div className="mt-1.5 text-[10px] text-even-ink-400">
            Override wins until cleared. Stamped with your name + time.
          </div>
        </div>
      )}
    </span>
  );
}
