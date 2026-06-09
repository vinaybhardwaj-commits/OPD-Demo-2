/**
 * Hardcoded smart defaults for the top ~30 GP/OPD generics.
 *
 * Per design doc §4A's "Smart defaults source" — v1 ships hardcoded
 * defaults; the parallel Qwen-drafted + V-reviewed pipeline at
 * /admin/drug-defaults/review (Sprint 4/5 side track) will populate the
 * full ~500 OPD drugs in drug_master.{default_frequency, …} directly.
 *
 * Until then, this map is the source of truth. Keyed by lowercased
 * primary molecule (substring match), so combination products still
 * pick up the right defaults (e.g. "Amoxicillin+Clavulanic acid"
 * matches the amoxicillin entry).
 *
 * These reflect typical Indian GP OPD prescribing patterns at EHRC.
 * They are NOT a substitute for clinical judgement — the row is
 * pre-filled, the doctor still owns the final decision.
 */
export type DrugDefault = {
  frequency: Frequency;
  duration_days: number;
  timing: Timing;
  instructions?: string;
};

export type Frequency = 'OD' | 'BD' | 'TDS' | 'QID' | 'SOS' | 'HS';
export type Timing =
  | 'Before meals'
  | 'After meals'
  | 'Empty stomach'
  | 'At bedtime'
  | 'With water';

export const FREQUENCY_OPTIONS: Frequency[] = ['OD', 'BD', 'TDS', 'QID', 'SOS', 'HS'];
export const DURATION_OPTIONS: number[] = [3, 5, 7, 10, 14, 30];
export const TIMING_OPTIONS: Timing[] = [
  'Before meals',
  'After meals',
  'Empty stomach',
  'At bedtime',
  'With water',
];

const DEFAULTS_BY_GENERIC: Record<string, DrugDefault> = {
  // Analgesic / antipyretic
  paracetamol:           { frequency: 'TDS', duration_days: 3,  timing: 'After meals', instructions: 'For fever / pain' },
  ibuprofen:             { frequency: 'BD',  duration_days: 5,  timing: 'After meals' },
  aceclofenac:           { frequency: 'BD',  duration_days: 5,  timing: 'After meals' },
  diclofenac:            { frequency: 'BD',  duration_days: 5,  timing: 'After meals' },
  tramadol:              { frequency: 'BD',  duration_days: 3,  timing: 'After meals' },
  mefenamic:             { frequency: 'TDS', duration_days: 3,  timing: 'After meals' },

  // Antibiotics
  amoxicillin:           { frequency: 'TDS', duration_days: 5,  timing: 'After meals' },
  azithromycin:          { frequency: 'OD',  duration_days: 3,  timing: 'Before meals' },
  cefuroxime:            { frequency: 'BD',  duration_days: 5,  timing: 'After meals' },
  cefixime:              { frequency: 'BD',  duration_days: 5,  timing: 'After meals' },
  ciprofloxacin:         { frequency: 'BD',  duration_days: 5,  timing: 'Empty stomach' },
  levofloxacin:          { frequency: 'OD',  duration_days: 5,  timing: 'Empty stomach' },
  doxycycline:           { frequency: 'BD',  duration_days: 7,  timing: 'After meals' },
  metronidazole:         { frequency: 'TDS', duration_days: 5,  timing: 'After meals' },
  clarithromycin:        { frequency: 'BD',  duration_days: 5,  timing: 'After meals' },
  nitrofurantoin:        { frequency: 'TDS', duration_days: 5,  timing: 'After meals', instructions: 'For UTI' },

  // GI
  omeprazole:            { frequency: 'OD',  duration_days: 14, timing: 'Empty stomach' },
  pantoprazole:          { frequency: 'OD',  duration_days: 14, timing: 'Empty stomach' },
  rabeprazole:           { frequency: 'OD',  duration_days: 14, timing: 'Empty stomach' },
  ondansetron:           { frequency: 'TDS', duration_days: 3,  timing: 'Before meals', instructions: 'For nausea / vomiting' },
  domperidone:           { frequency: 'TDS', duration_days: 3,  timing: 'Before meals' },
  dicyclomine:           { frequency: 'TDS', duration_days: 3,  timing: 'Before meals' },

  // Antihistamine / cold-cough
  cetirizine:            { frequency: 'OD',  duration_days: 5,  timing: 'At bedtime' },
  levocetirizine:        { frequency: 'OD',  duration_days: 5,  timing: 'At bedtime' },
  fexofenadine:          { frequency: 'OD',  duration_days: 5,  timing: 'After meals' },
  montelukast:           { frequency: 'OD',  duration_days: 14, timing: 'At bedtime' },
  dextromethorphan:      { frequency: 'TDS', duration_days: 5,  timing: 'After meals' },

  // Cardiovascular / chronic
  amlodipine:            { frequency: 'OD',  duration_days: 30, timing: 'After meals' },
  losartan:              { frequency: 'OD',  duration_days: 30, timing: 'After meals' },
  telmisartan:           { frequency: 'OD',  duration_days: 30, timing: 'After meals' },
  atenolol:              { frequency: 'OD',  duration_days: 30, timing: 'After meals' },
  atorvastatin:          { frequency: 'OD',  duration_days: 30, timing: 'At bedtime' },
  rosuvastatin:          { frequency: 'OD',  duration_days: 30, timing: 'At bedtime' },

  // Diabetes
  metformin:             { frequency: 'BD',  duration_days: 30, timing: 'With water', instructions: 'With breakfast + dinner' },
  glimepiride:           { frequency: 'OD',  duration_days: 30, timing: 'Before meals' },

  // Thyroid
  'levothyroxine':       { frequency: 'OD',  duration_days: 30, timing: 'Empty stomach', instructions: '30 min before breakfast' },

  // Supplements / commonly co-prescribed
  cholecalciferol:       { frequency: 'OD',  duration_days: 30, timing: 'After meals', instructions: 'Vitamin D3' },
  methylcobalamin:       { frequency: 'OD',  duration_days: 30, timing: 'After meals' },
  iron:                  { frequency: 'OD',  duration_days: 30, timing: 'After meals' },
  'oral rehydration':    { frequency: 'SOS', duration_days: 3,  timing: 'With water', instructions: 'After each loose stool' },

  // Asthma
  salbutamol:            { frequency: 'QID', duration_days: 5,  timing: 'With water', instructions: '2 puffs' },
  budesonide:            { frequency: 'BD',  duration_days: 14, timing: 'With water', instructions: '2 puffs' },
};

/**
 * Look up smart defaults by matching the drug's generic_name against
 * known molecules. Returns the FIRST match found. Combination products
 * (e.g. "Amoxicillin+Clavulanic acid") pick up the lead-molecule's
 * defaults — a deliberate simplification for v1.
 *
 * Returns null if nothing matches. The compose UI handles null by
 * leaving the chip groups unselected; doctor picks manually.
 */
export function findSmartDefaults(generic_name: string): DrugDefault | null {
  const g = generic_name.toLowerCase();
  for (const [key, value] of Object.entries(DEFAULTS_BY_GENERIC)) {
    if (g.includes(key)) return value;
  }
  return null;
}
