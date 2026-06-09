/**
 * v2.0.0 seed — patient stories batch 3 (5 of 50).
 * Existing patients EHRC-2026-006 through 009 + 013.
 */
import type { SeedPatient } from './types';

export const PATIENTS_BATCH_3: SeedPatient[] = [
  // 6. Vikram Singh — 52M — Cooke Town — businessman
  // T2DM with sub-optimal control, central obesity, mild HTN
  {
    mrn: 'EHRC-2026-006', name: 'Vikram Singh', age_years: 52, sex: 'M',
    phone_e164: '+919876543206', known_allergies: null,
    occupation: 'Businessman', area: 'Cooke Town',
    primary_doctor_email: 'rajesh.murthy@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Type 2 diabetes mellitus', since: '2023-02', status: 'active',
        current_meds: ['Metformin 1g BD', 'Glimepiride 2mg OD'] },
      { label: 'Essential hypertension', since: '2024-01', status: 'controlled',
        current_meds: ['Telmisartan 40mg OD'] },
      { label: 'Mixed dyslipidemia', since: '2023-08', status: 'active',
        current_meds: ['Atorvastatin 20mg OD'] },
    ],
    encounters: [
      {
        date: '2025-06-30', doctor_email: 'rajesh.murthy@even.in',
        cc_chips: ['Diabetes follow-up'],
        cc_text: 'Quarterly DM review. Home FBS 140-160. Frequent business travel, food irregular.',
        vitals: { bp_sys: 138, bp_dia: 86, hr: 78, temp_c: 36.7, spo2: 98, weight_kg: 89, height_cm: 174, pain: 0 },
        exam_findings: 'Central obesity. Foot exam normal — pulses palpable, no ulcers. CVS regular.',
        assessment_codes: ['E11.9'],
        assessment_text: 'T2DM sub-optimal. Increasing Glimepiride.',
        rx_lines: [
          { generic: 'Metformin', brand: 'Glycomet', strength: '1g', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Glimepiride', brand: 'Amaryl', strength: '2mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Atorvastatin', brand: 'Atorva', strength: '20mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2025-10-12', doctor_email: 'rajesh.murthy@even.in',
        cc_chips: ['Diabetes follow-up', 'Lab review'],
        cc_text: 'Quarterly review. Home FBS 130-150. Lost 2kg with diet effort.',
        vitals: { bp_sys: 132, bp_dia: 82, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 87, height_cm: 174, pain: 0 },
        exam_findings: 'Stable.',
        assessment_codes: ['E11.9'],
        assessment_text: 'HbA1c 7.6 — improving slowly. Continue.',
        rx_lines: [
          { generic: 'Metformin', brand: 'Glycomet', strength: '1g', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Glimepiride', brand: 'Amaryl', strength: '2mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Atorvastatin', brand: 'Atorva', strength: '20mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2026-01-28', doctor_email: 'rajesh.murthy@even.in',
        cc_chips: ['Diabetes follow-up'],
        cc_text: 'Annual eye + foot screening due. Reports occasional tingling soles bilateral, started 2 months ago.',
        vitals: { bp_sys: 134, bp_dia: 84, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 87, height_cm: 174, pain: 1 },
        exam_findings: 'Monofilament sensation decreased bilaterally at first metatarsal heads. Ankle reflexes diminished. Vibration diminished.',
        assessment_codes: ['E11.4'],
        assessment_text: 'Early diabetic peripheral neuropathy. Starting B12 + Pregabalin. Fundus exam due.',
        rx_lines: [
          { generic: 'Methylcobalamin', brand: 'Mecobal', strength: '1500mcg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Pregabalin', brand: 'Lyrica', strength: '75mg', form: 'tablet', frequency: 'HS', duration_days: 30, instructions: 'Start at bedtime. May feel drowsy initially.' },
        ],
        disposition: 'refer', referral_target: 'Dr. Vinay · Neurology (DPN assessment + fundus by Ophth team)',
      },
      {
        date: '2026-02-14', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Diabetes follow-up'],
        cc_text: 'Referred by Dr. Rajesh for diabetic neuropathy assessment. Tingling improving on Pregabalin + B12.',
        vitals: { bp_sys: 130, bp_dia: 80, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 86, height_cm: 174, pain: 1 },
        exam_findings: 'Distal symmetric sensory polyneuropathy confirmed clinically. Power 5/5. Glove-stocking sensory loss to 5cm above ankles.',
        assessment_codes: ['E11.4', 'G63.2'],
        assessment_text: 'Diabetic peripheral neuropathy — early. Continue Pregabalin + B12. Tight glycaemic control is the disease-modifying intervention.',
        rx_lines: [
          { generic: 'Pregabalin', brand: 'Lyrica', strength: '75mg', form: 'tablet', frequency: 'BD', duration_days: 60, instructions: 'Up-titrated from HS only.' },
          { generic: 'Methylcobalamin', brand: 'Mecobal', strength: '1500mcg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
        handoff_note: 'Patient may benefit from SGLT2 or GLP-1 RA given progression — please consider at next endo visit.',
      },
      {
        date: '2026-04-22', doctor_email: 'rajesh.murthy@even.in',
        cc_chips: ['Diabetes follow-up'],
        cc_text: 'Quarterly review. Neuropathy stable on Pregabalin. HbA1c 7.9 latest — needs intensification.',
        vitals: { bp_sys: 132, bp_dia: 82, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 85, height_cm: 174, pain: 1 },
        exam_findings: 'Stable.',
        assessment_codes: ['E11.4'],
        assessment_text: 'T2DM with neuropathy. Adding Empagliflozin per Dr. V handoff suggestion — also good for cardio-renal protection.',
        rx_lines: [
          { generic: 'Empagliflozin', brand: 'Jardiance', strength: '10mg', form: 'tablet', frequency: 'OD', duration_days: 90, instructions: 'New addition. Maintain hydration.' },
          { generic: 'Metformin', brand: 'Glycomet', strength: '1g', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Glimepiride', brand: 'Amaryl', strength: '2mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Atorvastatin', brand: 'Atorva', strength: '20mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Pregabalin', brand: 'Lyrica', strength: '75mg', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Methylcobalamin', brand: 'Mecobal', strength: '1500mcg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Diabetes follow-up'],
        cc_text: 'Type 2 DM review, fasting BSL 162. Tingling persists at low level.',
        vitals: { bp_sys: 132, bp_dia: 82, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 84, height_cm: 174, pain: 1 },
        exam_findings: 'Feet exam normal, no ulcers, dorsalis pedis pulses palpable.',
        assessment_codes: ['E11.9', 'E11.4'],
        assessment_text: 'T2DM — fair control, HbA1c due.',
        rx_lines: [
          { generic: 'Empagliflozin', brand: 'Jardiance', strength: '10mg', form: 'tablet', frequency: 'OD', duration_days: 30 },
          { generic: 'Metformin', brand: 'Glycomet', strength: '1g', form: 'tablet', frequency: 'BD', duration_days: 30 },
          { generic: 'Glimepiride', brand: 'Amaryl', strength: '2mg', form: 'tablet', frequency: 'OD', duration_days: 30 },
        ],
        disposition: 'follow_up', follow_up_days: 30,
      },
    ],
    lab_cycles: [
      {
        date: '2025-06-28', ordering_doctor_email: 'rajesh.murthy@even.in',
        orders: [{ raw_text: 'HbA1c + Lipid + RFT', canonical_key: 'dm_panel', display_name: 'DM Quarterly Panel' }],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 8.2, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 108, unit: 'mg/dL', reference_range: '<100' },
          { canonical_key: 'creatinine', display_name: 'Creatinine', value_numeric: 1.0, unit: 'mg/dL', reference_range: '0.7-1.3' },
        ],
      },
      {
        date: '2025-10-10', ordering_doctor_email: 'rajesh.murthy@even.in',
        orders: [{ raw_text: 'HbA1c + Lipid + RFT', canonical_key: 'dm_panel', display_name: 'DM Quarterly Panel' }],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 7.6, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 96, unit: 'mg/dL', reference_range: '<100' },
        ],
      },
      {
        date: '2026-01-26', ordering_doctor_email: 'rajesh.murthy@even.in',
        orders: [
          { raw_text: 'HbA1c + Lipid + RFT + Urine ACR', canonical_key: 'dm_panel', display_name: 'DM Quarterly Panel' },
          { raw_text: 'NCV lower limbs', canonical_key: 'ncv', display_name: 'Nerve Conduction Study' },
        ],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 7.8, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'urine_acr', display_name: 'Urine ACR', value_numeric: 22, unit: 'mg/g', reference_range: '<30' },
          { canonical_key: 'ncv', display_name: 'NCV Lower Limbs', value_text: 'Mild axonal sensorimotor neuropathy, distal predominant.', unit: '', reference_range: 'normal' },
        ],
      },
      {
        date: '2026-04-20', ordering_doctor_email: 'rajesh.murthy@even.in',
        orders: [{ raw_text: 'HbA1c + Lipid', canonical_key: 'dm_panel', display_name: 'DM Quarterly Panel' }],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 7.9, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 88, unit: 'mg/dL', reference_range: '<100' },
        ],
      },
    ],
    override_events: [
      { date: '2026-01-28', doctor_email: 'rajesh.murthy@even.in', target_kind: 'problem', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Diabetic peripheral neuropathy', status: 'active', note: 'NCV confirmed mild axonal sensorimotor.' } },
    ],
  },

  // 7. Meera Pillai — 29F — HSR — corporate lawyer
  // GERD + IBS overlap, stress-related, post-COVID fatigue lingering
  {
    mrn: 'EHRC-2026-007', name: 'Meera Pillai', age_years: 29, sex: 'F',
    phone_e164: '+919876543207', known_allergies: null,
    occupation: 'Corporate lawyer', area: 'HSR Layout',
    primary_doctor_email: 'priya.suresh@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Gastro-esophageal reflux disease', since: '2024-11', status: 'active',
        current_meds: ['Pantoprazole 40mg OD'] },
      { label: 'Functional dyspepsia / IBS overlap', since: '2025-03', status: 'active' },
    ],
    encounters: [
      {
        date: '2025-08-08', doctor_email: 'priya.suresh@even.in', room_name: 'OPD-5',
        cc_chips: ['Acid reflux'],
        cc_text: 'GERD symptoms break-through. Burning, regurgitation, especially nights when eating late.',
        vitals: { bp_sys: 110, bp_dia: 72, hr: 76, temp_c: 36.7, spo2: 99, weight_kg: 54, height_cm: 162, pain: 4 },
        exam_findings: 'Epigastric tenderness mild. No alarm features.',
        assessment_codes: ['K21.9'],
        assessment_text: 'GERD — step up PPI + lifestyle counseling.',
        rx_lines: [
          { generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'BD', duration_days: 28 },
          { generic: 'Domperidone', brand: 'Vomistop', strength: '10mg', form: 'tablet', frequency: 'TDS', duration_days: 14 },
        ],
        disposition: 'follow_up', follow_up_days: 28,
      },
      {
        date: '2025-10-25', doctor_email: 'priya.suresh@even.in', room_name: 'OPD-5',
        cc_chips: ['Acid reflux', 'Abdominal pain'],
        cc_text: 'Reflux better but new cramping abdominal pain — relieved by defecation. Stool habit erratic — alternating constipation and diarrhea.',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 78, temp_c: 36.7, spo2: 99, weight_kg: 54, height_cm: 162, pain: 4 },
        exam_findings: 'Abdomen soft. Mild generalized tenderness. Bowel sounds normal.',
        assessment_codes: ['K58.9', 'K21.9'],
        assessment_text: 'IBS-Mixed superimposed on GERD. Both stress-related.',
        rx_lines: [
          { generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 60 },
          { generic: 'Mebeverine', brand: 'Colospa', strength: '135mg', form: 'tablet', frequency: 'TDS', duration_days: 21 },
        ],
        disposition: 'follow_up', follow_up_days: 60,
      },
      {
        date: '2026-02-10', doctor_email: 'priya.suresh@even.in', room_name: 'OPD-5',
        cc_chips: ['Acid reflux'],
        cc_text: 'Settled mostly. Reports persistent fatigue post-COVID (had infection Dec 2025). Not sure if GI-related.',
        vitals: { bp_sys: 110, bp_dia: 70, hr: 80, temp_c: 36.7, spo2: 99, weight_kg: 53, height_cm: 162, pain: 1 },
        exam_findings: 'Stable.',
        assessment_codes: ['K21.9'],
        assessment_text: 'GERD controlled. Post-COVID fatigue — recommend basic labs to exclude anemia / thyroid.',
        rx_lines: [{ generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 }],
        disposition: 'diagnostics',
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Acid reflux'],
        cc_text: 'Acid reflux, worse at night. Recent travel + irregular meals.',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 78, temp_c: 36.7, spo2: 99, weight_kg: 53, height_cm: 162, pain: 3 },
        exam_findings: 'Soft non-tender abdomen, no organomegaly.',
        assessment_codes: ['K21.9'],
        assessment_text: 'GERD.',
        rx_lines: [
          { generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 30, timing: 'before breakfast' },
        ],
        disposition: 'discharge',
      },
    ],
    lab_cycles: [
      {
        date: '2026-02-13', ordering_doctor_email: 'priya.suresh@even.in', link_to_encounter_date: '2026-02-10',
        orders: [
          { raw_text: 'CBC + TSH + Ferritin + Vit D', canonical_key: 'fatigue_panel', display_name: 'Fatigue Workup' },
        ],
        results: [
          { canonical_key: 'hemoglobin', display_name: 'Hemoglobin', value_numeric: 11.4, unit: 'g/dL', reference_range: '12.0-16.0 (F)' },
          { canonical_key: 'ferritin', display_name: 'Ferritin', value_numeric: 12, unit: 'ng/mL', reference_range: '15-150 (F)' },
          { canonical_key: 'tsh', display_name: 'TSH', value_numeric: 2.4, unit: 'µIU/mL', reference_range: '0.4-4.5' },
          { canonical_key: 'vitamin_d', display_name: 'Vitamin D', value_numeric: 16, unit: 'ng/mL', reference_range: '30-100' },
        ],
      },
    ],
    override_events: [],
  },

  // 8. Suresh Reddy — 58M — Whitefield — IT executive — Aspirin allergy
  // Suspected stable angina, hyperlipidemia, family hx of premature CAD
  {
    mrn: 'EHRC-2026-008', name: 'Suresh Reddy', age_years: 58, sex: 'M',
    phone_e164: '+919876543208', known_allergies: 'Aspirin (urticaria + nasal polyps, 2019)',
    occupation: 'IT executive', area: 'Whitefield',
    primary_doctor_email: 'anika.iyer@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Stable angina (suspected)', since: '2026-05', status: 'active' },
      { label: 'Mixed dyslipidemia', since: '2024-06', status: 'active', current_meds: ['Rosuvastatin 20mg OD'] },
      { label: 'Essential hypertension', since: '2023-11', status: 'controlled', current_meds: ['Telmisartan 40mg OD', 'Bisoprolol 5mg OD'] },
    ],
    encounters: [
      {
        date: '2025-07-15', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Lab review'],
        cc_text: 'Quarterly BP + lipid review. Stable. Family hx: father MI age 52, brother CABG age 50.',
        vitals: { bp_sys: 130, bp_dia: 82, hr: 70, temp_c: 36.7, spo2: 98, weight_kg: 78, height_cm: 172, pain: 0 },
        exam_findings: 'CVS regular. No bruits. No oedema.',
        assessment_codes: ['I10', 'E78.5'],
        assessment_text: 'HTN + dyslipidemia well-controlled. High family risk — consider stress test next year.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Bisoprolol', brand: 'Concor', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Rosuvastatin', brand: 'Rosuvas', strength: '20mg', form: 'tablet', frequency: 'OD', duration_days: 90, timing: 'HS' },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2025-11-04', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up'],
        cc_text: 'Routine follow-up. Reports good exercise tolerance — gym 3x/week, no chest pain.',
        vitals: { bp_sys: 128, bp_dia: 80, hr: 68, temp_c: 36.7, spo2: 98, weight_kg: 78, height_cm: 172, pain: 0 },
        exam_findings: 'Stable.',
        assessment_codes: ['I10'],
        assessment_text: 'HTN + dyslipidemia stable. Continue.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 180 },
          { generic: 'Bisoprolol', brand: 'Concor', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 180 },
          { generic: 'Rosuvastatin', brand: 'Rosuvas', strength: '20mg', form: 'tablet', frequency: 'OD', duration_days: 180 },
        ],
        disposition: 'follow_up', follow_up_days: 180,
      },
      {
        date: '2026-05-04', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['Chest pain'],
        cc_text: 'Onset of mild exertional chest discomfort over last 2 weeks. Comes on after climbing 2 flights of stairs, relieved by rest within 2-3 minutes. No radiation, no diaphoresis.',
        vitals: { bp_sys: 142, bp_dia: 88, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 79, height_cm: 172, pain: 3 },
        exam_findings: 'CVS regular, no murmurs. Lungs clear.',
        assessment_codes: ['I20.9'],
        assessment_text: 'Suspected stable angina — for urgent cardio review.',
        rx_lines: [
          { generic: 'Clopidogrel', brand: 'Plavix', strength: '75mg', form: 'tablet', frequency: 'OD', duration_days: 30, instructions: 'Aspirin allergy — Clopidogrel instead.' },
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 30 },
          { generic: 'Bisoprolol', brand: 'Concor', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 30 },
          { generic: 'Rosuvastatin', brand: 'Rosuvas', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 30, instructions: 'Up-titrated. Target LDL <55.' },
          { generic: 'Glyceryl trinitrate', brand: 'GTN', strength: '0.5mg', form: 'sublingual', frequency: 'PRN', duration: '3 months', instructions: 'For chest pain.' },
        ],
        disposition: 'refer', referral_target: 'Dr. Anika · Cardiology (urgent stress test + echo)',
        handoff_note: 'Aspirin allergy — Clopidogrel started. Strong family hx CAD. Stress test ideally this week.',
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Chest pain'],
        cc_text: 'Chest discomfort on exertion, x 5 days. Has not yet got stress test, came in for headache today but also flagged.',
        vitals: { bp_sys: 152, bp_dia: 90, hr: 88, temp_c: 36.7, spo2: 98, weight_kg: 79, height_cm: 172, pain: 3 },
        exam_findings: 'BP 152/90, HR 88, S1S2 normal, no murmur, lungs clear.',
        assessment_codes: ['I20.9'],
        assessment_text: 'Suspected stable angina — for cardiology referral.',
        rx_lines: [
          { generic: 'Clopidogrel', brand: 'Plavix', strength: '75mg', form: 'tablet', frequency: 'OD', duration_days: 30 },
          { generic: 'Rosuvastatin', brand: 'Rosuvas', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 30 },
          { generic: 'Glyceryl trinitrate', brand: 'GTN', strength: '0.5mg', form: 'sublingual', frequency: 'PRN', duration: '1 month' },
        ],
        disposition: 'refer', referral_target: 'Dr. Anika · Cardiology — urgent',
      },
    ],
    lab_cycles: [
      {
        date: '2025-07-12', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2025-07-15',
        orders: [{ raw_text: 'Lipid + HbA1c + RFT', canonical_key: 'cv_risk_panel', display_name: 'CV Risk Panel' }],
        results: [
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 88, unit: 'mg/dL', reference_range: '<70 (high-risk)' },
          { canonical_key: 'hdl_cholesterol', display_name: 'HDL Cholesterol', value_numeric: 38, unit: 'mg/dL', reference_range: '>40 (M)' },
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 5.6, unit: '%', reference_range: '<5.7' },
        ],
      },
      {
        date: '2026-05-02', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2026-05-04',
        orders: [
          { raw_text: 'ECG', canonical_key: 'ecg', display_name: 'ECG' },
          { raw_text: 'Troponin', canonical_key: 'troponin', display_name: 'Troponin I' },
          { raw_text: 'Lipid', canonical_key: 'lipid_panel', display_name: 'Lipid Profile' },
        ],
        results: [
          { canonical_key: 'ecg', display_name: 'ECG', value_text: 'NSR 76 bpm. No ST changes. Q waves V1-V2 — minor, likely lead position.', unit: '', reference_range: 'normal' },
          { canonical_key: 'troponin', display_name: 'Troponin I', value_numeric: 0.02, unit: 'ng/mL', reference_range: '<0.04' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 92, unit: 'mg/dL', reference_range: '<70 (high-risk)' },
        ],
      },
    ],
    override_events: [
      { date: '2026-05-04', doctor_email: 'chandrika.kambam@even.in', target_kind: 'problem', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Stable angina (suspected)', status: 'active', note: 'Strong family hx + classic exertional pattern. Awaiting stress test.' } },
    ],
  },

  // 9. Deepika Nair — 31F — Koramangala — designer
  // Recurrent UTI pattern, mild iron-deficiency anemia
  {
    mrn: 'EHRC-2026-009', name: 'Deepika Nair', age_years: 31, sex: 'F',
    phone_e164: '+919876543209', known_allergies: null,
    occupation: 'UX designer', area: 'Koramangala',
    primary_doctor_email: 'aditya.sharma@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Recurrent urinary tract infection', since: '2024-02', status: 'active' },
      { label: 'Iron-deficiency anemia', since: '2025-08', status: 'controlled', current_meds: ['Ferrous ascorbate'] },
    ],
    encounters: [
      {
        date: '2025-08-19', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Lab review'],
        cc_text: 'Reports fatigue past 2 months. Heavy menstrual periods. Routine labs ordered.',
        vitals: { bp_sys: 108, bp_dia: 68, hr: 88, temp_c: 36.7, spo2: 99, weight_kg: 52, height_cm: 161, pain: 0 },
        exam_findings: 'Mild pallor conjunctivae. CVS normal except tachy.',
        assessment_codes: ['D50.9'],
        assessment_text: 'Iron-deficiency anemia. Hb 9.8. Likely menstrual losses + dietary insufficiency.',
        rx_lines: [
          { generic: 'Ferrous ascorbate', brand: 'Orofer', strength: '100mg', form: 'tablet', frequency: 'OD', duration_days: 90, timing: 'with vit C source', instructions: 'Avoid with milk/tea.' },
          { generic: 'Folic acid', brand: 'Folvite', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 30 },
        ],
        disposition: 'follow_up', follow_up_days: 60,
      },
      {
        date: '2025-10-21', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Burning urination'],
        cc_text: 'Dysuria, frequency, urgency. 3rd episode this year. Sexually active, new partner.',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 80, temp_c: 37.6, spo2: 99, weight_kg: 53, height_cm: 161, pain: 4 },
        exam_findings: 'Suprapubic tenderness mild. No CVA tenderness.',
        assessment_codes: ['N39.0'],
        assessment_text: 'Recurrent UTI. Will treat empirically, send urine for C+S.',
        rx_lines: [
          { generic: 'Nitrofurantoin', brand: 'Niftran', strength: '100mg', form: 'tablet', frequency: 'BD', duration_days: 5, timing: 'with food' },
          { generic: 'Phenazopyridine', brand: 'Pyridium', strength: '100mg', form: 'tablet', frequency: 'TDS', duration_days: 3, instructions: 'For dysuria relief, urine may turn orange.' },
        ],
        disposition: 'diagnostics',
      },
      {
        date: '2026-02-06', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Lab review'],
        cc_text: 'Routine follow-up. Hb improved, periods regular on OCP. Discussed UTI prophylaxis strategies.',
        vitals: { bp_sys: 110, bp_dia: 72, hr: 72, temp_c: 36.7, spo2: 99, weight_kg: 54, height_cm: 161, pain: 0 },
        exam_findings: 'No pallor. Stable.',
        assessment_codes: ['D50.9'],
        assessment_text: 'Anemia improved. UTI — counseling done re: post-coital voiding + hydration.',
        rx_lines: [{ generic: 'Ferrous ascorbate', brand: 'Orofer', strength: '100mg', form: 'tablet', frequency: 'OD', duration_days: 90 }],
        disposition: 'discharge',
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Burning urination'],
        cc_text: 'UTI symptoms x 2 days. Dysuria, frequency. 4th episode in 18 months — concerned re: pattern.',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 78, temp_c: 37.2, spo2: 99, weight_kg: 54, height_cm: 161, pain: 3 },
        exam_findings: 'No costovertebral angle tenderness, suprapubic mild.',
        assessment_codes: ['N39.0'],
        assessment_text: 'Uncomplicated lower UTI. Will start empirical + send urine. Consider prophylaxis review with urology if 5th episode.',
        rx_lines: [
          { generic: 'Nitrofurantoin', brand: 'Niftran', strength: '100mg', form: 'tablet', frequency: 'BD', duration_days: 5 },
          { generic: 'Paracetamol', brand: 'Crocin', strength: '650mg', form: 'tablet', frequency: 'TDS PRN', duration_days: 3 },
        ],
        disposition: 'discharge',
      },
    ],
    lab_cycles: [
      {
        date: '2025-08-17', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2025-08-19',
        orders: [
          { raw_text: 'CBC + Iron studies', canonical_key: 'anemia_panel', display_name: 'Anemia Panel' },
        ],
        results: [
          { canonical_key: 'hemoglobin', display_name: 'Hemoglobin', value_numeric: 9.8, unit: 'g/dL', reference_range: '12.0-16.0 (F)' },
          { canonical_key: 'mcv', display_name: 'MCV', value_numeric: 72, unit: 'fL', reference_range: '80-100' },
          { canonical_key: 'ferritin', display_name: 'Ferritin', value_numeric: 6, unit: 'ng/mL', reference_range: '15-150 (F)' },
          { canonical_key: 'tibc', display_name: 'TIBC', value_numeric: 480, unit: 'µg/dL', reference_range: '250-450' },
        ],
      },
      {
        date: '2025-10-22', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2025-10-21',
        orders: [{ raw_text: 'Urine routine + culture', canonical_key: 'urine_routine_culture', display_name: 'Urine Routine + Culture' }],
        results: [
          { canonical_key: 'urine_culture', display_name: 'Urine Culture', value_text: 'E.coli >10^5 CFU/mL. Sensitive to Nitrofurantoin, Fosfomycin. Resistant to Ampicillin.', unit: '', reference_range: 'no growth' },
        ],
      },
      {
        date: '2026-02-04', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2026-02-06',
        orders: [{ raw_text: 'CBC + Ferritin', canonical_key: 'anemia_recheck', display_name: 'Anemia recheck' }],
        results: [
          { canonical_key: 'hemoglobin', display_name: 'Hemoglobin', value_numeric: 12.4, unit: 'g/dL', reference_range: '12.0-16.0 (F)' },
          { canonical_key: 'ferritin', display_name: 'Ferritin', value_numeric: 32, unit: 'ng/mL', reference_range: '15-150 (F)' },
        ],
      },
    ],
    override_events: [
      { date: '2026-02-06', doctor_email: 'aditya.sharma@even.in', target_kind: 'problem', target_key: 'Iron-deficiency anemia',
        action: 'edit', payload: { status: 'controlled', note: 'Hb 12.4, ferritin 32 — restored.' } },
    ],
  },

  // 13. Kavya Bhat — 24F — Bellandur — student
  // Today's pneumonia w/u — sparse prior history
  {
    mrn: 'EHRC-2026-013', name: 'Kavya Bhat', age_years: 24, sex: 'F',
    phone_e164: '+919876543213', known_allergies: null,
    occupation: 'Postgraduate student', area: 'Bellandur',
    primary_doctor_email: 'lakshmi.naidu@even.in', existing_in_v1: true,
    active_problems: [],
    encounters: [
      {
        date: '2025-09-30', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Vaccination'],
        cc_text: 'Routine annual flu shot before semester.',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 76, temp_c: 36.7, spo2: 99, weight_kg: 50, height_cm: 158, pain: 0 },
        exam_findings: 'Healthy. No contraindications.',
        assessment_codes: ['Z23'],
        assessment_text: 'Healthy adult, routine vaccination.',
        rx_lines: [{ generic: 'Influenza vaccine (quadrivalent)', brand: 'Vaxigrip', strength: '0.5mL', form: 'IM injection', frequency: 'single', duration: 'one-time' }],
        disposition: 'vaccinate',
      },
      // Today — has open paused_diagnostics encounter, won't have completed prior
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Cough', 'Fever'],
        cc_text: 'Cough + low-grade fever x 6 days. Recently had productive cough, mild SOB on climbing stairs.',
        vitals: { bp_sys: 110, bp_dia: 72, hr: 96, rr: 22, temp_c: 38.4, spo2: 97, weight_kg: 50, height_cm: 158, pain: 1 },
        exam_findings: 'Right lower zone crackles, RR 22, SpO2 97%.',
        assessment_codes: ['J18.9'],
        assessment_text: 'Suspected pneumonia — awaiting CXR.',
        rx_lines: [],
        disposition: 'diagnostics',
        status: 'paused_diagnostics',
      },
    ],
    lab_cycles: [],
    override_events: [],
  },
];
