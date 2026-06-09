/**
 * v2.0.0 seed — patient stories batch 1 (5 of 50).
 *
 * Texture-validation batch. Covers the diversity spectrum:
 *   1. Mohan Rao         — existing, chronic multi-morbid (HTN + DM2 + OA)
 *   2. Sunita Krishnan   — existing, elderly endocrine (hypothyroid + OA)
 *   3. Arjun Murthy      — existing, acute ortho (mechanical LBP)
 *   4. Lakshmi Iyengar   — NEW, young multi-system (anxiety + IBS + hypothyroid)
 *   5. Vikram Reddy      — NEW, retired military (COPD + post-MI + DM2)
 *
 * Each carries ~6-8 historical encounters + 4-6 lab cycles + 1-3 override events
 * over the past 12 months (today = 2026-05-18 per env).
 *
 * Today's MRNs (1-4) are preserved from v1's seed in migration v3.
 */

import type { SeedPatient } from './types';

export const PATIENTS_BATCH_1: SeedPatient[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // 1. Mohan Rao — 66M — Indiranagar — retired bank manager
  //    Chronic HTN + DM2 + bilateral knee OA. Iodine contrast allergy.
  // ──────────────────────────────────────────────────────────────────────────
  {
    mrn: 'EHRC-2026-012',
    name: 'Mohan Rao',
    age_years: 66,
    sex: 'M',
    phone_e164: '+919845112233',
    known_allergies: 'Iodine contrast',
    occupation: 'Retired bank manager',
    area: 'Indiranagar',
    primary_doctor_email: 'chandrika.kambam@even.in',
    existing_in_v1: true,
    active_problems: [
      { label: 'Essential hypertension', since: '2025-06', status: 'controlled',
        current_meds: ['Telmisartan 80mg OD', 'Amlodipine 5mg OD'] },
      { label: 'Type 2 diabetes mellitus', since: '2025-07', status: 'controlled',
        current_meds: ['Metformin 500mg BD'] },
      { label: 'Bilateral knee osteoarthritis', since: '2025-12', status: 'active',
        current_meds: [] },
    ],
    encounters: [
      {
        date: '2025-06-12',
        doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up'],
        cc_text: 'First-time visit. Patient reports occasional morning headaches over the past month and one episode of dizziness 2 weeks ago. No chest pain, no breathlessness. Concerned after pharmacist BP reading of 160/100.',
        vitals: { bp_sys: 162, bp_dia: 96, hr: 84, temp_c: 36.8, spo2: 98, weight_kg: 76, height_cm: 168, pain: 0 },
        exam_findings: 'No raised JVP, normal S1S2 no murmurs. Chest clear. No pedal oedema. BMI 26.9. Optic fundi grossly normal (no retinopathy).',
        assessment_codes: ['I10'],
        assessment_text: 'Newly diagnosed essential hypertension (stage 2). No clinical evidence of end-organ damage. Baseline labs ordered.',
        rx_lines: [{ generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 14, timing: 'morning, before food' }],
        disposition: 'follow_up', follow_up_days: 14,
      },
      {
        date: '2025-07-02',
        doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Lab review'],
        cc_text: 'Returns with lab results. BP at home running 140-150 systolic. Reports tolerating Telmisartan well, no orthostatic symptoms.',
        vitals: { bp_sys: 144, bp_dia: 88, hr: 78, temp_c: 36.7, spo2: 98, weight_kg: 76, height_cm: 168, pain: 0 },
        exam_findings: 'Cardiovascular exam unremarkable. No new findings.',
        assessment_codes: ['I10', 'E11.9'],
        assessment_text: 'Essential HTN — partial control on Telmisartan 40mg. NEW: T2DM identified on HbA1c 7.4 (target check). Lipid borderline (LDL 142). Starting Metformin. Diet counseling.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 42, timing: 'morning, before food' },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 42, timing: 'with meals', instructions: 'Start after lunch; titrate to BD by week 2.' },
        ],
        disposition: 'follow_up', follow_up_days: 42,
      },
      {
        date: '2025-08-14',
        doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Diabetes follow-up'],
        cc_text: 'Home BP averaging 130-138. HbA1c at home glucometer fasting 130-150 range. Patient mentions occasional right knee ache after morning walks.',
        vitals: { bp_sys: 138, bp_dia: 82, hr: 74, temp_c: 36.6, spo2: 98, weight_kg: 75, height_cm: 168, pain: 2 },
        exam_findings: 'Mild crepitus right knee, no warmth, no effusion. Full ROM with mild discomfort at end-range. Otherwise stable.',
        assessment_codes: ['I10', 'E11.9'],
        assessment_text: 'HTN improving. T2DM well-controlled on initial Metformin. Mild knee pain — likely early OA, will watch.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90, timing: 'morning, before food' },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 90, timing: 'with meals' },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2025-11-22',
        doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Diabetes follow-up'],
        cc_text: 'BP stable. Major complaint: knee pain has worsened, now bilateral, especially climbing stairs. Has been taking OTC paracetamol intermittently.',
        vitals: { bp_sys: 134, bp_dia: 80, hr: 72, temp_c: 36.7, spo2: 98, weight_kg: 75.5, height_cm: 168, pain: 4 },
        exam_findings: 'Bilateral knee crepitus, palpable osteophytes medially. No effusion. Mild varus deformity left. Range of motion 5-130 bilaterally.',
        assessment_codes: ['I10', 'E11.9', 'M17.0'],
        assessment_text: 'HTN + DM2 stable. Bilateral knee OA, progressive. Will refer to Ortho for staging and management plan.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Paracetamol', brand: 'Crocin', strength: '650mg', form: 'tablet', frequency: 'PRN', duration: 'as needed', instructions: 'Max 3g/day. For knee pain.' },
        ],
        disposition: 'refer', referral_target: 'Dr. Karthik · Orthopedics',
        handoff_note: 'Please advise on bilateral knee plan; patient reluctant on injections, prefers conservative approach.',
      },
      {
        date: '2025-12-05',
        doctor_email: 'karthik.reddy@even.in',
        room_name: 'OPD-6',
        cc_chips: ['Joint pain'],
        cc_text: 'Referred by Dr. Chandrika for bilateral knee pain. Worse on stairs and after prolonged sitting. No morning stiffness >30min. No constitutional symptoms.',
        vitals: { bp_sys: 132, bp_dia: 78, hr: 70, temp_c: 36.7, spo2: 98, weight_kg: 75, height_cm: 168, pain: 4 },
        exam_findings: 'Bilateral knee tenderness over medial joint line. Crepitus on flexion-extension. McMurray negative. Slight quadriceps wasting bilaterally. X-ray (done today): K-L grade 2 bilateral, medial compartment narrowing.',
        assessment_codes: ['M17.0'],
        assessment_text: 'Bilateral knee OA, K-L grade 2. Conservative management appropriate — physio + analgesia + weight optimization. No surgical indication.',
        rx_lines: [
          { generic: 'Etoricoxib', brand: 'Etoshine', strength: '60mg', form: 'tablet', frequency: 'OD', duration_days: 14, timing: 'after food', instructions: 'For 2 weeks then PRN.' },
          { generic: 'Glucosamine + Chondroitin', brand: 'Joint-Up', strength: '1500mg+1200mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90, referral_target: 'Physiotherapy unit',
      },
      {
        date: '2026-02-18',
        doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Diabetes follow-up'],
        cc_text: 'Quarterly check. Home BP creeping up to 140-145. Stopped Etoricoxib after 2 weeks — felt it did not help much. Glucosamine continues.',
        vitals: { bp_sys: 142, bp_dia: 88, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 76, height_cm: 168, pain: 3 },
        exam_findings: 'Cardiovascular: normal. Knee findings unchanged from December.',
        assessment_codes: ['I10', 'E11.9', 'M17.0'],
        assessment_text: 'HTN — needs intensification. T2DM stable. Knee OA persistent but tolerable. Increasing Telmisartan dose.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '80mg', form: 'tablet', frequency: 'OD', duration_days: 42, timing: 'morning, before food', instructions: 'Increased from 40mg.' },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 42 },
        ],
        disposition: 'follow_up', follow_up_days: 42,
      },
      {
        date: '2026-04-07',
        doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Diabetes follow-up'],
        cc_text: 'BP improved on Telmisartan 80. Home readings 130-138. Continues knee pain at low level. Mood good. Walks 30 min most days.',
        vitals: { bp_sys: 136, bp_dia: 84, hr: 72, temp_c: 36.7, spo2: 98, weight_kg: 76, height_cm: 168, pain: 2 },
        exam_findings: 'No new findings.',
        assessment_codes: ['I10', 'E11.9', 'M17.0'],
        assessment_text: 'HTN well-controlled on increased dose. T2DM stable. Added low-dose Amlodipine for added BP buffer given KDIGO target 130/80 for diabetics.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '80mg', form: 'tablet', frequency: 'OD', duration_days: 42 },
          { generic: 'Amlodipine', brand: 'Amlong', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 42, timing: 'morning', instructions: 'New addition for tighter BP target.' },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 42 },
        ],
        disposition: 'follow_up', follow_up_days: 42,
      },
      // Today's encounter — already exists in v1's seed. The seed runner
      // detects the existing ENC-20260518-012 and SKIPs re-inserting.
      // We list it here for completeness/auditability.
      {
        date: '2026-05-18',
        doctor_email: 'vinay.bhardwaj@even.in',
        room_name: 'OPD-1',
        cc_chips: ['BP follow-up', 'Diabetes follow-up'],
        cc_text: 'Routine quarterly check — BP and DM follow-up. No new complaints.',
        vitals: { bp_sys: 132, bp_dia: 80, hr: 70, temp_c: 36.7, spo2: 98, weight_kg: 76, height_cm: 168, pain: 2 },
        exam_findings: 'Stable.',
        assessment_codes: ['I10', 'E11.9'],
        assessment_text: 'Essential HTN well-controlled. T2DM well-controlled. Knee OA stable on conservative management.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '80mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Amlodipine', brand: 'Amlong', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Metformin', brand: 'Glycomet', strength: '500mg', form: 'tablet', frequency: 'BD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
    ],
    lab_cycles: [
      {
        date: '2025-06-15', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2025-06-12',
        orders: [
          { raw_text: 'CBC', canonical_key: 'cbc', display_name: 'Complete Blood Count' },
          { raw_text: 'Lipid profile', canonical_key: 'lipid_panel', display_name: 'Lipid Profile' },
          { raw_text: 'HbA1c', canonical_key: 'hba1c', display_name: 'Glycated Hemoglobin' },
          { raw_text: 'RFT', canonical_key: 'rft', display_name: 'Renal Function Test' },
          { raw_text: 'LFT', canonical_key: 'lft', display_name: 'Liver Function Test' },
        ],
        results: [
          { canonical_key: 'hemoglobin', display_name: 'Hemoglobin', value_numeric: 13.8, unit: 'g/dL', reference_range: '13.0-17.0 (M)' },
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 7.4, unit: '%', reference_range: '<5.7 normal · 5.7-6.4 prediabetes · ≥6.5 diabetes' },
          { canonical_key: 'fasting_glucose', display_name: 'Fasting Plasma Glucose', value_numeric: 142, unit: 'mg/dL', reference_range: '70-100' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 142, unit: 'mg/dL', reference_range: '<100 optimal · 100-129 near-optimal · 130-159 borderline' },
          { canonical_key: 'hdl_cholesterol', display_name: 'HDL Cholesterol', value_numeric: 42, unit: 'mg/dL', reference_range: '>40 (M)' },
          { canonical_key: 'triglycerides', display_name: 'Triglycerides', value_numeric: 168, unit: 'mg/dL', reference_range: '<150' },
          { canonical_key: 'creatinine', display_name: 'Serum Creatinine', value_numeric: 1.0, unit: 'mg/dL', reference_range: '0.7-1.3' },
          { canonical_key: 'alt', display_name: 'ALT (SGPT)', value_numeric: 28, unit: 'U/L', reference_range: '7-56' },
        ],
      },
      {
        date: '2025-08-12', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2025-08-14',
        orders: [
          { raw_text: 'HbA1c', canonical_key: 'hba1c', display_name: 'Glycated Hemoglobin' },
          { raw_text: 'Lipid', canonical_key: 'lipid_panel', display_name: 'Lipid Profile' },
        ],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 7.1, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 128, unit: 'mg/dL', reference_range: '<100 optimal' },
        ],
      },
      {
        date: '2025-11-19', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2025-11-22',
        orders: [
          { raw_text: 'HbA1c', canonical_key: 'hba1c', display_name: 'Glycated Hemoglobin' },
          { raw_text: 'Lipid', canonical_key: 'lipid_panel', display_name: 'Lipid Profile' },
          { raw_text: 'Creatinine', canonical_key: 'creatinine', display_name: 'Serum Creatinine' },
        ],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 6.8, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 118, unit: 'mg/dL', reference_range: '<100' },
          { canonical_key: 'creatinine', display_name: 'Serum Creatinine', value_numeric: 1.0, unit: 'mg/dL', reference_range: '0.7-1.3' },
        ],
      },
      {
        date: '2026-02-15', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2026-02-18',
        orders: [
          { raw_text: 'HbA1c + Lipid + RFT + LFT', canonical_key: 'panel_chronic_care', display_name: 'Chronic care panel' },
        ],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 7.0, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 116, unit: 'mg/dL', reference_range: '<100' },
          { canonical_key: 'creatinine', display_name: 'Serum Creatinine', value_numeric: 1.1, unit: 'mg/dL', reference_range: '0.7-1.3' },
          { canonical_key: 'alt', display_name: 'ALT (SGPT)', value_numeric: 32, unit: 'U/L', reference_range: '7-56' },
        ],
      },
      {
        date: '2026-05-15', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2026-04-07',
        orders: [
          { raw_text: 'HbA1c + Lipid + RFT + LFT pre-visit', canonical_key: 'panel_chronic_care', display_name: 'Chronic care panel' },
        ],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 6.9, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 112, unit: 'mg/dL', reference_range: '<100' },
          { canonical_key: 'creatinine', display_name: 'Serum Creatinine', value_numeric: 1.1, unit: 'mg/dL', reference_range: '0.7-1.3' },
          { canonical_key: 'alt', display_name: 'ALT (SGPT)', value_numeric: 30, unit: 'U/L', reference_range: '7-56' },
        ],
      },
    ],
    override_events: [
      { date: '2025-12-05', doctor_email: 'karthik.reddy@even.in', target_kind: 'problem', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Bilateral knee osteoarthritis', status: 'active', note: 'K-L grade 2 on plain films Dec 2025.' } },
      { date: '2026-04-07', doctor_email: 'chandrika.kambam@even.in', target_kind: 'problem', target_key: 'Essential hypertension',
        action: 'edit', payload: { status: 'controlled', note: 'BP target now 130/80 per KDIGO update for diabetics.' } },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Sunita Krishnan — 72F — Jayanagar — retired schoolteacher
  //    Hypothyroid (since 2019), bilateral knee OA, mild osteoporosis.
  // ──────────────────────────────────────────────────────────────────────────
  {
    mrn: 'EHRC-2026-011',
    name: 'Sunita Krishnan',
    age_years: 72,
    sex: 'F',
    phone_e164: '+919844998877',
    known_allergies: 'Penicillin (rash, 2002)',
    occupation: 'Retired schoolteacher',
    area: 'Jayanagar',
    primary_doctor_email: 'rajesh.murthy@even.in',
    existing_in_v1: true,
    active_problems: [
      { label: 'Primary hypothyroidism', since: '2019-04', status: 'controlled',
        current_meds: ['Levothyroxine 75mcg OD'] },
      { label: 'Bilateral knee osteoarthritis', since: '2023-10', status: 'active',
        current_meds: ['Etoricoxib PRN'] },
      { label: 'Osteopenia / early osteoporosis', since: '2025-08', status: 'active',
        current_meds: ['Calcium + Vitamin D3'] },
    ],
    encounters: [
      {
        date: '2025-07-22', doctor_email: 'rajesh.murthy@even.in',
        cc_chips: ['Thyroid follow-up'],
        cc_text: 'Annual thyroid review. Reports occasional cold intolerance, otherwise fatigue-free. Stable on current Levothyroxine.',
        vitals: { bp_sys: 138, bp_dia: 84, hr: 68, temp_c: 36.5, spo2: 97, weight_kg: 62, height_cm: 156, pain: 2 },
        exam_findings: 'No goitre. No periorbital oedema. Pulse regular. Dry skin noted.',
        assessment_codes: ['E03.9'],
        assessment_text: 'Primary hypothyroidism stable. TSH within target. Continue same dose.',
        rx_lines: [{ generic: 'Levothyroxine', brand: 'Eltroxin', strength: '75mcg', form: 'tablet', frequency: 'OD', duration_days: 180, timing: 'empty stomach, 30 min before breakfast' }],
        disposition: 'follow_up', follow_up_days: 365,
      },
      {
        date: '2025-08-30', doctor_email: 'karthik.reddy@even.in', room_name: 'OPD-6',
        cc_chips: ['Joint pain'],
        cc_text: 'Right knee pain for past 3 weeks, worse on stairs. Recurrent issue, last seen 2023 for similar.',
        vitals: { bp_sys: 134, bp_dia: 82, hr: 70, temp_c: 36.6, spo2: 98, weight_kg: 62, height_cm: 156, pain: 5 },
        exam_findings: 'Right knee: mild effusion, tenderness over medial joint line, crepitus on flexion. Left knee: minimal crepitus only. McMurray negative bilaterally.',
        assessment_codes: ['M17.0'],
        assessment_text: 'Right-sided OA flare. Conservative management. DEXA scan also ordered given age + post-menopausal status.',
        rx_lines: [
          { generic: 'Etoricoxib', brand: 'Etoshine', strength: '60mg', form: 'tablet', frequency: 'OD', duration_days: 7, timing: 'after food' },
          { generic: 'Diclofenac gel', strength: '1%', form: 'topical', frequency: 'TDS', duration: '2 weeks', instructions: 'Apply locally to knee, do not cover.' },
        ],
        disposition: 'follow_up', follow_up_days: 21,
      },
      {
        date: '2025-09-18', doctor_email: 'karthik.reddy@even.in', room_name: 'OPD-6',
        cc_chips: ['Joint pain', 'Lab review'],
        cc_text: 'DEXA results review. Knee pain settled with Etoricoxib course, occasional mild discomfort only.',
        vitals: { bp_sys: 132, bp_dia: 80, hr: 70, temp_c: 36.6, spo2: 98, weight_kg: 62, height_cm: 156, pain: 2 },
        exam_findings: 'Right knee improved. No effusion. Crepitus persists bilaterally.',
        assessment_codes: ['M17.0', 'M81.0'],
        assessment_text: 'OA settled. DEXA shows T-score -2.1 (lumbar spine) — osteopenia, bordering osteoporosis. Will not start bisphosphonate yet, but optimize calcium/vit D.',
        rx_lines: [
          { generic: 'Calcium carbonate + Vitamin D3', brand: 'Shelcal', strength: '500mg+250IU', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Cholecalciferol', brand: 'Calcirol', strength: '60000 IU', form: 'sachet', frequency: 'weekly', duration: '8 weeks', instructions: 'Take with milk on Sundays.' },
        ],
        disposition: 'follow_up', follow_up_days: 180, referral_target: 'Dr. Rajesh · Endo (next thyroid visit, will also check Ca/PTH)',
      },
      {
        date: '2026-01-12', doctor_email: 'aditya.sharma@even.in', room_name: 'OPD-8',
        cc_chips: ['Cough', 'Fever'],
        cc_text: 'Dry cough for 5 days, low-grade fever 99.5F. No SOB. Mild sore throat. No travel history. Family member had similar 2 weeks ago.',
        vitals: { bp_sys: 130, bp_dia: 78, hr: 88, temp_c: 38.1, spo2: 96, weight_kg: 62, height_cm: 156, pain: 1 },
        exam_findings: 'Throat mildly congested. Cervical nodes not palpable. Chest clear, no rhonchi or crepts. ENT exam normal otherwise.',
        assessment_codes: ['J06.9'],
        assessment_text: 'Acute viral URI. No bacterial features. Supportive care.',
        rx_lines: [
          { generic: 'Paracetamol', brand: 'Crocin', strength: '650mg', form: 'tablet', frequency: 'TDS', duration_days: 3, timing: 'after food', instructions: 'For fever.' },
          { generic: 'Levocetirizine', brand: 'Levocet', strength: '5mg', form: 'tablet', frequency: 'HS', duration_days: 5 },
          { generic: 'Steam inhalation', strength: '-', form: 'instruction', frequency: 'BD', duration: '5 days' },
        ],
        disposition: 'discharge', follow_up_days: 7,
      },
      {
        date: '2026-03-04', doctor_email: 'rajesh.murthy@even.in',
        cc_chips: ['Thyroid follow-up'],
        cc_text: 'Routine annual visit moved up because of recent weight loss (2 kg over 2 months) and palpitations.',
        vitals: { bp_sys: 140, bp_dia: 86, hr: 92, temp_c: 36.7, spo2: 98, weight_kg: 60, height_cm: 156, pain: 0 },
        exam_findings: 'Mild fine tremor outstretched hands. Skin warm. No goitre. No exophthalmos. Pulse regular but tachy.',
        assessment_codes: ['E03.9'],
        assessment_text: 'Over-replacement of Levothyroxine? Will check TSH. In meantime reduce dose.',
        rx_lines: [{ generic: 'Levothyroxine', brand: 'Eltroxin', strength: '50mcg', form: 'tablet', frequency: 'OD', duration_days: 42, timing: 'empty stomach, 30 min before breakfast', instructions: 'Reduced from 75mcg.' }],
        disposition: 'diagnostics',
      },
      {
        date: '2026-04-15', doctor_email: 'rajesh.murthy@even.in',
        cc_chips: ['Thyroid follow-up', 'Lab review'],
        cc_text: 'Returns for TSH result review. Palpitations settled in past 2 weeks on reduced dose.',
        vitals: { bp_sys: 136, bp_dia: 82, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 60.5, height_cm: 156, pain: 0 },
        exam_findings: 'Tremor resolved. No tachycardia.',
        assessment_codes: ['E03.9'],
        assessment_text: 'TSH was suppressed to 0.3 (over-replaced). On 50mcg now feeling better. Will recheck in 2 months.',
        rx_lines: [{ generic: 'Levothyroxine', brand: 'Eltroxin', strength: '50mcg', form: 'tablet', frequency: 'OD', duration_days: 60, timing: 'empty stomach' }],
        disposition: 'follow_up', follow_up_days: 60,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Joint pain'],
        cc_text: 'Left knee pain over past week, similar pattern to last year. Stairs particularly hard.',
        vitals: { bp_sys: 138, bp_dia: 82, hr: 72, temp_c: 36.6, spo2: 98, weight_kg: 60, height_cm: 156, pain: 4 },
        exam_findings: 'Left knee tenderness medial joint line, mild crepitus.',
        assessment_codes: ['M17.0'],
        assessment_text: 'OA flare left knee.',
        rx_lines: [
          { generic: 'Etoricoxib', brand: 'Etoshine', strength: '60mg', form: 'tablet', frequency: 'OD', duration_days: 7, timing: 'after food' },
          { generic: 'Diclofenac gel', strength: '1%', form: 'topical', frequency: 'TDS', duration: '2 weeks' },
        ],
        disposition: 'follow_up', follow_up_days: 21,
      },
    ],
    lab_cycles: [
      {
        date: '2025-07-20', ordering_doctor_email: 'rajesh.murthy@even.in', link_to_encounter_date: '2025-07-22',
        orders: [{ raw_text: 'TSH + T4', canonical_key: 'thyroid_panel', display_name: 'Thyroid Function (TSH + Free T4)' }],
        results: [
          { canonical_key: 'tsh', display_name: 'TSH', value_numeric: 2.6, unit: 'µIU/mL', reference_range: '0.4-4.5' },
          { canonical_key: 'free_t4', display_name: 'Free T4', value_numeric: 1.2, unit: 'ng/dL', reference_range: '0.9-1.7' },
        ],
      },
      {
        date: '2025-09-15', ordering_doctor_email: 'karthik.reddy@even.in', link_to_encounter_date: '2025-09-18',
        orders: [
          { raw_text: 'DEXA scan', canonical_key: 'dexa', display_name: 'DEXA Bone Density Scan' },
          { raw_text: 'Calcium', canonical_key: 'serum_calcium', display_name: 'Serum Calcium' },
          { raw_text: 'Vitamin D', canonical_key: 'vitamin_d', display_name: '25-OH Vitamin D' },
        ],
        results: [
          { canonical_key: 'dexa_lumbar_tscore', display_name: 'DEXA T-score (Lumbar)', value_numeric: -2.1, unit: 'SD', reference_range: '> -1.0 normal · -1 to -2.5 osteopenia · < -2.5 osteoporosis' },
          { canonical_key: 'dexa_femoral_tscore', display_name: 'DEXA T-score (Femoral Neck)', value_numeric: -1.8, unit: 'SD', reference_range: '> -1.0 normal' },
          { canonical_key: 'serum_calcium', display_name: 'Serum Calcium', value_numeric: 9.2, unit: 'mg/dL', reference_range: '8.5-10.5' },
          { canonical_key: 'vitamin_d', display_name: '25-OH Vitamin D', value_numeric: 18, unit: 'ng/mL', reference_range: '30-100', is_critical: false },
        ],
      },
      {
        date: '2026-03-02', ordering_doctor_email: 'rajesh.murthy@even.in', link_to_encounter_date: '2026-03-04',
        orders: [{ raw_text: 'TSH', canonical_key: 'tsh', display_name: 'TSH' }],
        results: [
          { canonical_key: 'tsh', display_name: 'TSH', value_numeric: 0.3, unit: 'µIU/mL', reference_range: '0.4-4.5' },
          { canonical_key: 'free_t4', display_name: 'Free T4', value_numeric: 1.6, unit: 'ng/dL', reference_range: '0.9-1.7' },
        ],
      },
      {
        date: '2026-04-12', ordering_doctor_email: 'rajesh.murthy@even.in', link_to_encounter_date: '2026-04-15',
        orders: [{ raw_text: 'TSH recheck', canonical_key: 'tsh', display_name: 'TSH' }],
        results: [{ canonical_key: 'tsh', display_name: 'TSH', value_numeric: 1.4, unit: 'µIU/mL', reference_range: '0.4-4.5' }],
      },
    ],
    override_events: [
      { date: '2025-09-18', doctor_email: 'karthik.reddy@even.in', target_kind: 'problem', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Osteopenia / early osteoporosis', status: 'active', note: 'DEXA T-score -2.1 lumbar.' } },
      { date: '2026-04-15', doctor_email: 'rajesh.murthy@even.in', target_kind: 'problem', target_key: 'Primary hypothyroidism',
        action: 'edit', payload: { status: 'controlled', note: 'Dose reduced from 75 to 50mcg after over-replacement episode.' } },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Arjun Murthy — 42M — HSR Layout — software engineer
  //    Acute mechanical LBP after lifting. Otherwise healthy.
  // ──────────────────────────────────────────────────────────────────────────
  {
    mrn: 'EHRC-2026-010',
    name: 'Arjun Murthy',
    age_years: 42,
    sex: 'M',
    phone_e164: '+919900112233',
    known_allergies: null,
    occupation: 'Software engineer',
    area: 'HSR Layout',
    primary_doctor_email: 'karthik.reddy@even.in',
    existing_in_v1: true,
    active_problems: [
      { label: 'Mechanical low back pain', since: '2026-05', status: 'active' },
    ],
    encounters: [
      {
        date: '2025-09-04', doctor_email: 'aditya.sharma@even.in', room_name: 'OPD-8',
        cc_chips: ['Fever', 'Cough'],
        cc_text: 'Fever and cough for 4 days. Body aches. Working from home, multiple colleagues affected.',
        vitals: { bp_sys: 122, bp_dia: 78, hr: 92, temp_c: 38.4, spo2: 98, weight_kg: 78, height_cm: 174, pain: 3 },
        exam_findings: 'Throat congested. No lymphadenopathy. Chest clear.',
        assessment_codes: ['J06.9'],
        assessment_text: 'Acute viral URI. Sympomatic care; will likely settle in 5-7d.',
        rx_lines: [
          { generic: 'Paracetamol', brand: 'Crocin', strength: '650mg', form: 'tablet', frequency: 'TDS PRN', duration_days: 3 },
          { generic: 'Cetirizine', brand: 'Cetzine', strength: '10mg', form: 'tablet', frequency: 'HS', duration_days: 5 },
        ],
        disposition: 'discharge',
      },
      {
        date: '2026-05-04', doctor_email: 'aditya.sharma@even.in', room_name: 'OPD-8',
        cc_chips: ['Back pain'],
        cc_text: 'Sudden onset lower back pain after lifting heavy boxes during home shifting. Pain since morning, sharp, radiates briefly to right buttock. No numbness, no weakness, bladder/bowel intact.',
        vitals: { bp_sys: 128, bp_dia: 82, hr: 88, temp_c: 36.7, spo2: 98, weight_kg: 79, height_cm: 174, pain: 7 },
        exam_findings: 'Tenderness L4-L5 paraspinal area. Straight leg raise 70° bilaterally without radicular pain. Neurological exam intact: power 5/5, reflexes 2+, sensation intact. No saddle anaesthesia.',
        assessment_codes: ['M54.5'],
        assessment_text: 'Acute mechanical low back pain, likely paraspinal muscle strain. No red flags. Will manage conservatively. Referring to Ortho if not settling in 7 days.',
        rx_lines: [
          { generic: 'Diclofenac', brand: 'Voveran', strength: '50mg', form: 'tablet', frequency: 'BD', duration_days: 5, timing: 'after food' },
          { generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 5, timing: 'before breakfast' },
          { generic: 'Thiocolchicoside', brand: 'Myoril', strength: '4mg', form: 'tablet', frequency: 'BD', duration_days: 5 },
        ],
        disposition: 'follow_up', follow_up_days: 7,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Back pain'],
        cc_text: 'Mechanical low back pain after lifting heavy objects for the past four days. Pain settled significantly on Diclofenac but still has dull ache, especially in mornings. Concerned about long-term back health.',
        vitals: { bp_sys: 124, bp_dia: 80, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 79, height_cm: 174, pain: 4 },
        exam_findings: 'Tenderness reduced. SLR 80° bilaterally, painless. Neurological exam intact. Lumbar flexion 40° (full ~60°).',
        assessment_codes: ['M54.5'],
        assessment_text: 'Mechanical LBP improving. Continue NSAIDs short course. Refer to physio for core strengthening to prevent recurrence.',
        rx_lines: [
          { generic: 'Diclofenac', brand: 'Voveran', strength: '50mg', form: 'tablet', frequency: 'BD PRN', duration_days: 5, timing: 'after food' },
          { generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 5 },
        ],
        disposition: 'refer', referral_target: 'Physiotherapy unit · Back rehab',
      },
    ],
    lab_cycles: [],
    override_events: [],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Lakshmi Iyengar — 34F — Whitefield — software engineer
  //    Anxiety with panic + IBS-D + hypothyroid. Sulpha allergy.
  //    [NEW — not in v1 seed]
  // ──────────────────────────────────────────────────────────────────────────
  {
    mrn: 'EHRC-2026-026',
    name: 'Lakshmi Iyengar',
    age_years: 34,
    sex: 'F',
    phone_e164: '+919900445566',
    known_allergies: 'Sulpha drugs (rash, 2018)',
    occupation: 'Software engineer',
    area: 'Whitefield',
    primary_doctor_email: 'ravi.kumar@even.in',
    active_problems: [
      { label: 'Generalized anxiety with panic episodes', since: '2025-09', status: 'controlled',
        current_meds: ['Sertraline 50mg OD', 'Propranolol 10mg PRN'] },
      { label: 'Irritable bowel syndrome — diarrhea predominant', since: '2025-12', status: 'active',
        current_meds: ['Mebeverine 135mg TDS PRN'] },
      { label: 'Primary hypothyroidism', since: '2024-03', status: 'controlled',
        current_meds: ['Levothyroxine 50mcg OD'] },
    ],
    encounters: [
      {
        date: '2025-09-14', doctor_email: 'aditya.sharma@even.in', room_name: 'OPD-8',
        cc_chips: ['Chest pain', 'Headache'],
        cc_text: 'First visit. Reports recurring episodes of palpitations, racing heart, sweating, sense of impending doom, lasting 10-15 minutes. Triggered by work stress. Started 3 weeks ago. Insomnia. No chest pain at rest.',
        vitals: { bp_sys: 118, bp_dia: 76, hr: 96, temp_c: 36.6, spo2: 99, weight_kg: 58, height_cm: 162, pain: 0 },
        exam_findings: 'Normal cardiovascular exam at rest. No goitre. Thyroid 2024 reports brought today: TSH 2.8 on Levothyroxine 50.',
        assessment_codes: ['F41.1'],
        assessment_text: 'Generalised anxiety with panic features. Will rule out cardiac. Starting beta-blocker for symptom relief. Referring to psychiatry.',
        rx_lines: [
          { generic: 'Propranolol', brand: 'Inderal', strength: '10mg', form: 'tablet', frequency: 'PRN', duration: '2 weeks', instructions: 'Use during panic episode, max BD.' },
        ],
        disposition: 'refer', referral_target: 'Dr. Ravi · Psychiatry',
        handoff_note: 'Patient new to psychiatric care; please confirm dx and start SSRI if appropriate.',
      },
      {
        date: '2025-09-28', doctor_email: 'ravi.kumar@even.in', room_name: 'OPD-10',
        cc_chips: ['Anxiety', 'Insomnia'],
        cc_text: 'Referred by Dr. Aditya. Detailed history reveals 3 months of escalating work stress, panic episodes 3-4/week, sleep latency 1-2hrs, ruminative thinking. PHQ-9 score 11 (mild-moderate), GAD-7 score 14 (severe).',
        vitals: { bp_sys: 116, bp_dia: 74, hr: 78, temp_c: 36.5, spo2: 99, weight_kg: 58, height_cm: 162, pain: 0 },
        exam_findings: 'Mental status: alert, oriented. Mood anxious. Affect congruent. No suicidal ideation. No psychotic features. Insight preserved.',
        assessment_codes: ['F41.1'],
        assessment_text: 'GAD with panic features. Starting SSRI. Will refer for CBT. No psychiatric hospitalization indication.',
        rx_lines: [
          { generic: 'Sertraline', brand: 'Zoloft', strength: '25mg', form: 'tablet', frequency: 'OD', duration_days: 14, timing: 'morning', instructions: 'Will increase to 50mg in 2 weeks.' },
          { generic: 'Propranolol', brand: 'Inderal', strength: '10mg', form: 'tablet', frequency: 'PRN', duration: '4 weeks' },
        ],
        disposition: 'follow_up', follow_up_days: 14, referral_target: 'CBT — outpatient psychology',
      },
      {
        date: '2025-12-04', doctor_email: 'aditya.sharma@even.in', room_name: 'OPD-8',
        cc_chips: ['Abdominal pain', 'Diarrhea'],
        cc_text: 'New complaint: cramping epigastric pain + loose stools 3-4x daily for past 10 days, particularly after meals and during stressful days at work. No blood, no fever, no weight loss. Anxiety partly controlled on Sertraline 50.',
        vitals: { bp_sys: 114, bp_dia: 72, hr: 80, temp_c: 36.7, spo2: 99, weight_kg: 57, height_cm: 162, pain: 5 },
        exam_findings: 'Abdomen soft, mild diffuse tenderness, bowel sounds normal. No mass, no rebound.',
        assessment_codes: ['K58.0'],
        assessment_text: 'Likely IBS-D — fits Rome IV criteria, no alarm features. Stool ordered to exclude infection. Diet counseling.',
        rx_lines: [
          { generic: 'Mebeverine', brand: 'Colospa', strength: '135mg', form: 'tablet', frequency: 'TDS', duration_days: 14, timing: '20 min before meals' },
          { generic: 'ORS', strength: '-', form: 'sachet', frequency: 'PRN', duration: '2 weeks' },
        ],
        disposition: 'follow_up', follow_up_days: 14,
      },
      {
        date: '2026-02-11', doctor_email: 'ravi.kumar@even.in', room_name: 'OPD-10',
        cc_chips: ['Anxiety'],
        cc_text: 'Routine psychiatric follow-up. Panic frequency now 1-2/month from 3-4/week. CBT 4 sessions done. Sleep better. IBS symptoms still occasional, manage with Mebeverine.',
        vitals: { bp_sys: 116, bp_dia: 74, hr: 72, temp_c: 36.6, spo2: 99, weight_kg: 58, height_cm: 162, pain: 0 },
        exam_findings: 'Mood euthymic. Affect appropriate. No new symptoms.',
        assessment_codes: ['F41.1'],
        assessment_text: 'GAD with panic — responding well. Continue Sertraline 50, continue CBT. PHQ-9 down to 4, GAD-7 down to 7.',
        rx_lines: [{ generic: 'Sertraline', brand: 'Zoloft', strength: '50mg', form: 'tablet', frequency: 'OD', duration_days: 90 }],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2026-04-29', doctor_email: 'rajesh.murthy@even.in',
        cc_chips: ['Thyroid follow-up'],
        cc_text: 'Annual thyroid review. Reports good mood, energy normal. No cold/heat intolerance. Lipid check also due as part of annual check.',
        vitals: { bp_sys: 118, bp_dia: 76, hr: 74, temp_c: 36.6, spo2: 99, weight_kg: 58, height_cm: 162, pain: 0 },
        exam_findings: 'No goitre. Normal exam.',
        assessment_codes: ['E03.9'],
        assessment_text: 'Hypothyroidism stable. TSH within target. Continue same dose. Annual labs ordered.',
        rx_lines: [{ generic: 'Levothyroxine', brand: 'Eltroxin', strength: '50mcg', form: 'tablet', frequency: 'OD', duration_days: 180, timing: 'empty stomach' }],
        disposition: 'follow_up', follow_up_days: 365,
      },
    ],
    lab_cycles: [
      {
        date: '2025-09-14', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2025-09-14',
        orders: [
          { raw_text: 'TSH', canonical_key: 'tsh', display_name: 'TSH' },
          { raw_text: 'ECG', canonical_key: 'ecg', display_name: 'Electrocardiogram (ECG)' },
          { raw_text: 'CBC', canonical_key: 'cbc', display_name: 'Complete Blood Count' },
        ],
        results: [
          { canonical_key: 'tsh', display_name: 'TSH', value_numeric: 2.8, unit: 'µIU/mL', reference_range: '0.4-4.5' },
          { canonical_key: 'ecg', display_name: 'ECG', value_text: 'NSR 78 bpm, no ischaemic changes, no ectopics.', unit: '', reference_range: 'normal' },
          { canonical_key: 'hemoglobin', display_name: 'Hemoglobin', value_numeric: 12.6, unit: 'g/dL', reference_range: '12.0-16.0 (F)' },
        ],
      },
      {
        date: '2025-12-04', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2025-12-04',
        orders: [
          { raw_text: 'Stool routine and culture', canonical_key: 'stool_routine_culture', display_name: 'Stool Routine + Culture' },
          { raw_text: 'CRP', canonical_key: 'crp', display_name: 'C-Reactive Protein' },
        ],
        results: [
          { canonical_key: 'stool_culture', display_name: 'Stool Culture', value_text: 'No growth of pathogens', unit: '', reference_range: 'negative' },
          { canonical_key: 'crp', display_name: 'C-Reactive Protein', value_numeric: 4, unit: 'mg/L', reference_range: '<5' },
        ],
      },
      {
        date: '2026-04-28', ordering_doctor_email: 'rajesh.murthy@even.in', link_to_encounter_date: '2026-04-29',
        orders: [
          { raw_text: 'TSH + T4', canonical_key: 'thyroid_panel', display_name: 'Thyroid Function (TSH + Free T4)' },
          { raw_text: 'Lipid', canonical_key: 'lipid_panel', display_name: 'Lipid Profile' },
        ],
        results: [
          { canonical_key: 'tsh', display_name: 'TSH', value_numeric: 3.2, unit: 'µIU/mL', reference_range: '0.4-4.5' },
          { canonical_key: 'free_t4', display_name: 'Free T4', value_numeric: 1.1, unit: 'ng/dL', reference_range: '0.9-1.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 104, unit: 'mg/dL', reference_range: '<100 optimal' },
        ],
      },
    ],
    override_events: [
      { date: '2025-12-04', doctor_email: 'aditya.sharma@even.in', target_kind: 'problem', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Irritable bowel syndrome — diarrhea predominant', status: 'active', note: 'Rome IV positive, no alarm features.' } },
      { date: '2026-02-11', doctor_email: 'ravi.kumar@even.in', target_kind: 'problem', target_key: 'Generalized anxiety with panic episodes',
        action: 'edit', payload: { status: 'controlled', note: 'GAD-7 down from 14 to 7. CBT response strong.' } },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Vikram Reddy — 71M — Koramangala — retired Army colonel
  //    COPD + post-MI on antiplatelet + DM2. ACE inhibitor cough.
  //    [NEW — not in v1 seed]
  // ──────────────────────────────────────────────────────────────────────────
  {
    mrn: 'EHRC-2026-027',
    name: 'Vikram Reddy',
    age_years: 71,
    sex: 'M',
    phone_e164: '+919845778899',
    known_allergies: 'ACE inhibitors (cough — switched to ARB in 2022)',
    occupation: 'Retired Army colonel',
    area: 'Koramangala',
    primary_doctor_email: 'lakshmi.naidu@even.in',
    active_problems: [
      { label: 'Chronic obstructive pulmonary disease (GOLD II)', since: '2018-06', status: 'active',
        current_meds: ['Tiotropium 18mcg inhaler OD', 'Salbutamol PRN'] },
      { label: 'Post-MI status (2022 anterior STEMI, PCI to LAD)', since: '2022-03', status: 'controlled',
        current_meds: ['Aspirin 75mg', 'Clopidogrel 75mg', 'Atorvastatin 40mg', 'Bisoprolol 2.5mg'] },
      { label: 'Type 2 diabetes mellitus', since: '2019-11', status: 'controlled',
        current_meds: ['Metformin 1g BD', 'Sitagliptin 100mg OD'] },
      { label: 'Hypertension', since: '2020-02', status: 'controlled',
        current_meds: ['Telmisartan 40mg OD'] },
    ],
    encounters: [
      {
        date: '2025-06-25', doctor_email: 'lakshmi.naidu@even.in', room_name: 'OPD-7',
        cc_chips: ['Cough', 'Asthma review'],
        cc_text: 'Quarterly COPD review. Cough productive most mornings, baseline. No recent flare. Walks ~500m on flat ground before SOB. Uses Salbutamol 2-3x/week.',
        vitals: { bp_sys: 138, bp_dia: 82, hr: 82, rr: 18, temp_c: 36.7, spo2: 94, weight_kg: 70, height_cm: 172, pain: 0 },
        exam_findings: 'Mild prolonged expiratory phase. Few scattered rhonchi at bases. No crepitations. CVS: regular, S4 audible, no murmurs.',
        assessment_codes: ['J44.9', 'I25.2'],
        assessment_text: 'COPD GOLD II — stable. Tiotropium adherence good. Continue current regimen. Annual spirometry due — ordered.',
        rx_lines: [
          { generic: 'Tiotropium', brand: 'Spiriva', strength: '18mcg', form: 'inhaler', frequency: 'OD', duration_days: 90 },
          { generic: 'Salbutamol', brand: 'Asthalin', strength: '100mcg', form: 'inhaler', frequency: 'PRN', duration: '3 months' },
          { generic: 'Aspirin', brand: 'Ecosprin', strength: '75mg', form: 'tablet', frequency: 'OD', duration_days: 90, timing: 'after food' },
          { generic: 'Clopidogrel', brand: 'Plavix', strength: '75mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Atorvastatin', brand: 'Atorva', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90, timing: 'HS' },
          { generic: 'Bisoprolol', brand: 'Concor', strength: '2.5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Metformin', brand: 'Glycomet', strength: '1g', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Sitagliptin', brand: 'Januvia', strength: '100mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2025-09-12', doctor_email: 'lakshmi.naidu@even.in', room_name: 'OPD-7',
        cc_chips: ['Cough', 'Fever'],
        cc_text: 'COPD exacerbation. Increased SOB, increased sputum (now yellowish, was clear), low-grade fever for 3 days. Using Salbutamol 6-8x/day. Sleep disturbed.',
        vitals: { bp_sys: 144, bp_dia: 88, hr: 96, rr: 24, temp_c: 38.0, spo2: 90, weight_kg: 69, height_cm: 172, pain: 1 },
        exam_findings: 'Tachypneic at rest. Prolonged expiratory phase, scattered wheeze and rhonchi. No focal crepitations. SpO₂ 90% on room air (baseline 94).',
        assessment_codes: ['J44.1'],
        assessment_text: 'Acute COPD exacerbation, likely bacterial (purulent sputum, fever). Short course oral steroid + antibiotic. Close follow-up.',
        rx_lines: [
          { generic: 'Prednisolone', brand: 'Wysolone', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 5, timing: 'morning, after food' },
          { generic: 'Amoxicillin + Clavulanate', brand: 'Augmentin', strength: '625mg', form: 'tablet', frequency: 'TDS', duration_days: 7, timing: 'after food' },
          { generic: 'Salbutamol + Ipratropium nebuliser', strength: '2.5mg + 0.5mg', form: 'nebule', frequency: 'QID', duration_days: 5 },
        ],
        disposition: 'follow_up', follow_up_days: 5,
      },
      {
        date: '2025-09-18', doctor_email: 'lakshmi.naidu@even.in', room_name: 'OPD-7',
        cc_chips: ['Asthma review', 'Cough'],
        cc_text: 'Exacerbation resolving. SpO₂ back to 94, breath sounds clearer, fever gone, sputum reverting to clear. Finishing antibiotic course.',
        vitals: { bp_sys: 136, bp_dia: 82, hr: 84, rr: 18, temp_c: 36.7, spo2: 94, weight_kg: 70, height_cm: 172, pain: 0 },
        exam_findings: 'Improved. Mild rhonchi only.',
        assessment_codes: ['J44.1'],
        assessment_text: 'COPD exacerbation resolved. Step back to maintenance regimen.',
        rx_lines: [
          { generic: 'Tiotropium', brand: 'Spiriva', strength: '18mcg', form: 'inhaler', frequency: 'OD', duration_days: 90 },
          { generic: 'Salbutamol', brand: 'Asthalin', strength: '100mcg', form: 'inhaler', frequency: 'PRN', duration: '3 months' },
        ],
        disposition: 'discharge',
      },
      {
        date: '2025-12-08', doctor_email: 'anika.iyer@even.in', room_name: 'OPD-3',
        cc_chips: ['BP follow-up'],
        cc_text: 'Annual cardiology review post-MI 2022. Stable. No chest pain, no orthopnea, no syncope. Walks ~1km on flat ground. Compliant with all medicines.',
        vitals: { bp_sys: 130, bp_dia: 78, hr: 68, rr: 16, temp_c: 36.7, spo2: 94, weight_kg: 70, height_cm: 172, pain: 0 },
        exam_findings: 'CVS: regular, S1S2 normal, no S3, no murmurs. JVP not raised. No pedal oedema.',
        assessment_codes: ['I25.2'],
        assessment_text: 'Post-MI stable on optimised secondary prevention. Echo done — LVEF 50% (was 45% at index event). Continue current regimen.',
        rx_lines: [
          { generic: 'Aspirin', brand: 'Ecosprin', strength: '75mg', form: 'tablet', frequency: 'OD', duration_days: 365 },
          { generic: 'Atorvastatin', brand: 'Atorva', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 365 },
          { generic: 'Bisoprolol', brand: 'Concor', strength: '2.5mg', form: 'tablet', frequency: 'OD', duration_days: 365 },
        ],
        disposition: 'follow_up', follow_up_days: 365,
        handoff_note: 'May consider stopping Clopidogrel — at 3+ years post-PCI now, DAPT continuation reviewed annually.',
      },
      {
        date: '2026-02-14', doctor_email: 'lakshmi.naidu@even.in', room_name: 'OPD-7',
        cc_chips: ['Asthma review', 'BP follow-up'],
        cc_text: 'Quarterly review. Stable since Sept exacerbation. Walking better. Glucose readings at home FBS 110-130, PPBS 160-180.',
        vitals: { bp_sys: 132, bp_dia: 80, hr: 76, rr: 16, temp_c: 36.7, spo2: 94, weight_kg: 70.5, height_cm: 172, pain: 0 },
        exam_findings: 'Chest clear. CVS stable. No oedema.',
        assessment_codes: ['J44.9', 'E11.9', 'I25.2'],
        assessment_text: 'COPD stable. T2DM well-controlled. Post-MI stable. Continue all meds. Will stop Clopidogrel per cardiology note (DAPT >3yrs post-PCI).',
        rx_lines: [
          { generic: 'Tiotropium', brand: 'Spiriva', strength: '18mcg', form: 'inhaler', frequency: 'OD', duration_days: 90 },
          { generic: 'Aspirin', brand: 'Ecosprin', strength: '75mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Atorvastatin', brand: 'Atorva', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Bisoprolol', brand: 'Concor', strength: '2.5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Metformin', brand: 'Glycomet', strength: '1g', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Sitagliptin', brand: 'Januvia', strength: '100mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Headache'],
        cc_text: 'New complaint: dull bifrontal headache, 4 days, mild-moderate. No focal neurological symptoms. No visual disturbance. Vision check 2 months back was normal.',
        vitals: { bp_sys: 138, bp_dia: 84, hr: 74, rr: 16, temp_c: 36.7, spo2: 94, weight_kg: 70, height_cm: 172, pain: 4 },
        exam_findings: 'Neurological exam: cranial nerves intact. Power 5/5 throughout. Reflexes 2+ symmetric. No cerebellar signs. Fundi normal. No neck stiffness.',
        assessment_codes: ['G44.2'],
        assessment_text: 'Tension-type headache, likely. No red flags. Symptomatic care, ergonomic counseling. Will see Dr. Anika for BP if persists.',
        rx_lines: [{ generic: 'Paracetamol', brand: 'Crocin', strength: '650mg', form: 'tablet', frequency: 'TDS PRN', duration_days: 5 }],
        disposition: 'discharge',
      },
    ],
    lab_cycles: [
      {
        date: '2025-06-22', ordering_doctor_email: 'lakshmi.naidu@even.in', link_to_encounter_date: '2025-06-25',
        orders: [
          { raw_text: 'Spirometry', canonical_key: 'spirometry', display_name: 'Spirometry' },
          { raw_text: 'HbA1c', canonical_key: 'hba1c', display_name: 'HbA1c' },
          { raw_text: 'Lipid', canonical_key: 'lipid_panel', display_name: 'Lipid Profile' },
        ],
        results: [
          { canonical_key: 'spirometry_fev1_pct', display_name: 'FEV1 % predicted', value_numeric: 62, unit: '%', reference_range: '>80% normal · 50-79 mild-mod · 30-49 severe' },
          { canonical_key: 'spirometry_fev1_fvc', display_name: 'FEV1/FVC ratio', value_numeric: 0.62, unit: 'ratio', reference_range: '>0.70 normal' },
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 6.7, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 76, unit: 'mg/dL', reference_range: '<70 (post-MI)' },
        ],
      },
      {
        date: '2025-12-05', ordering_doctor_email: 'anika.iyer@even.in', link_to_encounter_date: '2025-12-08',
        orders: [
          { raw_text: 'Echo', canonical_key: 'echocardiogram', display_name: '2D Echocardiogram' },
          { raw_text: 'Lipid + LFT', canonical_key: 'lipid_panel', display_name: 'Lipid Profile + LFT' },
          { raw_text: 'Creatinine', canonical_key: 'creatinine', display_name: 'Serum Creatinine' },
        ],
        results: [
          { canonical_key: 'echo_lvef', display_name: 'Echo LVEF', value_numeric: 50, unit: '%', reference_range: '>55 normal · 40-54 mildly reduced · <40 reduced' },
          { canonical_key: 'echo_wall_motion', display_name: 'Echo Wall Motion', value_text: 'Apical and anteroseptal hypokinesia, mild. No new RWMA.', unit: '', reference_range: 'normal' },
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 68, unit: 'mg/dL', reference_range: '<70 (post-MI)' },
          { canonical_key: 'creatinine', display_name: 'Serum Creatinine', value_numeric: 1.2, unit: 'mg/dL', reference_range: '0.7-1.3' },
          { canonical_key: 'alt', display_name: 'ALT', value_numeric: 42, unit: 'U/L', reference_range: '7-56' },
        ],
      },
      {
        date: '2026-02-12', ordering_doctor_email: 'lakshmi.naidu@even.in', link_to_encounter_date: '2026-02-14',
        orders: [
          { raw_text: 'HbA1c + Creatinine + LFT', canonical_key: 'panel_chronic_care', display_name: 'Chronic care panel' },
        ],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 6.9, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'creatinine', display_name: 'Serum Creatinine', value_numeric: 1.3, unit: 'mg/dL', reference_range: '0.7-1.3' },
          { canonical_key: 'alt', display_name: 'ALT', value_numeric: 38, unit: 'U/L', reference_range: '7-56' },
        ],
      },
    ],
    override_events: [
      { date: '2026-02-14', doctor_email: 'lakshmi.naidu@even.in', target_kind: 'problem', target_key: 'Post-MI status (2022 anterior STEMI, PCI to LAD)',
        action: 'edit', payload: { status: 'controlled', note: 'Clopidogrel stopped per cardiology — DAPT duration >3yrs post-PCI.' } },
    ],
  },
];
