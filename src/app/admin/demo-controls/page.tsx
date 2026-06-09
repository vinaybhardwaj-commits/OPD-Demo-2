/**
 * /admin/demo-controls — V's stand-in for Pulse events during the demo.
 *
 * Three controls per design doc §6A:
 *   1. Reset demo — wipes today's encounters and reseeds the original
 *      17. Patients + drug_master untouched. Use between dry-runs.
 *   2. Add walk-in — inserts a new patient at the bottom of the waiting
 *      lane (no encounter row, so it shows as Waiting).
 *   3. Mark diagnostic ready — per paused encounter, a one-tap flip
 *      from paused_diagnostics → ready_to_resume. Sprint 6's pause/
 *      resume choreography will use real Pulse events; this is the
 *      placeholder.
 *
 * The page is a server component that calls getDemoStatus() so it
 * shows live counts after every action.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentDoctor } from '@/lib/auth';
import { getDemoStatus } from '@/lib/seed';
import { getSummaryBackfillStatus } from '@/lib/patient-summary';
import {
  actionReset,
  actionReplayDemo,
  actionAddWalkIn,
  actionMarkReady,
  actionBackfillSummaries,
} from './actions';

export const dynamic = 'force-dynamic';
// PH.1.3: backfill action runs up to 6 patients × ~44s Qwen latency,
// well above the default 60s segment timeout.
export const maxDuration = 300;

export default async function DemoControlsPage() {
  const session = await getCurrentDoctor();
  if (!session) redirect('/auth/login');

  const [status, backfill] = await Promise.all([
    getDemoStatus(session.email),
    getSummaryBackfillStatus(),
  ]);

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Back to queue
          </Link>
          <span className="text-[10px] font-mono text-even-ink-400">
            admin · demo controls
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-10">
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-even-blue-700">
          Sprint 2 · M2.4
        </p>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-even-navy">
          Demo controls
        </h1>
        <p className="mb-8 text-sm text-even-ink-600">
          Stand-in for Pulse events while the integration is mocked. Use
          these to reset the queue between practice runs, drop in walk-ins,
          or simulate diagnostic results coming back.
        </p>

        {/* Status snapshot */}
        <div className="mb-8 rounded-xl border border-even-ink-200 bg-white p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-even-ink-500">
            Current state
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Patients"   value={status.total_patients} />
            <Stat label="Today's encounters" value={status.encounters_today} />
            <Stat label="Paused"     value={status.by_status.paused_diagnostics ?? 0} />
            <Stat label="Ready"      value={status.by_status.ready_to_resume ?? 0} />
          </div>
        </div>

        {/* Reset demo — v2 replay is the primary, v1 reset is the fallback */}
        <ControlCard
          title="Reset demo for next run"
          description="Rewinds today's encounters network-wide into a varied pristine state (30% registered for CCE/Triage, 20% at_triage, 20% waiting_for_doctor, 20% paused_diagnostics with a fresh CBC, 10% ready_to_resume). Clears handoff notes + DDI/DDx caches + voice queries. Patients kept. Use this between practice runs."
        >
          <div className="flex flex-wrap items-center gap-3">
            <form action={actionReplayDemo}>
              <button
                type="submit"
                className="rounded-lg bg-even-blue px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-even-blue-700"
              >
                ↻ Replay v2 demo
              </button>
            </form>
            <form action={actionReset}>
              <button
                type="submit"
                className="rounded-lg border border-even-pink-300 bg-even-pink-50 px-4 py-2 text-sm font-medium text-even-pink-800 transition hover:bg-even-pink-100"
                title="v1-era reset — only touches your own encounters"
              >
                Reset just my queue (v1)
              </button>
            </form>
          </div>
        </ControlCard>

        {/* Add walk-in */}
        <ControlCard
          title="Add a walk-in"
          description="Inserts a new patient at the bottom of the Waiting lane (no encounter row yet). Each tap pulls the next unused name + a fresh MRN."
        >
          <form action={actionAddWalkIn}>
            <button
              type="submit"
              className="rounded-lg border border-even-ink-200 bg-white px-4 py-2 text-sm font-semibold text-even-navy transition hover:border-even-blue-300 hover:bg-even-blue-50"
            >
              + Add walk-in
            </button>
          </form>
        </ControlCard>

        {/* Mark diagnostic ready */}
        <ControlCard
          title="Mark diagnostic ready"
          description="Flips a paused_diagnostics encounter to ready_to_resume. Stand-in for the Pulse event that fires when a test result lands."
        >
          {status.paused_encounters.length === 0 ? (
            <p className="text-xs text-even-ink-400">
              No paused encounters right now. Reset the queue or start a new one and send to diagnostics to see this in action.
            </p>
          ) : (
            <ul className="space-y-2">
              {status.paused_encounters.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-even-pink-200 bg-even-pink-50/50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-even-navy">
                      {e.patient_name}
                    </div>
                    <div className="text-[11px] text-even-ink-500">
                      <span className="font-mono">{e.encounter_number}</span>
                      {' · '}
                      pending {e.pending_diagnostic_test ?? '—'}
                    </div>
                  </div>
                  <form action={actionMarkReady}>
                    <input type="hidden" name="encounter_id" value={e.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-even-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-even-blue-700 transition hover:bg-even-blue-50"
                    >
                      ✓ Test ready
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </ControlCard>

        {/* Backfill Qwen summaries (PH.1.3) */}
        <ControlCard
          title="Backfill patient summaries"
          description="Computes the Qwen summary for every patient who has at least one completed encounter. Each click processes up to 6 patients at warm-Qwen latency (~5-15s each). Click again until 0 remain. Already-fresh patients are skipped."
        >
          <div className="mb-3 grid grid-cols-4 gap-3 text-sm">
            <Stat label="Eligible"  value={backfill.eligible} />
            <Stat label="Fresh"     value={backfill.fresh} />
            <Stat label="Failed"    value={backfill.failed} />
            <Stat label="Remaining" value={backfill.remaining} />
          </div>
          {backfill.remaining === 0 ? (
            <p className="rounded-md border border-even-blue-100 bg-even-blue-50 px-3 py-2 text-xs text-even-navy">
              All {backfill.eligible} eligible patients have a fresh summary.
            </p>
          ) : (
            <form action={actionBackfillSummaries}>
              <button
                type="submit"
                className="rounded-lg border border-even-blue-300 bg-even-blue-50 px-4 py-2 text-sm font-semibold text-even-blue-800 transition hover:border-even-blue-500 hover:bg-even-blue-100"
              >
                ▶ Backfill next batch ({Math.min(6, backfill.remaining)})
              </button>
            </form>
          )}
        </ControlCard>

        <p className="mt-12 text-[11px] text-even-ink-400">
          Pause/resume choreography is wired on top of these.
          For now, every state change here surfaces immediately on{' '}
          <Link href="/dashboard" className="underline hover:text-even-navy">
            /dashboard
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums text-even-navy">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-even-ink-500">
        {label}
      </div>
    </div>
  );
}

function ControlCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-xl border border-even-ink-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
        {title}
      </h2>
      <p className="mb-3 text-xs text-even-ink-600">{description}</p>
      {children}
    </div>
  );
}
