'use client';

/**
 * <HandoffBanner /> — v2.3 pinned handoff context on the encounter screen.
 *
 * Renders when the encounter has an unacknowledged handoff_note AND the
 * viewing doctor is now the encounter's owner (after they claimed it
 * from the Needs review lane on /dashboard).
 *
 * The doctor can click Acknowledge to clear the banner — this fires
 * POST /claim-handoff which is idempotent for the current owner (it
 * just stamps handoff_ack_at if not already set, no doctor_id change).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type HandoffBannerProps = {
  encounterId: string;
  note: string;
  fromDoctorName: string;
  /** ISO timestamp from encounters.updated_at when handoff was flagged. */
  flaggedAt: string | null;
};

export function HandoffBanner({
  encounterId,
  note,
  fromDoctorName,
  flaggedAt,
}: HandoffBannerProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAck() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/claim-handoff`, {
        method: 'POST',
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? 'ack_failed');
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
          🔁 Handoff from {firstName(fromDoctorName)}
        </p>
        {flaggedAt && (
          <p className="text-[10px] uppercase tracking-wider text-amber-700">
            {relativeAge(flaggedAt)}
          </p>
        )}
      </div>
      <p className="mt-1.5 text-sm italic text-even-navy">&ldquo;{note}&rdquo;</p>
      <div className="mt-3 flex items-center justify-end gap-2">
        {error && (
          <span className="text-[11px] text-even-pink-700">{error}</span>
        )}
        <button
          type="button"
          onClick={onAck}
          disabled={busy}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Acknowledging…' : 'Acknowledge'}
        </button>
      </div>
    </div>
  );
}

function firstName(full: string): string {
  // v5.0.3 — strip 'Dr.'/'Dr'/'Nurse' prefix FIRST, then split. The
  // previous order split first and tried to strip a 'Dr.' token that
  // had no trailing whitespace, leaving 'Dr.' as the result.
  const stripped = (full || '').replace(/^(Dr\.?|Nurse)\s*/i, '').trim();
  return stripped.split(/\s+/)[0] || stripped || full;
}

function relativeAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
