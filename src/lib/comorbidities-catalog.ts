/**
 * EHS Comorbidity Catalog v1.0 — canonical 110-condition catalog.
 *
 * Source: `EHS_Comorbidity_Catalog_v1_0.xlsx` (V, Owner: Hospital PM,
 * 2026-05-23 draft). Tier 2 Family Medicine panel for EHS clinics
 * (JP Nagar + Yelahanka). Powers the longitudinal record + panel
 * risk stratification.
 *
 * Capture modes:
 *   - binary: present/absent, year of onset
 *   - binary+control: present + control_state (controlled/partial/uncontrolled)
 *   - binary+severity: present + severity_state (per scale)
 *   - binary+control AND severity: both axes (rare, future-proofed)
 *   - risk_factor: behaviour/state contributing to risk
 *   - risk_factor+severity: graded risk factor
 *
 * v3.9.0 patient_comorbidities schema is MINIMAL (presence only) per
 * V's lock. control_state + severity_state capture deferred to v3.9.5.
 * Catalog metadata exposes the dimensions so the UX + tier algorithm
 * can use them.
 */
import catalogJson from './seed/comorbidity-catalog.json' with { type: 'json' };

export type CaptureMode =
  | 'binary'
  | 'binary+control'
  | 'binary+severity'
  | 'binary+control AND severity'
  | 'risk_factor'
  | 'risk_factor+severity';

export type ComorbidityEntry = {
  catalog_id: string;             // CORE_01, EXT_01, etc.
  condition_name: string;
  icd10_anchor: string;           // single code OR range OR "A / B" multi-list
  captured_as: CaptureMode;
  control_dimension: string | null;
  severity_dimension: string | null;
  panel_risk_weight: number;
  triggers_extended_capture: boolean;
  notes: string | null;
  tier: 'core' | 'extended';
};

export const COMORBIDITY_CATALOG: ComorbidityEntry[] = catalogJson as ComorbidityEntry[];

const BY_ID = new Map(COMORBIDITY_CATALOG.map((e) => [e.catalog_id, e]));
const BY_ICD_ANCHOR = new Map(COMORBIDITY_CATALOG.map((e) => [e.icd10_anchor, e]));

export function lookupByCatalogId(id: string): ComorbidityEntry | undefined {
  return BY_ID.get(id);
}

export function lookupByIcd10Anchor(code: string): ComorbidityEntry | undefined {
  return BY_ICD_ANCHOR.get(code);
}

const ICD10_REGEX = /^[A-Z]\d{2}(\.\d{1,4})?$/;
export function isValidIcd10(code: string): boolean {
  return ICD10_REGEX.test(code);
}

/**
 * In-memory ranked search across catalog_id, condition_name, icd10_anchor.
 * Returns top `limit` results.
 *
 * @param scope 'core' (Core 30 only) | 'all' (Core 30 + Extended 80)
 */
export function searchComorbidities(
  q: string,
  limit = 12,
  scope: 'core' | 'all' = 'all',
): ComorbidityEntry[] {
  const query = q.trim().toLowerCase();
  if (query.length < 1) return [];
  const pool = scope === 'core' ? COMORBIDITY_CATALOG.filter((e) => e.tier === 'core') : COMORBIDITY_CATALOG;
  const scored: Array<[number, ComorbidityEntry]> = [];
  for (const e of pool) {
    let score = 0;
    const name = e.condition_name.toLowerCase();
    const icd = e.icd10_anchor.toLowerCase();
    if (icd === query) score += 100;
    else if (icd.startsWith(query)) score += 50;
    else if (icd.includes(query)) score += 25;
    if (name === query) score += 80;
    else if (name.startsWith(query)) score += 40;
    else if (name.includes(query)) score += 20;
    if (score > 0) scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, e]) => e);
}
