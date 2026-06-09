/**
 * /triage — Triage Nurse workstation (v2.0.4.1).
 *
 * Lists every today encounter in 'registered' or 'at_triage' state.
 * Tabs across the top let the nurse filter by room: All / OPD-1 / …
 * Each card shows patient name, age/sex, MRN, CCE-captured visit
 * reason, time since registration, and a [Capture vitals →] button
 * that flips to at_triage and routes to /triage/[id].
 *
 * Cards already in at_triage show a small amber tag so two nurses
 * don't race; clicking still opens the form (last save wins).
 *
 * Selected-room state lives in the URL (?room=<id>) so refreshes
 * preserve the filter.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { QueueLive } from '@/components/QueueLive';
import { actionStartTriage } from './actions';

export const dynamic = 'force-dynamic';

type RoomRow = { id: string; name: string };
type Card = {
  encounter_id: string;
  encounter_number: string;
  status: 'registered' | 'at_triage';
  registered_at: string | null;
  patient_id: string;
  patient_name: string;
  patient_mrn: string;
  patient_age_years: number;
  patient_sex: 'M' | 'F' | 'O';
  intake_visit_reason: string | null;
  room_id: string;
  room_name: string;
  doctor_name: string | null;
};

function relativeAge(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m ago`;
}

export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const sp = await searchParams;
  const selectedRoomId = sp.room ?? 'all';

  const [roomsRes, cardsRes] = await Promise.all([
    pool.query<RoomRow>(
      `SELECT id, name FROM opd_rooms WHERE active = TRUE ORDER BY name ASC`,
    ),
    pool.query<Card>(
      `SELECT e.id AS encounter_id, e.encounter_number,
              e.status::text AS status,
              e.registered_at::text AS registered_at,
              p.id AS patient_id, p.name AS patient_name, p.mrn AS patient_mrn,
              p.age_years AS patient_age_years, p.sex AS patient_sex,
              e.intake_visit_reason,
              e.room_id, r.name AS room_name,
              d.name AS doctor_name
         FROM encounters e
         JOIN patients p ON p.id = e.patient_id
         JOIN opd_rooms r ON r.id = e.room_id
         LEFT JOIN doctors d ON d.id = e.doctor_id
        WHERE e.encounter_date = CURRENT_DATE
          AND e.status IN ('registered','at_triage')
        ORDER BY e.registered_at ASC NULLS LAST`,
    ),
  ]);

  const cards = cardsRes.rows;
  const filtered =
    selectedRoomId === 'all'
      ? cards
      : cards.filter((c) => c.room_id === selectedRoomId);

  const countByRoom = new Map<string, number>();
  for (const c of cards) {
    countByRoom.set(c.room_id, (countByRoom.get(c.room_id) ?? 0) + 1);
  }

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <QueueLive channel="queue:global" />
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="h-7 w-7 rounded-full bg-amber-500 ring-4 ring-amber-100"
            />
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-even-navy">
              Even OPD · Triage
            </span>
          </div>
          <div className="text-xs text-even-ink-500">
            {session.email}
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
            >
              Sign out
            </button>
          </form>
        </div>
        <div className="mx-auto max-w-5xl px-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-even-navy">
            Triage queue
          </h1>
          <p className="text-xs text-even-ink-500">
            {cards.length} patient{cards.length === 1 ? '' : 's'} awaiting vitals capture
          </p>
        </div>
        {/* Room tabs */}
        <div className="mx-auto max-w-5xl px-6 pb-3">
          <div className="flex flex-wrap gap-2">
            <RoomTab
              label="All"
              count={cards.length}
              href="/triage"
              active={selectedRoomId === 'all'}
            />
            {roomsRes.rows.map((r) => (
              <RoomTab
                key={r.id}
                label={r.name}
                count={countByRoom.get(r.id) ?? 0}
                href={`/triage?room=${r.id}`}
                active={selectedRoomId === r.id}
              />
            ))}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-8">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-even-ink-200 bg-white p-8 text-center">
            <p className="text-sm text-even-ink-500">
              No patients waiting for triage in this lane.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((c) => (
              <TriageCard key={c.encounter_id} card={c} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function RoomTab({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-amber-400 bg-amber-50 text-amber-900'
          : 'border-even-ink-200 bg-white text-even-ink-600 hover:border-amber-300 hover:text-amber-800'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
          active ? 'bg-amber-200 text-amber-900' : 'bg-even-ink-100 text-even-ink-600'
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

function TriageCard({ card: c }: { card: Card }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-even-ink-200 bg-white p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-base font-semibold text-even-navy">
            {c.patient_name}
          </span>
          <span className="text-xs text-even-ink-500">
            {c.patient_age_years}
            {c.patient_sex} · <span className="font-mono">{c.patient_mrn}</span>
          </span>
          {c.status === 'at_triage' && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
              in progress
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-even-ink-700">
          {c.intake_visit_reason ?? <em className="text-even-ink-400">no reason captured</em>}
        </p>
        <p className="mt-0.5 text-[11px] uppercase tracking-wider text-even-ink-500">
          {c.room_name}
          {c.doctor_name ? ` · ${c.doctor_name}` : ''}
          {' · registered '}
          {relativeAge(c.registered_at)}
        </p>
      </div>
      <form action={actionStartTriage}>
        <input type="hidden" name="encounter_id" value={c.encounter_id} />
        <button
          type="submit"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
        >
          Capture vitals →
        </button>
      </form>
    </li>
  );
}
