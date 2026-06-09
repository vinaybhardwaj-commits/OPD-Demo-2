/**
 * GET /api/admin/seed-v2-stats
 * Tiny diagnostic — returns row counts across the v2 seed surface.
 * Auth: x-migration-secret header.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.MIGRATION_SECRET;
  if (req.headers.get('x-migration-secret') !== secret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const [
    doctors, doctorsByRole, rooms, patients, encounters,
    completedEnc, prescriptions, labOrders, labResults,
    overrides, summaries, mohanRaoEncs,
  ] = await Promise.all([
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM doctors`),
    pool.query<{ role: string; c: string }>(`SELECT role, COUNT(*)::text c FROM doctors GROUP BY role ORDER BY role`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM opd_rooms`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM patients`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM encounters`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM encounters WHERE status='completed'`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM prescriptions`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM lab_orders`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM lab_results`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM doctor_overrides`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM patient_summaries`),
    pool.query<{ c: string; encounter_number: string; encounter_date: string; status: string; doctor_email: string }>(
      `SELECT e.id::text c, e.encounter_number, e.encounter_date::text AS encounter_date,
              e.status::text AS status, d.email AS doctor_email
         FROM encounters e
         JOIN patients p ON p.id = e.patient_id
         LEFT JOIN doctors d ON d.id = e.doctor_id
        WHERE p.mrn = 'EHRC-2026-012'
        ORDER BY encounter_date DESC`,
    ),
  ]);

  return NextResponse.json({
    ok: true,
    totals: {
      doctors: parseInt(doctors.rows[0].c, 10),
      doctors_by_role: doctorsByRole.rows.map((r) => ({ role: r.role, count: parseInt(r.c, 10) })),
      opd_rooms: parseInt(rooms.rows[0].c, 10),
      patients: parseInt(patients.rows[0].c, 10),
      encounters_total: parseInt(encounters.rows[0].c, 10),
      encounters_completed: parseInt(completedEnc.rows[0].c, 10),
      prescriptions: parseInt(prescriptions.rows[0].c, 10),
      lab_orders: parseInt(labOrders.rows[0].c, 10),
      lab_results: parseInt(labResults.rows[0].c, 10),
      doctor_overrides: parseInt(overrides.rows[0].c, 10),
      patient_summaries: parseInt(summaries.rows[0].c, 10),
    },
    mohan_rao_encounters: mohanRaoEncs.rows,
  });
}
