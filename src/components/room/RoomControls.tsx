'use client';

/**
 * Room lifecycle controls — OPD-Demo-2 P1.1 shell.
 * One primary control that morphs by clinical state (design §10.2),
 * driving POST /api/encounters/[id]/lifecycle. The big Record button is
 * a disabled placeholder until the record loop lands (P1.2).
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ClinicalStatus } from '@/lib/lifecycle';

type Props = { encounterId: string; clinicalStatus: ClinicalStatus };

type Action = 'enter_room' | 'pause_for_workup' | 'mark_back_ready' | 'end_visit';

export function RoomControls({ encounterId, clinicalStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<Action | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function fire(action: Action) {
    setBusy(action);
    setError(null);
    try {
      const r = await fetch(`/api/encounters/${encounterId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; from?: string; to?: string };
      if (!j.ok) {
        setError(j.error === 'invalid_transition' ? `Not allowed from "${j.from}"` : j.error ?? 'failed');
      } else {
        router.refresh();
      }
    } catch {
      setError('network error');
    } finally {
      setBusy(null);
    }
  }

  const btn =
    'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Record placeholder — wired in P1.2 */}
      <button
        disabled
        title="Record loop lands in P1.2"
        className={`${btn} flex items-center gap-2 bg-even-ink-100 text-even-ink-400`}
      >
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-400" /> Record
      </button>

      {(clinicalStatus === 'ready' || clinicalStatus === 'back_ready') && (
        <button
          onClick={() => fire('enter_room')}
          disabled={busy !== null}
          className={`${btn} bg-even-blue-600 text-white hover:bg-even-blue-700`}
        >
          {busy === 'enter_room'
            ? 'Starting…'
            : clinicalStatus === 'back_ready'
              ? 'Continue encounter'
              : 'Start visit'}
        </button>
      )}

      {clinicalStatus === 'in_room' && (
        <>
          <button
            onClick={() => fire('pause_for_workup')}
            disabled={busy !== null}
            className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
          >
            {busy === 'pause_for_workup' ? 'Pausing…' : 'Pause for workup'}
          </button>
          <button
            onClick={() => fire('end_visit')}
            disabled={busy !== null}
            className={`${btn} bg-even-navy-800 text-white hover:bg-even-navy-700`}
          >
            {busy === 'end_visit' ? 'Ending…' : 'End visit'}
          </button>
        </>
      )}

      {clinicalStatus === 'out_for_workup' && (
        <button
          onClick={() => fire('mark_back_ready')}
          disabled={busy !== null}
          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          {busy === 'mark_back_ready' ? 'Marking…' : 'Results back (demo)'}
        </button>
      )}

      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
