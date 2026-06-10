'use client';

/**
 * DispositionFan — D.5 (V, 10 Jun). The floating Disposition button in the
 * editor's sticky bottom bar FANS OUT all plan kinds in a popover anchored
 * to the button itself — it overlays whatever is on screen and rides with
 * the sticky bar as the page scrolls. Replaces the D.3 slide-over here
 * (whose fixed positioning collapsed inside the editor's transformed
 * layout) AND the inline chip wall in section 7 (hidden via
 * PlanSection.hideManualWall). Picking a kind creates the plan through the
 * SAME endpoint the chip wall used, then auto-scrolls to its form in
 * section 7 so the doctor lands on the payload editor.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PLAN_KINDS, PLAN_META, PLAN_DEFAULTS, type PlanKind } from '@/lib/plan-schemas';

export function DispositionFan({
  encounterId,
  disabled,
}: {
  encounterId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<PlanKind | null>(null);
  const router = useRouter();
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  // Click-away + Escape close.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = async (kind: PlanKind) => {
    if (busy) return;
    setBusy(kind);
    try {
      const res = await fetch(`/api/encounters/${encodeURIComponent(encounterId)}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          payload: { ...(PLAN_DEFAULTS[kind] ?? {}) },
          source: 'doctor',
          predicted: false,
        }),
      });
      const j = (await res.json()) as { ok?: boolean };
      if (j.ok) {
        setOpen(false);
        router.refresh();
        // Land the doctor on the new plan's form in section 7.
        window.setTimeout(() => {
          document.getElementById('enc-section-plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 350);
      }
    } catch {
      /* intentional: chip stays; doctor can retap */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-3 w-[min(620px,calc(100vw-3rem))] rounded-2xl border border-violet-200 bg-white p-3 shadow-2xl">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">
              Disposition — pick a plan
            </span>
            <span className="text-[10px] text-even-ink-400">
              opens its form in section 7 · ✨ suggestions live there too
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PLAN_KINDS.map((k) => {
              const meta = PLAN_META[k];
              return (
                <button
                  key={k}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void pick(k)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50"
                  title={meta?.shortDesc}
                >
                  {meta?.icon} {meta?.label}
                  {busy === k ? ' …' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-lg px-3 py-2 text-sm font-semibold text-white transition ${
          open ? 'bg-violet-700' : 'bg-violet-600 hover:bg-violet-700'
        } disabled:opacity-50`}
        title="Fan out every disposition — discharge, tests, referral, admit…"
      >
        🧭 Disposition {open ? '▾' : '▴'}
      </button>
    </div>
  );
}
