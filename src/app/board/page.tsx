/**
 * /board — the Clinic Board (Surface A), OPD-Demo-2's new home for the
 * batch / multi-encounter-in-flight choreography. P0.4 SHELL: lanes +
 * cards + processing pills, read-only. Actions wire up in P1.
 *
 * Lanes (design §5.2): To see · In workup · Back & ready · Review queue · Done.
 * Each card shows the two status tracks independently — clinical lane via
 * its column, pipeline state via the processing pill (TracePanel-style).
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentDoctor } from '@/lib/auth';
import { getBoard, type BoardCard } from '@/lib/board';
import { LANE_LABELS, LANE_ORDER, type BoardLane } from '@/lib/lifecycle';

export const dynamic = 'force-dynamic';

const LANE_ACCENT: Record<BoardLane, string> = {
  to_see: 'border-t-even-blue-600',
  in_workup: 'border-t-amber-400',
  back_ready: 'border-t-emerald-500',
  review_queue: 'border-t-violet-500',
  done: 'border-t-even-ink-300',
};

const PROCESSING_PILL: Record<string, { label: string; cls: string }> = {
  idle: { label: 'idle', cls: 'bg-even-ink-100 text-even-ink-500' },
  transcribing: { label: 'transcribing…', cls: 'bg-amber-100 text-amber-800' },
  generating: { label: 'generating note…', cls: 'bg-violet-100 text-violet-800' },
  ready: { label: 'ready', cls: 'bg-emerald-100 text-emerald-800' },
  errored: { label: 'errored', cls: 'bg-red-100 text-red-800' },
};

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  in_room: 'In room',
  out_for_workup: 'Out for workup',
  back_ready: 'Back & ready',
  processing: 'Processing',
  ready_for_review: 'Ready for review',
  finalizing: 'Finalizing',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

const PRIMARY_ACTION: Record<string, string | null> = {
  ready: 'Start',
  in_room: 'Enter room',
  out_for_workup: null,
  back_ready: 'Call back in',
  processing: null,
  ready_for_review: 'Review',
  finalizing: null,
  complete: null,
  cancelled: null,
};

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function Card({ card }: { card: BoardCard }) {
  const pill = PROCESSING_PILL[card.processing_status] ?? PROCESSING_PILL.idle;
  const action = PRIMARY_ACTION[card.clinical_status];
  return (
    <div className="rounded-lg border border-even-ink-200 bg-white p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="truncate text-sm font-semibold text-even-navy-800">
          {card.patient_name}
          <span className="ml-1 font-normal text-even-ink-500">
            {card.age_years}{card.sex ? card.sex : ''}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-even-ink-400">{card.encounter_number}</span>
      </div>

      {card.chief_complaint ? (
        <div className="mt-1 truncate text-xs text-even-ink-600">{card.chief_complaint}</div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-even-ink-100 px-2 py-0.5 text-[10px] font-medium text-even-ink-600">
          {STATUS_LABEL[card.clinical_status] ?? card.clinical_status}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${pill.cls}`}>
          {card.processing_status === 'idle' ? 'pipeline idle' : pill.label}
        </span>
        {card.session_count > 0 ? (
          <span className="rounded-full bg-even-blue-50 px-2 py-0.5 text-[10px] font-medium text-even-blue-700">
            {card.session_count} session{card.session_count > 1 ? 's' : ''}
          </span>
        ) : null}
        {card.has_note_draft ? (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
            draft ✓
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-even-ink-400">{fmtTime(card.started_at)}</span>
        {action ? (
          <Link
            href={`/dashboard/encounters/${card.id}`}
            className="rounded-md bg-even-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-even-blue-700"
          >
            {action}
          </Link>
        ) : (
          <Link
            href={`/dashboard/encounters/${card.id}`}
            className="text-[11px] font-medium text-even-blue-600 hover:underline"
          >
            View
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function BoardPage() {
  const session = await getCurrentDoctor();
  if (!session) redirect('/auth/login');

  const lanes = await getBoard();

  return (
    <main className="min-h-screen bg-even-white-cream px-4 py-5">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-even-navy-800">Clinic Board</h1>
          <div className="flex items-center gap-3 text-xs text-even-ink-500">
            <Link href="/dashboard" className="text-even-blue-600 hover:underline">
              Classic queue
            </Link>
            <span>{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {LANE_ORDER.map((lane) => (
            <section
              key={lane}
              className={`rounded-xl border border-even-ink-200 border-t-4 bg-even-ink-50/50 ${LANE_ACCENT[lane]}`}
            >
              <header className="flex items-center justify-between px-3 pb-1 pt-2.5">
                <h2 className="text-xs font-bold uppercase tracking-wide text-even-ink-600">
                  {LANE_LABELS[lane]}
                </h2>
                <span className="rounded-full bg-even-ink-100 px-1.5 text-[10px] font-semibold text-even-ink-500">
                  {lanes[lane].length}
                </span>
              </header>
              <div className="flex flex-col gap-2 p-2">
                {lanes[lane].length === 0 ? (
                  <div className="rounded-lg border border-dashed border-even-ink-200 p-3 text-center text-[11px] text-even-ink-400">
                    Empty
                  </div>
                ) : (
                  lanes[lane].map((c) => <Card key={c.id} card={c} />)
                )}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-4 text-[11px] text-even-ink-400">
          P0 shell — cards are read-only; Start / Call back in / Review wire up in P1+. Both status
          tracks shown: clinical lane + background pipeline pill.
        </p>
      </div>
    </main>
  );
}
