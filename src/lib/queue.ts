/**
 * Shared queue fetcher — used by both the JSON API (/api/queue) and the
 * server-rendered queue page (/dashboard). One source of truth for the
 * SQL + bucketing keeps the two views from drifting.
 *
 * v2.0.5 evolutions:
 *   - QueueCard now carries vitals JSONB, intake_visit_reason,
 *     triage_completed_at, triage_nurse_name so the dashboard cards can
 *     render the vitals tile + intake reason chip.
 *   - Patients in 'registered' or 'at_triage' state are EXCLUDED from
 *     the doctor's queue — they're upstream (still with CCE/nurse). The
 *     doctor only sees patients ready for them.
 *   - 'waiting_for_doctor' AND 'active' both bucket into the "waiting"
 *     lane (which the dashboard relabels as "Vitals captured · ready").
 */
import { pool } from '@/lib/db';

export type QueueStatus =
  | 'waiting'
  | 'registered'
  | 'at_triage'
  | 'active'
  | 'waiting_for_doctor'
  | 'paused_diagnostics'
  | 'ready_to_resume'
  | 'completed';

export type QueueVitals = {
  bp_sys?: number;
  bp_dia?: number;
  hr?: number;
  rr?: number;
  temp_c?: number;
  spo2?: number;
  weight_kg?: number;
  height_cm?: number;
  pain?: number;
};

export type QueueCard = {
  patient_id: string;
  mrn: string;
  name: string;
  age_years: number;
  sex: 'M' | 'F' | 'O';
  phone_e164: string | null;
  known_allergies: string | null;
  encounter_id: string | null;
  encounter_number: string | null;
  status: QueueStatus;
  chief_complaint_text: string | null;
  pending_diagnostic_test: string | null;
  started_at: string | null;
  completed_at: string | null;
  // v2.0.5
  vitals: QueueVitals | null;
  intake_visit_reason: string | null;
  triage_completed_at: string | null;
  triage_nurse_name: string | null;
  room_name: string | null;
};

export type DoctorQueue = {
  doctor: { id: string; email: string; name: string };
  /**
   * v2.3 — Network-wide "Needs review" lane. Encounters with a
   * pending handoff (handoff_note set, no ack yet), across ALL
   * doctors. Any signed-in doctor can claim from this lane.
   */
  needs_review: HandoffCard[];
  ready_to_resume: QueueCard[];
  waiting: QueueCard[];
  at_diagnostics: QueueCard[];
  completed: QueueCard[];
};

export type HandoffCard = {
  encounter_id: string;
  encounter_number: string;
  patient_id: string;
  patient_name: string;
  patient_mrn: string;
  patient_age_years: number;
  patient_sex: 'M' | 'F' | 'O';
  current_doctor_name: string;
  current_doctor_email: string;
  handoff_note: string;
  flagged_at: string;
  room_name: string | null;
};

/**
 * Returns null if the email isn't seeded as a doctor.
 *
 * The query is one round-trip — patients LEFT JOIN LATERAL to their most
 * recent encounter today for this doctor. Patients with no encounter
 * default to status='waiting'. Patients in 'registered' or 'at_triage'
 * are filtered out (they're upstream of the doctor).
 */
export async function getQueueForDoctor(
  email: string,
): Promise<DoctorQueue | null> {
  const { rows: doctorRows } = await pool.query<{
    id: string;
    email: string;
    name: string;
  }>(
    'SELECT id, email, name FROM doctors WHERE lower(email) = $1 LIMIT 1',
    [email.trim().toLowerCase()],
  );
  const doctor = doctorRows[0];
  if (!doctor) return null;

  const { rows } = await pool.query<QueueCard>(
    `
    SELECT
      p.id AS patient_id,
      p.mrn,
      p.name,
      p.age_years,
      p.sex,
      p.phone_e164,
      p.known_allergies,
      e.id AS encounter_id,
      e.encounter_number,
      COALESCE(e.status::text, 'waiting') AS status,
      e.chief_complaint_text,
      e.pending_diagnostic_test,
      e.started_at,
      e.completed_at,
      e.vitals,
      e.intake_visit_reason,
      e.triage_completed_at::text AS triage_completed_at,
      tn.name AS triage_nurse_name,
      r.name AS room_name
    FROM patients p
    LEFT JOIN LATERAL (
      SELECT *
      FROM encounters
      WHERE patient_id = p.id
        AND doctor_id = $1
        AND encounter_date = CURRENT_DATE
      ORDER BY started_at DESC
      LIMIT 1
    ) e ON TRUE
    LEFT JOIN doctors tn ON tn.id = e.triage_nurse_id
    LEFT JOIN opd_rooms r ON r.id = e.room_id
    WHERE e.id IS NOT NULL  -- v2: only patients with an encounter today
    ORDER BY
      CASE COALESCE(e.status::text, 'waiting')
        WHEN 'ready_to_resume' THEN 0
        WHEN 'active' THEN 1
        WHEN 'waiting_for_doctor' THEN 2
        WHEN 'waiting' THEN 3
        WHEN 'paused_diagnostics' THEN 4
        WHEN 'completed' THEN 5
        ELSE 6
      END,
      e.started_at DESC NULLS LAST,
      p.name ASC
    `,
    [doctor.id],
  );

  const ready_to_resume: QueueCard[] = [];
  const waiting: QueueCard[] = [];
  const at_diagnostics: QueueCard[] = [];
  const completed: QueueCard[] = [];
  for (const r of rows) {
    // Skip patients still with CCE / nurse — they're upstream.
    if (r.status === 'registered' || r.status === 'at_triage') continue;
    if (r.status === 'ready_to_resume') ready_to_resume.push(r);
    else if (r.status === 'paused_diagnostics') at_diagnostics.push(r);
    else if (r.status === 'completed') completed.push(r);
    else waiting.push(r); // waiting | waiting_for_doctor | active
  }

  // v2.3 — Network-wide "Needs review" lane: encounters across ALL
  // doctors with a pending handoff. The receiving doctor's queue
  // (the one viewing this dashboard) sees them as claimable cards.
  const { rows: handoffRows } = await pool.query<HandoffCard>(
    `SELECT
       e.id AS encounter_id,
       e.encounter_number,
       p.id AS patient_id,
       p.name AS patient_name,
       p.mrn AS patient_mrn,
       p.age_years AS patient_age_years,
       p.sex AS patient_sex,
       d.name AS current_doctor_name,
       d.email AS current_doctor_email,
       e.handoff_note,
       e.updated_at::text AS flagged_at,
       r.name AS room_name
     FROM encounters e
     JOIN patients p ON p.id = e.patient_id
     JOIN doctors d ON d.id = e.doctor_id
     LEFT JOIN opd_rooms r ON r.id = e.room_id
     WHERE e.handoff_note IS NOT NULL
       AND e.handoff_ack_by IS NULL
       AND e.status NOT IN ('completed')
       AND e.encounter_date = CURRENT_DATE
     ORDER BY e.updated_at DESC
     LIMIT 50`,
  );

  return {
    doctor,
    needs_review: handoffRows,
    ready_to_resume,
    waiting,
    at_diagnostics,
    completed,
  };
}
