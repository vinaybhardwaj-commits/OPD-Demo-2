'use client';

/**
 * DispositionPanel — D.1 (design §10.2's "Pause for disposition opens the
 * plan engine", V locked 10 Jun). The v6.1 PLAN-V5 disposition engine —
 * SuggestedPlans + the 13-kind chip wall + per-kind forms + submit — rendered
 * in a slide-over INSIDE the Room, so the initial / intermediate / final
 * disposition never requires leaving the recording cockpit. Submit-with-
 * diagnostics flips the legacy status; the Room's existing desync poll then
 * auto-pauses (stop → upload-first → out_for_workup) exactly as before.
 * Same component, no fork — lossless.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import PlanSection from '@/components/PlanSection';

export function DispositionPanel({
  encounterId,
  encounterStatus,
  clinicalStatus,
  force,
}: {
  encounterId: string;
  encounterStatus: string;
  clinicalStatus: string;
  /** D.3: render regardless of clinical lane (classic editor's persistent bar). */
  force?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const eligible = force || ['in_room', 'back_ready', 'ready_for_review'].includes(clinicalStatus);
  if (!eligible) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
        title="Open the plan engine — suggested plans, orders, referrals, disposition. Submitting diagnostics pauses the encounter for workup."
      >
        🧭 Disposition
      </button>

      {open && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-even-navy-900/30 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-[640px] overflow-y-auto bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-even-navy-800">
                Disposition — plan engine
              </h2>
              <button
                onClick={() => {
                  setOpen(false);
                  router.refresh();
                }}
                className="rounded-md bg-even-ink-50 px-2.5 py-1 text-xs font-semibold text-even-ink-600 hover:bg-even-ink-100"
              >
                ✕ Close
              </button>
            </div>
            <p className="mb-4 text-[11px] text-even-ink-500">
              Same engine as section 7 of the note editor. Ordering tests pauses the encounter
              (the recording uploads first); terminal plans (discharge / follow-up / refer / admit)
              set up the final disposition for Submit &amp; finish in review.
            </p>
            <PlanSection
              encounterId={encounterId}
              encounterStatus={encounterStatus}
              onSubmitted={() => {
                setOpen(false);
                router.refresh();
              }}
            />
          </aside>
        </div>
      )}
    </>
  );
}
