/**
 * Demo data seed helpers.
 *
 * The initial seed lives in migration v3 (immutable, run once). This
 * module mirrors the same shape and exposes it as callable functions so
 * the /admin/demo-controls panel can reset the queue between demos
 * without touching migrations.
 *
 * The encounter VALUES below are the same as migration v3 — kept
 * deliberately duplicated. If a real second seed is needed in the
 * future, this becomes the single source of truth and migration v3
 * stays where it is for audit purposes.
 */
import { pool } from '@/lib/db';

const TODAYS_ENCOUNTERS_VALUES = `(VALUES
  -- COMPLETED (12)
  ('ENC-20260518-001', 'EHRC-2026-001', 'completed'::text, NOW() - INTERVAL '3h 30m', NOW() - INTERVAL '3h 18m', NULL::text, NULL::text, 'Sore throat 3 days, low-grade fever',                'Mildly inflamed pharynx, no exudate, afebrile on exam',           'Acute pharyngitis, likely viral',                          'discharge'::text, NULL::int),
  ('ENC-20260518-002', 'EHRC-2026-002', 'completed', NOW() - INTERVAL '3h 15m', NOW() - INTERVAL '2h 50m', NULL, NULL, 'Hypertension follow-up, BP 148/92 home readings',           'BP 144/88 in clinic, HR 76 regular, no edema',                    'Essential HTN — sub-optimal control on current regimen',   'follow_up',     14),
  ('ENC-20260518-003', 'EHRC-2026-003', 'completed', NOW() - INTERVAL '2h 55m', NOW() - INTERVAL '2h 38m', NULL, NULL, 'Knee pain x 2 weeks, worse on stairs',                       'Crepitus right knee, no effusion, ROM 0-110 painful at extreme',  'Right knee osteoarthritis',                                'refer',         NULL),
  ('ENC-20260518-004', 'EHRC-2026-004', 'completed', NOW() - INTERVAL '2h 40m', NOW() - INTERVAL '2h 28m', NULL, NULL, 'Annual check-up, no complaints',                             'Unremarkable. BP 122/78, BMI 24.6.',                              'Healthy adult, due for routine bloods',                    'discharge',     NULL),
  ('ENC-20260518-005', 'EHRC-2026-005', 'completed', NOW() - INTERVAL '2h 25m', NOW() - INTERVAL '2h 10m', NULL, NULL, 'Migraine recurrence, 2nd episode this month',                'Neuro grossly intact, no focal deficit, no nuchal rigidity',      'Migraine without aura',                                    'follow_up',     30),
  ('ENC-20260518-006', 'EHRC-2026-006', 'completed', NOW() - INTERVAL '2h 10m', NOW() - INTERVAL '1h 55m', NULL, NULL, 'Type 2 DM review, fasting BSL 162',                          'Feet exam normal, no ulcers, dorsalis pedis pulses palpable',     'T2DM — fair control, HbA1c due',                           'follow_up',     30),
  ('ENC-20260518-007', 'EHRC-2026-007', 'completed', NOW() - INTERVAL '1h 55m', NOW() - INTERVAL '1h 40m', NULL, NULL, 'Acid reflux, worse at night',                                'Soft non-tender abdomen, no organomegaly',                        'GERD',                                                     'discharge',     NULL),
  ('ENC-20260518-008', 'EHRC-2026-008', 'completed', NOW() - INTERVAL '1h 40m', NOW() - INTERVAL '1h 22m', NULL, NULL, 'Chest discomfort on exertion, x 5 days',                     'BP 152/90, HR 88, S1S2 normal, no murmur, lungs clear',           'Suspected stable angina — for cardiology referral',        'refer',         NULL),
  ('ENC-20260518-009', 'EHRC-2026-009', 'completed', NOW() - INTERVAL '1h 25m', NOW() - INTERVAL '1h 12m', NULL, NULL, 'UTI symptoms x 2 days',                                       'No costovertebral angle tenderness, suprapubic mild',             'Uncomplicated lower UTI',                                  'discharge',     NULL),
  ('ENC-20260518-010', 'EHRC-2026-010', 'completed', NOW() - INTERVAL '1h 10m', NOW() - INTERVAL '58m',    NULL, NULL, 'Back pain after lifting, x 4 days',                          'Para-spinal muscle tenderness L4-L5, SLR negative bilaterally',   'Mechanical low back pain',                                 'discharge',     NULL),
  ('ENC-20260518-011', 'EHRC-2026-011', 'completed', NOW() - INTERVAL '55m',    NOW() - INTERVAL '42m',    NULL, NULL, 'Allergic rhinitis flare, sneezing + post-nasal drip',         'Nasal mucosa pale and boggy, no sinus tenderness',                'Allergic rhinitis',                                        'discharge',     NULL),
  ('ENC-20260518-012', 'EHRC-2026-012', 'completed', NOW() - INTERVAL '40m',    NOW() - INTERVAL '28m',    NULL, NULL, 'Routine BP + diabetes review',                                'BP 138/82, weight stable, no edema',                              'HTN + T2DM, both well-controlled',                         'follow_up',     90),

  -- PAUSED for diagnostics (3) — disposition empty, completed_at NULL
  ('ENC-20260518-013', 'EHRC-2026-013', 'paused_diagnostics'::text, NOW() - INTERVAL '35m', NULL, 'diagnostics'::text, 'Chest x-ray'::text,         'Cough + low-grade fever x 6 days',                'Right lower zone crackles, RR 22, SpO2 97%',                'Suspected pneumonia — awaiting CXR',                       ''::text, NULL::int),
  ('ENC-20260518-014', 'EHRC-2026-014', 'paused_diagnostics',       NOW() - INTERVAL '28m', NULL, 'diagnostics',       'ECG',                       'Palpitations + occasional dizziness, x 2 weeks',  'BP 130/82, HR 92 irregular, no S3/S4',                       'R/o arrhythmia — awaiting ECG',                            '',       NULL),
  ('ENC-20260518-015', 'EHRC-2026-015', 'paused_diagnostics',       NOW() - INTERVAL '20m', NULL, 'diagnostics',       'USG abdomen',               'RUQ pain + nausea, fatty food intolerance, x 1mo','Mild RUQ tenderness, no rebound, Murphy negative',           'R/o cholelithiasis — awaiting USG',                        '',       NULL),

  -- READY TO RESUME (2)
  ('ENC-20260518-016', 'EHRC-2026-016', 'ready_to_resume'::text, NOW() - INTERVAL '1h 5m', NULL, 'diagnostics'::text, 'CBC + CRP'::text,   'Fever x 4 days, no localising symptoms', 'Looks well, no rash, no neck stiffness, BP 118/74',  'Pyrexia of unknown origin — workup pending', '', NULL),
  ('ENC-20260518-017', 'EHRC-2026-017', 'ready_to_resume',       NOW() - INTERVAL '50m',   NULL, 'diagnostics',       'Urine routine',     'Burning micturition x 3 days',           'Suprapubic tenderness, no flank tenderness',          'R/o UTI — urine sent',                        '', NULL)
) v(enc_no, mrn, status, started_at, completed_at, paused_reason, pending_diagnostic_test, cc, exam, assessment, disposition, follow_up_days)`;

/**
 * Wipes today's encounters for the given doctor and reseeds the 17
 * starter encounters. Patients and the doctor row are untouched.
 *
 * Returns counts so the UI can show what just happened.
 */
export async function resetTodaysEncounters(
  doctorEmail: string,
): Promise<{ deleted: number; inserted: number }> {
  const { rows: docRows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE lower(email) = $1 LIMIT 1',
    [doctorEmail.toLowerCase()],
  );
  const doctorId = docRows[0]?.id;
  if (!doctorId) throw new Error('doctor_not_seeded');

  const { rowCount: deleted } = await pool.query(
    'DELETE FROM encounters WHERE doctor_id = $1 AND encounter_date = CURRENT_DATE',
    [doctorId],
  );

  const insertResult = await pool.query(
    `INSERT INTO encounters (
       encounter_number, patient_id, doctor_id, encounter_date,
       status, started_at, completed_at, paused_reason, pending_diagnostic_test,
       chief_complaint_text, exam_findings, assessment_text,
       disposition, follow_up_days
     )
     SELECT
       v.enc_no, p.id, d.id, CURRENT_DATE,
       v.status::encounter_status, v.started_at, v.completed_at,
       v.paused_reason, v.pending_diagnostic_test,
       v.cc, v.exam, v.assessment,
       NULLIF(v.disposition, '')::disposition_kind, v.follow_up_days
     FROM ${TODAYS_ENCOUNTERS_VALUES}
     JOIN patients p ON p.mrn = v.mrn
     JOIN doctors d  ON d.id = $1
     ON CONFLICT (encounter_number) DO NOTHING`,
    [doctorId],
  );

  return {
    deleted: deleted ?? 0,
    inserted: insertResult.rowCount ?? 0,
  };
}

// Walk-in name pool — same Bangalore-area-realistic mix as the patient seed,
// distinct names from the original 25.
const WALK_INS: { name: string; sex: 'M' | 'F'; age_years: number }[] = [
  { name: 'Sneha Acharya',  sex: 'F', age_years: 31 },
  { name: 'Karan Malhotra', sex: 'M', age_years: 36 },
  { name: 'Anushka Kapoor', sex: 'F', age_years: 28 },
  { name: 'Yash Tripathi',  sex: 'M', age_years: 39 },
  { name: 'Sapna Iyengar',  sex: 'F', age_years: 45 },
  { name: 'Vinod Choudhary',sex: 'M', age_years: 56 },
  { name: 'Bhavya Mahesh',  sex: 'F', age_years: 25 },
  { name: 'Tarun Bose',     sex: 'M', age_years: 41 },
  { name: 'Mahima Sinha',   sex: 'F', age_years: 33 },
  { name: 'Hemant Khanna',  sex: 'M', age_years: 48 },
];

/**
 * Inserts one walk-in patient. MRN auto-allocated as next sequential
 * EHRC-2026-NNN. Phone uses a fake +91 99999-NNN-NNN block clearly
 * distinct from the original seed range.
 */
export async function addWalkInPatient(): Promise<{
  mrn: string;
  name: string;
  age_years: number;
  sex: string;
}> {
  // Allocate next MRN
  const { rows: mrnRows } = await pool.query<{ next: string }>(
    `SELECT 'EHRC-2026-' || LPAD((COALESCE(MAX(SUBSTRING(mrn FROM '\\d+$')::int), 0) + 1)::text, 3, '0') AS next
     FROM patients
     WHERE mrn LIKE 'EHRC-2026-%'`,
  );
  const nextMrn = mrnRows[0]?.next ?? 'EHRC-2026-026';

  // Pick a name we haven't used (cycle if all 10 are gone)
  const { rows: usedRows } = await pool.query<{ name: string }>(
    'SELECT name FROM patients WHERE name = ANY($1)',
    [WALK_INS.map((w) => w.name)],
  );
  const usedSet = new Set(usedRows.map((r) => r.name));
  const fresh = WALK_INS.find((w) => !usedSet.has(w.name)) ?? WALK_INS[Math.floor(Math.random() * WALK_INS.length)];

  const phoneTail = nextMrn.slice(-3);
  const phone = `+9199999${phoneTail.padStart(6, '0')}`;

  await pool.query(
    `INSERT INTO patients (mrn, name, age_years, sex, phone_e164)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (mrn) DO NOTHING`,
    [nextMrn, fresh.name, fresh.age_years, fresh.sex, phone],
  );

  return {
    mrn: nextMrn,
    name: fresh.name,
    age_years: fresh.age_years,
    sex: fresh.sex,
  };
}

/**
 * Flips a `paused_diagnostics` encounter to `ready_to_resume`. Demo
 * stand-in for the Pulse event "diagnostic result available."
 */
export async function markDiagnosticReady(
  encounterId: string,
  doctorEmail: string,
): Promise<{ ok: true; encounter_number: string } | { ok: false; error: string }> {
  const { rows } = await pool.query<{
    id: string;
    status: string;
    encounter_number: string;
  }>(
    `SELECT e.id, e.status::text AS status, e.encounter_number
     FROM encounters e
     JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 AND lower(d.email) = $2
     LIMIT 1`,
    [encounterId, doctorEmail.toLowerCase()],
  );
  const enc = rows[0];
  if (!enc) return { ok: false, error: 'not_found' };
  if (enc.status !== 'paused_diagnostics') {
    return { ok: false, error: `wrong_status:${enc.status}` };
  }
  await pool.query(
    `UPDATE encounters SET status = 'ready_to_resume', updated_at = NOW()
     WHERE id = $1`,
    [encounterId],
  );
  return { ok: true, encounter_number: enc.encounter_number };
}

/**
 * Light status snapshot for the admin page.
 */
export async function getDemoStatus(doctorEmail: string): Promise<{
  doctor_id: string | null;
  total_patients: number;
  encounters_today: number;
  by_status: Record<string, number>;
  paused_encounters: Array<{ id: string; encounter_number: string; patient_name: string; pending_diagnostic_test: string | null }>;
}> {
  const { rows: docRows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE lower(email) = $1 LIMIT 1',
    [doctorEmail.toLowerCase()],
  );
  const doctorId = docRows[0]?.id ?? null;

  const { rows: patRows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM patients',
  );
  const { rows: encRows } = await pool.query<{ status: string; count: string }>(
    `SELECT e.status::text AS status, COUNT(*)::text AS count
     FROM encounters e
     WHERE e.doctor_id = $1 AND e.encounter_date = CURRENT_DATE
     GROUP BY e.status`,
    [doctorId ?? ''],
  );
  const by_status: Record<string, number> = {};
  let totalEnc = 0;
  for (const r of encRows) {
    const n = parseInt(r.count, 10);
    by_status[r.status] = n;
    totalEnc += n;
  }

  const { rows: pausedRows } = await pool.query<{
    id: string;
    encounter_number: string;
    patient_name: string;
    pending_diagnostic_test: string | null;
  }>(
    `SELECT e.id, e.encounter_number, p.name AS patient_name, e.pending_diagnostic_test
     FROM encounters e
     JOIN patients p ON p.id = e.patient_id
     WHERE e.doctor_id = $1 AND e.encounter_date = CURRENT_DATE
       AND e.status = 'paused_diagnostics'
     ORDER BY e.started_at`,
    [doctorId ?? ''],
  );

  return {
    doctor_id: doctorId,
    total_patients: parseInt(patRows[0]?.count ?? '0', 10),
    encounters_today: totalEnc,
    by_status,
    paused_encounters: pausedRows,
  };
}
