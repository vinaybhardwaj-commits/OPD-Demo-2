/**
 * /reception — CCE workstation (v2.0.3.1).
 *
 * Three regions:
 *   1. Header  — logo + PatientSearch + sign-out
 *   2. Per-room queue grid (10 cards) — each room shows its default
 *      doctor + counts of patients across the 6 v2 states + the visible
 *      patient list
 *   3. Lab / Diagnostics dispatch panel — paused_diagnostics encounters
 *      with "Sent to lab" (visual ack) and "✓ Result ready" (state flip)
 *      buttons
 *
 * Register-patient flow lands in v2.0.3.2. Today the [+ Register
 * patient] button shows a "coming in v2.0.3.2" callout instead.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { PatientSearch } from '@/components/PatientSearch';
import { RegisterPatientModal } from '@/components/RegisterPatientModal';
import { QueueLive } from '@/components/QueueLive';
import { PreStageDiagnosticsButton } from '@/components/PreStageDiagnosticsButton';
import { actionMarkDiagnosticReady } from './actions';

export const dynamic = 'force-dynamic';

type RoomWithQueue = {
  room_id: string;
  room_name: string;
  floor: string | null;
  specialty: string | null;
  doctor_name: string | null;
  active: boolean;
  encounters: EncounterRow[];
};

type EncounterRow = {
  encounter_id: string;
  encounter_number: string;
  status: string;
  patient_id: string;
  patient_name: string;
  patient_mrn: string;
  patient_age_years: number;
  patient_sex: 'M' | 'F' | 'O';
  intake_visit_reason: string | null;
  pending_diagnostic_test: string | null;
  pre_staged_lab_count: number;
};

type LabPending = {
  encounter_id: string;
  encounter_number: string;
  patient_name: string;
  patient_mrn: string;
  pending_diagnostic_test: string | null;
  room_name: string | null;
  doctor_name: string | null;
  started_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  registered: 'registered',
  at_triage: 'at triage',
  waiting_for_doctor: 'ready for doctor',
  active: 'with doctor',
  paused_diagnostics: 'at diagnostics',
  ready_to_resume: 'ready to resume',
};

const STATUS_ORDER = [
  'registered',
  'at_triage',
  'waiting_for_doctor',
  'active',
  'paused_diagnostics',
  'ready_to_resume',
];

const STATUS_PILL: Record<string, string> = {
  registered: 'bg-even-ink-50 border-even-ink-200 text-even-ink-600',
  at_triage: 'bg-amber-50 border-amber-300 text-amber-800',
  waiting_for_doctor: 'bg-even-blue-50 border-even-blue-200 text-even-blue-800',
  active: 'bg-even-blue text-white border-even-blue',
  paused_diagnostics: 'bg-even-pink-50 border-even-pink-200 text-even-pink-800',
  ready_to_resume: 'bg-green-50 border-green-300 text-green-800',
};

export default async function ReceptionPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  // 1. Fetch rooms + their non-completed encounters today.
  const { rows: roomEncRows } = await pool.query<{
    room_id: string;
    room_name: string;
    floor: string | null;
    specialty: string | null;
    doctor_name: string | null;
    room_active: boolean;
    encounter_id: string | null;
    encounter_number: string | null;
    status: string | null;
    patient_id: string | null;
    patient_name: string | null;
    patient_mrn: string | null;
    patient_age_years: number | null;
    patient_sex: 'M' | 'F' | 'O' | null;
    intake_visit_reason: string | null;
    pending_diagnostic_test: string | null;
  }>(
    `SELECT r.id AS room_id, r.name AS room_name, r.floor, r.specialty, r.active AS room_active,
            d.name AS doctor_name,
            e.id AS encounter_id, e.encounter_number,
            e.status::text AS status,
            p.id AS patient_id, p.name AS patient_name, p.mrn AS patient_mrn,
            p.age_years AS patient_age_years, p.sex AS patient_sex,
            e.intake_visit_reason, e.pending_diagnostic_test
       FROM opd_rooms r
       LEFT JOIN doctors d ON d.id = r.default_doctor_id
       LEFT JOIN encounters e ON e.room_id = r.id
            AND e.encounter_date = CURRENT_DATE
            AND e.status NOT IN ('completed')
       LEFT JOIN patients p ON p.id = e.patient_id
      WHERE r.active = TRUE
      ORDER BY r.name ASC, e.started_at ASC`,
  );

  const rooms = new Map<string, RoomWithQueue>();
  for (const r of roomEncRows) {
    let room = rooms.get(r.room_id);
    if (!room) {
      room = {
        room_id: r.room_id,
        room_name: r.room_name,
        floor: r.floor,
        specialty: r.specialty,
        doctor_name: r.doctor_name,
        active: r.room_active,
        encounters: [],
      };
      rooms.set(r.room_id, room);
    }
    if (r.encounter_id && r.patient_id && r.status) {
      room.encounters.push({
        encounter_id: r.encounter_id,
        encounter_number: r.encounter_number ?? '',
        status: r.status,
        patient_id: r.patient_id,
        patient_name: r.patient_name ?? '',
        patient_mrn: r.patient_mrn ?? '',
        patient_age_years: r.patient_age_years ?? 0,
        patient_sex: r.patient_sex ?? 'O',
        intake_visit_reason: r.intake_visit_reason,
        pending_diagnostic_test: r.pending_diagnostic_test,
        pre_staged_lab_count: 0,
      });
    }
  }
  const roomList = Array.from(rooms.values());

  // 1b. Pre-staged lab counts per encounter — for the 🧪 badge on the
  //     CCE pre-stage button.
  const allEncIds = roomList.flatMap((r) => r.encounters.map((e) => e.encounter_id));
  if (allEncIds.length > 0) {
    const { rows: preCounts } = await pool.query<{
      encounter_id: string;
      cnt: string;
    }>(
      `SELECT encounter_id, COUNT(*)::text AS cnt
         FROM lab_orders
         WHERE encounter_id = ANY($1::uuid[]) AND status = 'pre_staged'
         GROUP BY encounter_id`,
      [allEncIds],
    );
    const byId = new Map(preCounts.map((p) => [p.encounter_id, parseInt(p.cnt, 10) || 0]));
    for (const room of roomList) {
      for (const enc of room.encounters) {
        enc.pre_staged_lab_count = byId.get(enc.encounter_id) ?? 0;
      }
    }
  }

  // 2. Lab dispatch panel — every paused encounter across the hospital.
  const { rows: labPending } = await pool.query<LabPending>(
    `SELECT e.id AS encounter_id, e.encounter_number,
            p.name AS patient_name, p.mrn AS patient_mrn,
            e.pending_diagnostic_test,
            r.name AS room_name,
            d.name AS doctor_name,
            e.started_at::text AS started_at
       FROM encounters e
       JOIN patients p ON p.id = e.patient_id
       LEFT JOIN opd_rooms r ON r.id = e.room_id
       LEFT JOIN doctors d ON d.id = e.doctor_id
      WHERE e.status = 'paused_diagnostics'
        AND e.encounter_date = CURRENT_DATE
      ORDER BY e.started_at ASC`,
  );

  // 3. Hospital-wide today counts (header banner).
  const totalToday = roomList.reduce((acc, r) => acc + r.encounters.length, 0);

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <QueueLive channel="queue:global" />
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex shrink-0 items-center gap-3">
            <div
              aria-hidden
              className="h-7 w-7 rounded-full bg-even-blue ring-4 ring-even-blue-100"
            />
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-even-navy">
              Even OPD · Reception
            </span>
          </div>
          <div className="flex-1">
            <PatientSearch />
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <Link
              href="/admin/demo-controls"
              className="text-xs font-medium uppercase tracking-wider text-even-ink-400 hover:text-even-pink-700"
            >
              Demo
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-even-navy">
            Today's queue
          </h1>
          <p className="text-xs text-even-ink-500">
            {session.email} · {totalToday} patients in motion across{' '}
            {roomList.length} active room{roomList.length === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-8">
        {/* Register button */}
        <div className="mb-6 flex items-center justify-between rounded-xl border border-even-blue-200 bg-even-blue-50/40 p-4">
          <div>
            <p className="text-sm font-semibold text-even-navy">
              Register a patient
            </p>
            <p className="text-xs text-even-ink-600">
              Walk-ins or scheduled. Search by phone / name / MRN, or
              fill in fresh details for a new patient.
            </p>
          </div>
          <RegisterPatientModal
            rooms={roomList.map((r) => ({
              id: r.room_id,
              name: r.room_name,
              doctor_name: r.doctor_name,
              queue_count: r.encounters.length,
            }))}
          />
        </div>

        {/* Per-room queue grid */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roomList.map((room) => (
            <RoomQueueCard key={room.room_id} room={room} />
          ))}
        </div>

        {/* Lab dispatch panel */}
        <LabDispatchPanel pending={labPending} />
      </section>
    </main>
  );
}

function RoomQueueCard({ room }: { room: RoomWithQueue }) {
  // Group encounters by status (ordered).
  const byStatus = new Map<string, EncounterRow[]>();
  for (const e of room.encounters) {
    if (!byStatus.has(e.status)) byStatus.set(e.status, []);
    byStatus.get(e.status)!.push(e);
  }
  const ordered: Array<[string, EncounterRow[]]> = STATUS_ORDER.filter(
    (s) => byStatus.has(s),
  ).map((s) => [s, byStatus.get(s)!]);

  return (
    <div className="rounded-xl border border-even-ink-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-even-navy">{room.room_name}</p>
          <p className="text-[10px] uppercase tracking-wider text-even-ink-500">
            {room.doctor_name ?? 'No default doctor'}
            {room.specialty ? ` · ${room.specialty}` : ''}
          </p>
        </div>
        <span className="rounded-full border border-even-ink-200 bg-even-ink-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-ink-600">
          {room.encounters.length}
        </span>
      </div>
      {ordered.length === 0 ? (
        <p className="text-[11px] text-even-ink-400">Quiet — no patients.</p>
      ) : (
        <div className="space-y-2">
          {ordered.map(([status, list]) => (
            <div key={status}>
              <p
                className={`mb-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                  STATUS_PILL[status] ?? STATUS_PILL.registered
                }`}
              >
                {STATUS_LABELS[status] ?? status} · {list.length}
              </p>
              <ul className="space-y-0.5">
                {list.map((e) => (
                  <li
                    key={e.encounter_id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-even-navy">
                        {e.patient_name}
                      </span>
                      <span className="ml-1 text-[10px] text-even-ink-400">
                        {e.patient_age_years}
                        {e.patient_sex}
                      </span>
                      {e.intake_visit_reason && (
                        <span className="ml-1 text-[10px] text-even-ink-500">
                          · {e.intake_visit_reason}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {/* Pre-stage allowed only before doctor starts. */}
                      {(e.status === 'registered' ||
                        e.status === 'at_triage' ||
                        e.status === 'waiting_for_doctor') && (
                        <PreStageDiagnosticsButton
                          encounterId={e.encounter_id}
                          patientName={e.patient_name}
                          existingPreStagedCount={e.pre_staged_lab_count}
                        />
                      )}
                      <span className="font-mono text-[10px] text-even-ink-400">
                        {e.patient_mrn.split('-').pop()}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LabDispatchPanel({ pending }: { pending: LabPending[] }) {
  return (
    <div className="rounded-xl border border-even-pink-200 bg-even-pink-50/30 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-even-pink-900">
          Lab / Diagnostics dispatch
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-even-pink-700">
          {pending.length} waiting on results
        </span>
      </div>
      {pending.length === 0 ? (
        <p className="text-sm text-even-pink-800">
          No patients waiting for results.
        </p>
      ) : (
        <ul className="space-y-2">
          {pending.map((p) => (
            <li
              key={p.encounter_id}
              className="flex items-center justify-between gap-3 rounded-lg border border-even-pink-200 bg-white px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-even-navy">
                  {p.patient_name}{' '}
                  <span className="text-[10px] font-mono text-even-ink-400">
                    {p.patient_mrn}
                  </span>
                </div>
                <div className="text-[11px] text-even-ink-500">
                  {p.room_name ?? '—'} · {p.doctor_name ?? '—'} ·{' '}
                  pending {p.pending_diagnostic_test ?? '—'}
                </div>
              </div>
              <form action={actionMarkDiagnosticReady}>
                <input type="hidden" name="encounter_id" value={p.encounter_id} />
                <button
                  type="submit"
                  className="rounded-md border border-even-blue-300 bg-even-blue-50 px-3 py-1.5 text-[11px] font-semibold text-even-blue-800 hover:bg-even-blue-100"
                >
                  ✓ Result ready
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
