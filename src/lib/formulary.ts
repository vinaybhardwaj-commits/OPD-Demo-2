/**
 * Map a single row of the Pharmacy Formulary CSV to a drug_master row.
 *
 * Sheet has 14 columns, drug_master uses 5 of them (item_code, brand_name,
 * generic_name, dosage_form, major_grouping) directly, derives 2 more
 * (schedule_dc, is_high_risk), parses 1 list (lasa_alternates), and drops
 * the rest (Minor Grouping, Manufacturer, Schedule IP 2022,
 * Department Primary, Department Secondary, VED) — those live in the
 * production schema but aren't in the demo schema.
 *
 * Schedule mapping:
 *   OTC / H / H1 / X → kept as-is (matches drug_schedule enum)
 *   Biological       → H1 (vaccines / antisera need register entry per
 *                      CDSCO 2016 gazette; closest enum value)
 *   G                → H (general prescription)
 *   anything else    → null (row is skipped with a 'skipped_schedule' note)
 */
import type { CsvRow } from './csv';

export type DrugScheduleEnum = 'OTC' | 'H' | 'H1' | 'X';

export type FormularyDrug = {
  item_code: string;
  brand_name: string;
  generic_name: string;
  dosage_form: string;
  strength: string | null;
  major_grouping: string;
  schedule_dc: DrugScheduleEnum;
  is_high_risk: boolean;
  lasa_alternates: string[];
};

export type MapResult =
  | { ok: true; drug: FormularyDrug }
  | { ok: false; reason: string; itemCode: string };

const REQUIRED_COLUMNS = [
  'Item Code',
  'Brand Name',
  'Generic Name',
  'Dosage Form',
  'Major Grouping',
  'Schedule (D&C Rules)',
  'Risk Profile',
];

export function validateCsvHeaders(headers: string[]): string[] {
  const missing: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) missing.push(col);
  }
  return missing;
}

function mapSchedule(raw: string): DrugScheduleEnum | null {
  const v = raw.trim().toUpperCase();
  if (v === 'OTC' || v === 'H' || v === 'H1' || v === 'X') return v;
  if (v === 'BIOLOGICAL') return 'H1'; // vaccines + antisera — register entry required
  if (v === 'G') return 'H'; // hormones — prescription required
  // Em-dash / hyphen / "N/A" / empty all collapse to OTC. These show up
  // for FMCG-style items in the formulary (Vicks, ENO, sunscreens,
  // moisturizers) — not Schedule drugs, behave like OTC at point of sale.
  if (v === '' || v === '—' || v === '-' || v === 'N/A' || v === 'NA') return 'OTC';
  return null;
}

function parseLasa(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '—');
}

/**
 * Many "Dosage Form" values look like "Tablet 500 MG", "Injection 25 MG",
 * "Syrup 60 ML". Split on the first space-then-digit boundary to get form
 * + strength. If the cell is just "Tablet" or "Tablet ." (sheet noise),
 * strength becomes null.
 */
function splitDosageForm(raw: string): { dosage_form: string; strength: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { dosage_form: '', strength: null };
  // Match: form (one or more words) + optional strength starting with digit
  const m = trimmed.match(/^([A-Za-z][A-Za-z\s\/().-]*?)(?:\s+(\d.*))?$/);
  if (!m) return { dosage_form: trimmed, strength: null };
  const form = m[1].trim().replace(/\s*\.\s*$/, ''); // strip trailing " ."
  const strength = m[2]?.trim() || null;
  return { dosage_form: form, strength };
}

export function mapCsvRowToDrug(row: CsvRow): MapResult {
  const itemCode = row['Item Code']?.trim() || '';
  if (!itemCode) return { ok: false, reason: 'missing_item_code', itemCode: '' };

  const brand = row['Brand Name']?.trim() || '';
  const generic = row['Generic Name']?.trim() || '';
  const major = row['Major Grouping']?.trim() || '';
  if (!brand || !generic || !major) {
    return { ok: false, reason: 'missing_required_field', itemCode };
  }

  const sched = mapSchedule(row['Schedule (D&C Rules)'] || '');
  if (!sched) {
    return { ok: false, reason: 'unmappable_schedule', itemCode };
  }

  const { dosage_form, strength } = splitDosageForm(row['Dosage Form'] || '');
  if (!dosage_form) {
    return { ok: false, reason: 'missing_dosage_form', itemCode };
  }

  return {
    ok: true,
    drug: {
      item_code: itemCode,
      brand_name: brand,
      generic_name: generic,
      dosage_form,
      strength,
      major_grouping: major,
      schedule_dc: sched,
      is_high_risk: (row['Risk Profile'] || '').trim().toLowerCase() === 'high risk',
      lasa_alternates: parseLasa(row['LASA (similar drugs)'] || ''),
    },
  };
}
