/**
 * Polish #3 — Lab trending for the HistoryPanel.
 *
 * One query pulls the last N results across all canonical_keys for a
 * patient. The JS layer groups by canonical_key and keeps only keys
 * with ≥2 historical results (single-point "trends" aren't useful).
 *
 * Used by /dashboard/encounters/[id] and /patients/[id].
 */
import { pool } from '@/lib/db';

export type LabTrendPoint = {
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  abnormal_flag: string | null;
  entered_at: string;
  encounter_id: string | null;
};

export type LabTrendSeries = {
  canonical_key: string;
  display_name: string;
  points: LabTrendPoint[]; // newest first
};

const PER_PATIENT_LIMIT = 200; // ~20 keys × 10 points worst case

export async function loadLabTrends(
  patientId: string,
): Promise<LabTrendSeries[]> {
  const { rows } = await pool.query<{
    canonical_key: string;
    display_name: string;
    value_numeric: number | null;
    value_text: string | null;
    unit: string | null;
    abnormal_flag: string | null;
    entered_at: string;
    encounter_id: string | null;
  }>(
    `SELECT
       lr.canonical_key,
       lr.display_name,
       lr.value_numeric,
       lr.value_text,
       lr.unit,
       lr.abnormal_flag,
       lr.entered_at::text AS entered_at,
       lo.encounter_id
     FROM lab_results lr
     LEFT JOIN lab_orders lo ON lo.id = lr.lab_order_id
     WHERE lr.patient_id = $1
     ORDER BY lr.entered_at DESC
     LIMIT $2`,
    [patientId, PER_PATIENT_LIMIT],
  );

  const byKey = new Map<string, LabTrendSeries>();
  for (const r of rows) {
    let series = byKey.get(r.canonical_key);
    if (!series) {
      series = {
        canonical_key: r.canonical_key,
        display_name: r.display_name,
        points: [],
      };
      byKey.set(r.canonical_key, series);
    }
    // Keep at most 10 points per key (head of the desc list).
    if (series.points.length < 10) {
      series.points.push({
        value_numeric: r.value_numeric,
        value_text: r.value_text,
        unit: r.unit,
        abnormal_flag: r.abnormal_flag,
        entered_at: r.entered_at,
        encounter_id: r.encounter_id,
      });
    }
  }

  // Filter to series with ≥2 points; sort series by most-recent point.
  return Array.from(byKey.values())
    .filter((s) => s.points.length >= 2)
    .sort((a, b) => b.points[0].entered_at.localeCompare(a.points[0].entered_at));
}
