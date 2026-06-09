/**
 * v2.0.0 seed — patient stories batch 4 (5 of 50).
 * Existing patients EHRC-2026-014 through 018.
 */
import type { SeedPatient } from './types';

export const PATIENTS_BATCH_4: SeedPatient[] = [
  // 14. Rohan Mehta — 37M — Bellandur — fintech founder
  // Palpitations workup, vaping history, recent caffeine spike
  {
    mrn: 'EHRC-2026-014', name: 'Rohan Mehta', age_years: 37, sex: 'M',
    phone_e164: '+919876543214', known_allergies: null,
    occupation: 'Fintech founder', area: 'Bellandur',
    primary_doctor_email: 'anika.iyer@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Palpitations — likely SVT vs sinus tachycardia', since: '2026-05', status: 'active' },
    ],
    encounters: [
      {
        date: '2025-12-15', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Annual check-up'],
        cc_text: 'Annual health check pre-investor due diligence. No complaints. Smokes 5 cig/day + vapes daily.',
        vitals: { bp_sys: 128, bp_dia: 82, hr: 80, temp_c: 36.7, spo2: 98, weight_kg: 76, height_cm: 178, pain: 0 },
        exam_findings: 'Unremarkable.',
        assessment_codes: ['Z00.0', 'F17.2'],
        assessment_text: 'Healthy. Nicotine dependence. Counseling done.',
        rx_lines: [],
        disposition: 'diagnostics',
      },
      // Today — paused_diagnostics
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Chest pain', 'Dizziness'],
        cc_text: 'Palpitations + occasional dizziness, x 2 weeks. Episodes 1-2/day, 30-60s each. Coffee intake high (6-8 cups/day during fundraise).',
        vitals: { bp_sys: 130, bp_dia: 82, hr: 92, temp_c: 36.7, spo2: 98, weight_kg: 76, height_cm: 178, pain: 0 },
        exam_findings: 'BP 130/82, HR 92 irregular, no S3/S4.',
        assessment_codes: ['R00.2'],
        assessment_text: 'R/o arrhythmia — awaiting ECG.',
        rx_lines: [],
        disposition: 'diagnostics', status: 'paused_diagnostics',
      },
    ],
    lab_cycles: [
      {
        date: '2025-12-12', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2025-12-15',
        orders: [{ raw_text: 'Annual labs', canonical_key: 'annual_panel', display_name: 'Annual Wellness Panel' }],
        results: [
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 124, unit: 'mg/dL', reference_range: '<130' },
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 5.4, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'tsh', display_name: 'TSH', value_numeric: 1.8, unit: 'µIU/mL', reference_range: '0.4-4.5' },
        ],
      },
    ],
    override_events: [],
  },

  // 15. Geetha Prasad — 55F — Yelahanka — homemaker
  // Cholelithiasis workup, T2DM, HTN
  {
    mrn: 'EHRC-2026-015', name: 'Geetha Prasad', age_years: 55, sex: 'F',
    phone_e164: '+919876543215', known_allergies: null,
    occupation: 'Homemaker', area: 'Yelahanka',
    primary_doctor_email: 'priya.suresh@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Type 2 diabetes mellitus', since: '2024-06', status: 'controlled',
        current_meds: ['Metformin 500mg BD'] },
      { label: 'Essential hypertension', since: '2023-09', status: 'controlled',
        current_meds: ['Amlodipine 5mg OD'] },
      { label: 'Symptomatic cholelithiasis (suspected)', since: '2026-05', status: 'active' },
    ],
    encounters: [
      {
        date: '2025-08-28', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Diabetes follow-up'],
        cc_text: 'Routine quarterly check. Both BP and BSL stable.',
        vitals: { bp_sys: 132, bp_dia: 82, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 72, height_cm: 156, pain: 0 },
        exam_findings: 'Stable.',
        assessment_codes: ['I10', 'E11.9'],
        assessment_text: 'HTN + DM2 well-controlled.',
        rx_lines: [
          { generic: 'Amlodipine', brand: 'Amlong', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2025-12-04', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Diabetes follow-up'],
        cc_text: 'Routine. Reports occasional RUQ discomfort after fatty meals over past 2 months.',
        vitals: { bp_sys: 134, bp_dia: 80, hr: 74, temp_c: 36.7, spo2: 98, weight_kg: 73, height_cm: 156, pain: 2 },
        exam_findings: 'Mild RUQ tenderness, Murphy negative.',
        assessment_codes: ['I10', 'E11.9'],
        assessment_text: 'HTN+DM stable. Will order USG abdomen to investigate RUQ discomfort.',
        rx_lines: [
          { generic: 'Amlodipine', brand: 'Amlong', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 90 },
        ],
        disposition: 'diagnostics',
      },
      {
        date: '2026-03-26', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Diabetes follow-up', 'Lab review'],
        cc_text: 'Routine + USG result review. Gallstones noted on USG, intermittent post-prandial pain ongoing.',
        vitals: { bp_sys: 132, bp_dia: 80, hr: 74, temp_c: 36.7, spo2: 98, weight_kg: 72, height_cm: 156, pain: 2 },
        exam_findings: 'Stable.',
        assessment_codes: ['I10', 'E11.9', 'K80.2'],
        assessment_text: 'Asymptomatic cholelithiasis at present. Will refer to surgical team if symptomatic.',
        rx_lines: [
          { generic: 'Amlodipine', brand: 'Amlong', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      // Today — paused_diagnostics
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Abdominal pain'],
        cc_text: 'RUQ pain + nausea, fatty food intolerance, x 1mo. Worse over past 3 days after wedding dinner.',
        vitals: { bp_sys: 138, bp_dia: 84, hr: 82, temp_c: 36.9, spo2: 98, weight_kg: 73, height_cm: 156, pain: 5 },
        exam_findings: 'Mild RUQ tenderness, no rebound, Murphy negative.',
        assessment_codes: ['K80.2'],
        assessment_text: 'R/o cholelithiasis — awaiting USG.',
        rx_lines: [],
        disposition: 'diagnostics', status: 'paused_diagnostics',
      },
    ],
    lab_cycles: [
      {
        date: '2025-08-26', ordering_doctor_email: 'chandrika.kambam@even.in',
        orders: [{ raw_text: 'HbA1c + Lipid', canonical_key: 'dm_panel', display_name: 'DM Quarterly' }],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 6.8, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 102, unit: 'mg/dL', reference_range: '<100' },
        ],
      },
      {
        date: '2026-01-08', ordering_doctor_email: 'chandrika.kambam@even.in',
        orders: [
          { raw_text: 'USG abdomen', canonical_key: 'usg_abdomen', display_name: 'USG Abdomen' },
          { raw_text: 'LFT', canonical_key: 'lft', display_name: 'Liver Function Test' },
        ],
        results: [
          { canonical_key: 'usg_abdomen', display_name: 'USG Abdomen', value_text: 'Multiple gallstones, largest 8mm. GB wall normal. CBD not dilated.', unit: '', reference_range: 'normal' },
          { canonical_key: 'alt', display_name: 'ALT', value_numeric: 28, unit: 'U/L', reference_range: '7-56' },
          { canonical_key: 'alkaline_phosphatase', display_name: 'ALP', value_numeric: 102, unit: 'U/L', reference_range: '40-129' },
        ],
      },
      {
        date: '2026-03-24', ordering_doctor_email: 'chandrika.kambam@even.in',
        orders: [{ raw_text: 'HbA1c + Lipid', canonical_key: 'dm_panel', display_name: 'DM Quarterly' }],
        results: [{ canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 6.7, unit: '%', reference_range: '<5.7' }],
      },
    ],
    override_events: [
      { date: '2026-03-26', doctor_email: 'chandrika.kambam@even.in', target_kind: 'problem', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Asymptomatic cholelithiasis', status: 'active', note: 'USG: multiple stones largest 8mm. No surgical indication unless symptomatic.' } },
    ],
  },

  // 16. Naveen Gowda — 33M — Banashankari — accountant
  // Pyrexia of unknown origin workup, dengue risk area
  {
    mrn: 'EHRC-2026-016', name: 'Naveen Gowda', age_years: 33, sex: 'M',
    phone_e164: '+919876543216', known_allergies: null,
    occupation: 'Chartered accountant', area: 'Banashankari',
    primary_doctor_email: 'aditya.sharma@even.in', existing_in_v1: true,
    active_problems: [],
    encounters: [
      {
        date: '2025-10-08', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Annual check-up'],
        cc_text: 'Annual physical. No complaints.',
        vitals: { bp_sys: 122, bp_dia: 78, hr: 70, temp_c: 36.7, spo2: 99, weight_kg: 68, height_cm: 170, pain: 0 },
        exam_findings: 'Normal.',
        assessment_codes: ['Z00.0'],
        assessment_text: 'Healthy adult.',
        rx_lines: [],
        disposition: 'discharge',
      },
      // Today — ready_to_resume
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Fever'],
        cc_text: 'Fever x 4 days, no localising symptoms. No travel, but lives near construction site, multiple mosquitoes.',
        vitals: { bp_sys: 118, bp_dia: 74, hr: 96, temp_c: 38.4, spo2: 98, weight_kg: 68, height_cm: 170, pain: 1 },
        exam_findings: 'Looks well, no rash, no neck stiffness, BP 118/74.',
        assessment_codes: ['R50.9'],
        assessment_text: 'Pyrexia of unknown origin — workup pending.',
        rx_lines: [],
        disposition: 'diagnostics', status: 'ready_to_resume',
      },
    ],
    lab_cycles: [],
    override_events: [],
  },

  // 17. Aishwarya Rao — 27F — Sarjapur — software engineer
  // UTI today, otherwise healthy
  {
    mrn: 'EHRC-2026-017', name: 'Aishwarya Rao', age_years: 27, sex: 'F',
    phone_e164: '+919876543217', known_allergies: null,
    occupation: 'Software engineer', area: 'Sarjapur',
    primary_doctor_email: 'aditya.sharma@even.in', existing_in_v1: true,
    active_problems: [],
    encounters: [
      {
        date: '2025-07-04', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Vaccination'],
        cc_text: 'HPV vaccine due — completing 3-dose schedule.',
        vitals: { bp_sys: 108, bp_dia: 68, hr: 72, temp_c: 36.7, spo2: 99, weight_kg: 55, height_cm: 162, pain: 0 },
        exam_findings: 'Healthy.',
        assessment_codes: ['Z23'],
        assessment_text: 'Routine vaccination.',
        rx_lines: [{ generic: 'HPV vaccine', brand: 'Gardasil-9', strength: '0.5mL', form: 'IM injection', frequency: 'single', duration: 'one-time (dose 2 of 3)' }],
        disposition: 'vaccinate',
      },
      // Today — ready_to_resume
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Burning urination'],
        cc_text: 'Burning micturition x 3 days. Mild frequency. No fever.',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 76, temp_c: 36.9, spo2: 99, weight_kg: 55, height_cm: 162, pain: 3 },
        exam_findings: 'Suprapubic tenderness, no flank tenderness.',
        assessment_codes: ['N39.0'],
        assessment_text: 'R/o UTI — urine sent.',
        rx_lines: [],
        disposition: 'diagnostics', status: 'ready_to_resume',
      },
    ],
    lab_cycles: [],
    override_events: [],
  },

  // 18. Prakash Hegde — 61M — Malleshwaram — retired engineer
  // BPH + chronic kidney disease stage 3a, ex-smoker
  {
    mrn: 'EHRC-2026-018', name: 'Prakash Hegde', age_years: 61, sex: 'M',
    phone_e164: '+919876543218', known_allergies: null,
    occupation: 'Retired civil engineer', area: 'Malleshwaram',
    primary_doctor_email: 'chandrika.kambam@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Benign prostatic hyperplasia', since: '2024-04', status: 'active',
        current_meds: ['Tamsulosin 0.4mg HS', 'Dutasteride 0.5mg OD'] },
      { label: 'Chronic kidney disease stage 3a', since: '2024-09', status: 'active' },
      { label: 'Essential hypertension', since: '2018-03', status: 'controlled',
        current_meds: ['Telmisartan 40mg OD'] },
    ],
    encounters: [
      {
        date: '2025-08-05', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Lab review'],
        cc_text: 'Quarterly BP + kidney function. Stable.',
        vitals: { bp_sys: 130, bp_dia: 78, hr: 72, temp_c: 36.7, spo2: 98, weight_kg: 68, height_cm: 168, pain: 0 },
        exam_findings: 'Stable.',
        assessment_codes: ['I10', 'N18.3'],
        assessment_text: 'HTN well-controlled. CKD stable.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Tamsulosin', brand: 'Flomax', strength: '0.4mg', form: 'capsule', frequency: 'HS', duration_days: 90 },
          { generic: 'Dutasteride', brand: 'Avodart', strength: '0.5mg', form: 'capsule', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2025-11-12', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['Burning urination'],
        cc_text: 'Increasing urinary frequency, nocturia 3-4 times/night up from 1-2. PSA stable last check.',
        vitals: { bp_sys: 132, bp_dia: 80, hr: 72, temp_c: 36.7, spo2: 98, weight_kg: 68, height_cm: 168, pain: 1 },
        exam_findings: 'Prostate enlarged smooth on DRE, no nodules.',
        assessment_codes: ['N40'],
        assessment_text: 'BPH symptoms increasing. Will check post-void residual + uroflow. Add 5-ARI step-up.',
        rx_lines: [
          { generic: 'Tamsulosin + Dutasteride', brand: 'Veltam Plus', strength: '0.4mg+0.5mg', form: 'capsule', frequency: 'OD', duration_days: 90, instructions: 'Combo replacement for prior 2 tablets.' },
        ],
        disposition: 'diagnostics',
      },
      {
        date: '2026-02-26', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Burning urination'],
        cc_text: 'Symptoms improved on combo. Routine BP check.',
        vitals: { bp_sys: 128, bp_dia: 76, hr: 70, temp_c: 36.7, spo2: 98, weight_kg: 68, height_cm: 168, pain: 0 },
        exam_findings: 'Stable.',
        assessment_codes: ['I10', 'N40', 'N18.3'],
        assessment_text: 'All stable. CKD GFR 52.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Tamsulosin + Dutasteride', brand: 'Veltam Plus', strength: '0.4mg+0.5mg', form: 'capsule', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      // Today (this patient is in waiting — Active encounter)
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['BP follow-up'],
        cc_text: 'Quarterly BP + BPH check. Generally stable.',
        vitals: { bp_sys: 130, bp_dia: 78, hr: 72, temp_c: 36.7, spo2: 98, weight_kg: 68, height_cm: 168, pain: 0 },
        exam_findings: 'Stable.',
        assessment_codes: ['I10', 'N40'],
        assessment_text: 'HTN + BPH stable.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Tamsulosin + Dutasteride', brand: 'Veltam Plus', strength: '0.4mg+0.5mg', form: 'capsule', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
    ],
    lab_cycles: [
      {
        date: '2025-08-03', ordering_doctor_email: 'chandrika.kambam@even.in',
        orders: [{ raw_text: 'Creatinine + ACR + PSA', canonical_key: 'urology_panel', display_name: 'Urology Quarterly' }],
        results: [
          { canonical_key: 'creatinine', display_name: 'Creatinine', value_numeric: 1.5, unit: 'mg/dL', reference_range: '0.7-1.3' },
          { canonical_key: 'egfr', display_name: 'eGFR', value_numeric: 50, unit: 'mL/min/1.73m²', reference_range: '>60' },
          { canonical_key: 'psa', display_name: 'PSA', value_numeric: 3.2, unit: 'ng/mL', reference_range: '<4.0' },
        ],
      },
      {
        date: '2025-11-10', ordering_doctor_email: 'chandrika.kambam@even.in',
        orders: [
          { raw_text: 'Post-void residual + uroflow', canonical_key: 'urodynamics', display_name: 'Uroflow + PVR' },
          { raw_text: 'PSA', canonical_key: 'psa', display_name: 'PSA' },
        ],
        results: [
          { canonical_key: 'post_void_residual', display_name: 'Post-void residual', value_numeric: 65, unit: 'mL', reference_range: '<50' },
          { canonical_key: 'qmax', display_name: 'Qmax', value_numeric: 11, unit: 'mL/s', reference_range: '>15' },
          { canonical_key: 'psa', display_name: 'PSA', value_numeric: 3.0, unit: 'ng/mL', reference_range: '<4.0' },
        ],
      },
      {
        date: '2026-02-24', ordering_doctor_email: 'chandrika.kambam@even.in',
        orders: [{ raw_text: 'Creatinine + Lipid', canonical_key: 'ckd_panel', display_name: 'CKD Quarterly' }],
        results: [
          { canonical_key: 'creatinine', display_name: 'Creatinine', value_numeric: 1.4, unit: 'mg/dL', reference_range: '0.7-1.3' },
          { canonical_key: 'egfr', display_name: 'eGFR', value_numeric: 52, unit: 'mL/min/1.73m²', reference_range: '>60' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 94, unit: 'mg/dL', reference_range: '<100' },
        ],
      },
    ],
    override_events: [],
  },
];
