-- =====================================================================
-- OPD Encounter App — DEMO Schema v0.1
-- Target: Postgres 15+ (Neon-compatible)
-- 
-- SANDBOX-ONLY — NOT production-shaped
-- Companion to: OPD-ENCOUNTER-APP-DESIGN.md (Section 6A)
-- 
-- Trimmed from the production schema (15 tables) to get a working demo
-- running fast. Migration to production is additive — every table here
-- exists in the production schema with extra columns added.
-- 
-- Generated: 2026-05-17
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enums (4 — kept only the ones that drive UI state)
CREATE TYPE encounter_status AS ENUM ('active','paused_diagnostics','ready_to_resume','completed');
CREATE TYPE disposition_kind AS ENUM ('discharge','follow_up','refer','diagnostics','admit','vaccinate');
CREATE TYPE drug_schedule AS ENUM ('OTC','H','H1','X');
CREATE TYPE transcription_status AS ENUM ('pending','complete','failed');

-- Identity
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  age_years INT NOT NULL,
  sex CHAR(1) CHECK (sex IN ('M','F','O')),
  phone_e164 TEXT,
  known_allergies TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  mci_registration_number TEXT NOT NULL,
  signature_blob_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drug master with defaults folded in
CREATE TABLE drug_master (
  item_code TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  generic_name TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  strength TEXT,
  major_grouping TEXT NOT NULL,
  schedule_dc drug_schedule NOT NULL,
  is_high_risk BOOLEAN NOT NULL DEFAULT FALSE,
  lasa_alternates TEXT[],
  default_frequency TEXT,
  default_duration_days INT,
  default_timing TEXT,
  default_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drug_brand_trgm ON drug_master USING gin (brand_name gin_trgm_ops);
CREATE INDEX idx_drug_generic_trgm ON drug_master USING gin (generic_name gin_trgm_ops);

-- Encounters
CREATE TABLE encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_number TEXT UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  encounter_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status encounter_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  paused_reason TEXT,
  pending_diagnostic_test TEXT,
  chief_complaint_chips TEXT[],
  chief_complaint_text TEXT,
  vitals JSONB,
  exam_findings TEXT,
  assessment_codes TEXT[],
  assessment_text TEXT,
  disposition disposition_kind,
  follow_up_days INT,
  referral_target TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_encounters_doctor_date ON encounters(doctor_id, encounter_date);
CREATE INDEX idx_encounters_status ON encounters(status) WHERE status != 'completed';

-- Recordings
CREATE TABLE encounter_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  recording_session_id UUID NOT NULL,
  snippet_index INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  transcript_status transcription_status NOT NULL DEFAULT 'pending',
  transcript_text TEXT,
  UNIQUE (encounter_id, snippet_index)
);

CREATE TABLE encounter_recording_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES encounter_recordings(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  blob_url TEXT NOT NULL,
  bytes INT NOT NULL,
  UNIQUE (recording_id, chunk_index)
);

CREATE TABLE section_dictations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  section TEXT NOT NULL,
  audio_blob_url TEXT NOT NULL,
  duration_seconds INT NOT NULL,
  transcript_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prescriptions
CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id) UNIQUE,
  prescription_number TEXT UNIQUE NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_blob_url TEXT,
  lines JSONB NOT NULL,
  patient_sent_at TIMESTAMPTZ,
  pharmacy_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
