/**
 * Encounter lifecycle helpers — used by server actions and API routes.
 *
 * `encounter_number` format: ENC-YYYYMMDD-NNN. We allocate NNN by
 * counting the doctor's encounters today + 1, which is racy under
 * concurrency but fine for the demo's single-doctor pace. Real prod
 * will swap in a per-doctor daily sequence.
 */
import { pool } from '@/lib/db';

export async function startEncounterForPatient(opts: {
  patient_id: string;
  doctor_email: string;
}): Promise<{ encounter_id: string; encounter_number: string }> {
  const { rows: doctorRows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE lower(email) = $1 LIMIT 1',
    [opts.doctor_email.toLowerCase()],
  );
  const doctorId = doctorRows[0]?.id;
  if (!doctorId) throw new Error('doctor_not_seeded');

  // Reuse a same-day active encounter if one exists for this patient+doctor
  const { rows: existing } = await pool.query<{
    id: string;
    encounter_number: string;
  }>(
    `SELECT id, encounter_number
     FROM encounters
     WHERE patient_id = $1 AND doctor_id = $2 AND encounter_date = CURRENT_DATE
       AND status IN ('active', 'paused_diagnostics', 'ready_to_resume')
     ORDER BY started_at DESC
     LIMIT 1`,
    [opts.patient_id, doctorId],
  );
  if (existing[0]) {
    return {
      encounter_id: existing[0].id,
      encounter_number: existing[0].encounter_number,
    };
  }

  // Sequence number for today
  const { rows: seqRows } = await pool.query<{ next: string }>(
    `SELECT LPAD((COUNT(*) + 1)::text, 3, '0') AS next
     FROM encounters
     WHERE doctor_id = $1 AND encounter_date = CURRENT_DATE`,
    [doctorId],
  );
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const encNo = `ENC-${yyyymmdd}-${seqRows[0]?.next ?? '001'}`;

  const { rows: created } = await pool.query<{ id: string }>(
    `INSERT INTO encounters (
       encounter_number, patient_id, doctor_id, status, started_at
     ) VALUES ($1, $2, $3, 'active', NOW())
     RETURNING id`,
    [encNo, opts.patient_id, doctorId],
  );

  return { encounter_id: created[0].id, encounter_number: encNo };
}
