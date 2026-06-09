'use client';

/**
 * <PausedDiagnosticsBanner /> — v4.1.0
 *
 * Pink banner that shows when an encounter is in 'paused_diagnostics'.
 * Always tells the doctor the encounter is awaiting the named pending
 * test. When the doctor has picked a disposition (i.e. they've made up
 * their mind without the result), surfaces a 'Cancel diagnostics &
 * finish' button that POSTs /api/encounters/[id]/cancel-diagnostics,
 * which cancels every still-incomplete diagnostic_order on the encounter
 * and flips status back to 'active' so Submit unlocks.
 *
 * Confirmation prompt before firing — cancelling a real lab order on
 * a real patient is destructive enough that we want one confirm step.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PausedDiagnosticsBanner({
  encounterId,
  pendingTest,
  dispositionPicked,
}: {
  encounterId: string;
  pendingTest: string | null;
  dispositionPicked: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cancel = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/cancel-diagnostics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason: 'Doctor cancelled to finish encounter without lab result' }),
      });
      const text = await res.text();
      let json: { ok?: boolean; error?: string; cancelled_count?: number };
      try { json = JSON.parse(text); }
      catch { json = { ok: false, error: 'non-json response' }; }
      if (!res.ok || !json.ok) {
        setErr(json.error ?? `Server ${res.status}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-even-pink-200 bg-even-pink-50 p-3 text-xs text-even-navy">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p>
            Encounter paused — awaiting{' '}
            <span className="font-medium">{pendingTest ?? 'diagnostic results'}</span>.
            You can still update notes; Submit unlocks once results come back.
          </p>
          {dispositionPicked && !confirming && (
            <p className="mt-1.5 text-[11px] text-even-ink-500">
              Already made your call? Cancel the pending order to finish now.
            </p>
          )}
          {err && (
            <p className="mt-1.5 text-[11px] text-even-pink-700">
              Couldn&apos;t cancel: {err}
            </p>
          )}
        </div>

        {dispositionPicked && (
          <div className="flex shrink-0 items-center gap-2">
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className="rounded-md border border-even-pink-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-even-pink-700 transition hover:bg-even-pink-50 disabled:opacity-50"
              >
                Cancel diagnostics & finish
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="rounded-md border border-even-ink-200 bg-white px-3 py-1.5 text-[11px] font-medium text-even-ink-600 transition hover:bg-even-ink-50 disabled:opacity-50"
                >
                  Keep waiting
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  disabled={busy}
                  className="rounded-md bg-even-pink-700 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-even-pink-800 disabled:opacity-50"
                >
                  {busy ? 'Cancelling…' : 'Yes, cancel'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
