/**
 * Encounter active-time clock — formatting helpers.
 *
 * Backing fields on `encounters`:
 *   - active_ms_accumulated  : BIGINT — ms of doctor-active time already
 *                              banked from prior active windows.
 *   - active_since           : TIMESTAMPTZ | NULL — when the current active
 *                              window started, or NULL if the encounter is
 *                              currently paused / pre-doctor / completed.
 *
 * These are maintained by the BEFORE-INSERT/UPDATE-OF-status trigger
 * `encounters_active_time_trg` (migration v34). The trigger means EVERY
 * route, helper, and background job that mutates encounters.status
 * automatically gets correct bookkeeping — there is no need for a
 * matching TS helper and no possibility of a code path forgetting it.
 *
 * Active states (timer runs): 'active', 'ready_to_resume'.
 * All other states (registered, at_triage, waiting_for_doctor,
 * paused_diagnostics, cancelled, completed) leave the clock frozen.
 *
 * Display rules:
 *   < 60s         →  "0:SS"     (e.g. 0:42)
 *   < 60min       →  "M:SS"     (e.g. 12:07)
 *   ≥ 60min       →  "H:MM:SS"  (e.g. 1:42:30)
 *
 * This module is pure (no React, no DB). It is the single source of truth
 * for how the timer renders on the client AND, eventually, anywhere
 * server-side that needs to print elapsed time (e.g. completed-encounter
 * audit views, billing).
 */

export const ACTIVE_STATUSES = ['active', 'ready_to_resume'] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

/** True when this status counts toward doctor-active time. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'ready_to_resume';
}

/**
 * Compute current active-time elapsed in seconds.
 *
 * @param accumulatedMs    encounters.active_ms_accumulated (BIGINT → number;
 *                         safe up to ~2^53 ms ≈ 285,000 years)
 * @param activeSinceIso   encounters.active_since (ISO string) or null
 * @param now              ms epoch — injectable for tests / SSR
 */
export function computeActiveSeconds(
  accumulatedMs: number | string | null | undefined,
  activeSinceIso: string | null | undefined,
  now: number = Date.now(),
): number {
  const acc = typeof accumulatedMs === 'string' ? Number(accumulatedMs) : (accumulatedMs ?? 0);
  const accSafe = Number.isFinite(acc) && acc > 0 ? acc : 0;

  let liveMs = 0;
  if (activeSinceIso) {
    const since = new Date(activeSinceIso).getTime();
    if (!Number.isNaN(since)) {
      liveMs = Math.max(0, now - since);
    }
  }

  return Math.floor((accSafe + liveMs) / 1000);
}

/**
 * Format elapsed seconds for display.
 *
 * Hours roll over correctly — unlike the legacy formatter, minutes will
 * never exceed 59. A six-hour encounter reads "6:00:00", not "360:00".
 */
export function formatActiveTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const ss = s.toString().padStart(2, '0');
  if (h > 0) {
    const mm = m.toString().padStart(2, '0');
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}

/**
 * Whether the timer should be visibly ticking right now.
 *
 * Encapsulates the "should I setInterval" decision for components — if
 * the encounter is in a frozen state, components can skip the per-second
 * re-render and just show a static value.
 */
export function isTimerLive(
  activeSinceIso: string | null | undefined,
  status: string | null | undefined,
): boolean {
  return Boolean(activeSinceIso) && isActiveStatus(status);
}
