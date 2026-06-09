/**
 * POST /api/admin/seed-v2
 *
 * Idempotent v2 foundation seed. Inserts:
 *   - 10 doctors (V + Chandrika + 8 specialists) + 5 support staff (CCE/Nurse/Lab)
 *   - 10 OPD rooms (one per doctor)
 *   - 50 patients (25 existing skipped on ON CONFLICT, 25 new inserted)
 *   - Historical encounters (4-8 per patient, 12 months back)
 *   - Prescriptions per encounter (one per encounter that has rx_lines)
 *   - Lab orders + lab results
 *   - Doctor overrides
 *
 * Auth: x-migration-secret header must equal MIGRATION_SECRET env var.
 *
 * Idempotency keys:
 *   - doctors / staff: email
 *   - opd_rooms: name
 *   - patients: mrn
 *   - encounters: deterministic encounter_number derived from date + patient
 *   - prescriptions: encounter_id (UNIQUE)
 *   - lab_orders: composite (encounter_id, canonical_key, ordered_at)
 *   - lab_results: composite (lab_order_id, canonical_key) — best-effort
 *   - doctor_overrides: composite (patient_id, target_kind, target_key, created_at)
 *
 * Re-running the endpoint is safe — duplicates are skipped.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  SEED_DOCTORS,
  SEED_STAFF,
  SEED_ROOMS,
  ALL_PATIENTS,
  type SeedPatient,
} from '@/lib/seed-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Stats = {
  doctors_upserted: number;
  staff_upserted: number;
  rooms_upserted: number;
  patients_inserted: number;
  patients_skipped: number;
  encounters_inserted: number;
  prescriptions_inserted: number;
  lab_orders_inserted: number;
  lab_results_inserted: number;
  overrides_inserted: number;
  errors: string[];
};

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

function encounterNumberFor(date: string, mrn: string, idx: number): string {
  // ENC-YYYYMMDD-<mrn_suffix>-<idx>
  const d = date.replaceAll('-', '');
  const suffix = mrn.split('-').pop() ?? '000';
  return `ENC-${d}-${suffix}-${String(idx + 1).padStart(2, '0')}`;
}

function rxNumberFor(encounterNumber: string): string {
  // RX- followed by the encounter's date+suffix part
  return encounterNumber.replace(/^ENC-/, 'RX-');
}

export async function POST(req: Request) {
  const secret = process.env.MIGRATION_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'migration_secret_not_configured' }, { status: 500 });
  }
  if (req.headers.get('x-migration-secret') !== secret) return unauthorized();

  const stats: Stats = {
    doctors_upserted: 0, staff_upserted: 0, rooms_upserted: 0,
    patients_inserted: 0, patients_skipped: 0,
    encounters_inserted: 0, prescriptions_inserted: 0,
    lab_orders_inserted: 0, lab_results_inserted: 0,
    overrides_inserted: 0, errors: [],
  };

  // 1. Doctors + staff (upsert by email, set role/specialty/name).
  for (const d of [...SEED_DOCTORS, ...SEED_STAFF]) {
    try {
      await pool.query(
        `INSERT INTO doctors (email, name, mci_registration_number, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           role = EXCLUDED.role`,
        [d.email, d.name, d.mci_registration_number, d.role],
      );
      if (d.role === 'doctor') stats.doctors_upserted++;
      else stats.staff_upserted++;
    } catch (e) {
      stats.errors.push(`doctor ${d.email}: ${(e as Error).message}`);
    }
  }

  // Build email→id map for FK resolution
  const { rows: docRows } = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM doctors`,
  );
  const doctorByEmail = new Map<string, string>();
  for (const r of docRows) doctorByEmail.set(r.email.toLowerCase(), r.id);

  // 2. OPD rooms (upsert by name).
  for (const r of SEED_ROOMS) {
    try {
      const docId = doctorByEmail.get(r.default_doctor_email.toLowerCase()) ?? null;
      await pool.query(
        `INSERT INTO opd_rooms (name, floor, default_doctor_id, specialty, active)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (name) DO UPDATE SET
           floor = EXCLUDED.floor,
           default_doctor_id = EXCLUDED.default_doctor_id,
           specialty = EXCLUDED.specialty`,
        [r.name, r.floor, docId, r.specialty],
      );
      stats.rooms_upserted++;
    } catch (e) {
      stats.errors.push(`room ${r.name}: ${(e as Error).message}`);
    }
  }

  // Build room name→id map.
  const { rows: roomRows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM opd_rooms`,
  );
  const roomByName = new Map<string, string>();
  for (const r of roomRows) roomByName.set(r.name, r.id);

  // 3. Patients (skip-if-exists by MRN). Then per-patient: encounters, prescriptions, labs, overrides.
  for (const p of ALL_PATIENTS) {
    try {
      const { rows: existing } = await pool.query<{ id: string }>(
        `SELECT id FROM patients WHERE mrn = $1 LIMIT 1`, [p.mrn]
      );
      let patientId: string;
      if (existing[0]) {
        patientId = existing[0].id;
        stats.patients_skipped++;
      } else {
        const { rows: ins } = await pool.query<{ id: string }>(
          `INSERT INTO patients (mrn, name, age_years, sex, phone_e164, known_allergies)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [p.mrn, p.name, p.age_years, p.sex, p.phone_e164, p.known_allergies],
        );
        patientId = ins[0].id;
        stats.patients_inserted++;
      }

      await seedPatientHistory(p, patientId, doctorByEmail, roomByName, stats);
    } catch (e) {
      stats.errors.push(`patient ${p.mrn}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, stats });
}

async function seedPatientHistory(
  p: SeedPatient,
  patientId: string,
  doctorByEmail: Map<string, string>,
  roomByName: Map<string, string>,
  stats: Stats,
) {
  // 3a. Encounters — keyed by encounter_number.
  const encByDateAndDoctor = new Map<string, string>(); // date|doctor_email → encounter_id

  for (let idx = 0; idx < p.encounters.length; idx++) {
    const e = p.encounters[idx];
    const encNumber = encounterNumberFor(e.date, p.mrn, idx);
    const docId = doctorByEmail.get(e.doctor_email.toLowerCase());
    if (!docId) continue;

    // Skip if already exists.
    const { rows: existing } = await pool.query<{ id: string }>(
      `SELECT id FROM encounters WHERE encounter_number = $1 LIMIT 1`, [encNumber]
    );
    if (existing[0]) {
      encByDateAndDoctor.set(`${e.date}|${e.doctor_email}`, existing[0].id);
      continue;
    }

    const roomId = e.room_name ? roomByName.get(e.room_name) ?? null : null;
    const status = e.status ?? 'completed';
    const vitalsJson = e.vitals ? JSON.stringify(e.vitals) : null;

    // Encounter timing: started_at = date 10am, completed_at = date 10:15am (for historicals)
    const startedAt = `${e.date} 10:00:00+05:30`;
    const completedAt = status === 'completed' ? `${e.date} 10:15:00+05:30` : null;

    const { rows: ins } = await pool.query<{ id: string }>(
      `INSERT INTO encounters (
         encounter_number, patient_id, doctor_id, encounter_date, status,
         started_at, completed_at,
         chief_complaint_chips, chief_complaint_text,
         exam_findings, vitals,
         assessment_codes, assessment_text,
         disposition, follow_up_days, referral_target,
         handoff_note, room_id, intake_visit_reason, token_number
       )
       VALUES ($1, $2, $3, $4, $5::encounter_status,
               $6::timestamptz, $7::timestamptz,
               $8::text[], $9,
               $10, $11::jsonb,
               $12::text[], $13,
               $14::disposition_kind, $15, $16,
               $17, $18, $19, $20)
       RETURNING id`,
      [
        encNumber, patientId, docId, e.date, status,
        startedAt, completedAt,
        e.cc_chips, e.cc_text,
        e.exam_findings, vitalsJson,
        e.assessment_codes, e.assessment_text,
        e.disposition || null, e.follow_up_days ?? null, e.referral_target ?? null,
        e.handoff_note ?? null, roomId, e.intake_visit_reason ?? null, p.mrn,
      ],
    );
    const encId = ins[0].id;
    encByDateAndDoctor.set(`${e.date}|${e.doctor_email}`, encId);
    stats.encounters_inserted++;

    // Prescription row (only if rx_lines non-empty).
    if (e.rx_lines.length > 0) {
      const rxNum = rxNumberFor(encNumber);
      try {
        await pool.query(
          `INSERT INTO prescriptions (encounter_id, prescription_number, generated_at, lines)
           VALUES ($1, $2, $3::timestamptz, $4::jsonb)
           ON CONFLICT (encounter_id) DO NOTHING`,
          [encId, rxNum, completedAt ?? startedAt, JSON.stringify(e.rx_lines)],
        );
        stats.prescriptions_inserted++;
      } catch (e2) {
        stats.errors.push(`prescription ${encNumber}: ${(e2 as Error).message}`);
      }
    }
  }

  // 3b. Lab cycles → lab_orders + lab_results.
  for (const cycle of p.lab_cycles) {
    const docId = doctorByEmail.get(cycle.ordering_doctor_email.toLowerCase());
    if (!docId) continue;
    // Resolve linked encounter (best effort).
    let linkedEncId: string | null = null;
    if (cycle.link_to_encounter_date) {
      const key = `${cycle.link_to_encounter_date}|${cycle.ordering_doctor_email}`;
      linkedEncId = encByDateAndDoctor.get(key) ?? null;
    }
    if (!linkedEncId) {
      // Fallback to nearest encounter (by date) for this patient.
      const { rows: nearest } = await pool.query<{ id: string }>(
        `SELECT id FROM encounters WHERE patient_id = $1
         ORDER BY ABS(EXTRACT(EPOCH FROM (encounter_date::timestamptz - $2::timestamptz))) ASC
         LIMIT 1`,
        [patientId, cycle.date],
      );
      linkedEncId = nearest[0]?.id ?? null;
    }
    if (!linkedEncId) continue;

    const orderIdByKey = new Map<string, string>();
    for (const o of cycle.orders) {
      // Idempotency: skip if same encounter+canonical_key+ordered_at exists.
      const { rows: existing } = await pool.query<{ id: string }>(
        `SELECT id FROM lab_orders
          WHERE encounter_id = $1 AND canonical_key = $2 AND ordered_at::date = $3::date
          LIMIT 1`,
        [linkedEncId, o.canonical_key, cycle.date],
      );
      if (existing[0]) { orderIdByKey.set(o.canonical_key, existing[0].id); continue; }

      try {
        const { rows: ins } = await pool.query<{ id: string }>(
          `INSERT INTO lab_orders
             (encounter_id, patient_id, ordering_doctor_id, raw_text, canonical_key, display_name,
              status, ordered_at, resulted_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'resulted', $7::timestamptz, $7::timestamptz)
           RETURNING id`,
          [linkedEncId, patientId, docId, o.raw_text, o.canonical_key, o.display_name, `${cycle.date} 09:00:00+05:30`],
        );
        orderIdByKey.set(o.canonical_key, ins[0].id);
        stats.lab_orders_inserted++;
      } catch (e) { stats.errors.push(`lab_order ${p.mrn}/${o.canonical_key}: ${(e as Error).message}`); }
    }

    for (const r of cycle.results) {
      try {
        // Try to find a matching order by canonical_key; otherwise pick the first order from this cycle.
        let orderId: string | null = orderIdByKey.get(r.canonical_key) ?? null;
        if (!orderId && orderIdByKey.size > 0) {
          orderId = Array.from(orderIdByKey.values())[0];
        }
        await pool.query(
          `INSERT INTO lab_results
             (lab_order_id, patient_id, canonical_key, display_name,
              value_numeric, value_text, unit, reference_range, is_critical, entered_by, entered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)`,
          [
            orderId, patientId, r.canonical_key, r.display_name,
            r.value_numeric ?? null, r.value_text ?? null, r.unit ?? null,
            r.reference_range ?? null, r.is_critical ?? false, docId,
            `${cycle.date} 14:00:00+05:30`,
          ],
        );
        stats.lab_results_inserted++;
      } catch (e) { stats.errors.push(`lab_result ${p.mrn}/${r.canonical_key}: ${(e as Error).message}`); }
    }
  }

  // 3c. Doctor overrides.
  for (const ov of p.override_events) {
    const docId = doctorByEmail.get(ov.doctor_email.toLowerCase());
    if (!docId) continue;
    try {
      // Idempotency: skip if existing on (patient_id, target_kind, target_key, created_at::date, action).
      const { rows: existing } = await pool.query<{ id: string }>(
        `SELECT id FROM doctor_overrides
          WHERE patient_id = $1 AND target_kind = $2 AND target_key = $3
            AND created_at::date = $4::date AND action = $5
          LIMIT 1`,
        [patientId, ov.target_kind, ov.target_key, ov.date, ov.action],
      );
      if (existing[0]) continue;

      await pool.query(
        `INSERT INTO doctor_overrides
           (patient_id, doctor_id, target_kind, target_key, action, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
        [
          patientId, docId, ov.target_kind, ov.target_key, ov.action,
          ov.payload ? JSON.stringify(ov.payload) : null,
          `${ov.date} 11:00:00+05:30`,
        ],
      );
      stats.overrides_inserted++;
    } catch (e) { stats.errors.push(`override ${p.mrn}: ${(e as Error).message}`); }
  }
}
