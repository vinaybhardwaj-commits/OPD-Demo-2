/**
 * Hardcoded list of ICD-10 code prefixes that represent CHRONIC
 * conditions (worth surfacing the "Add as chronic comorbidity?"
 * soft prompt below an Assessment chip).
 *
 * Used by EncounterEditor's chip cross-link UX in v3.9.1b.
 *
 * Coverage: high-frequency chronic conditions an Indian OPD doctor
 * sees regularly. Not exhaustive — Qwen-driven detection deferred per
 * PRD decision #12 (hardcoded patterns are fast enough + accurate enough).
 */

const CHRONIC_3CHAR_PREFIXES = new Set([
  // Endocrine
  'E03', 'E04', 'E05', 'E10', 'E11', 'E13', 'E27', 'E28', 'E55', 'E66', 'E78', 'E89',
  // Cardiovascular
  'I10', 'I11', 'I25', 'I27', 'I42', 'I48', 'I49', 'I50', 'I63', 'I65', 'I69',
  'I70', 'I73', 'I83', 'I87',
  // Respiratory
  'J30', 'J31', 'J42', 'J44', 'J45', 'J47', 'J84',
  // Renal / uro
  'N18', 'N20', 'N28', 'N40',
  // GI / hepatic
  'B18', 'K21', 'K25', 'K27', 'K50', 'K51', 'K57', 'K58', 'K70', 'K74', 'K76', 'K80', 'K90',
  // Neuro
  'G20', 'G30', 'G35', 'G40', 'G43', 'G45', 'G47', 'G50', 'G62',
  // Psychiatric
  'F10', 'F17', 'F20', 'F31', 'F32', 'F33', 'F41', 'F45', 'F90',
  // MSK / rheum
  'M05', 'M06', 'M10', 'M15', 'M16', 'M17', 'M19', 'M32', 'M45', 'M54', 'M79', 'M81',
  // Heme / onc history
  'D50', 'D51', 'D55', 'D56', 'D57', 'D64', 'D69', 'Z51', 'Z85',
  // Allergy / derm
  'L20', 'L40', 'L50', 'L70', 'L80',
  // Infectious (chronic)
  'A15', 'A18', 'B20', 'Z21', 'Z22',
  // Sensory
  'H25', 'H40', 'H66', 'H93',
  // Long-term status / history
  'Z79', 'Z85', 'Z89', 'Z90', 'Z94', 'Z95',
]);

export function isChronicIcd10(code: string): boolean {
  if (!code) return false;
  const prefix = code.trim().toUpperCase().slice(0, 3);
  return CHRONIC_3CHAR_PREFIXES.has(prefix);
}
