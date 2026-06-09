/**
 * /triage/[encounterId] — vitals capture form (v2.0.4.2).
 *
 * Server component: validates that the encounter is in triage-eligible
 * state and renders the <VitalsForm> client component for input.
 *
 * Wrong states bounce back to /triage:
 *   completed / paused_diagnostics / ready_to_resume / active /
 *   waiting_for_doctor  →  redirect (nothing for the nurse to do)
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { VitalsForm } from '@/components/VitalsForm';

export const dynamic = 'force-dynamic';

type Row = {
  encounter_id: string;
  encounter_number: string;
  status: string;
  intake_visit_reason: string | null;
  patient_id: string;
  patient_name: string;
  patient_mrn: string;
  patient_age_years: number;
  patient_sex: 'M' | 'F' | 'O';
  patient_phone: string | null;
  patient_allergies: string | null;
  room_name: string;
  doctor_name: string | null;
};

export default async function TriageDetailPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const { encounterId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(encounterId)) notFound();

  const { rows } = await pool.query<Row>(
    `SELECT e.id AS encounter_id, e.encounter_number,
            e.status::text AS status,
            e.intake_visit_reason,
            p.id AS patient_id, p.name AS patient_name, p.mrn AS patient_mrn,
            p.age_years AS patient_age_years, p.sex AS patient_sex,
            p.phone_e164 AS patient_phone, p.known_allergies AS patient_allergies,
            r.name AS room_name, d.name AS doctor_name
       FROM encounters e
       JOIN patients p ON p.id = e.patient_id
       JOIN opd_rooms r ON r.id = e.room_id
       LEFT JOIN doctors d ON d.id = e.doctor_id
      WHERE e.id = $1
      LIMIT 1`,
    [encounterId],
  );
  const row = rows[0];
  if (!row) notFound();

  if (row.status !== 'registered' && row.status !== 'at_triage') {
    redirect('/triage');
  }

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link
            href="/triage"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Back to queue
          </Link>
          <span className="text-[10px] font-mono text-even-ink-400">
            {row.encounter_number} · {row.status.replace('_', ' ')}
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
        {/* Patient banner */}
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/40 p-5">
          <h1 className="text-2xl font-semibold tracking-tight text-even-navy">
            {row.patient_name}
          </h1>
          <p className="mt-1 text-sm text-even-ink-600">
            {row.patient_age_years} y / {row.patient_sex}
            {' · '}
            <span className="font-mono">{row.patient_mrn}</span>
            {row.patient_phone && (
              <>
                {' · '}
                <span className="font-mono text-even-ink-500">{row.patient_phone}</span>
              </>
            )}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wider text-even-ink-500">
            {row.room_name}
            {row.doctor_name ? ` · ${row.doctor_name}` : ''}
          </p>
          {row.patient_allergies && (
            <p className="mt-3 inline-flex items-center gap-1 rounded-md bg-even-pink-100 px-2 py-1 text-xs font-medium text-even-pink-800">
              ⚠ Allergies: {row.patient_allergies}
            </p>
          )}
        </div>

        <VitalsForm
          encounterId={row.encounter_id}
          patientName={row.patient_name}
          patientMrn={row.patient_mrn}
          patientAge={row.patient_age_years}
          patientSex={row.patient_sex}
          ccePrefilledReason={row.intake_visit_reason}
        />
      </section>
    </main>
  );
}
