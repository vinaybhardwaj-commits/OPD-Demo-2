/**
 * v3.9.6 — batched tier loader for the doctor's queue.
 *
 * Single round-trip per page render. For N queue rows:
 *  1. Pull all active comorbidity codes across those patients
 *  2. Pull hospitalization (disposition='admit') counts last 6mo per patient
 *  3. Pull ED visit counts last 12mo via heuristic
 *     (disposition='refer' AND referral_target ILIKE %emergency% / %ed% /
 *      %casualty% / %a&e%)
 *  4. Pull patients.tier_override_state for each
 *  5. Per patient → computeTier() → return Map<patient_id, TierResult>
 *
 * Soft-fail: on any error, returns empty map and the UI silently
 * renders without tier pills.
 */
import { pool } from '@/lib/db';
import { lookupByIcd10Anchor } from '@/lib/comorbidities-catalog';
import { computeTier, type TierBreakdown, type Tier } from '@/lib/comorbidity-tier';

export type QueueTier = TierBreakdown & {
  active_count: number;
  uncontrolled_count: number;
  override_state: Tier | null;
};

const TIER_STATE_TO_NUMBER: Record<string, Tier> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
};

const ED_KEYWORDS = ['emergency', 'casualty', 'a&e'];
// 'ed' is too noisy on its own; require it as a word boundary or paired with 'visit'/'attend'

export async function loadQueueTiers(
  patientIds: string[],
): Promise<Map<string, QueueTier>> {
  const out = new Map<string, QueueTier>();
  if (patientIds.length === 0) return out;

  try {
    const [comRes, patRes, admitRes, edRes] = await Promise.all([
      pool.query<{ patient_id: string; code: string; control_state: string | null; severity_state: string | null }>(
        `SELECT patient_id, code, control_state, severity_state
         FROM patient_comorbidities
         WHERE patient_id = ANY($1::uuid[]) AND is_resolved = false`,
        [patientIds],
      ),
      pool.query<{ id: string; age_years: number; tier_override_state: string | null }>(
        `SELECT id, age_years, tier_override_state
         FROM patients
         WHERE id = ANY($1::uuid[])`,
        [patientIds],
      ),
      pool.query<{ patient_id: string; n: number }>(
        `SELECT patient_id, COUNT(*)::int AS n FROM encounters
         WHERE patient_id = ANY($1::uuid[])
           AND disposition = 'admit'
           AND encounter_date >= CURRENT_DATE - INTERVAL '6 months'
         GROUP BY patient_id`,
        [patientIds],
      ),
      pool.query<{ patient_id: string; n: number }>(
        // ED heuristic — disposition='refer' AND referral_target matches an ED keyword
        `SELECT patient_id, COUNT(*)::int AS n FROM encounters
         WHERE patient_id = ANY($1::uuid[])
           AND disposition = 'refer'
           AND encounter_date >= CURRENT_DATE - INTERVAL '12 months'
           AND (
             referral_target ILIKE '%emergency%'
             OR referral_target ILIKE '%casualty%'
             OR referral_target ILIKE '%a&e%'
           )
         GROUP BY patient_id`,
        [patientIds],
      ),
    ]);

    const admitByPatient = new Map<string, number>(admitRes.rows.map((r) => [r.patient_id, r.n]));
    const edByPatient = new Map<string, number>(edRes.rows.map((r) => [r.patient_id, r.n]));

    // Group comorbidities by patient
    const comByPatient = new Map<string, { catalog_ids: string[]; uncontrolled_ids: string[] }>();
    for (const row of comRes.rows) {
      let bucket = comByPatient.get(row.patient_id);
      if (!bucket) {
        bucket = { catalog_ids: [], uncontrolled_ids: [] };
        comByPatient.set(row.patient_id, bucket);
      }
      const cat = lookupByIcd10Anchor(row.code);
      if (!cat) continue;
      bucket.catalog_ids.push(cat.catalog_id);
      if (row.control_state === 'uncontrolled' || row.severity_state === 'severe') {
        bucket.uncontrolled_ids.push(cat.catalog_id);
      }
    }

    for (const pat of patRes.rows) {
      const bucket = comByPatient.get(pat.id) ?? { catalog_ids: [], uncontrolled_ids: [] };
      const hospitalized = (admitByPatient.get(pat.id) ?? 0) > 0;
      const edVisits = edByPatient.get(pat.id) ?? 0;
      const overrideTier: Tier | null = pat.tier_override_state ? (TIER_STATE_TO_NUMBER[pat.tier_override_state] ?? null) : null;
      const breakdown = computeTier({
        activeCatalogIds: bucket.catalog_ids,
        uncontrolledCatalogIds: bucket.uncontrolled_ids,
        patient_age_years: pat.age_years,
        hospitalizedLast6Mo: hospitalized,
        edVisitsLast12Mo: edVisits,
        recentFallWithInjuryLast6Mo: false, // v3.9.7+
        recentEdLast90Days: false, // v3.9.7+
        clinicianOverrideTier: overrideTier ?? undefined,
      });
      out.set(pat.id, {
        ...breakdown,
        active_count: bucket.catalog_ids.length,
        uncontrolled_count: bucket.uncontrolled_ids.length,
        override_state: overrideTier,
      });
    }
  } catch (e) {
    // soft-fail — pills render with no data rather than crashing the queue
    if (process.env.NODE_ENV !== 'production') {
      console.error('[queue-tier] loadQueueTiers error:', e);
    }
  }
  return out;
}
