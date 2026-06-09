/**
 * POST /api/admin/seed-v2-dedupe-today
 *
 * Cleans up duplicate today-encounters from the 25 existing v1 patients.
 * v1 inserted ENC-20260518-NNN; seed-v2 inserted ENC-20260518-NNN-08 etc.
 * Both have status='completed' and same patient. Keeps the seed-v2 one
 * (richer narrative), drops the v1 one.
 *
 * Auth: x-migration-secret.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (req.headers.get('x-migration-secret') !== process.env.MIGRATION_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Find v1-style today encounters (short ENC-YYYYMMDD-NNN pattern, no trailing -NN)
  // that have a seed-v2 counterpart for the same patient + date.
  const { rows: dupes } = await pool.query<{ id: string; encounter_number: string }>(
    `SELECT e1.id, e1.encounter_number
       FROM encounters e1
      WHERE e1.encounter_number ~ '^ENC-[0-9]{8}-[0-9]{3}$'
        AND EXISTS (
          SELECT 1 FROM encounters e2
           WHERE e2.patient_id = e1.patient_id
             AND e2.encounter_date = e1.encounter_date
             AND e2.encounter_number ~ '^ENC-[0-9]{8}-[0-9]+-[0-9]{2}$'
        )`,
  );

  let deleted_encounters = 0;
  let deleted_prescriptions = 0;
  for (const r of dupes) {
    try {
      const presDel = await pool.query(`DELETE FROM prescriptions WHERE encounter_id = $1`, [r.id]);
      deleted_prescriptions += presDel.rowCount ?? 0;
      await pool.query(`DELETE FROM section_dictations WHERE encounter_id = $1`, [r.id]).catch(() => {});
      await pool.query(`DELETE FROM encounter_recording_chunks WHERE encounter_id = $1`, [r.id]).catch(() => {});
      await pool.query(`DELETE FROM encounter_recordings WHERE encounter_id = $1`, [r.id]).catch(() => {});
      await pool.query(`DELETE FROM lab_orders WHERE encounter_id = $1`, [r.id]).catch(() => {});
      const del = await pool.query(`DELETE FROM encounters WHERE id = $1`, [r.id]);
      deleted_encounters += del.rowCount ?? 0;
    } catch { /* skip */ }
  }

  return NextResponse.json({ ok: true, deleted_encounters, deleted_prescriptions });
}
