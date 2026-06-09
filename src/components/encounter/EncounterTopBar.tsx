'use client';

/**
 * <EncounterTopBar /> — v4.1.1
 *
 * Top of the encounter capture page:
 *
 *   ← Queue   ● Patient Name · 37M · ENC-2026-014   ⏱ 0:42  🎙  …
 *
 * Timer behaviour (v4.1.1 — see migration v34 + lib/encounter-timer.ts):
 *
 *   The timer reads the doctor-active-time clock maintained by the
 *   encounters_active_time_trg DB trigger. It runs (ticking) only when
 *   the encounter is in an active state (active / ready_to_resume); it
 *   freezes during paused_diagnostics, cancelled, completed, and the
 *   pre-doctor states. Hours roll over: a four-hour encounter shows
 *   "4:00:00", not "240:00".
 *
 *   Earlier versions (v4.0.1 and before) computed (NOW() - started_at)
 *   on the client, which (a) never paused, (b) never rolled minutes
 *   into hours, and (c) was duplicated in EncounterEditor's body —
 *   producing the 561:00 reading V hit on the demo encounter.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { VoiceQueryFab } from '../VoiceQueryFab';
import {
  computeActiveSeconds,
  formatActiveTime,
  isTimerLive,
} from '@/lib/encounter-timer';

type EncounterStatus =
  | 'registered'
  | 'at_triage'
  | 'waiting_for_doctor'
  | 'active'
  | 'paused_diagnostics'
  | 'ready_to_resume'
  | 'completed';

type StatusTone = { dot: string; label: string };

const STATUS_TONE: Record<EncounterStatus, StatusTone> = {
  registered: { dot: 'bg-even-ink-300', label: 'registered' },
  at_triage: { dot: 'bg-even-ink-300', label: 'at triage' },
  waiting_for_doctor: { dot: 'bg-even-ink-400', label: 'waiting' },
  active: { dot: 'bg-emerald-500', label: 'active' },
  paused_diagnostics: { dot: 'bg-amber-500', label: 'paused' },
  ready_to_resume: { dot: 'bg-even-blue', label: 'ready' },
  completed: { dot: 'bg-even-ink-200', label: 'completed' },
};

export function EncounterTopBar({
  encounterId,
  encounterNumber,
  status,
  activeMsAccumulated,
  activeSince,
  patientName,
  patientAge,
  patientSex,
}: {
  encounterId: string;
  encounterNumber: string;
  status: EncounterStatus;
  /** encounters.active_ms_accumulated — banked active time so far */
  activeMsAccumulated: number;
  /** encounters.active_since (ISO) — null when the clock is frozen */
  activeSince: string | null;
  patientName: string;
  patientAge: number;
  patientSex: string;
}) {
  const live = isTimerLive(activeSince, status);

  const [display, setDisplay] = useState(() =>
    formatActiveTime(computeActiveSeconds(activeMsAccumulated, activeSince)),
  );

  // Tick once per second only while the clock is live. When frozen we
  // render the value computed at mount and skip the interval entirely.
  useEffect(() => {
    if (!live) {
      setDisplay(
        formatActiveTime(computeActiveSeconds(activeMsAccumulated, activeSince)),
      );
      return;
    }
    setDisplay(
      formatActiveTime(computeActiveSeconds(activeMsAccumulated, activeSince)),
    );
    const id = setInterval(() => {
      setDisplay(
        formatActiveTime(computeActiveSeconds(activeMsAccumulated, activeSince)),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [live, activeMsAccumulated, activeSince]);

  const tone = STATUS_TONE[status];
  // We show the timer for any non-completed encounter. Frozen states
  // display the banked value statically (e.g. "0:00" for a fresh demo
  // row that's paused, or "12:07" for an encounter currently paused
  // mid-flow). Completed encounters hide the timer entirely.
  const showTimer = status !== 'completed';
  const showVoice = status !== 'completed';

  const timerTitle = live
    ? 'Doctor-active time (ticking)'
    : status === 'paused_diagnostics'
      ? 'Paused for diagnostics — clock frozen'
      : status === 'completed'
        ? 'Encounter completed'
        : 'Doctor-active time (frozen)';

  return (
    <header className="border-b border-even-ink-100 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
        {/* Left — back link */}
        <Link
          href="/dashboard"
          className="shrink-0 text-xs font-medium text-even-ink-500 hover:text-even-navy"
        >
          ← Queue
        </Link>

        {/* Center — patient identity with status dot */}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-center text-sm">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
            title={tone.label}
            aria-label={`Status: ${tone.label}`}
          />
          <span className="truncate font-semibold text-even-navy">{patientName}</span>
          <span className="shrink-0 text-even-ink-500">·</span>
          <span className="shrink-0 font-mono text-xs text-even-ink-500">
            {patientAge}{patientSex}
          </span>
          <span className="shrink-0 text-even-ink-500">·</span>
          <span className="shrink-0 font-mono text-xs text-even-ink-400">
            {encounterNumber}
          </span>
        </div>

        {/* Right — timer + actions */}
        <div className="flex shrink-0 items-center gap-3 text-xs text-even-ink-500">
          {showTimer && (
            <span
              className={`font-mono tabular-nums ${live ? 'text-even-navy' : 'text-even-ink-400'}`}
              title={timerTitle}
            >
              ⏱ {display}
            </span>
          )}
          {showVoice && <VoiceQueryFab encounterId={encounterId} />}
        </div>
      </div>
    </header>
  );
}
