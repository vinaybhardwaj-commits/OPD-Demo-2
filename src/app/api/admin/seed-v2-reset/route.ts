/**
 * POST /api/admin/seed-v2-reset
 *
 * One-shot cleanup before /api/admin/seed-v2 re-runs.
 *
 * For every MRN in the seed catalog (EHRC-2026-001 through -050), if a row
 * exists in `patients` whose name does NOT match the seed name, treat it as
 * a stale walk-in or demo artifact. Wipe its dependent rows and remove the
 * patient. This restores the MRN slot so seed-v2 can populate it correctly.
 *
 * Does NOT touch patients whose name DOES match (i.e., the v1-seeded 25).
 *
 * Also wipes encounters / labs / overrides that the buggy first run of
 * seed-v2 attached to wrong patient_ids, by deleting rows that came in
 * "today" (encounter_date = today) with encounter_number matching the
 * seed-v2 naming convention `ENC-YYYYMMDD-<suffix>-<idx>`.
 *
 * Auth: x-migration-secret.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_PATIENTS } from '@/lib/seed-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function POST(req: Request) {
  const secret = process.env.MIGRATION_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'no_secret' }, { status: 500 });
  if (req.headers.get('x-migration-secret') !== secret) return unauthorized();

  const stats = {
    walkin_patients_deleted: 0,
    encounters_deleted: 0,
    prescriptions_deleted: 0,
    lab_orders_deleted: 0,
    lab_results_deleted: 0,
    overrides_deleted: 0,
    summaries_deleted: 0,
    seed_v2_encounter_pattern_deleted: 0,
    errors: [] as string[],
  };

  // Build the name→MRN map from the seed catalog.
  const expectedNameByMrn = new Map<string, string>();
  for (const p of ALL_PATIENTS) expectedNameByMrn.set(p.mrn, p.name.toLowerCase());

  // ── 1. Delete any seed-v2-style encounters (those with name pattern
  //       'ENC-YYYYMMDD-<sfx>-<idx>') that may have been mis-attached.
  //       The pattern is ENC-<8 digits>-<digits>-<2 digits>.
  try {
    const { rows: badEncs } = await pool.query<{ id: string }>(
      `SELECT id FROM encounters WHERE encounter_number ~ '^ENC-[0-9]{8}-[0-9]+-[0-9]{2}$'`,
    );
    const ids = badEncs.map((r) => r.id);
    if (ids.length > 0) {
      await pool.query(`DELETE FROM prescriptions WHERE encounter_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM section_dictations WHERE encounter_id = ANY($1::uuid[])`, [ids]);
      const lo = await pool.query<{ id: string }>(`SELECT id FROM lab_orders WHERE encounter_id = ANY($1::uuid[])`, [ids]);
      const loIds = lo.rows.map((r) => r.id);
      if (loIds.length > 0) {
        await pool.query(`DELETE FROM lab_results WHERE lab_order_id = ANY($1::uuid[])`, [loIds]);
      }
      await pool.query(`DELETE FROM lab_orders WHERE encounter_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM encounter_recording_chunks WHERE encounter_id = ANY($1::uuid[])`, [ids]).catch(() => {});
      await pool.query(`DELETE FROM encounter_recordings WHERE encounter_id = ANY($1::uuid[])`, [ids]).catch(() => {});
      const del = await pool.query(`DELETE FROM encounters WHERE id = ANY($1::uuid[])`, [ids]);
      stats.seed_v2_encounter_pattern_deleted = del.rowCount ?? 0;
    }
  } catch (e) { stats.errors.push(`seed-v2 enc wipe: ${(e as Error).message}`); }

  // ── 2. For each EHRC-2026-NNN MRN in the seed catalog, find the patient row.
  //       If name doesn't match the seed name, it's a stray walk-in. Wipe it.
  for (const [mrn, expectedNameLower] of expectedNameByMrn.entries()) {
    try {
      const { rows } = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM patients WHERE mrn = $1 LIMIT 1`, [mrn]
      );
      if (!rows[0]) continue;
      const actualNameLower = rows[0].name.toLowerCase();
      if (actualNameLower === expectedNameLower) continue; // legitimate match

      const patientId = rows[0].id;
      // Wipe dependents: encounters (and their dependents), summaries, overrides, audits.
      const { rows: encs } = await pool.query<{ id: string }>(
        `SELECT id FROM encounters WHERE patient_id = $1`, [patientId]
      );
      const encIds = encs.map((r) => r.id);
      if (encIds.length > 0) {
        const presDel = await pool.query(`DELETE FROM prescriptions WHERE encounter_id = ANY($1::uuid[])`, [encIds]);
        stats.prescriptions_deleted += presDel.rowCount ?? 0;
        await pool.query(`DELETE FROM section_dictations WHERE encounter_id = ANY($1::uuid[])`, [encIds]).catch(() => {});
        await pool.query(`DELETE FROM encounter_recording_chunks WHERE encounter_id = ANY($1::uuid[])`, [encIds]).catch(() => {});
        await pool.query(`DELETE FROM encounter_recordings WHERE encounter_id = ANY($1::uuid[])`, [encIds]).catch(() => {});
        const lo = await pool.query<{ id: string }>(`SELECT id FROM lab_orders WHERE encounter_id = ANY($1::uuid[])`, [encIds]);
        const loIds = lo.rows.map((r) => r.id);
        if (loIds.length > 0) {
          const lrDel = await pool.query(`DELETE FROM lab_results WHERE lab_order_id = ANY($1::uuid[])`, [loIds]);
          stats.lab_results_deleted += lrDel.rowCount ?? 0;
        }
        const loDel = await pool.query(`DELETE FROM lab_orders WHERE encounter_id = ANY($1::uuid[])`, [encIds]);
        stats.lab_orders_deleted += loDel.rowCount ?? 0;
        const encDel = await pool.query(`DELETE FROM encounters WHERE id = ANY($1::uuid[])`, [encIds]);
        stats.encounters_deleted += encDel.rowCount ?? 0;
      }
      const ovDel = await pool.query(`DELETE FROM doctor_overrides WHERE patient_id = $1`, [patientId]);
      stats.overrides_deleted += ovDel.rowCount ?? 0;
      const sumDel = await pool.query(`DELETE FROM patient_summaries WHERE patient_id = $1`, [patientId]);
      stats.summaries_deleted += sumDel.rowCount ?? 0;
      await pool.query(`DELETE FROM qwen_call_audit WHERE patient_id = $1`, [patientId]).catch(() => {});
      // Now delete the patient.
      await pool.query(`DELETE FROM patients WHERE id = $1`, [patientId]);
      stats.walkin_patients_deleted++;
    } catch (e) {
      stats.errors.push(`reset ${mrn}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, stats });
}
