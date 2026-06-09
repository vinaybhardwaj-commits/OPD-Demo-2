/**
 * v2.0.0 seed — type definitions for patient stories.
 *
 * Each patient carries demographics + a 12-month history of encounters,
 * lab cycles, and doctor overrides. The seed runner reads this shape
 * and emits the correct INSERTs across patients, encounters, prescriptions,
 * lab_orders, lab_results, doctor_overrides.
 *
 * Dates are ISO YYYY-MM-DD; timestamps are NOW() unless explicitly set.
 * doctor_email resolves to the doctor's id at insert time.
 */

export type SeedVitals = {
  bp_sys?: number;
  bp_dia?: number;
  hr?: number;
  rr?: number;
  temp_c?: number;
  spo2?: number;
  weight_kg?: number;
  height_cm?: number;
  pain?: number;
};

export type SeedRxLine = {
  brand?: string;
  generic: string;
  strength: string;
  form?: string;          // tablet, capsule, syrup, drops
  frequency: string;      // OD, BD, TDS, QID, PRN, HS
  duration_days?: number;
  duration?: string;      // free-text duration if not days
  timing?: string;        // before food, after food, etc
  instructions?: string;
};

export type SeedEncounter = {
  date: string;                          // ISO YYYY-MM-DD
  doctor_email: string;
  room_name?: string;                    // resolved from doctor if absent
  intake_visit_reason?: string | null;   // CCE-captured
  cc_chips: string[];                    // standard catalogue OR custom
  cc_text: string;
  vitals?: SeedVitals;
  exam_findings: string;
  assessment_codes: string[];            // ICD-10 codes
  assessment_text: string;
  rx_lines: SeedRxLine[];
  disposition:
    | 'discharge'
    | 'follow_up'
    | 'refer'
    | 'diagnostics'
    | 'admit'
    | 'vaccinate';
  follow_up_days?: number;
  referral_target?: string;
  handoff_note?: string;
  status?: 'completed' | 'active' | 'paused_diagnostics' | 'ready_to_resume' | 'registered' | 'at_triage' | 'waiting_for_doctor';
  // Default 'completed' for historicals; today's encounter may have other states.
};

export type SeedLabResult = {
  canonical_key: string;     // 'hba1c', 'hemoglobin', 'ldl_cholesterol'
  display_name: string;
  value_numeric?: number;
  value_text?: string;
  unit: string;
  reference_range: string;
  is_critical?: boolean;
};

export type SeedLabCycle = {
  date: string;
  ordering_doctor_email: string;
  link_to_encounter_date?: string;       // join hint
  orders: Array<{
    raw_text: string;
    canonical_key: string;
    display_name: string;
  }>;
  results: SeedLabResult[];
};

export type SeedOverride = {
  date: string;
  doctor_email: string;
  target_kind: 'problem' | 'allergy' | 'cc_chip';
  target_key: string;
  action: 'edit' | 'dismiss' | 'add';
  payload?: { label?: string; status?: string; note?: string };
};

export type SeedActiveProblem = {
  label: string;
  since: string;        // ISO YYYY-MM
  status: 'active' | 'controlled' | 'resolved';
  current_meds?: string[];
  source_encounters?: string[]; // optional anchor list of ENC-… numbers
};

export type SeedPatient = {
  mrn: string;
  name: string;
  age_years: number;
  sex: 'M' | 'F' | 'O';
  phone_e164: string;
  known_allergies: string | null;
  occupation?: string;
  area?: string;
  // The patient's primary doctor today (drives initial room assignment).
  primary_doctor_email: string;
  active_problems: SeedActiveProblem[];
  encounters: SeedEncounter[];
  lab_cycles: SeedLabCycle[];
  override_events: SeedOverride[];
  // If true, this patient is an existing one from v1's seed — the seed
  // runner SKIPs inserting them as new (uses ON CONFLICT MRN) and only
  // backfills their history.
  existing_in_v1?: boolean;
};
