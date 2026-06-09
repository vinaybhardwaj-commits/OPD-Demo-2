/**
 * Panel risk tier computation per EHS Comorbidity Catalog v1.0
 * Tiering_Algorithm sheet.
 *
 * Inputs: patient's active comorbidities (catalog_ids), patient age,
 * + flags for recent hospitalization / ED visits / fall-with-injury.
 *
 * Outputs: { score, tier, modifiers[], trigger_reasons[], extended_visible }.
 *
 * Defer to v3.9.6 polish: T_06 clinician override + T_07 special programme.
 */
import { COMORBIDITY_CATALOG, lookupByCatalogId, type ComorbidityEntry } from './comorbidities-catalog';

export type Tier = 0 | 1 | 2 | 3;

export type TierInput = {
  activeCatalogIds: string[];                 // CORE_01, EXT_05, etc.
  uncontrolledCatalogIds?: string[];          // subset of active where control_state = uncontrolled (v3.9.5+)
  patient_age_years: number;
  hospitalizedLast6Mo: boolean;               // T_05
  edVisitsLast12Mo: number;                   // contributes if >= 2
  recentFallWithInjuryLast6Mo: boolean;       // independent of frailty
  recentEdLast90Days: boolean;                // T_08
  clinicianOverrideTier?: Tier;               // T_06 (overrides computed tier)
  clinicianOverrideShowExtended?: boolean;    // T_06 (overrides extended visibility)
};

export type TierBreakdown = {
  score: number;
  tier: Tier;
  base_score: number;
  modifiers: Array<{ label: string; points: number }>;
  trigger_reasons: string[];
  extended_visible: boolean;
  override_applied: boolean;
};

/** Map total score to tier per the doc. */
export function tierFromScore(score: number): Tier {
  if (score >= 10) return 3;
  if (score >= 4) return 2;
  if (score >= 1) return 1;
  return 0;
}

export const TIER_LABEL: Record<Tier, string> = {
  0: 'Tier 0 — Healthy',
  1: 'Tier 1 — Stable',
  2: 'Tier 2 — Multimorbid',
  3: 'Tier 3 — Complex',
};

export const TIER_DESCRIPTION: Record<Tier, string> = {
  0: 'No active chronic conditions; no risk factors.',
  1: 'Single well-controlled condition or low risk-factor burden.',
  2: '2-3 conditions, or 1 uncontrolled, or moderate risk burden.',
  3: '4+ conditions, high-impact disease, frailty, recent admission, or active cancer.',
};

export const TIER_REVIEW_CADENCE: Record<Tier, string> = {
  0: 'Annual prevention visit',
  1: '6-monthly',
  2: 'Quarterly',
  3: 'Monthly + care manager assigned',
};

export function computeTier(input: TierInput): TierBreakdown {
  // Step 1 — base score: sum panel_risk_weight across all active.
  let base_score = 0;
  const activeEntries: ComorbidityEntry[] = [];
  for (const id of input.activeCatalogIds) {
    const e = lookupByCatalogId(id);
    if (!e) continue;
    activeEntries.push(e);
    base_score += e.panel_risk_weight;
  }

  // Step 2 — modifiers
  const modifiers: TierBreakdown['modifiers'] = [];

  // Uncontrolled-condition contribution (+2 each, cap +6 total)
  if (input.uncontrolledCatalogIds && input.uncontrolledCatalogIds.length > 0) {
    let uncCount = 0;
    for (const id of input.uncontrolledCatalogIds) {
      const e = lookupByCatalogId(id);
      if (!e) continue;
      if (e.captured_as.includes('binary+control')) uncCount++;
    }
    const points = Math.min(uncCount * 2, 6);
    if (points > 0) modifiers.push({ label: `${uncCount} uncontrolled (cap +6)`, points });
  }

  if (input.hospitalizedLast6Mo) modifiers.push({ label: 'Hospitalization in last 6 mo', points: 3 });

  // Age modifier (mutually exclusive: 85+ replaces 75-84)
  if (input.patient_age_years >= 85) modifiers.push({ label: 'Age ≥ 85', points: 4 });
  else if (input.patient_age_years >= 75) modifiers.push({ label: 'Age 75-84', points: 2 });

  // Active cancer on treatment (EXT_50)
  if (input.activeCatalogIds.includes('EXT_50')) {
    modifiers.push({ label: 'Active cancer on treatment (EXT_50)', points: 5 });
  }

  if (input.edVisitsLast12Mo >= 2) {
    modifiers.push({ label: `${input.edVisitsLast12Mo} ED visits in last 12 mo`, points: 2 });
  }

  if (input.recentFallWithInjuryLast6Mo) {
    modifiers.push({ label: 'Recent fall with injury (6 mo)', points: 2 });
  }

  const modifier_total = modifiers.reduce((sum, m) => sum + m.points, 0);
  const computed_score = base_score + modifier_total;
  let tier = tierFromScore(computed_score);

  // Step 4 — clinician override (T_06)
  let override_applied = false;
  if (input.clinicianOverrideTier !== undefined && input.clinicianOverrideTier !== tier) {
    tier = input.clinicianOverrideTier;
    override_applied = true;
  }

  // Trigger rules → extended visibility
  const trigger_reasons: string[] = [];
  if (tier >= 2) trigger_reasons.push('T_01: Tier ≥ 2');
  const coreActiveCount = activeEntries.filter((e) => e.tier === 'core').length;
  if (coreActiveCount >= 3) trigger_reasons.push(`T_02: ${coreActiveCount} active core conditions`);
  const triggeringActive = activeEntries.filter((e) => e.triggers_extended_capture);
  if (triggeringActive.length > 0) {
    trigger_reasons.push(`T_03: high-impact disease present (${triggeringActive.map((e) => e.catalog_id).join(', ')})`);
  }
  if (input.patient_age_years >= 70) trigger_reasons.push('T_04: Age ≥ 70');
  if (input.hospitalizedLast6Mo) trigger_reasons.push('T_05: Hospitalization in last 6 mo');
  // T_06 override
  if (input.clinicianOverrideShowExtended) trigger_reasons.push('T_06: Clinician override');
  // T_07 special programme — defer
  if (input.recentEdLast90Days) trigger_reasons.push('T_08: Recent ED visit (last 90 days)');

  const extended_visible = trigger_reasons.length > 0;

  return {
    score: computed_score,
    tier,
    base_score,
    modifiers,
    trigger_reasons,
    extended_visible,
    override_applied,
  };
}
