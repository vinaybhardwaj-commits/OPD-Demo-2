/**
 * Preset chief-complaint chips for the OPD encounter screen.
 *
 * Curated for Bangalore GP OPD — the dominant complaints at EHRC, with
 * the chronic-disease follow-up bucket separated out so the doctor can
 * scan past the acute presentations when they know the patient is in
 * for a BP/DM review.
 *
 * Keep this list short enough to render as ~24 chips without scrolling.
 * Less-common complaints fall through to the free-text textarea below.
 */
export type CcChipCategory = 'acute' | 'chronic' | 'routine';

export type CcChip = {
  label: string;
  category: CcChipCategory;
};

export const CC_CHIPS: CcChip[] = [
  // Acute presentations (12)
  { label: 'Fever',              category: 'acute' },
  { label: 'Cough',              category: 'acute' },
  { label: 'Sore throat',        category: 'acute' },
  { label: 'Cold',               category: 'acute' },
  { label: 'Headache',           category: 'acute' },
  { label: 'Body ache',          category: 'acute' },
  { label: 'Vomiting',           category: 'acute' },
  { label: 'Diarrhea',           category: 'acute' },
  { label: 'Abdominal pain',     category: 'acute' },
  { label: 'Chest pain',         category: 'acute' },
  { label: 'Back pain',          category: 'acute' },
  { label: 'Burning urination',  category: 'acute' },
  // Chronic follow-up (6)
  { label: 'BP follow-up',       category: 'chronic' },
  { label: 'Diabetes follow-up', category: 'chronic' },
  { label: 'Asthma review',      category: 'chronic' },
  { label: 'Thyroid follow-up',  category: 'chronic' },
  { label: 'Medication refill',  category: 'chronic' },
  { label: 'Lab review',         category: 'chronic' },
  // Routine / other (6)
  { label: 'Annual check-up',    category: 'routine' },
  { label: 'Vaccination',        category: 'routine' },
  { label: 'Pre-employment',     category: 'routine' },
  { label: 'Pregnancy check',    category: 'routine' },
  { label: 'Rash / itching',     category: 'routine' },
  { label: 'Dizziness',          category: 'routine' },
];
