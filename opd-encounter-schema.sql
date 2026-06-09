-- =====================================================================
-- OPD Encounter App — Schema v1.0
-- Target: Postgres 15+ (Neon-compatible)
-- Companion to: OPD-ENCOUNTER-APP-DESIGN.md
-- Generated: 2026-05-17
-- =====================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================================
-- ENUMS
-- =====================================================================

CREATE TYPE encounter_status AS ENUM ('active','paused_diagnostics','ready_to_resume','completed','abandoned');
CREATE TYPE disposition_kind AS ENUM ('discharge','follow_up','refer','diagnostics','admit','vaccinate');
CREATE TYPE drug_schedule AS ENUM ('OTC','H','H1','X','G','K','Biological');
CREATE TYPE ved_tier AS ENUM ('V','E','D');
CREATE TYPE transcription_status AS ENUM ('pending','transcribing','complete','failed');
CREATE TYPE whatsapp_delivery_status AS ENUM ('queued','sent','delivered','failed','undeliverable');
CREATE TYPE drug_default_source AS ENUM ('hardcoded','qwen_drafted','v_approved','learned');
CREATE TYPE confidence_level AS ENUM ('high','medium','low');
CREATE TYPE encounter_section AS ENUM ('chief_complaint','exam_findings','assessment','prescription','disposition_notes');
CREATE TYPE pulse_event_kind AS ENUM ('patient_arrived','patient_registered','diagnostic_ordered','diagnostic_completed','patient_left','patient_updated');
CREATE TYPE outbound_event_kind AS ENUM ('encounter_started','encounter_paused','encounter_resumed','encounter_completed','prescription_issued');

-- =====================================================================
-- IDENTITY
-- =====================================================================

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn TEXT NOT NULL UNIQUE,
  pulse_patient_id TEXT UNIQUE,
  name TEXT NOT NULL,
  date_of_birth DATE,
  age_years INT,
  sex CHAR(1) CHECK (sex IN ('M','F','O')),
  phone_e164 TEXT,
  whatsapp_opt_in BOOLEAN DEFAULT TRUE,
  known_allergies TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_patients_mrn ON patients(mrn) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_pulse_id ON patients(pulse_patient_id) WHERE pulse_patient_id IS NOT NULL;

CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  qualification TEXT,
  mci_registration_number TEXT NOT NULL,
  specialty TEXT,
  signature_blob_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- DRUG MASTER (cached from Even Pharmacy Formulary 2026)
-- =====================================================================

CREATE TABLE drug_master (
  item_code TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  generic_name TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  strength TEXT,
  major_grouping TEXT NOT NULL,
  minor_grouping TEXT,
  manufacturer TEXT,
  schedule_dc drug_schedule NOT NULL,
  schedule_ip TEXT,
  dept_primary TEXT NOT NULL,
  dept_secondary TEXT,
  is_high_risk BOOLEAN NOT NULL DEFAULT FALSE,
  lasa_alternates TEXT[],
  ved_tier ved_tier NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_sheet_row INT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drug_master_brand_trgm ON drug_master USING gin (brand_name gin_trgm_ops);
CREATE INDEX idx_drug_master_generic_trgm ON drug_master USING gin (generic_name gin_trgm_ops);
CREATE INDEX idx_drug_master_dept ON drug_master(dept_primary) WHERE active;
CREATE INDEX idx_drug_master_schedule ON drug_master(schedule_dc) WHERE active;

CREATE TABLE drug_defaults_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT NOT NULL REFERENCES drug_master(item_code),
  draft_payload JSONB NOT NULL,
  qwen_reasoning TEXT,
  qwen_confidence confidence_level,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','edited','skipped')),
  reviewed_by UUID REFERENCES doctors(id),
  reviewed_at TIMESTAMPTZ,
  final_payload JSONB,
  drafted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_code)
);

CREATE TABLE drug_defaults (
  item_code TEXT PRIMARY KEY REFERENCES drug_master(item_code),
  default_frequency TEXT NOT NULL,
  default_duration_days INT,
  default_timing TEXT,
  default_instructions TEXT,
  default_route TEXT NOT NULL DEFAULT 'oral',
  source drug_default_source NOT NULL,
  confidence confidence_level NOT NULL,
  approved_by UUID REFERENCES doctors(id),
  approved_at TIMESTAMPTZ,
  qwen_reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- ENCOUNTERS
-- =====================================================================

CREATE TABLE encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_number TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  encounter_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status encounter_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_duration_seconds INT,
  paused_reason TEXT,
  pending_diagnostic_test TEXT,
  pending_diagnostic_notes TEXT,
  chief_complaint_chips TEXT[],
  chief_complaint_text TEXT,
  vitals JSONB,
  exam_findings TEXT,
  assessment_codes TEXT[],
  assessment_text TEXT,
  disposition disposition_kind,
  follow_up_days INT,
  referral_target TEXT,
  diagnostic_orders JSONB,
  admit_target TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_encounters_doctor_date ON encounters(doctor_id, encounter_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_encounters_patient ON encounters(patient_id, encounter_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_encounters_status ON encounters(status) WHERE status != 'completed' AND deleted_at IS NULL;

-- =====================================================================
-- RECORDINGS
-- =====================================================================

CREATE TABLE encounter_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  recording_session_id UUID NOT NULL,
  snippet_index INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  audio_blob_prefix TEXT,
  chunk_count INT NOT NULL DEFAULT 0,
  bytes_total BIGINT,
  transcript_status transcription_status NOT NULL DEFAULT 'pending',
  transcript_text TEXT,
  transcript_segments JSONB,
  speaker_map JSONB,
  transcribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (encounter_id, snippet_index)
);
CREATE INDEX idx_recordings_encounter ON encounter_recordings(encounter_id);
CREATE INDEX idx_recordings_session ON encounter_recordings(recording_session_id);

CREATE TABLE encounter_recording_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES encounter_recordings(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  blob_url TEXT NOT NULL,
  bytes INT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'audio/webm',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recording_id, chunk_index)
);
CREATE INDEX idx_chunks_recording ON encounter_recording_chunks(recording_id, chunk_index);

CREATE TABLE section_dictations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  section encounter_section NOT NULL,
  audio_blob_url TEXT NOT NULL,
  duration_seconds INT NOT NULL,
  transcript_text TEXT,
  transcript_status transcription_status NOT NULL DEFAULT 'pending',
  transcribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dictations_encounter ON section_dictations(encounter_id, section);

-- =====================================================================
-- PRESCRIPTIONS
-- =====================================================================

CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id) UNIQUE,
  prescription_number TEXT NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_blob_url TEXT,
  patient_whatsapp_status whatsapp_delivery_status NOT NULL DEFAULT 'queued',
  patient_whatsapp_message_sid TEXT,
  patient_whatsapp_attempted_at TIMESTAMPTZ,
  patient_whatsapp_delivered_at TIMESTAMPTZ,
  patient_whatsapp_error TEXT,
  pharmacy_whatsapp_status whatsapp_delivery_status NOT NULL DEFAULT 'queued',
  pharmacy_whatsapp_message_sid TEXT,
  pharmacy_whatsapp_attempted_at TIMESTAMPTZ,
  pharmacy_whatsapp_delivered_at TIMESTAMPTZ,
  pharmacy_whatsapp_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_prescriptions_number ON prescriptions(prescription_number);
CREATE INDEX idx_prescriptions_patient_status ON prescriptions(patient_whatsapp_status) WHERE patient_whatsapp_status IN ('queued','failed');
CREATE INDEX idx_prescriptions_pharmacy_status ON prescriptions(pharmacy_whatsapp_status) WHERE pharmacy_whatsapp_status IN ('queued','failed');

CREATE TABLE prescription_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  line_order INT NOT NULL,
  item_code TEXT NOT NULL REFERENCES drug_master(item_code),
  drug_name_snapshot TEXT NOT NULL,
  generic_snapshot TEXT NOT NULL,
  strength_snapshot TEXT,
  schedule_snapshot drug_schedule NOT NULL,
  is_high_risk_snapshot BOOLEAN NOT NULL,
  frequency TEXT NOT NULL,
  duration_days INT,
  timing TEXT,
  instructions TEXT,
  route TEXT NOT NULL DEFAULT 'oral',
  lasa_warning_shown BOOLEAN NOT NULL DEFAULT FALSE,
  lasa_confirmed_by_doctor BOOLEAN,
  input_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prescription_id, line_order)
);
CREATE INDEX idx_rx_lines_prescription ON prescription_lines(prescription_id, line_order);
CREATE INDEX idx_rx_lines_item ON prescription_lines(item_code);

CREATE TABLE drug_default_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  item_code TEXT NOT NULL REFERENCES drug_master(item_code),
  field_changed TEXT NOT NULL,
  original_value TEXT,
  new_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_overrides_drug ON drug_default_overrides(item_code, created_at DESC);
CREATE INDEX idx_overrides_doctor ON drug_default_overrides(doctor_id, item_code);

-- =====================================================================
-- AUDIT & INTEGRATION
-- =====================================================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID REFERENCES doctors(id),
  encounter_id UUID REFERENCES encounters(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_doctor_time ON audit_log(doctor_id, created_at DESC);
CREATE INDEX idx_audit_encounter ON audit_log(encounter_id, created_at);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);

CREATE TABLE pulse_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type pulse_event_kind NOT NULL,
  patient_pulse_id TEXT,
  patient_id UUID REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  process_status TEXT NOT NULL DEFAULT 'received'
    CHECK (process_status IN ('received','processed','failed')),
  process_error TEXT
);
CREATE INDEX idx_pulse_events_pending ON pulse_events(process_status, received_at) WHERE process_status = 'received';
CREATE INDEX idx_pulse_events_patient ON pulse_events(patient_pulse_id, received_at DESC);

CREATE TABLE outbound_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type outbound_event_kind NOT NULL,
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  payload JSONB NOT NULL,
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','emitted','acknowledged','failed')),
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX idx_outbound_pending ON outbound_events(status, emitted_at) WHERE status IN ('pending','emitted');
CREATE INDEX idx_outbound_encounter ON outbound_events(encounter_id);

-- =====================================================================
-- TRIGGERS
-- =====================================================================

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_patients_updated BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_doctors_updated BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_drug_master_updated BEFORE UPDATE ON drug_master FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_drug_defaults_updated BEFORE UPDATE ON drug_defaults FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_encounters_updated BEFORE UPDATE ON encounters FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_recordings_updated BEFORE UPDATE ON encounter_recordings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_prescriptions_updated BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
