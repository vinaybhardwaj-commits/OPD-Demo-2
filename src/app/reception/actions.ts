'use server';

/**
 * Server actions for /reception (CCE workstation).
 *
 * actionMarkDiagnosticReady — CCE clicks "✓ Result ready" on a paused
 *   encounter when the lab returns the result. Flips status from
 *   paused_diagnostics → ready_to_resume so the doctor sees it in the
 *   "Ready" lane. (v1 had this in /admin/demo-controls; v2 puts it on
 *   the CCE's workstation where it belongs.)
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { notifyRoom } from '@/lib/queueNotify';

async function requireSession(): Promise<void> {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');
}

export async function actionMarkDiagnosticReady(formData: FormData) {
  await requireSession();
  const encounterId = String(formData.get('encounter_id') ?? '');
  if (!encounterId) return;
  const { rows } = await pool.query<{ room_id: string | null }>(
    `UPDATE encounters
        SET status = 'ready_to_resume',
            updated_at = NOW()
      WHERE id = $1
        AND status = 'paused_diagnostics'
      RETURNING room_id`,
    [encounterId],
  );
  await notifyRoom(rows[0]?.room_id ?? null, `lab_ready:${encounterId}`);
  revalidatePath('/reception');
  // Also notify the doctor's dashboard if they're looking at it
  revalidatePath('/dashboard');
}

/**
 * Register a patient for an OPD visit.
 *
 * If existing_patient_id is provided, reuses that patient row; otherwise
 * INSERTs a new one. Then INSERTs an encounter row with status='registered',
 * room_id resolved, doctor_id from the room's default_doctor, intake fields
 * captured. Encounter number is generated from (date, mrn-suffix, sequence).
 *
 * Returns nothing — the page revalidates to show the new patient in the queue.
 */
export async function actionRegisterPatient(formData: FormData) {
  await requireSession();
  const session = await getCurrentUser();
  if (!session) return;

  // CCE who's registering (for audit attribution).
  const { rows: cceRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const cceId = cceRows[0]?.id ?? null;

  // Existing or new patient.
  const existingId = String(formData.get('existing_patient_id') ?? '').trim() || null;
  const roomId = String(formData.get('room_id') ?? '').trim();
  const visitReason = String(formData.get('intake_visit_reason') ?? '').trim();
  if (!roomId || !visitReason) return;

  let patientId: string;
  let patientMrn: string;

  if (existingId) {
    const { rows } = await pool.query<{ id: string; mrn: string }>(
      `SELECT id, mrn FROM patients WHERE id = $1 LIMIT 1`,
      [existingId],
    );
    if (!rows[0]) return;
    patientId = rows[0].id;
    patientMrn = rows[0].mrn;
  } else {
    const name = String(formData.get('name') ?? '').trim();
    const ageStr = String(formData.get('age_years') ?? '').trim();
    const sex = String(formData.get('sex') ?? '').trim();
    const phone = String(formData.get('phone_e164') ?? '').trim();
    const allergies = String(formData.get('known_allergies') ?? '').trim() || null;
    const age = parseInt(ageStr, 10);
    if (!name || !Number.isFinite(age) || age < 0 || !sex || !phone) return;

    // Generate a fresh MRN of the form EHRC-YYYY-NNN — find the next slot.
    const { rows: maxRows } = await pool.query<{ max_n: string | null }>(
      `SELECT MAX(SUBSTRING(mrn FROM 'EHRC-[0-9]+-([0-9]+)')::int)::text AS max_n
         FROM patients WHERE mrn ~ '^EHRC-[0-9]+-[0-9]+$'`,
    );
    const nextSeq = (parseInt(maxRows[0]?.max_n ?? '0', 10) || 0) + 1;
    const year = new Date().getFullYear();
    const mrn = `EHRC-${year}-${String(nextSeq).padStart(3, '0')}`;

    const { rows: ins } = await pool.query<{ id: string }>(
      `INSERT INTO patients (mrn, name, age_years, sex, phone_e164, known_allergies)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [mrn, name, age, sex, phone, allergies],
    );
    patientId = ins[0].id;
    patientMrn = mrn;
  }

  // Resolve the room's default doctor for encounter.doctor_id.
  const { rows: roomRows } = await pool.query<{ default_doctor_id: string | null }>(
    `SELECT default_doctor_id FROM opd_rooms WHERE id = $1 LIMIT 1`,
    [roomId],
  );
  const doctorId = roomRows[0]?.default_doctor_id ?? null;
  if (!doctorId) return; // can't register without a doctor for the room

  // Encounter number: ENC-YYYYMMDD-<mrn_suffix>-<seq today>
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const mrnSfx = patientMrn.split('-').pop() ?? '000';
  const { rows: seqRows } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM encounters
      WHERE encounter_date = CURRENT_DATE AND patient_id = $1`,
    [patientId],
  );
  const seqN = (parseInt(seqRows[0]?.c ?? '0', 10) || 0) + 1;
  const encNumber = `ENC-${ymd}-${mrnSfx}-${String(seqN).padStart(2, '0')}`;

  await pool.query(
    `INSERT INTO encounters
       (encounter_number, patient_id, doctor_id, encounter_date, status,
        started_at, room_id, intake_visit_reason, token_number,
        registered_by_cce_id, registered_at)
     VALUES ($1, $2, $3, CURRENT_DATE, 'registered'::encounter_status,
             NOW(), $4, $5, $6, $7, NOW())`,
    [encNumber, patientId, doctorId, roomId, visitReason, patientMrn, cceId],
  );

  await notifyRoom(roomId, `registered:${encNumber}`);
  revalidatePath('/reception');
  revalidatePath('/triage');
  revalidatePath('/dashboard');
}
