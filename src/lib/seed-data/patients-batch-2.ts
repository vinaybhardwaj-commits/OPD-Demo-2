/**
 * v2.0.0 seed — patient stories batch 2 (5 of 50).
 * Existing patients EHRC-2026-001 through 005.
 */
import type { SeedPatient } from './types';

export const PATIENTS_BATCH_2: SeedPatient[] = [
  // 1. Priya Ramesh — 28F — Marathahalli — graphic designer
  // Recurrent URI pattern, mild allergic rhinitis, PCOS workup
  {
    mrn: 'EHRC-2026-001', name: 'Priya Ramesh', age_years: 28, sex: 'F',
    phone_e164: '+919876543201', known_allergies: null,
    occupation: 'Graphic designer', area: 'Marathahalli',
    primary_doctor_email: 'aditya.sharma@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Allergic rhinitis', since: '2024-08', status: 'active', current_meds: ['Levocetirizine PRN'] },
      { label: 'Polycystic ovary syndrome', since: '2025-11', status: 'active', current_meds: ['Combined OCP (Yasmin)'] },
    ],
    encounters: [
      {
        date: '2025-08-12', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Cold', 'Sore throat'],
        cc_text: 'Recurrent URI 3rd episode this year. Sneezing, runny nose, post-nasal drip. No fever. Worse on weekends when she visits parents (cats at home).',
        vitals: { bp_sys: 110, bp_dia: 70, hr: 76, temp_c: 36.7, spo2: 99, weight_kg: 56, height_cm: 160, pain: 1 },
        exam_findings: 'Boggy nasal mucosa, clear discharge. Throat mildly congested.',
        assessment_codes: ['J30.9'],
        assessment_text: 'Allergic rhinitis, likely seasonal + cat allergen.',
        rx_lines: [
          { generic: 'Levocetirizine', brand: 'Levocet', strength: '5mg', form: 'tablet', frequency: 'HS', duration_days: 14 },
          { generic: 'Fluticasone nasal spray', brand: 'Flonase', strength: '50mcg', form: 'spray', frequency: 'BD', duration_days: 30, instructions: 'One spray each nostril.' },
        ],
        disposition: 'follow_up', follow_up_days: 30,
      },
      {
        date: '2025-11-18', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Period problems'],
        cc_text: 'Irregular periods over past 8 months — cycles 35-60 days. Mild facial hair growth, acne flare. Concerned re: fertility (not actively planning but wants to know).',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 78, temp_c: 36.7, spo2: 99, weight_kg: 58, height_cm: 160, pain: 0 },
        exam_findings: 'BMI 22.6. Mild hirsutism upper lip + chin. Acne on face. Acanthosis nigricans subtle at neck. Abdomen normal.',
        assessment_codes: ['E28.2'],
        assessment_text: 'Suspected PCOS. Hormonal workup + USG pelvis ordered.',
        rx_lines: [],
        disposition: 'diagnostics',
      },
      {
        date: '2025-12-04', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Lab review', 'Period problems'],
        cc_text: 'Reviews PCOS workup. Insulin elevated, LH:FSH 2.6, USG ovaries polycystic.',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 76, temp_c: 36.7, spo2: 99, weight_kg: 58, height_cm: 160, pain: 0 },
        exam_findings: 'Stable.',
        assessment_codes: ['E28.2'],
        assessment_text: 'PCOS confirmed. Starting OCP for cycle regulation. Lifestyle counseling.',
        rx_lines: [
          { generic: 'Drospirenone + Ethinylestradiol', brand: 'Yasmin', strength: '3mg+30mcg', form: 'tablet', frequency: 'OD', duration_days: 84, instructions: '21 days on, 7 days off per pack.' },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2026-03-08', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Period problems', 'Lab review'],
        cc_text: 'Periods regular on OCP. Acne improved. Lost 2kg with diet changes. Repeat HbA1c due.',
        vitals: { bp_sys: 110, bp_dia: 70, hr: 72, temp_c: 36.7, spo2: 99, weight_kg: 56, height_cm: 160, pain: 0 },
        exam_findings: 'Skin clearer.',
        assessment_codes: ['E28.2'],
        assessment_text: 'PCOS responding to OCP + lifestyle. Continue.',
        rx_lines: [{ generic: 'Drospirenone + Ethinylestradiol', brand: 'Yasmin', strength: '3mg+30mcg', form: 'tablet', frequency: 'OD', duration_days: 168 }],
        disposition: 'follow_up', follow_up_days: 180,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Sore throat', 'Fever'],
        cc_text: 'Sore throat 3 days, low-grade fever. Mildly inflamed pharynx, no exudate.',
        vitals: { bp_sys: 112, bp_dia: 72, hr: 82, temp_c: 37.6, spo2: 99, weight_kg: 56, height_cm: 160, pain: 2 },
        exam_findings: 'Mildly inflamed pharynx, no exudate, afebrile on exam.',
        assessment_codes: ['J06.9'],
        assessment_text: 'Acute pharyngitis, likely viral.',
        rx_lines: [
          { generic: 'Paracetamol', brand: 'Crocin', strength: '650mg', form: 'tablet', frequency: 'TDS PRN', duration_days: 3 },
          { generic: 'Levocetirizine', brand: 'Levocet', strength: '5mg', form: 'tablet', frequency: 'HS', duration_days: 5 },
        ],
        disposition: 'discharge',
      },
    ],
    lab_cycles: [
      {
        date: '2025-11-22', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2025-11-18',
        orders: [
          { raw_text: 'PCOS workup — LH FSH testosterone insulin fasting glucose', canonical_key: 'pcos_panel', display_name: 'PCOS Panel' },
          { raw_text: 'USG pelvis', canonical_key: 'usg_pelvis', display_name: 'USG Pelvis' },
        ],
        results: [
          { canonical_key: 'lh', display_name: 'LH', value_numeric: 18, unit: 'mIU/mL', reference_range: '2-12 (follicular)' },
          { canonical_key: 'fsh', display_name: 'FSH', value_numeric: 7, unit: 'mIU/mL', reference_range: '3-8' },
          { canonical_key: 'testosterone_total', display_name: 'Total Testosterone', value_numeric: 78, unit: 'ng/dL', reference_range: '<70 (F)' },
          { canonical_key: 'fasting_insulin', display_name: 'Fasting Insulin', value_numeric: 18, unit: 'µIU/mL', reference_range: '<15' },
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 5.8, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'usg_pelvis', display_name: 'USG Pelvis', value_text: 'Both ovaries enlarged, multiple peripheral follicles >12 in each, classic polycystic appearance.', unit: '', reference_range: 'normal' },
        ],
      },
      {
        date: '2026-03-05', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2026-03-08',
        orders: [{ raw_text: 'HbA1c + Insulin', canonical_key: 'metabolic_followup', display_name: 'Metabolic follow-up' }],
        results: [
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 5.6, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'fasting_insulin', display_name: 'Fasting Insulin', value_numeric: 12, unit: 'µIU/mL', reference_range: '<15' },
        ],
      },
    ],
    override_events: [
      { date: '2025-12-04', doctor_email: 'aditya.sharma@even.in', target_kind: 'problem', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Polycystic ovary syndrome', status: 'active', note: 'USG + hormonal panel positive.' } },
    ],
  },

  // 2. Rajesh Kumar — 45M — Whitefield — banker — Penicillin allergy
  // HTN sub-optimally controlled, alcohol-related GERD, mild fatty liver
  {
    mrn: 'EHRC-2026-002', name: 'Rajesh Kumar', age_years: 45, sex: 'M',
    phone_e164: '+919876543202', known_allergies: 'Penicillin (urticarial rash, 2010)',
    occupation: 'Bank manager', area: 'Whitefield',
    primary_doctor_email: 'chandrika.kambam@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Essential hypertension — sub-optimally controlled', since: '2023-05', status: 'active',
        current_meds: ['Amlodipine 10mg OD', 'Telmisartan 40mg OD'] },
      { label: 'Non-alcoholic fatty liver disease', since: '2024-09', status: 'active' },
      { label: 'GERD', since: '2024-09', status: 'controlled', current_meds: ['Pantoprazole 40mg OD'] },
    ],
    encounters: [
      {
        date: '2025-07-09', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up', 'Lab review'],
        cc_text: 'Quarterly BP review. Home BP 145-155 systolic. Compliant with Telmisartan, but admits irregular exercise and continued alcohol intake (3-4 drinks/wk).',
        vitals: { bp_sys: 152, bp_dia: 96, hr: 82, temp_c: 36.7, spo2: 98, weight_kg: 88, height_cm: 174, pain: 0 },
        exam_findings: 'Truncal obesity. CVS regular. Abdomen: mild hepatomegaly, non-tender.',
        assessment_codes: ['I10', 'K76.0'],
        assessment_text: 'HTN sub-optimal — adding Amlodipine. NAFLD on USG (2024).',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Amlodipine', brand: 'Amlong', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 30, timing: 'before breakfast' },
        ],
        disposition: 'follow_up', follow_up_days: 60,
      },
      {
        date: '2025-09-15', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up'],
        cc_text: 'BP improved on dual therapy but ankle oedema noted by patient over past week.',
        vitals: { bp_sys: 138, bp_dia: 86, hr: 78, temp_c: 36.7, spo2: 98, weight_kg: 88, height_cm: 174, pain: 0 },
        exam_findings: 'Bilateral pedal pitting oedema +. Otherwise stable.',
        assessment_codes: ['I10'],
        assessment_text: 'Amlodipine-related oedema. Switch to higher Telmisartan + reduce Amlodipine.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '80mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Amlodipine', brand: 'Amlong', strength: '2.5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 60,
      },
      {
        date: '2025-12-18', doctor_email: 'priya.suresh@even.in', room_name: 'OPD-5',
        cc_chips: ['Acid reflux'],
        cc_text: 'GERD flare — burning retrosternal pain, regurgitation after meals + lying down. Worse over holiday season with rich food.',
        vitals: { bp_sys: 142, bp_dia: 90, hr: 84, temp_c: 36.7, spo2: 98, weight_kg: 90, height_cm: 174, pain: 5 },
        exam_findings: 'Epigastric tenderness mild. No alarm features.',
        assessment_codes: ['K21.9'],
        assessment_text: 'GERD flare. Step up PPI, lifestyle counseling.',
        rx_lines: [
          { generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'BD', duration_days: 28, timing: 'before meals' },
          { generic: 'Sucralfate', brand: 'Sucrafil', strength: '1g', form: 'tablet', frequency: 'TDS', duration_days: 14, timing: 'before meals' },
        ],
        disposition: 'follow_up', follow_up_days: 28,
      },
      {
        date: '2026-02-04', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up'],
        cc_text: 'Routine BP check. Reports oedema resolved. GERD symptoms improved.',
        vitals: { bp_sys: 140, bp_dia: 88, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 88, height_cm: 174, pain: 0 },
        exam_findings: 'No oedema. Otherwise stable.',
        assessment_codes: ['I10'],
        assessment_text: 'Continue current regimen. Will retry Amlodipine 5mg if BP not <130.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '80mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Amlodipine', brand: 'Amlong', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Pantoprazole', brand: 'Pantop', strength: '40mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['BP follow-up'],
        cc_text: 'Hypertension follow-up, BP 148/92 home readings.',
        vitals: { bp_sys: 144, bp_dia: 88, hr: 76, temp_c: 36.7, spo2: 98, weight_kg: 89, height_cm: 174, pain: 0 },
        exam_findings: 'BP 144/88 in clinic, HR 76 regular, no edema.',
        assessment_codes: ['I10'],
        assessment_text: 'Essential HTN — sub-optimal control on current regimen.',
        rx_lines: [
          { generic: 'Telmisartan', brand: 'Telma', strength: '80mg', form: 'tablet', frequency: 'OD', duration_days: 14 },
          { generic: 'Amlodipine', brand: 'Amlong', strength: '10mg', form: 'tablet', frequency: 'OD', duration_days: 14, instructions: 'Increased from 5mg.' },
        ],
        disposition: 'follow_up', follow_up_days: 14,
      },
    ],
    lab_cycles: [
      {
        date: '2025-07-05', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2025-07-09',
        orders: [
          { raw_text: 'Lipid', canonical_key: 'lipid_panel', display_name: 'Lipid Profile' },
          { raw_text: 'LFT', canonical_key: 'lft', display_name: 'Liver Function Test' },
          { raw_text: 'HbA1c', canonical_key: 'hba1c', display_name: 'HbA1c' },
          { raw_text: 'USG abdomen', canonical_key: 'usg_abdomen', display_name: 'USG Abdomen' },
        ],
        results: [
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 156, unit: 'mg/dL', reference_range: '<130 borderline' },
          { canonical_key: 'triglycerides', display_name: 'Triglycerides', value_numeric: 232, unit: 'mg/dL', reference_range: '<150' },
          { canonical_key: 'alt', display_name: 'ALT', value_numeric: 68, unit: 'U/L', reference_range: '7-56' },
          { canonical_key: 'ast', display_name: 'AST', value_numeric: 52, unit: 'U/L', reference_range: '10-40' },
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 5.9, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'usg_abdomen', display_name: 'USG Abdomen', value_text: 'Grade II fatty liver. No focal lesion. Gallbladder normal.', unit: '', reference_range: 'normal' },
        ],
      },
      {
        date: '2026-02-02', ordering_doctor_email: 'chandrika.kambam@even.in', link_to_encounter_date: '2026-02-04',
        orders: [{ raw_text: 'Lipid + LFT', canonical_key: 'metabolic_panel', display_name: 'Metabolic Panel' }],
        results: [
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 144, unit: 'mg/dL', reference_range: '<130 borderline' },
          { canonical_key: 'triglycerides', display_name: 'Triglycerides', value_numeric: 198, unit: 'mg/dL', reference_range: '<150' },
          { canonical_key: 'alt', display_name: 'ALT', value_numeric: 58, unit: 'U/L', reference_range: '7-56' },
        ],
      },
    ],
    override_events: [
      { date: '2025-12-18', doctor_email: 'priya.suresh@even.in', target_kind: 'problem', target_key: 'GERD',
        action: 'edit', payload: { status: 'active', note: 'Flared during holidays — likely diet trigger.' } },
      { date: '2026-02-04', doctor_email: 'chandrika.kambam@even.in', target_kind: 'problem', target_key: 'GERD',
        action: 'edit', payload: { status: 'controlled', note: 'Resolved on step-up PPI.' } },
    ],
  },

  // 3. Lakshmi Iyer — 62F — Sadashivanagar — retired teacher
  // Right knee OA, post-menopausal, mild osteopenia, HTN
  {
    mrn: 'EHRC-2026-003', name: 'Lakshmi Iyer', age_years: 62, sex: 'F',
    phone_e164: '+919876543203', known_allergies: null,
    occupation: 'Retired teacher', area: 'Sadashivanagar',
    primary_doctor_email: 'karthik.reddy@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Right knee osteoarthritis', since: '2025-04', status: 'active', current_meds: ['Etoricoxib PRN', 'Glucosamine'] },
      { label: 'Essential hypertension', since: '2022-08', status: 'controlled', current_meds: ['Amlodipine 5mg OD'] },
      { label: 'Post-menopausal osteopenia', since: '2025-05', status: 'active', current_meds: ['Calcium + Vit D'] },
    ],
    encounters: [
      {
        date: '2025-08-22', doctor_email: 'chandrika.kambam@even.in',
        cc_chips: ['BP follow-up'],
        cc_text: 'Routine BP. Home readings 130-140. Reports knee pain has settled with intermittent NSAIDs.',
        vitals: { bp_sys: 136, bp_dia: 80, hr: 72, temp_c: 36.7, spo2: 98, weight_kg: 64, height_cm: 158, pain: 2 },
        exam_findings: 'CVS unremarkable. Knee crepitus right, no effusion.',
        assessment_codes: ['I10'],
        assessment_text: 'HTN well-controlled.',
        rx_lines: [{ generic: 'Amlodipine', brand: 'Amlong', strength: '5mg', form: 'tablet', frequency: 'OD', duration_days: 90 }],
        disposition: 'follow_up', follow_up_days: 180,
      },
      {
        date: '2025-10-04', doctor_email: 'karthik.reddy@even.in', room_name: 'OPD-6',
        cc_chips: ['Joint pain'],
        cc_text: 'Right knee pain progressively worse over past 6 weeks. Difficulty squatting for prayer.',
        vitals: { bp_sys: 134, bp_dia: 78, hr: 72, temp_c: 36.7, spo2: 98, weight_kg: 64, height_cm: 158, pain: 6 },
        exam_findings: 'Right knee crepitus marked, mild effusion, ROM 0-110 limited by pain. X-ray K-L grade 2.',
        assessment_codes: ['M17.1'],
        assessment_text: 'Right knee OA, K-L grade 2. Consider hyaluronic acid injection if conservative fails.',
        rx_lines: [
          { generic: 'Etoricoxib', brand: 'Etoshine', strength: '90mg', form: 'tablet', frequency: 'OD', duration_days: 7 },
          { generic: 'Glucosamine + Chondroitin', brand: 'Joint-Up', strength: '1500mg+1200mg', form: 'tablet', frequency: 'OD', duration_days: 90 },
          { generic: 'Diclofenac gel', strength: '1%', form: 'topical', frequency: 'TDS', duration: '4 weeks' },
        ],
        disposition: 'follow_up', follow_up_days: 28, referral_target: 'Physiotherapy',
      },
      {
        date: '2026-01-22', doctor_email: 'karthik.reddy@even.in', room_name: 'OPD-6',
        cc_chips: ['Joint pain'],
        cc_text: 'Knee pain returning after Etoricoxib course ended. Physio attendance irregular.',
        vitals: { bp_sys: 132, bp_dia: 78, hr: 70, temp_c: 36.7, spo2: 98, weight_kg: 64, height_cm: 158, pain: 5 },
        exam_findings: 'Mild effusion right knee. Crepitus persistent.',
        assessment_codes: ['M17.1'],
        assessment_text: 'OA persistent. Intra-articular hyaluronic acid injection planned.',
        rx_lines: [
          { generic: 'Hyaluronic acid', brand: 'Synvisc-One', strength: '6mL', form: 'injection', frequency: 'single', duration: 'one-time intra-articular' },
          { generic: 'Paracetamol', brand: 'Crocin', strength: '650mg', form: 'tablet', frequency: 'TDS PRN', duration_days: 14 },
        ],
        disposition: 'follow_up', follow_up_days: 28,
      },
      {
        date: '2026-02-25', doctor_email: 'karthik.reddy@even.in', room_name: 'OPD-6',
        cc_chips: ['Joint pain'],
        cc_text: 'HA injection effect — significant pain relief. Walking comfortably. Squatting still limited.',
        vitals: { bp_sys: 130, bp_dia: 76, hr: 70, temp_c: 36.7, spo2: 98, weight_kg: 63, height_cm: 158, pain: 2 },
        exam_findings: 'No effusion. Crepitus less.',
        assessment_codes: ['M17.1'],
        assessment_text: 'OA improved post HA. Continue physio + analgesia PRN.',
        rx_lines: [{ generic: 'Paracetamol', brand: 'Crocin', strength: '650mg', form: 'tablet', frequency: 'PRN', duration: '3 months' }],
        disposition: 'follow_up', follow_up_days: 90,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Joint pain'],
        cc_text: 'Knee pain x 2 weeks, worse on stairs. Walking the temple steps daily aggravating.',
        vitals: { bp_sys: 132, bp_dia: 78, hr: 70, temp_c: 36.7, spo2: 98, weight_kg: 63, height_cm: 158, pain: 5 },
        exam_findings: 'Crepitus right knee, no effusion, ROM 0-110 painful at extreme.',
        assessment_codes: ['M17.1'],
        assessment_text: 'Right knee osteoarthritis.',
        rx_lines: [{ generic: 'Etoricoxib', brand: 'Etoshine', strength: '60mg', form: 'tablet', frequency: 'OD', duration_days: 7, timing: 'after food' }],
        disposition: 'refer', referral_target: 'Dr. Karthik · Ortho (recurrent OA flare, consider repeat HA)',
      },
    ],
    lab_cycles: [
      {
        date: '2025-10-01', ordering_doctor_email: 'karthik.reddy@even.in', link_to_encounter_date: '2025-10-04',
        orders: [
          { raw_text: 'DEXA scan', canonical_key: 'dexa', display_name: 'DEXA Bone Density Scan' },
          { raw_text: 'Vit D', canonical_key: 'vitamin_d', display_name: 'Vitamin D' },
        ],
        results: [
          { canonical_key: 'dexa_lumbar_tscore', display_name: 'DEXA T-score (Lumbar)', value_numeric: -1.6, unit: 'SD', reference_range: '> -1.0 normal' },
          { canonical_key: 'vitamin_d', display_name: 'Vitamin D', value_numeric: 22, unit: 'ng/mL', reference_range: '30-100' },
        ],
      },
    ],
    override_events: [
      { date: '2025-10-04', doctor_email: 'karthik.reddy@even.in', target_kind: 'problem', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Post-menopausal osteopenia', status: 'active', note: 'T-score -1.6.' } },
    ],
  },

  // 4. Karthik Subramanian — 35M — JP Nagar — software engineer
  // Healthy, annual check-up pattern, mild dyslipidemia
  {
    mrn: 'EHRC-2026-004', name: 'Karthik Subramanian', age_years: 35, sex: 'M',
    phone_e164: '+919876543204', known_allergies: null,
    occupation: 'Software engineer', area: 'JP Nagar',
    primary_doctor_email: 'aditya.sharma@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Mild dyslipidemia', since: '2025-09', status: 'active' },
    ],
    encounters: [
      {
        date: '2025-09-11', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Annual check-up'],
        cc_text: 'Annual health check, no complaints. Sedentary work, exercises ~2x/week. Family hx: father had MI at 58.',
        vitals: { bp_sys: 124, bp_dia: 78, hr: 70, temp_c: 36.7, spo2: 99, weight_kg: 74, height_cm: 172, pain: 0 },
        exam_findings: 'BMI 25.0. CVS unremarkable. Otherwise normal exam.',
        assessment_codes: ['Z00.0'],
        assessment_text: 'Healthy adult, family hx warrants lipid + glucose screen.',
        rx_lines: [],
        disposition: 'diagnostics',
      },
      {
        date: '2025-09-30', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Lab review'],
        cc_text: 'Annual labs back. LDL 156. Glucose normal.',
        vitals: { bp_sys: 122, bp_dia: 78, hr: 72, temp_c: 36.7, spo2: 99, weight_kg: 74, height_cm: 172, pain: 0 },
        exam_findings: 'Stable.',
        assessment_codes: ['E78.5'],
        assessment_text: 'Mild dyslipidemia. Lifestyle modification trial first. No statin yet given low ASCVD risk score.',
        rx_lines: [],
        disposition: 'follow_up', follow_up_days: 180,
      },
      {
        date: '2026-03-18', doctor_email: 'aditya.sharma@even.in',
        cc_chips: ['Lab review'],
        cc_text: '6-month follow-up labs. Says he started running 4x/week, lost 3kg.',
        vitals: { bp_sys: 118, bp_dia: 76, hr: 64, temp_c: 36.7, spo2: 99, weight_kg: 71, height_cm: 172, pain: 0 },
        exam_findings: 'BMI 24.0. Stable.',
        assessment_codes: ['E78.5'],
        assessment_text: 'Dyslipidemia improving with lifestyle. Continue.',
        rx_lines: [],
        disposition: 'follow_up', follow_up_days: 365,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Annual check-up'],
        cc_text: 'Annual check-up, no complaints.',
        vitals: { bp_sys: 122, bp_dia: 78, hr: 66, temp_c: 36.7, spo2: 99, weight_kg: 71, height_cm: 172, pain: 0 },
        exam_findings: 'Unremarkable. BP 122/78, BMI 24.6.',
        assessment_codes: ['Z00.0'],
        assessment_text: 'Healthy adult, due for routine bloods.',
        rx_lines: [],
        disposition: 'discharge',
      },
    ],
    lab_cycles: [
      {
        date: '2025-09-25', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2025-09-11',
        orders: [
          { raw_text: 'Lipid + HbA1c + LFT + RFT', canonical_key: 'annual_panel', display_name: 'Annual Wellness Panel' },
        ],
        results: [
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 156, unit: 'mg/dL', reference_range: '<130 borderline' },
          { canonical_key: 'hdl_cholesterol', display_name: 'HDL Cholesterol', value_numeric: 38, unit: 'mg/dL', reference_range: '>40 (M)' },
          { canonical_key: 'triglycerides', display_name: 'Triglycerides', value_numeric: 184, unit: 'mg/dL', reference_range: '<150' },
          { canonical_key: 'hba1c', display_name: 'HbA1c', value_numeric: 5.3, unit: '%', reference_range: '<5.7' },
          { canonical_key: 'creatinine', display_name: 'Creatinine', value_numeric: 0.9, unit: 'mg/dL', reference_range: '0.7-1.3' },
          { canonical_key: 'alt', display_name: 'ALT', value_numeric: 28, unit: 'U/L', reference_range: '7-56' },
        ],
      },
      {
        date: '2026-03-15', ordering_doctor_email: 'aditya.sharma@even.in', link_to_encounter_date: '2026-03-18',
        orders: [{ raw_text: 'Lipid panel', canonical_key: 'lipid_panel', display_name: 'Lipid Profile' }],
        results: [
          { canonical_key: 'ldl_cholesterol', display_name: 'LDL Cholesterol', value_numeric: 128, unit: 'mg/dL', reference_range: '<130 borderline' },
          { canonical_key: 'hdl_cholesterol', display_name: 'HDL Cholesterol', value_numeric: 44, unit: 'mg/dL', reference_range: '>40 (M)' },
          { canonical_key: 'triglycerides', display_name: 'Triglycerides', value_numeric: 142, unit: 'mg/dL', reference_range: '<150' },
        ],
      },
    ],
    override_events: [],
  },

  // 5. Anita Sharma — 38F — Indiranagar — marketing exec — Sulfa allergy
  // Migraine without aura — recurrent, sleep-related triggers, hormonal
  {
    mrn: 'EHRC-2026-005', name: 'Anita Sharma', age_years: 38, sex: 'F',
    phone_e164: '+919876543205', known_allergies: 'Sulfa drugs (rash, 2015)',
    occupation: 'Marketing executive', area: 'Indiranagar',
    primary_doctor_email: 'vinay.bhardwaj@even.in', existing_in_v1: true,
    active_problems: [
      { label: 'Migraine without aura', since: '2020-03', status: 'active',
        current_meds: ['Sumatriptan PRN'] },
    ],
    encounters: [
      {
        date: '2025-09-22', doctor_email: 'vinay.bhardwaj@even.in',
        cc_chips: ['Headache'],
        cc_text: 'Migraine flare — frequency increased to 3-4 per month, was 1/month. Triggers: late nights at work, missed meals. Each episode 4-6 hours, throbbing left temporal, photophobia, nausea.',
        vitals: { bp_sys: 118, bp_dia: 76, hr: 78, temp_c: 36.7, spo2: 99, weight_kg: 60, height_cm: 164, pain: 5 },
        exam_findings: 'Neurological exam normal. Fundi normal. No neck stiffness.',
        assessment_codes: ['G43.0'],
        assessment_text: 'Migraine without aura — increasing frequency. Will consider preventive if >4/month sustained.',
        rx_lines: [
          { generic: 'Sumatriptan', brand: 'Imitrex', strength: '50mg', form: 'tablet', frequency: 'PRN', duration: '3 months', instructions: 'At onset of attack, max 200mg/24h.' },
          { generic: 'Naproxen', brand: 'Naprosyn', strength: '500mg', form: 'tablet', frequency: 'PRN', duration: '3 months', instructions: 'For mild-mod attacks.' },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      {
        date: '2025-12-13', doctor_email: 'vinay.bhardwaj@even.in',
        cc_chips: ['Headache'],
        cc_text: 'Frequency now 5-6/month. Triggers consistent with sleep deprivation + work stress. Triptan effective but using often.',
        vitals: { bp_sys: 116, bp_dia: 74, hr: 76, temp_c: 36.7, spo2: 99, weight_kg: 60, height_cm: 164, pain: 3 },
        exam_findings: 'Normal neurological exam.',
        assessment_codes: ['G43.0'],
        assessment_text: 'Frequency warrants preventive. Starting Propranolol low-dose, sleep hygiene counseling.',
        rx_lines: [
          { generic: 'Propranolol', brand: 'Inderal', strength: '20mg', form: 'tablet', frequency: 'BD', duration_days: 60, instructions: 'Preventive. Will up-titrate to 40mg BD if tolerated.' },
          { generic: 'Sumatriptan', brand: 'Imitrex', strength: '50mg', form: 'tablet', frequency: 'PRN', duration: '3 months' },
        ],
        disposition: 'follow_up', follow_up_days: 60,
      },
      {
        date: '2026-02-19', doctor_email: 'vinay.bhardwaj@even.in',
        cc_chips: ['Headache'],
        cc_text: 'On Propranolol 20mg BD x 2 months. Frequency down to 2/month. Tolerating well, no dizziness or fatigue.',
        vitals: { bp_sys: 108, bp_dia: 68, hr: 64, temp_c: 36.7, spo2: 99, weight_kg: 60, height_cm: 164, pain: 0 },
        exam_findings: 'Normal exam.',
        assessment_codes: ['G43.0'],
        assessment_text: 'Migraine well-controlled on Propranolol. Continue.',
        rx_lines: [
          { generic: 'Propranolol', brand: 'Inderal', strength: '20mg', form: 'tablet', frequency: 'BD', duration_days: 90 },
          { generic: 'Sumatriptan', brand: 'Imitrex', strength: '50mg', form: 'tablet', frequency: 'PRN', duration: '3 months' },
        ],
        disposition: 'follow_up', follow_up_days: 90,
      },
      // Today
      {
        date: '2026-05-18', doctor_email: 'vinay.bhardwaj@even.in', room_name: 'OPD-1',
        cc_chips: ['Headache'],
        cc_text: 'Migraine recurrence, 2nd episode this month. Both broke through Propranolol — last attack lasted 8 hours, Sumatriptan helped.',
        vitals: { bp_sys: 110, bp_dia: 70, hr: 66, temp_c: 36.7, spo2: 99, weight_kg: 60, height_cm: 164, pain: 2 },
        exam_findings: 'Neuro grossly intact, no focal deficit, no nuchal rigidity.',
        assessment_codes: ['G43.0'],
        assessment_text: 'Migraine without aura — breakthrough on Propranolol 20BD. Up-titrate.',
        rx_lines: [
          { generic: 'Propranolol', brand: 'Inderal', strength: '40mg', form: 'tablet', frequency: 'BD', duration_days: 30, instructions: 'Up-titrated from 20mg BD.' },
          { generic: 'Sumatriptan', brand: 'Imitrex', strength: '50mg', form: 'tablet', frequency: 'PRN', duration: '3 months' },
        ],
        disposition: 'follow_up', follow_up_days: 30,
      },
    ],
    lab_cycles: [],
    override_events: [
      { date: '2025-12-13', doctor_email: 'vinay.bhardwaj@even.in', target_kind: 'cc_chip', target_key: '__doctor_added__',
        action: 'add', payload: { label: 'Sleep deprivation review', note: 'Patient-specific addition relevant to migraine trigger management.' } },
    ],
  },
];
