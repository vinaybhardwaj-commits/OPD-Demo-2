/**
 * Static map of chronic Rx drugs → implied comorbidities (ICD-10).
 *
 * v3.9.4 — Used by `/api/encounters/[id]/rx-coherence` to detect when a
 * doctor is prescribing a drug that typically implies a comorbidity the
 * patient doesn't have on file. Static layer runs first; drugs not in this
 * map fall through to a Qwen "is this chronic?" check.
 *
 * Coverage targets the high-confidence, high-volume chronic classes seen
 * at EHS Tier-2 FM clinics. Drugs whose chronic-vs-acute usage is genuinely
 * ambiguous (PPIs, SSRIs, amitriptyline, opioids, gabapentinoids) are
 * intentionally EXCLUDED from the static map — Qwen + clinician judgment
 * handles those. False negative > false positive in v1.
 *
 * Match strategy: case-insensitive substring against generic_name first,
 * then brand_name. Synonyms[] cover trade names and common India-market
 * brands (e.g. glycomet for metformin).
 */

export type ChronicRxEntry = {
  generic: string;
  synonyms: string[];
  icd10: string;
  label: string;
  drug_class: string;
  /** 0–1 confidence this Rx implies the comorbidity. Hard-capped at 0.95. */
  confidence: number;
};

export const CHRONIC_RX_MAP: ChronicRxEntry[] = [
  // --- Diabetes (E11.x) ---
  { generic: 'metformin', synonyms: ['glycomet','glucophage','okamet','cetapin','gluconorm'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'biguanide', confidence: 0.95 },
  { generic: 'glimepiride', synonyms: ['amaryl','glimer','azulix'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'sulfonylurea', confidence: 0.95 },
  { generic: 'glibenclamide', synonyms: ['glyburide','daonil','euglucon'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'sulfonylurea', confidence: 0.95 },
  { generic: 'gliclazide', synonyms: ['diamicron','glizid','glix'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'sulfonylurea', confidence: 0.95 },
  { generic: 'sitagliptin', synonyms: ['januvia','istavel'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'dpp4', confidence: 0.95 },
  { generic: 'vildagliptin', synonyms: ['galvus','jalra','zomelis'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'dpp4', confidence: 0.95 },
  { generic: 'linagliptin', synonyms: ['trajenta'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'dpp4', confidence: 0.95 },
  { generic: 'teneligliptin', synonyms: ['tenepride','zita','tenglyn'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'dpp4', confidence: 0.95 },
  { generic: 'empagliflozin', synonyms: ['jardiance','emparil'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'sglt2', confidence: 0.95 },
  { generic: 'dapagliflozin', synonyms: ['forxiga','oxra','udapa'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'sglt2', confidence: 0.95 },
  { generic: 'canagliflozin', synonyms: ['invokana'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'sglt2', confidence: 0.95 },
  { generic: 'pioglitazone', synonyms: ['pioz','piozone'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'tzd', confidence: 0.95 },
  { generic: 'acarbose', synonyms: ['glucobay'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'alpha-glucosidase', confidence: 0.95 },
  { generic: 'voglibose', synonyms: ['vocarb','voglib'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'alpha-glucosidase', confidence: 0.95 },
  { generic: 'liraglutide', synonyms: ['victoza','saxenda'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'glp1', confidence: 0.85 },
  { generic: 'semaglutide', synonyms: ['ozempic','rybelsus','wegovy'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'glp1', confidence: 0.85 },
  { generic: 'dulaglutide', synonyms: ['trulicity'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'glp1', confidence: 0.95 },
  { generic: 'insulin', synonyms: ['humalog','novorapid','lantus','tresiba','mixtard','huminsulin','basalog','glargine'], icd10: 'E11.9', label: 'Type 2 diabetes mellitus', drug_class: 'insulin', confidence: 0.85 },

  // --- Hypertension (I10) ---
  { generic: 'amlodipine', synonyms: ['amlong','amlodac','amlopres','stamlo','amtas','amlokind'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'ccb', confidence: 0.9 },
  { generic: 'nifedipine', synonyms: ['adalat','depin','nicardia'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'ccb', confidence: 0.9 },
  { generic: 'cilnidipine', synonyms: ['cilacar','cinod'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'ccb', confidence: 0.95 },
  { generic: 'felodipine', synonyms: ['felogard','plendil'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'ccb', confidence: 0.95 },
  { generic: 'telmisartan', synonyms: ['telma','telpres','telsartan','cresar','arbitel'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'arb', confidence: 0.92 },
  { generic: 'losartan', synonyms: ['losacar','losanorm','covance','repace'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'arb', confidence: 0.9 },
  { generic: 'olmesartan', synonyms: ['olmesar','olvance','olmetrack','benitec'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'arb', confidence: 0.95 },
  { generic: 'valsartan', synonyms: ['diovan','starval'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'arb', confidence: 0.9 },
  { generic: 'enalapril', synonyms: ['envas','enam'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'acei', confidence: 0.9 },
  { generic: 'ramipril', synonyms: ['cardace','ramcor','ramistar','hopecard'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'acei', confidence: 0.9 },
  { generic: 'lisinopril', synonyms: ['lisoril','cipril'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'acei', confidence: 0.9 },
  { generic: 'perindopril', synonyms: ['coversyl','pearinda'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'acei', confidence: 0.92 },
  { generic: 'hydrochlorothiazide', synonyms: ['hctz','aquazide','hydrazide'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'thiazide', confidence: 0.92 },
  { generic: 'indapamide', synonyms: ['natrilix','lorvas','indicontin'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'thiazide', confidence: 0.92 },
  { generic: 'chlorthalidone', synonyms: ['ctd','chlorthacare'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'thiazide', confidence: 0.95 },

  // --- Beta-blockers (HTN/CAD/HF; collapse to I10 for v1) ---
  { generic: 'metoprolol', synonyms: ['betaloc','metolar','starpress','seloken','metpure'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'beta-blocker', confidence: 0.7 },
  { generic: 'atenolol', synonyms: ['aten','tenormin','betacard'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'beta-blocker', confidence: 0.8 },
  { generic: 'bisoprolol', synonyms: ['concor','corbis','bisocor'], icd10: 'I10', label: 'Essential hypertension', drug_class: 'beta-blocker', confidence: 0.7 },
  { generic: 'carvedilol', synonyms: ['cardivas','carvil','caryl'], icd10: 'I50.9', label: 'Heart failure, unspecified', drug_class: 'beta-blocker', confidence: 0.7 },

  // --- Dyslipidemia (E78.5) ---
  { generic: 'atorvastatin', synonyms: ['atocor','atorlip','storvas','lipitor','atorva'], icd10: 'E78.5', label: 'Hyperlipidemia, unspecified', drug_class: 'statin', confidence: 0.95 },
  { generic: 'rosuvastatin', synonyms: ['rosuvas','crestor','rosumac','rosulip','rostar'], icd10: 'E78.5', label: 'Hyperlipidemia, unspecified', drug_class: 'statin', confidence: 0.95 },
  { generic: 'simvastatin', synonyms: ['simvotin','zocor'], icd10: 'E78.5', label: 'Hyperlipidemia, unspecified', drug_class: 'statin', confidence: 0.95 },
  { generic: 'fenofibrate', synonyms: ['lipicard','finate','controlip'], icd10: 'E78.5', label: 'Hyperlipidemia, unspecified', drug_class: 'fibrate', confidence: 0.95 },
  { generic: 'ezetimibe', synonyms: ['ezetib','ezedoc'], icd10: 'E78.5', label: 'Hyperlipidemia, unspecified', drug_class: 'cholesterol-absorption-inhibitor', confidence: 0.95 },

  // --- Thyroid ---
  { generic: 'levothyroxine', synonyms: ['thyronorm','eltroxin','thyrox','thyroup','thyroxine'], icd10: 'E03.9', label: 'Hypothyroidism, unspecified', drug_class: 'thyroid-replacement', confidence: 0.95 },
  { generic: 'methimazole', synonyms: ['tapazole','thiamazole'], icd10: 'E05.90', label: 'Hyperthyroidism, unspecified', drug_class: 'antithyroid', confidence: 0.95 },
  { generic: 'carbimazole', synonyms: ['neo-mercazole','thyrozole'], icd10: 'E05.90', label: 'Hyperthyroidism, unspecified', drug_class: 'antithyroid', confidence: 0.95 },

  // --- Antiplatelets (CAD/secondary prevention) ---
  { generic: 'clopidogrel', synonyms: ['clopilet','deplatt','preva'], icd10: 'I25.9', label: 'Chronic ischemic heart disease', drug_class: 'antiplatelet', confidence: 0.85 },
  { generic: 'ecosprin', synonyms: ['aspirin','sprintas','loprin'], icd10: 'I25.9', label: 'Chronic ischemic heart disease', drug_class: 'antiplatelet', confidence: 0.65 },

  // --- Anticoagulants (AF / DVT) ---
  { generic: 'apixaban', synonyms: ['eliquis'], icd10: 'I48.91', label: 'Atrial fibrillation', drug_class: 'doac', confidence: 0.7 },
  { generic: 'rivaroxaban', synonyms: ['xarelto'], icd10: 'I48.91', label: 'Atrial fibrillation', drug_class: 'doac', confidence: 0.7 },
  { generic: 'dabigatran', synonyms: ['pradaxa'], icd10: 'I48.91', label: 'Atrial fibrillation', drug_class: 'doac', confidence: 0.75 },
  { generic: 'warfarin', synonyms: ['warf'], icd10: 'I48.91', label: 'Atrial fibrillation', drug_class: 'vka', confidence: 0.7 },
  { generic: 'acenocoumarol', synonyms: ['acitrom'], icd10: 'I48.91', label: 'Atrial fibrillation', drug_class: 'vka', confidence: 0.75 },

  // --- Gout / hyperuricemia ---
  { generic: 'allopurinol', synonyms: ['zyloric','ciploric'], icd10: 'M10.9', label: 'Gout, unspecified', drug_class: 'xoi', confidence: 0.85 },
  { generic: 'febuxostat', synonyms: ['febutaz','feburic','zurig'], icd10: 'M10.9', label: 'Gout, unspecified', drug_class: 'xoi', confidence: 0.95 },

  // --- COPD / Asthma (inhaled) ---
  { generic: 'tiotropium', synonyms: ['spiriva','tiova'], icd10: 'J44.9', label: 'COPD, unspecified', drug_class: 'lama', confidence: 0.95 },
  { generic: 'salmeterol', synonyms: ['serobid','serroflo'], icd10: 'J45.909', label: 'Asthma, unspecified', drug_class: 'laba', confidence: 0.8 },
  { generic: 'formoterol', synonyms: ['foracort','symbicort'], icd10: 'J45.909', label: 'Asthma, unspecified', drug_class: 'laba', confidence: 0.8 },
  { generic: 'budesonide', synonyms: ['budecort','pulmicort','budamate'], icd10: 'J45.909', label: 'Asthma, unspecified', drug_class: 'ics', confidence: 0.85 },
  { generic: 'montelukast', synonyms: ['montair','romilast','telekast'], icd10: 'J45.909', label: 'Asthma, unspecified', drug_class: 'ltra', confidence: 0.85 },

  // --- BPH ---
  { generic: 'tamsulosin', synonyms: ['urimax','flomax','tamdura'], icd10: 'N40.0', label: 'Benign prostatic hyperplasia', drug_class: 'alpha-blocker', confidence: 0.9 },
  { generic: 'finasteride', synonyms: ['finpecia','fincar','proscar'], icd10: 'N40.0', label: 'Benign prostatic hyperplasia', drug_class: '5ari', confidence: 0.75 },
  { generic: 'dutasteride', synonyms: ['dutas','duprost'], icd10: 'N40.0', label: 'Benign prostatic hyperplasia', drug_class: '5ari', confidence: 0.92 },

  // --- Epilepsy ---
  { generic: 'phenytoin', synonyms: ['eptoin','dilantin','epsolin'], icd10: 'G40.909', label: 'Epilepsy, unspecified', drug_class: 'aed', confidence: 0.9 },
  { generic: 'levetiracetam', synonyms: ['levipil','keppra','lekitam'], icd10: 'G40.909', label: 'Epilepsy, unspecified', drug_class: 'aed', confidence: 0.92 },
  { generic: 'sodium valproate', synonyms: ['valproate','encorate','valparin','divalproex'], icd10: 'G40.909', label: 'Epilepsy, unspecified', drug_class: 'aed', confidence: 0.8 },
  { generic: 'carbamazepine', synonyms: ['tegretol','mazetol'], icd10: 'G40.909', label: 'Epilepsy, unspecified', drug_class: 'aed', confidence: 0.8 },
];

/**
 * Lookup a single Rx drug name and return the matched chronic-Rx entry,
 * or null. Match priority:
 *   1. Exact generic match
 *   2. Substring match against generic
 *   3. Substring match against any synonym
 */
export function lookupChronicRx(drugName: string): ChronicRxEntry | null {
  if (!drugName) return null;
  const q = drugName.toLowerCase().trim();
  if (!q) return null;
  const exact = CHRONIC_RX_MAP.find((e) => e.generic === q);
  if (exact) return exact;
  const sub = CHRONIC_RX_MAP.find((e) => q.includes(e.generic));
  if (sub) return sub;
  const syn = CHRONIC_RX_MAP.find((e) =>
    e.synonyms.some((s) => s.length >= 3 && q.includes(s.toLowerCase())),
  );
  return syn ?? null;
}

export function listChronicRxGenerics(): string[] {
  return CHRONIC_RX_MAP.map((e) => e.generic).sort();
}
