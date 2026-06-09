/**
 * Curated ICD-10 codes for Indian GP / OPD use.
 *
 * Not the full ICD-10 (70k codes). This is the high-frequency subset a
 * Bangalore GP at EHRC would reach for during a typical OPD day — ~150
 * codes covering infectious, cardiovascular, endocrine, respiratory,
 * gastro, musculoskeletal, dermatology, neurology, ENT, mental health,
 * paediatric, gyn, urology, and routine encounter codes.
 *
 * Sprint 3 stores codes-only in assessment_codes[]; this module's
 * `lookupIcd10` is the source of truth for rendering the human label
 * next to the code in chips.
 */
export type Icd10Code = { code: string; label: string };

export const ICD10_CODES: Icd10Code[] = [
  // Infectious & general
  { code: 'A09',    label: 'Infectious gastroenteritis' },
  { code: 'B34.9',  label: 'Viral infection, unspecified' },
  { code: 'R50.9',  label: 'Fever, unspecified' },
  { code: 'R05',    label: 'Cough' },
  { code: 'R51',    label: 'Headache' },
  { code: 'R10.4',  label: 'Generalized abdominal pain' },
  { code: 'R11.0',  label: 'Nausea' },
  { code: 'R11.10', label: 'Vomiting, unspecified' },
  { code: 'R19.7',  label: 'Diarrhea, unspecified' },
  { code: 'R53.83', label: 'Fatigue' },
  { code: 'R42',    label: 'Dizziness and giddiness' },
  { code: 'R07.9',  label: 'Chest pain, unspecified' },
  { code: 'R06.0',  label: 'Dyspnoea' },
  { code: 'R21',    label: 'Rash and non-specific skin eruption' },

  // ENT / URI
  { code: 'J00',    label: 'Acute nasopharyngitis (common cold)' },
  { code: 'J01.90', label: 'Acute sinusitis, unspecified' },
  { code: 'J02.9',  label: 'Acute pharyngitis, unspecified' },
  { code: 'J03.90', label: 'Acute tonsillitis, unspecified' },
  { code: 'J04.0',  label: 'Acute laryngitis' },
  { code: 'J06.9',  label: 'Acute upper respiratory infection, unspecified' },
  { code: 'H66.90', label: 'Otitis media, unspecified ear' },
  { code: 'H92.0',  label: 'Otalgia (ear pain)' },
  { code: 'H10.9',  label: 'Conjunctivitis, unspecified' },

  // Lower respiratory
  { code: 'J20.9',  label: 'Acute bronchitis, unspecified' },
  { code: 'J18.9',  label: 'Pneumonia, unspecified organism' },
  { code: 'J45.909',label: 'Asthma, uncomplicated' },
  { code: 'J44.9',  label: 'COPD, unspecified' },
  { code: 'J30.9',  label: 'Allergic rhinitis, unspecified' },

  // Cardiovascular
  { code: 'I10',    label: 'Essential (primary) hypertension' },
  { code: 'I11.9',  label: 'Hypertensive heart disease without HF' },
  { code: 'I25.10', label: 'Atherosclerotic heart disease w/o angina' },
  { code: 'I20.9',  label: 'Angina pectoris, unspecified' },
  { code: 'I48.91', label: 'Atrial fibrillation, unspecified' },
  { code: 'I50.9',  label: 'Heart failure, unspecified' },
  { code: 'I83.90', label: 'Varicose veins, unspecified site' },

  // Endocrine / metabolic
  { code: 'E11.9',  label: 'Type 2 diabetes mellitus w/o complications' },
  { code: 'E11.65', label: 'Type 2 DM with hyperglycaemia' },
  { code: 'E11.40', label: 'Type 2 DM with diabetic neuropathy' },
  { code: 'E10.9',  label: 'Type 1 diabetes mellitus w/o complications' },
  { code: 'E66.9',  label: 'Obesity, unspecified' },
  { code: 'E78.5',  label: 'Hyperlipidemia, unspecified' },
  { code: 'E03.9',  label: 'Hypothyroidism, unspecified' },
  { code: 'E05.90', label: 'Thyrotoxicosis, unspecified' },
  { code: 'E61.1',  label: 'Iron deficiency' },
  { code: 'D50.9',  label: 'Iron deficiency anemia, unspecified' },
  { code: 'D64.9',  label: 'Anemia, unspecified' },
  { code: 'E55.9',  label: 'Vitamin D deficiency, unspecified' },
  { code: 'E53.8',  label: 'Vitamin B12 deficiency' },

  // GI
  { code: 'K21.9',  label: 'GERD without esophagitis' },
  { code: 'K29.70', label: 'Gastritis, unspecified, no bleeding' },
  { code: 'K30',    label: 'Functional dyspepsia' },
  { code: 'K58.9',  label: 'IBS without diarrhea' },
  { code: 'K59.00', label: 'Constipation, unspecified' },
  { code: 'K59.1',  label: 'Functional diarrhea' },
  { code: 'K92.2',  label: 'GI haemorrhage, unspecified' },
  { code: 'K80.20', label: 'Cholelithiasis without cholecystitis' },
  { code: 'K76.0',  label: 'Fatty (change of) liver, NEC' },

  // Urinary / male / female
  { code: 'N39.0',  label: 'Urinary tract infection, site not specified' },
  { code: 'N30.90', label: 'Cystitis, unspecified, w/o haematuria' },
  { code: 'N40.0',  label: 'Benign prostatic hyperplasia w/o LUTS' },
  { code: 'N40.1',  label: 'Benign prostatic hyperplasia w/ LUTS' },
  { code: 'N20.0',  label: 'Calculus of kidney' },
  { code: 'N91.2',  label: 'Amenorrhoea, unspecified' },
  { code: 'N92.4',  label: 'Excessive menstrual bleeding' },
  { code: 'N95.1',  label: 'Menopausal & female climacteric states' },
  { code: 'N76.0',  label: 'Acute vaginitis' },
  { code: 'N80.9',  label: 'Endometriosis, unspecified' },

  // Pregnancy / antenatal
  { code: 'Z34.90', label: 'Supervision of normal pregnancy, unspec' },
  { code: 'O20.0',  label: 'Threatened miscarriage' },
  { code: 'O26.83', label: 'Pregnancy related peripheral oedema' },

  // Musculoskeletal
  { code: 'M54.5',  label: 'Low back pain' },
  { code: 'M54.2',  label: 'Cervicalgia (neck pain)' },
  { code: 'M25.50', label: 'Pain in unspecified joint' },
  { code: 'M17.9',  label: 'Osteoarthritis of knee, unspecified' },
  { code: 'M19.91', label: 'Primary osteoarthritis, unspecified site' },
  { code: 'M79.1',  label: 'Myalgia' },
  { code: 'M79.7',  label: 'Fibromyalgia' },
  { code: 'M75.100',label: 'Rotator cuff tear, unspecified shoulder' },
  { code: 'M77.10', label: 'Lateral epicondylitis (tennis elbow)' },
  { code: 'M10.9',  label: 'Gout, unspecified' },
  { code: 'M81.0',  label: 'Age-related osteoporosis' },
  { code: 'S93.401',label: 'Ankle sprain, unspecified site' },

  // Dermatology
  { code: 'L20.9',  label: 'Atopic dermatitis, unspecified' },
  { code: 'L23.9',  label: 'Allergic contact dermatitis, unspecified' },
  { code: 'L29.9',  label: 'Pruritus, unspecified' },
  { code: 'L30.9',  label: 'Dermatitis, unspecified' },
  { code: 'L40.9',  label: 'Psoriasis, unspecified' },
  { code: 'L50.9',  label: 'Urticaria, unspecified' },
  { code: 'L70.0',  label: 'Acne vulgaris' },
  { code: 'B35.1',  label: 'Tinea unguium (nail fungus)' },
  { code: 'B35.4',  label: 'Tinea corporis' },
  { code: 'B07.9',  label: 'Viral wart, unspecified' },
  { code: 'L08.9',  label: 'Local skin/SC infection, unspecified' },

  // Neurology / psych
  { code: 'G43.909',label: 'Migraine, unspecified, w/o status migrainosus' },
  { code: 'G44.209',label: 'Tension-type headache, unspecified' },
  { code: 'G47.00', label: 'Insomnia, unspecified' },
  { code: 'G47.33', label: 'Obstructive sleep apnoea' },
  { code: 'G45.9',  label: 'Transient cerebral ischaemic attack, unspec' },
  { code: 'G50.0',  label: 'Trigeminal neuralgia' },
  { code: 'F41.1',  label: 'Generalized anxiety disorder' },
  { code: 'F41.9',  label: 'Anxiety disorder, unspecified' },
  { code: 'F32.9',  label: 'Major depressive disorder, single, unspec' },
  { code: 'F33.9',  label: 'Major depressive disorder, recurrent, unspec' },
  { code: 'F43.10', label: 'Post-traumatic stress disorder, unspecified' },
  { code: 'F51.01', label: 'Primary insomnia' },

  // Eye
  { code: 'H52.4',  label: 'Presbyopia' },
  { code: 'H52.10', label: 'Myopia, unspecified eye' },
  { code: 'H10.45', label: 'Other chronic allergic conjunctivitis' },
  { code: 'H53.143',label: 'Visual discomfort, bilateral' },

  // Paediatric / general
  { code: 'P92.9',  label: 'Feeding problem of newborn, unspecified' },
  { code: 'R62.50', label: 'Failure to thrive, unspecified age' },
  { code: 'K02.9',  label: 'Dental caries, unspecified' },
  { code: 'A38.9',  label: 'Scarlet fever, unspecified' },
  { code: 'B05.9',  label: 'Measles without complication' },
  { code: 'B06.9',  label: 'Rubella without complication' },
  { code: 'B01.9',  label: 'Varicella without complication' },

  // Vector-borne (high in India)
  { code: 'A90',    label: 'Dengue fever' },
  { code: 'A91',    label: 'Dengue haemorrhagic fever' },
  { code: 'B54',    label: 'Unspecified malaria' },
  { code: 'A01.00', label: 'Typhoid fever, unspecified' },
  { code: 'A02.9',  label: 'Salmonella infection, unspecified' },
  { code: 'A06.9',  label: 'Amoebiasis, unspecified' },
  { code: 'A15.9',  label: 'Respiratory tuberculosis, unspecified' },
  { code: 'B83.9',  label: 'Helminthiasis, unspecified' },

  // Allergy / immunology
  { code: 'T78.40', label: 'Allergy, unspecified' },
  { code: 'T78.2XXA',label: 'Anaphylactic shock, unspecified, initial' },

  // Routine / preventive
  { code: 'Z00.00', label: 'Encounter for general adult medical exam w/o abn' },
  { code: 'Z00.121',label: 'Routine child health exam with abn findings' },
  { code: 'Z23',    label: 'Encounter for immunization' },
  { code: 'Z51.81', label: 'Encounter for therapeutic drug monitoring' },
  { code: 'Z79.4',  label: 'Long term use of insulin' },
  { code: 'Z79.84', label: 'Long term use of oral hypoglycaemic drugs' },
  { code: 'Z79.899',label: 'Other long term (current) drug therapy' },
  { code: 'Z71.3',  label: 'Dietary counselling and surveillance' },
  { code: 'Z72.0',  label: 'Tobacco use' },
  { code: 'Z02.79', label: 'Encounter for fit-for-work certificate' },
  { code: 'Z76.89', label: 'Persons encountering health services, other' },

  // Misc symptoms commonly billed
  { code: 'R60.0',  label: 'Localized edema' },
  { code: 'R63.4',  label: 'Abnormal weight loss' },
  { code: 'R63.5',  label: 'Abnormal weight gain' },
  { code: 'R30.0',  label: 'Dysuria' },
  { code: 'R31.9',  label: 'Haematuria, unspecified' },
  { code: 'R35.0',  label: 'Frequency of micturition' },
  { code: 'R73.03', label: 'Prediabetes' },
];

const BY_CODE: Map<string, string> = new Map(
  ICD10_CODES.map((c) => [c.code, c.label]),
);

export function lookupIcd10(code: string): string | undefined {
  return BY_CODE.get(code);
}

/**
 * In-memory ranked search. The curated list is ~150 entries so a full
 * scan is fine (sub-millisecond) — no index needed.
 *
 * Ranking:
 *   1.00  exact code match  (e.g. q="J02.9")
 *   0.95  code starts with q
 *   0.90  label word starts with q  (e.g. q="hyper" → "Hypertension")
 *   0.70  label contains q anywhere
 */
export function searchIcd10(rawQ: string, limit: number): Icd10Code[] {
  const q = rawQ.trim();
  if (q.length < 1) return [];
  const qLower = q.toLowerCase();

  type Scored = { item: Icd10Code; score: number };
  const scored: Scored[] = [];

  for (const item of ICD10_CODES) {
    const codeLower = item.code.toLowerCase();
    const labelLower = item.label.toLowerCase();
    let score = 0;

    if (codeLower === qLower) score = 1.0;
    else if (codeLower.startsWith(qLower)) score = 0.95;
    else if (codeLower.includes(qLower)) score = 0.85;
    else {
      // Label scoring
      const words = labelLower.split(/[\s,()/-]+/).filter(Boolean);
      if (words.some((w) => w.startsWith(qLower))) score = 0.90;
      else if (labelLower.includes(qLower)) score = 0.70;
    }

    if (score > 0) scored.push({ item, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.item.code.length - b.item.code.length ||
      a.item.code.localeCompare(b.item.code),
  );
  return scored.slice(0, limit).map((s) => s.item);
}
