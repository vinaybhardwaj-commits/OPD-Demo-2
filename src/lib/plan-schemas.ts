/**
 * v5.0 plan schemas — declarative metadata + Zod validation per plan kind.
 *
 * Single source of truth for the 13 plan kinds. Drives:
 *   - server-side payload validation (zod)
 *   - generic form renderer (PlanFormShell.tsx reads FIELDS metadata)
 *   - prediction prefill validation
 *
 * Adding a new plan kind: add an entry to PLAN_KINDS, schema in SCHEMAS,
 * field metadata in FIELDS, and downstream dispatcher in plan-downstream.ts.
 *
 * See Daily Dash EHRC/PLAN-V5-PRD.md §3-4 for the spec.
 */
import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────
// Plan kind enum (matches Postgres plan_kind enum exactly, in order).
// ────────────────────────────────────────────────────────────────────
export const PLAN_KINDS = [
  'discharge',
  'follow_up',
  'refer',
  'diagnostics',
  'imaging',
  'medical_admission',
  'surgical_plan',
  'day_care_procedure',
  'vaccinate',
  'emergency_transfer',
  'counseling_only',
  'refusal_of_advised_plan',
  'no_further_action',
] as const;

export type PlanKind = (typeof PLAN_KINDS)[number];

// ────────────────────────────────────────────────────────────────────
// Per-kind metadata for the UI: label, short description, icon char.
// Encounter status on submit drives the state machine (see PRD §7).
// ────────────────────────────────────────────────────────────────────
export const PLAN_META: Record<
  PlanKind,
  {
    label: string;
    icon: string;
    shortDesc: string;
    statusOnSubmit:
      | 'completed'
      | 'paused_diagnostics'
      | 'depends_on_payload'; // imaging chooses based on post_result_action
  }
> = {
  discharge: { label: 'Discharge with Rx', icon: '🏠', shortDesc: 'Send home with prescription', statusOnSubmit: 'completed' },
  follow_up: { label: 'Return to OPD', icon: '📅', shortDesc: 'Schedule next OPD visit', statusOnSubmit: 'completed' },
  refer: { label: 'Refer to another doctor', icon: '➡️', shortDesc: 'In-house or external referral', statusOnSubmit: 'completed' },
  diagnostics: { label: 'Order tests', icon: '🧪', shortDesc: 'Pause encounter; wait for results', statusOnSubmit: 'paused_diagnostics' },
  imaging: { label: 'Order imaging', icon: '🩻', shortDesc: 'X-ray / CT / MRI / US', statusOnSubmit: 'depends_on_payload' },
  medical_admission: { label: 'Medical admission', icon: '🏥', shortDesc: 'Admit for medical management', statusOnSubmit: 'completed' },
  surgical_plan: { label: 'Plan surgery', icon: '🔪', shortDesc: 'Surgical procedure planning', statusOnSubmit: 'completed' },
  day_care_procedure: { label: 'Day-care procedure', icon: '⏱️', shortDesc: 'Same-day in-and-out', statusOnSubmit: 'completed' },
  vaccinate: { label: 'Vaccinate', icon: '💉', shortDesc: 'Today / scheduled', statusOnSubmit: 'completed' },
  emergency_transfer: { label: 'Emergency transfer', icon: '🚑', shortDesc: 'Stabilize + transfer out', statusOnSubmit: 'completed' },
  counseling_only: { label: 'Counseling only', icon: '💬', shortDesc: 'Education / discussion, no clinical action', statusOnSubmit: 'completed' },
  refusal_of_advised_plan: { label: 'Patient declined', icon: '✋', shortDesc: 'Refused a recommended plan', statusOnSubmit: 'completed' },
  no_further_action: { label: 'Tracking only', icon: '👁️', shortDesc: 'Passive monitoring', statusOnSubmit: 'completed' },
};

// ────────────────────────────────────────────────────────────────────
// Field metadata for the generic form renderer.
// Each plan kind lists fields the doctor sees. The renderer in
// PlanFormShell.tsx dispatches per `type`.
// ────────────────────────────────────────────────────────────────────
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'date_or_relative'
  | 'timestamp'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'doctor_picker'
  | 'specialty_picker'
  | 'string_array';

export interface FieldMeta {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
}

const SPECIALTIES_OPTS = [
  { value: 'cardio', label: 'Cardiology' },
  { value: 'pulmo', label: 'Pulmonology' },
  { value: 'nephro', label: 'Nephrology' },
  { value: 'endo', label: 'Endocrinology' },
  { value: 'hema', label: 'Hematology' },
  { value: 'id', label: 'Infectious Disease' },
  { value: 'anesthesia', label: 'Anesthesia' },
  { value: 'gastro', label: 'Gastroenterology' },
  { value: 'neuro', label: 'Neurology' },
  { value: 'ortho', label: 'Orthopaedics' },
  { value: 'gynae', label: 'Gynaecology' },
  { value: 'paeds', label: 'Paediatrics' },
  { value: 'surgery', label: 'General Surgery' },
  { value: 'psych', label: 'Psychiatry' },
  { value: 'derm', label: 'Dermatology' },
  { value: 'other', label: 'Other' },
];

export const FIELDS: Record<PlanKind, FieldMeta[]> = {
  discharge: [
    { key: 'advice_text', label: 'Discharge advice', type: 'textarea', placeholder: 'Lifestyle, diet, activity, medication adherence…' },
    { key: 'red_flag_warnings', label: 'Red-flag warnings', type: 'string_array', help: 'One per line — "if X happens, come back"' },
    { key: 'sos_criteria', label: 'SOS criteria', type: 'text', placeholder: 'When to seek emergency care' },
  ],

  follow_up: [
    { key: 'when', label: 'When *', type: 'date_or_relative', required: true, help: 'Pick a date or a relative window like "7 days"' },
    { key: 'with_doctor_id', label: 'With which doctor', type: 'doctor_picker', help: 'Defaults to you' },
    { key: 'with_specialty', label: 'Specialty (if not specific doctor)', type: 'specialty_picker' },
    { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'in_person', label: 'In person' }, { value: 'tele_consult', label: 'Tele-consult' }] },
    { key: 'reason', label: 'Reason for follow-up', type: 'text' },
    { key: 'bring', label: 'Things to bring (e.g. tests, reports)', type: 'string_array' },
  ],

  refer: [
    { key: 'to_specialty', label: 'Refer to specialty', type: 'specialty_picker', help: 'Either specialty OR specific doctor' },
    { key: 'to_doctor_id', label: 'Refer to specific doctor', type: 'doctor_picker' },
    { key: 'is_external', label: 'External referral (outside this facility)', type: 'boolean' },
    { key: 'external_doctor_name', label: 'External doctor name', type: 'text' },
    { key: 'external_facility', label: 'External facility', type: 'text' },
    { key: 'urgency', label: 'Urgency', type: 'select', required: true, options: [{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent (<24h)' }, { value: 'emergent', label: 'Emergent (now)' }] },
    { key: 'reason', label: 'Reason for referral', type: 'textarea' },
    { key: 'specific_question', label: 'Specific question for receiving doctor', type: 'text' },
    { key: 'attach_encounter', label: 'Attach this encounter\'s records', type: 'boolean' },
  ],

  diagnostics: [
    { key: 'urgency', label: 'Urgency', type: 'select', required: true, options: [{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'stat', label: 'STAT' }] },
    { key: 'post_result_action', label: 'When results return', type: 'select', required: true, options: [{ value: 'return_to_doctor', label: 'Return to me for review' }, { value: 'discharge_with_protocol', label: 'Auto-discharge per protocol' }, { value: 'auto_followup', label: 'Auto-schedule follow-up' }] },
    { key: 'post_result_followup_when', label: 'Follow-up window (if auto)', type: 'text', placeholder: 'e.g. 3 days' },
  ],

  imaging: [
    { key: 'modality', label: 'Modality *', type: 'select', required: true, options: [{ value: 'xray', label: 'X-ray' }, { value: 'ct', label: 'CT' }, { value: 'mri', label: 'MRI' }, { value: 'us', label: 'Ultrasound' }, { value: 'mammography', label: 'Mammography' }, { value: 'dexa', label: 'DEXA' }, { value: 'other', label: 'Other' }] },
    { key: 'body_part', label: 'Body part *', type: 'text', required: true, placeholder: 'e.g. chest, abdomen, L knee' },
    { key: 'indication', label: 'Clinical indication *', type: 'textarea', required: true, placeholder: 'Why this imaging now' },
    { key: 'contrast', label: 'Contrast', type: 'select', options: [{ value: 'none', label: 'No contrast' }, { value: 'with', label: 'With contrast' }, { value: 'without', label: 'Without contrast' }, { value: 'with_and_without', label: 'With and without' }] },
    { key: 'is_external', label: 'External (not in-house)', type: 'boolean' },
    { key: 'urgency', label: 'Urgency', type: 'select', options: [{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'stat', label: 'STAT' }] },
    { key: 'post_result_action', label: 'When results return', type: 'select', options: [{ value: 'return_to_doctor', label: 'Return to me' }, { value: 'discharge_with_protocol', label: 'Auto-discharge per protocol' }, { value: 'auto_followup', label: 'Auto-schedule follow-up' }] },
  ],

  medical_admission: [
    { key: 'bed_type', label: 'Bed type *', type: 'select', required: true, options: [{ value: 'general_ward', label: 'General ward' }, { value: 'private', label: 'Private room' }, { value: 'semi_private', label: 'Semi-private' }, { value: 'hdu', label: 'HDU' }, { value: 'icu', label: 'ICU' }, { value: 'step_down', label: 'Step-down' }] },
    { key: 'admit_under_doctor_id', label: 'Admit under doctor *', type: 'doctor_picker', required: true, help: 'Defaults to you' },
    { key: 'admit_under_specialty', label: 'Specialty', type: 'specialty_picker' },
    { key: 'anticipated_los_days', label: 'Anticipated length of stay (days)', type: 'number' },
    { key: 'pre_admission_referrals_needed', label: 'Pre-admission referrals needed', type: 'multiselect', options: SPECIALTIES_OPTS },
    { key: 'special_orders', label: 'Special on-admission orders', type: 'textarea', placeholder: 'NPO from midnight; start IV antibiotics; trans-thoracic echo within 24h…' },
    { key: 'mrsa_screen', label: 'MRSA screen needed', type: 'boolean' },
    { key: 'fall_risk_assessment', label: 'Fall-risk assessment needed', type: 'boolean' },
    { key: 'isolation_precautions', label: 'Isolation precautions', type: 'select', options: [{ value: 'none', label: 'None' }, { value: 'contact', label: 'Contact' }, { value: 'droplet', label: 'Droplet' }, { value: 'airborne', label: 'Airborne' }] },
  ],

  surgical_plan: [
    { key: 'procedure_name', label: 'Procedure name *', type: 'text', required: true, placeholder: 'e.g. laparoscopic cholecystectomy' },
    { key: 'urgency', label: 'Urgency *', type: 'select', required: true, options: [{ value: 'emergent', label: 'Emergent (<1h)' }, { value: 'urgent', label: 'Urgent (<24h)' }, { value: 'semi_urgent', label: 'Semi-urgent (<1 week)' }, { value: 'elective', label: 'Elective (>1 week)' }] },
    { key: 'planned_date', label: 'Planned date *', type: 'date', help: 'Required for non-emergent' },
    { key: 'planned_admission_date', label: 'Planned admission date', type: 'date', help: 'Defaults to day before for major procedures' },
    { key: 'surgeon_doctor_id', label: 'Primary surgeon', type: 'doctor_picker', help: 'Defaults to you' },
    { key: 'assisting_surgeon_doctor_id', label: 'Assisting surgeon', type: 'doctor_picker' },
    { key: 'procedure_code', label: 'Procedure code (CPT / ICD-10-PCS)', type: 'text' },
    { key: 'anesthesia_type', label: 'Anesthesia type', type: 'select', options: [{ value: 'ga', label: 'General' }, { value: 'regional', label: 'Regional' }, { value: 'local', label: 'Local' }, { value: 'mac_sedation', label: 'MAC sedation' }] },
    { key: 'anesthesia_notes', label: 'Anesthesia notes', type: 'textarea' },
    { key: 'expected_los_nights', label: 'Expected length of stay (nights)', type: 'number' },
    { key: 'preop_clearances_needed', label: 'Pre-op clearances needed', type: 'multiselect', options: SPECIALTIES_OPTS },
    { key: 'preop_tests_to_repeat', label: 'Pre-op tests to repeat', type: 'string_array' },
    { key: 'blood_crossmatch_needed', label: 'Blood crossmatch needed', type: 'boolean' },
    { key: 'blood_units', label: 'Units of blood', type: 'number' },
    { key: 'special_equipment', label: 'Special equipment', type: 'string_array' },
    { key: 'implants_needed', label: 'Implants needed', type: 'string_array' },
    { key: 'risks_counselled', label: 'Patient counselled about risks', type: 'boolean' },
    { key: 'cost_estimate_counselled', label: 'Patient counselled about cost', type: 'boolean' },
    { key: 'ot_notes', label: 'Notes for OT scheduler', type: 'textarea' },
  ],

  day_care_procedure: [
    { key: 'procedure_name', label: 'Procedure name *', type: 'text', required: true, placeholder: 'e.g. upper GI endoscopy' },
    { key: 'scheduled_at', label: 'Scheduled date + time *', type: 'timestamp', required: true },
    { key: 'anesthesia_type', label: 'Anesthesia type', type: 'select', options: [{ value: 'none', label: 'None' }, { value: 'local', label: 'Local' }, { value: 'sedation', label: 'Sedation' }, { value: 'ga', label: 'General' }] },
    { key: 'preprocedure_prep', label: 'Pre-procedure prep', type: 'textarea', placeholder: 'NPO from midnight; bowel prep; etc.' },
    { key: 'observation_hours', label: 'Post-procedure observation (hours)', type: 'number' },
    { key: 'accompaniment_required', label: 'Patient requires accompaniment', type: 'boolean', help: 'For procedures with sedation' },
  ],

  vaccinate: [
    // vaccines[] is a special array-of-objects — handled by a custom sub-renderer.
    { key: 'vaccines', label: 'Vaccines *', type: 'string_array', required: true, placeholder: 'One vaccine name per line; site and batch added per vaccine' },
    { key: 'vis_given', label: 'VIS (Vaccine Information Statement) given', type: 'boolean' },
  ],

  emergency_transfer: [
    { key: 'target_facility', label: 'Target facility *', type: 'text', required: true },
    { key: 'target_doctor', label: 'Receiving doctor (if known)', type: 'text' },
    { key: 'transfer_mode', label: 'Transfer mode *', type: 'select', required: true, options: [{ value: 'bls_ambulance', label: 'BLS ambulance' }, { value: 'als_ambulance', label: 'ALS ambulance' }, { value: 'private_vehicle', label: 'Private vehicle' }, { value: 'air', label: 'Air' }] },
    { key: 'accompanying_staff', label: 'Accompanying staff *', type: 'select', required: true, options: [{ value: 'none', label: 'None' }, { value: 'nurse', label: 'Nurse' }, { value: 'doctor', label: 'Doctor' }] },
    { key: 'stabilization_status', label: 'Current stabilization', type: 'textarea', placeholder: 'Vitals, IV access, intubation status' },
    { key: 'interventions_completed', label: 'Interventions completed pre-transfer', type: 'textarea' },
    { key: 'transit_equipment', label: 'Equipment in transit', type: 'string_array' },
  ],

  counseling_only: [
    { key: 'topics', label: 'Topics *', type: 'string_array', required: true, placeholder: 'e.g. Contraception, breastfeeding, lifestyle modification' },
    { key: 'summary', label: 'Summary *', type: 'textarea', required: true },
    { key: 'materials_given', label: 'Materials given', type: 'string_array' },
    { key: 'followup_suggested', label: 'Follow-up suggested', type: 'boolean' },
    { key: 'followup_when', label: 'Follow-up window', type: 'text', placeholder: 'e.g. 2 weeks' },
  ],

  refusal_of_advised_plan: [
    { key: 'advised_summary', label: 'What was advised *', type: 'textarea', required: true },
    { key: 'what_refused', label: 'What patient refused *', type: 'text', required: true },
    { key: 'reason', label: 'Reason captured *', type: 'textarea', required: true, placeholder: 'Cost, time, second opinion, personal/religious…' },
    { key: 'high_risk', label: 'High-risk refusal (admission/surgery/transfer)', type: 'boolean' },
  ],

  no_further_action: [
    { key: 'tracking_item', label: 'What is being tracked *', type: 'text', required: true, placeholder: 'e.g. incidental thyroid nodule on USG' },
    { key: 'next_review_trigger', label: 'Next review trigger', type: 'text', placeholder: 'e.g. 6 months; if symptom X develops' },
  ],
};

// ────────────────────────────────────────────────────────────────────
// Zod schemas — server-side validation for each plan's payload.
// Looser than UI required-marking; UI handles "required" via metadata
// and Zod just guards the data shape on insert/update.
// ────────────────────────────────────────────────────────────────────
const whenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absolute'), date: z.string() }),
  z.object({ kind: z.literal('relative'), days: z.number().int().positive() }),
]);

export const SCHEMAS: Record<PlanKind, z.ZodTypeAny> = {
  discharge: z.object({
    advice_text: z.string().optional(),
    red_flag_warnings: z.array(z.string()).optional().default([]),
    sos_criteria: z.string().optional(),
  }),

  follow_up: z.object({
    when: whenSchema,
    with_doctor_id: z.string().uuid().optional(),
    with_specialty: z.string().optional(),
    reason: z.string().optional(),
    mode: z.enum(['in_person', 'tele_consult']).optional().default('in_person'),
    bring: z.array(z.string()).optional().default([]),
  }),

  refer: z.object({
    to_doctor_id: z.string().uuid().optional(),
    to_specialty: z.string().optional(),
    is_external: z.boolean().optional().default(false),
    external_doctor_name: z.string().optional(),
    external_facility: z.string().optional(),
    reason: z.string().optional(),
    specific_question: z.string().optional(),
    urgency: z.enum(['routine', 'urgent', 'emergent']),
    attach_encounter: z.boolean().optional().default(true),
    is_preop_clearance_for_plan_id: z.string().uuid().optional(),
  }).refine(
    (d) => d.to_doctor_id || d.to_specialty || d.external_doctor_name,
    { message: 'Either to_doctor_id, to_specialty, or external_doctor_name is required' },
  ),

  diagnostics: z.object({
    lab_order_ids: z.array(z.string().uuid()).optional().default([]),
    urgency: z.enum(['routine', 'urgent', 'stat']),
    post_result_action: z.enum(['return_to_doctor', 'discharge_with_protocol', 'auto_followup']),
    post_result_followup_when: z.string().optional(),
  }),

  imaging: z.object({
    modality: z.enum(['xray', 'ct', 'mri', 'us', 'mammography', 'dexa', 'other']),
    body_part: z.string().min(1),
    indication: z.string().min(1),
    contrast: z.enum(['none', 'with', 'without', 'with_and_without']).optional().default('none'),
    is_external: z.boolean().optional().default(false),
    urgency: z.enum(['routine', 'urgent', 'stat']).optional().default('routine'),
    post_result_action: z.enum(['return_to_doctor', 'discharge_with_protocol', 'auto_followup']).optional().default('return_to_doctor'),
  }),

  medical_admission: z.object({
    bed_type: z.enum(['general_ward', 'private', 'semi_private', 'hdu', 'icu', 'step_down']),
    admit_under_doctor_id: z.string().uuid().optional(),
    admit_under_specialty: z.string().optional(),
    anticipated_los_days: z.number().int().positive().optional(),
    pre_admission_referrals_needed: z.array(z.string()).optional().default([]),
    special_orders: z.string().optional(),
    mrsa_screen: z.boolean().optional(),
    fall_risk_assessment: z.boolean().optional(),
    isolation_precautions: z.enum(['none', 'contact', 'droplet', 'airborne']).optional().default('none'),
  }),

  surgical_plan: z.object({
    procedure_name: z.string().min(1),
    procedure_code: z.string().optional(),
    urgency: z.enum(['emergent', 'urgent', 'semi_urgent', 'elective']),
    planned_date: z.string().optional(),
    planned_admission_date: z.string().optional(),
    surgeon_doctor_id: z.string().uuid().optional(),
    assisting_surgeon_doctor_id: z.string().uuid().optional(),
    anesthesia_type: z.enum(['ga', 'regional', 'local', 'mac_sedation']).optional(),
    anesthesia_notes: z.string().optional(),
    expected_los_nights: z.number().int().nonnegative().optional(),
    preop_clearances_needed: z.array(z.string()).optional().default([]),
    preop_tests_to_repeat: z.array(z.string()).optional().default([]),
    blood_crossmatch_needed: z.boolean().optional().default(false),
    blood_units: z.number().int().nonnegative().optional(),
    special_equipment: z.array(z.string()).optional().default([]),
    implants_needed: z.array(z.string()).optional().default([]),
    risks_counselled: z.boolean().optional().default(false),
    cost_estimate_counselled: z.boolean().optional().default(false),
    ot_notes: z.string().optional(),
  }).refine(
    (d) => d.urgency === 'emergent' || !!d.planned_date,
    { message: 'planned_date is required for non-emergent surgical plans' },
  ),

  day_care_procedure: z.object({
    procedure_name: z.string().min(1),
    scheduled_at: z.string(),
    anesthesia_type: z.enum(['none', 'local', 'sedation', 'ga']).optional().default('none'),
    preprocedure_prep: z.string().optional(),
    observation_hours: z.number().int().nonnegative().optional(),
    accompaniment_required: z.boolean().optional().default(false),
  }),

  vaccinate: z.object({
    vaccines: z.array(z.object({
      name: z.string().min(1),
      site: z.string().optional(),
      batch: z.string().optional(),
      expiry: z.string().optional(),
      manufacturer: z.string().optional(),
      next_dose_due_date: z.string().optional(),
    })).min(1),
    vis_given: z.boolean().optional().default(false),
  }),

  emergency_transfer: z.object({
    target_facility: z.string().min(1),
    target_doctor: z.string().optional(),
    transfer_mode: z.enum(['bls_ambulance', 'als_ambulance', 'private_vehicle', 'air']),
    accompanying_staff: z.enum(['none', 'nurse', 'doctor']),
    stabilization_status: z.string().optional(),
    interventions_completed: z.string().optional(),
    transit_equipment: z.array(z.string()).optional().default([]),
  }),

  counseling_only: z.object({
    topics: z.array(z.string()).min(1),
    summary: z.string().min(1),
    materials_given: z.array(z.string()).optional().default([]),
    followup_suggested: z.boolean().optional().default(false),
    followup_when: z.string().optional(),
  }),

  refusal_of_advised_plan: z.object({
    advised_summary: z.string().min(1),
    what_refused: z.string().min(1),
    reason: z.string().min(1),
    refusal_form_blob_url: z.string().url().optional(),
    high_risk: z.boolean().optional().default(false),
  }),

  no_further_action: z.object({
    tracking_item: z.string().min(1),
    next_review_trigger: z.string().optional(),
  }),
};

/**
 * Smart defaults per plan kind. Used when the doctor clicks a chip in
 * the manual plan picker — pre-fills sensible required-field values
 * so the row can be persisted as a draft without the doctor having to
 * tap through every field. Doctors can edit anything in the form
 * afterwards.
 *
 * Goal: minimize keystrokes for the common case. Where a required
 * field is genuinely encounter-specific (procedure_name, body_part,
 * indication, target_facility, etc.) we use an empty string placeholder
 * — the form shows the * marker and the doctor knows to fill it. Strict
 * validation only runs at submit time (see encounter-plans.ts).
 */
export const PLAN_DEFAULTS: Record<PlanKind, Record<string, unknown>> = {
  discharge: {
    red_flag_warnings: [],
  },
  follow_up: {
    when: { kind: 'relative', days: 7 },
    mode: 'in_person',
    bring: [],
  },
  refer: {
    urgency: 'routine',
    attach_encounter: true,
    is_external: false,
  },
  diagnostics: {
    urgency: 'routine',
    post_result_action: 'return_to_doctor',
    lab_order_ids: [],
  },
  imaging: {
    modality: 'xray',
    body_part: '',
    indication: '',
    contrast: 'none',
    is_external: false,
    urgency: 'routine',
    post_result_action: 'return_to_doctor',
  },
  medical_admission: {
    bed_type: 'general_ward',
    pre_admission_referrals_needed: [],
    isolation_precautions: 'none',
  },
  surgical_plan: {
    procedure_name: '',
    urgency: 'elective',
    preop_clearances_needed: [],
    preop_tests_to_repeat: [],
    blood_crossmatch_needed: false,
    special_equipment: [],
    implants_needed: [],
    risks_counselled: false,
    cost_estimate_counselled: false,
  },
  day_care_procedure: {
    procedure_name: '',
    scheduled_at: '',
    anesthesia_type: 'none',
    accompaniment_required: false,
  },
  vaccinate: {
    vaccines: [],
    vis_given: false,
  },
  emergency_transfer: {
    target_facility: '',
    transfer_mode: 'als_ambulance',
    accompanying_staff: 'nurse',
    transit_equipment: [],
  },
  counseling_only: {
    topics: [],
    summary: '',
    materials_given: [],
    followup_suggested: false,
  },
  refusal_of_advised_plan: {
    advised_summary: '',
    what_refused: '',
    reason: '',
    high_risk: false,
  },
  no_further_action: {
    tracking_item: '',
  },
};

/**
 * Strict validator used at SUBMIT time. Returns { ok, error } so the
 * route can short-circuit a submit attempt with a readable error list.
 * Throws nothing.
 */
export function validatePlanForSubmit(
  kind: PlanKind,
  payload: unknown,
): { ok: true } | { ok: false; error: string } {
  const schema = SCHEMAS[kind];
  if (!schema) return { ok: false, error: `Unknown plan kind: ${kind}` };
  try {
    schema.parse(payload);
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors
        .map((err) => `${err.path.join('.') || '(root)'}: ${err.message}`)
        .join('; ');
      return { ok: false, error: msg };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}


// Helper: validate a payload for a given kind. Returns parsed payload
// or throws ZodError.
export function validatePlanPayload<T = unknown>(
  kind: PlanKind,
  payload: unknown,
): T {
  const schema = SCHEMAS[kind];
  if (!schema) throw new Error(`Unknown plan kind: ${kind}`);
  return schema.parse(payload) as T;
}

// Helper: compute the encounter status after a plan submits.
export function statusAfterPlan(kind: PlanKind, payload: Record<string, unknown>): 'completed' | 'paused_diagnostics' {
  const meta = PLAN_META[kind];
  if (meta.statusOnSubmit === 'paused_diagnostics') return 'paused_diagnostics';
  if (meta.statusOnSubmit === 'depends_on_payload') {
    // imaging: post_result_action 'return_to_doctor' or 'auto_followup' → paused
    const action = (payload as { post_result_action?: string }).post_result_action;
    if (action === 'return_to_doctor' || action === 'auto_followup') return 'paused_diagnostics';
    return 'completed';
  }
  return 'completed';
}
