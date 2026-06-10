/**
 * Inline migration registry — same pattern as EHRC-Daily-Dash.
 *
 * Why inline (not separate .sql files):
 *   - bundles cleanly into a Vercel serverless function with no extra
 *     filesystem reads
 *   - keeps the migration version + name + SQL in one place that diffs
 *     cleanly in PRs
 *   - the runner at /api/run-migrations applies any unapplied versions
 *     in order, idempotently
 *
 * Rules for new migrations:
 *   1. Append to the end of MIGRATIONS. Never reuse a version number.
 *   2. Prefer IF NOT EXISTS on tables and indexes. Use DO blocks for
 *      enums and other non-idempotent DDL.
 *   3. Each migration runs inside its own transaction. Failures roll back.
 *   4. Statements split on `;` outside dollar-quoted (`$$ … $$`) blocks.
 */

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const MIGRATIONS: Migration[] = [
  {
    version: 0,
    name: 'init_schema_migrations',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    version: 1,
    name: 'opd_demo_schema',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      DO $do$ BEGIN
        CREATE TYPE encounter_status AS ENUM ('active','paused_diagnostics','ready_to_resume','completed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $do$;

      DO $do$ BEGIN
        CREATE TYPE disposition_kind AS ENUM ('discharge','follow_up','refer','diagnostics','admit','vaccinate');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $do$;

      DO $do$ BEGIN
        CREATE TYPE drug_schedule AS ENUM ('OTC','H','H1','X');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $do$;

      DO $do$ BEGIN
        CREATE TYPE transcription_status AS ENUM ('pending','complete','failed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $do$;

      CREATE TABLE IF NOT EXISTS patients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mrn TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        age_years INT NOT NULL,
        sex CHAR(1) CHECK (sex IN ('M','F','O')),
        phone_e164 TEXT,
        known_allergies TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS doctors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        mci_registration_number TEXT NOT NULL,
        signature_blob_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS drug_master (
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
      CREATE INDEX IF NOT EXISTS idx_drug_brand_trgm ON drug_master USING gin (brand_name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_drug_generic_trgm ON drug_master USING gin (generic_name gin_trgm_ops);

      CREATE TABLE IF NOT EXISTS encounters (
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
      CREATE INDEX IF NOT EXISTS idx_encounters_doctor_date ON encounters(doctor_id, encounter_date);
      CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(status) WHERE status != 'completed';

      CREATE TABLE IF NOT EXISTS encounter_recordings (
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

      CREATE TABLE IF NOT EXISTS encounter_recording_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recording_id UUID NOT NULL REFERENCES encounter_recordings(id) ON DELETE CASCADE,
        chunk_index INT NOT NULL,
        blob_url TEXT NOT NULL,
        bytes INT NOT NULL,
        UNIQUE (recording_id, chunk_index)
      );

      CREATE TABLE IF NOT EXISTS section_dictations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id UUID NOT NULL REFERENCES encounters(id),
        section TEXT NOT NULL,
        audio_blob_url TEXT NOT NULL,
        duration_seconds INT NOT NULL,
        transcript_text TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS prescriptions (
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
    `,
  },
  {
    version: 2,
    name: 'seed_doctor_v',
    sql: `
      -- Seed V into the doctors table so the magic-link allowlist can move
      -- from env-var to a real DB row. Idempotent — re-running the
      -- migration won't duplicate.
      INSERT INTO doctors (email, name, mci_registration_number)
      VALUES ('vinay.bhardwaj@even.in', 'Dr. Vinay Bhardwaj', 'DEMO-MCI-001')
      ON CONFLICT (email) DO NOTHING;
    `,
  },
  {
    version: 3,
    name: 'seed_patients_and_today_encounters',
    sql: `
      -- 25 patients (Bangalore-area realistic name mix) + today's queue.
      -- Distribution: 8 waiting (no encounter row), 3 paused_diagnostics,
      -- 2 ready_to_resume, 12 completed = 17 encounter rows today.
      --
      -- Patient phone numbers are clearly fake (+91 9876543201..225) so
      -- nothing tries to dial them from the demo.

      INSERT INTO patients (mrn, name, age_years, sex, phone_e164, known_allergies) VALUES
        ('EHRC-2026-001', 'Priya Ramesh',       28, 'F', '+919876543201', NULL),
        ('EHRC-2026-002', 'Rajesh Kumar',       45, 'M', '+919876543202', 'Penicillin'),
        ('EHRC-2026-003', 'Lakshmi Iyer',       62, 'F', '+919876543203', NULL),
        ('EHRC-2026-004', 'Karthik Subramanian',35, 'M', '+919876543204', NULL),
        ('EHRC-2026-005', 'Anita Sharma',       38, 'F', '+919876543205', 'Sulfa drugs'),
        ('EHRC-2026-006', 'Vikram Singh',       52, 'M', '+919876543206', NULL),
        ('EHRC-2026-007', 'Meera Pillai',       29, 'F', '+919876543207', NULL),
        ('EHRC-2026-008', 'Suresh Reddy',       58, 'M', '+919876543208', 'Aspirin'),
        ('EHRC-2026-009', 'Deepika Nair',       31, 'F', '+919876543209', NULL),
        ('EHRC-2026-010', 'Arjun Murthy',       42, 'M', '+919876543210', NULL),
        ('EHRC-2026-011', 'Sunita Krishnan',    49, 'F', '+919876543211', NULL),
        ('EHRC-2026-012', 'Mohan Rao',          66, 'M', '+919876543212', 'Iodine contrast'),
        ('EHRC-2026-013', 'Kavya Bhat',         24, 'F', '+919876543213', NULL),
        ('EHRC-2026-014', 'Rohan Mehta',        37, 'M', '+919876543214', NULL),
        ('EHRC-2026-015', 'Geetha Prasad',      55, 'F', '+919876543215', NULL),
        ('EHRC-2026-016', 'Naveen Gowda',       33, 'M', '+919876543216', NULL),
        ('EHRC-2026-017', 'Aishwarya Rao',      27, 'F', '+919876543217', NULL),
        ('EHRC-2026-018', 'Prakash Hegde',      61, 'M', '+919876543218', NULL),
        ('EHRC-2026-019', 'Divya Joshi',        40, 'F', '+919876543219', NULL),
        ('EHRC-2026-020', 'Sandeep Patel',      44, 'M', '+919876543220', NULL),
        ('EHRC-2026-021', 'Shobha Kumari',      34, 'F', '+919876543221', NULL),
        ('EHRC-2026-022', 'Ravi Shankar',       53, 'M', '+919876543222', NULL),
        ('EHRC-2026-023', 'Pooja Shenoy',       32, 'F', '+919876543223', NULL),
        ('EHRC-2026-024', 'Manoj Verma',        47, 'M', '+919876543224', NULL),
        ('EHRC-2026-025', 'Asha Pai',           26, 'F', '+919876543225', NULL)
      ON CONFLICT (mrn) DO NOTHING;

      -- 12 completed today, 3 paused for diagnostics, 2 ready_to_resume.
      -- 8 patients (EHRC-2026-018..025) are intentionally left without
      -- encounters so they show as "Waiting" in the queue.

      INSERT INTO encounters (
        encounter_number, patient_id, doctor_id, encounter_date,
        status, started_at, completed_at, paused_reason, pending_diagnostic_test,
        chief_complaint_text, exam_findings, assessment_text,
        disposition, follow_up_days
      )
      SELECT
        v.enc_no,
        p.id,
        d.id,
        CURRENT_DATE,
        v.status::encounter_status,
        v.started_at,
        v.completed_at,
        v.paused_reason,
        v.pending_diagnostic_test,
        v.cc,
        v.exam,
        v.assessment,
        NULLIF(v.disposition, '')::disposition_kind,
        v.follow_up_days
      FROM (VALUES
        -- COMPLETED (12)
        ('ENC-20260518-001', 'EHRC-2026-001', 'completed'::text, NOW() - INTERVAL '3h 30m', NOW() - INTERVAL '3h 18m', NULL::text, NULL::text, 'Sore throat 3 days, low-grade fever',                'Mildly inflamed pharynx, no exudate, afebrile on exam',           'Acute pharyngitis, likely viral',                          'discharge'::text, NULL::int),
        ('ENC-20260518-002', 'EHRC-2026-002', 'completed', NOW() - INTERVAL '3h 15m', NOW() - INTERVAL '2h 50m', NULL, NULL, 'Hypertension follow-up, BP 148/92 home readings',           'BP 144/88 in clinic, HR 76 regular, no edema',                    'Essential HTN — sub-optimal control on current regimen',   'follow_up',     14),
        ('ENC-20260518-003', 'EHRC-2026-003', 'completed', NOW() - INTERVAL '2h 55m', NOW() - INTERVAL '2h 38m', NULL, NULL, 'Knee pain x 2 weeks, worse on stairs',                       'Crepitus right knee, no effusion, ROM 0-110 painful at extreme',  'Right knee osteoarthritis',                                'refer',         NULL),
        ('ENC-20260518-004', 'EHRC-2026-004', 'completed', NOW() - INTERVAL '2h 40m', NOW() - INTERVAL '2h 28m', NULL, NULL, 'Annual check-up, no complaints',                             'Unremarkable. BP 122/78, BMI 24.6.',                              'Healthy adult, due for routine bloods',                    'discharge',     NULL),
        ('ENC-20260518-005', 'EHRC-2026-005', 'completed', NOW() - INTERVAL '2h 25m', NOW() - INTERVAL '2h 10m', NULL, NULL, 'Migraine recurrence, 2nd episode this month',                'Neuro grossly intact, no focal deficit, no nuchal rigidity',      'Migraine without aura',                                    'follow_up',     30),
        ('ENC-20260518-006', 'EHRC-2026-006', 'completed', NOW() - INTERVAL '2h 10m', NOW() - INTERVAL '1h 55m', NULL, NULL, 'Type 2 DM review, fasting BSL 162',                          'Feet exam normal, no ulcers, dorsalis pedis pulses palpable',     'T2DM — fair control, HbA1c due',                           'follow_up',     30),
        ('ENC-20260518-007', 'EHRC-2026-007', 'completed', NOW() - INTERVAL '1h 55m', NOW() - INTERVAL '1h 40m', NULL, NULL, 'Acid reflux, worse at night',                                'Soft non-tender abdomen, no organomegaly',                        'GERD',                                                     'discharge',     NULL),
        ('ENC-20260518-008', 'EHRC-2026-008', 'completed', NOW() - INTERVAL '1h 40m', NOW() - INTERVAL '1h 22m', NULL, NULL, 'Chest discomfort on exertion, x 5 days',                     'BP 152/90, HR 88, S1S2 normal, no murmur, lungs clear',           'Suspected stable angina — for cardiology referral',        'refer',         NULL),
        ('ENC-20260518-009', 'EHRC-2026-009', 'completed', NOW() - INTERVAL '1h 25m', NOW() - INTERVAL '1h 12m', NULL, NULL, 'UTI symptoms x 2 days',                                       'No costovertebral angle tenderness, suprapubic mild',             'Uncomplicated lower UTI',                                  'discharge',     NULL),
        ('ENC-20260518-010', 'EHRC-2026-010', 'completed', NOW() - INTERVAL '1h 10m', NOW() - INTERVAL '58m',    NULL, NULL, 'Back pain after lifting, x 4 days',                          'Para-spinal muscle tenderness L4-L5, SLR negative bilaterally',   'Mechanical low back pain',                                 'discharge',     NULL),
        ('ENC-20260518-011', 'EHRC-2026-011', 'completed', NOW() - INTERVAL '55m',    NOW() - INTERVAL '42m',    NULL, NULL, 'Allergic rhinitis flare, sneezing + post-nasal drip',         'Nasal mucosa pale and boggy, no sinus tenderness',                'Allergic rhinitis',                                        'discharge',     NULL),
        ('ENC-20260518-012', 'EHRC-2026-012', 'completed', NOW() - INTERVAL '40m',    NOW() - INTERVAL '28m',    NULL, NULL, 'Routine BP + diabetes review',                                'BP 138/82, weight stable, no edema',                              'HTN + T2DM, both well-controlled',                         'follow_up',     90),

        -- PAUSED for diagnostics (3) — disposition empty, completed_at NULL
        ('ENC-20260518-013', 'EHRC-2026-013', 'paused_diagnostics'::text, NOW() - INTERVAL '35m', NULL, 'diagnostics'::text, 'Chest x-ray'::text,         'Cough + low-grade fever x 6 days',                'Right lower zone crackles, RR 22, SpO2 97%',                'Suspected pneumonia — awaiting CXR',                       ''::text, NULL::int),
        ('ENC-20260518-014', 'EHRC-2026-014', 'paused_diagnostics',       NOW() - INTERVAL '28m', NULL, 'diagnostics',       'ECG',                       'Palpitations + occasional dizziness, x 2 weeks',  'BP 130/82, HR 92 irregular, no S3/S4',                       'R/o arrhythmia — awaiting ECG',                            '',       NULL),
        ('ENC-20260518-015', 'EHRC-2026-015', 'paused_diagnostics',       NOW() - INTERVAL '20m', NULL, 'diagnostics',       'USG abdomen',               'RUQ pain + nausea, fatty food intolerance, x 1mo','Mild RUQ tenderness, no rebound, Murphy negative',           'R/o cholelithiasis — awaiting USG',                        '',       NULL),

        -- READY TO RESUME (2) — same shape as paused but the test is back
        ('ENC-20260518-016', 'EHRC-2026-016', 'ready_to_resume'::text, NOW() - INTERVAL '1h 5m', NULL, 'diagnostics'::text, 'CBC + CRP'::text,   'Fever x 4 days, no localising symptoms', 'Looks well, no rash, no neck stiffness, BP 118/74',  'Pyrexia of unknown origin — workup pending', '', NULL),
        ('ENC-20260518-017', 'EHRC-2026-017', 'ready_to_resume',       NOW() - INTERVAL '50m',   NULL, 'diagnostics',       'Urine routine',     'Burning micturition x 3 days',           'Suprapubic tenderness, no flank tenderness',          'R/o UTI — urine sent',                        '', NULL)
      ) v(enc_no, mrn, status, started_at, completed_at, paused_reason, pending_diagnostic_test, cc, exam, assessment, disposition, follow_up_days)
      JOIN patients p ON p.mrn = v.mrn
      JOIN doctors d ON d.email = 'vinay.bhardwaj@even.in'
      ON CONFLICT (encounter_number) DO NOTHING;
    `,
  },
  {
    version: 4,
    name: 'relax_section_dictation_blob_url',
    sql: `
      -- Sprint 3 lays the section-dictation scaffold (UI + API + DB row).
      -- Real audio capture + Blob upload ship in Sprint 5. Until then a
      -- dictation row can exist with NULL audio_blob_url meaning
      -- "doctor intended to dictate here, no audio yet."
      ALTER TABLE section_dictations
        ALTER COLUMN audio_blob_url DROP NOT NULL;
    `,
  },
  {
    version: 5,
    name: 'patient_summaries',
    sql: `
      -- PH.1: cached Qwen output per patient. One row per patient, one
      -- JSONB blob holding the whole summary. Recomputed post-encounter-
      -- submit + on-demand from /patients/[id].
      CREATE TABLE IF NOT EXISTS patient_summaries (
        patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
        summary JSONB NOT NULL,
        source_encounter_count INT NOT NULL,
        source_window_start DATE NOT NULL,
        source_window_end DATE NOT NULL,
        qwen_model TEXT NOT NULL,
        qwen_latency_ms INT,
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'fresh',
        fail_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_patient_summaries_status
        ON patient_summaries(status) WHERE status != 'fresh';
    `,
  },
  {
    version: 6,
    name: 'qwen_call_audit',
    sql: `
      -- PH.1: per-call audit. Hashes only — no raw PHI in logs (Round 5
      -- decision). Replay debug works by re-running with the same
      -- input window.
      CREATE TABLE IF NOT EXISTS qwen_call_audit (
        id BIGSERIAL PRIMARY KEY,
        patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        doctor_id UUID REFERENCES doctors(id),
        prompt_hash TEXT NOT NULL,
        output_hash TEXT NOT NULL,
        qwen_model TEXT NOT NULL,
        qwen_latency_ms INT,
        result TEXT NOT NULL,
        called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_qwen_call_audit_patient
        ON qwen_call_audit(patient_id, called_at DESC);
    `,
  },
  {
    version: 7,
    name: 'encounters_disposition_label_override',
    sql: `
      -- PH.4: patient-specific disposition labels.
      -- When the doctor picks one of Qwen's net-new disposition_additions
      -- (e.g. "Refer to Dr. Iyer · Cardiology"), the underlying
      -- disposition enum still resolves to one of the 6 standard values
      -- (typically 'refer') but the human-readable label override lets
      -- the PDF + dashboard surface what the doctor actually picked.
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS disposition_label_override TEXT;
    `,
  },
  {
    version: 8,
    name: 'doctor_overrides',
    sql: `
      -- PH.5: per-patient corrections the doctor makes to the AI summary.
      -- These get folded back into the Qwen user-message on the next
      -- recompute so the model honours "this is resolved" / "rename
      -- this problem" / "dismiss this allergy" etc.
      --
      -- target_kind enumerates what was overridden; payload carries the
      -- override-specific fields (jsonb) — keeps the schema small while
      -- still being queryable per kind.
      CREATE TABLE IF NOT EXISTS doctor_overrides (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        doctor_id UUID REFERENCES doctors(id),
        target_kind TEXT NOT NULL,        -- 'problem' | 'allergy' | 'cc_chip'
        target_key TEXT NOT NULL,         -- label/text identifying the target
        action TEXT NOT NULL,             -- 'edit' | 'dismiss' | 'add'
        payload JSONB,                    -- { label?, status?, note?, ... }
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_doctor_overrides_patient
        ON doctor_overrides(patient_id, target_kind);
    `,
  },
  {
    version: 9,
    name: 'users_role_column',
    sql: `
      -- v2.0.0: the doctors table now holds all staff roles. Name kept
      -- as 'doctors' for pragmatic reasons (avoids touching every
      -- existing query); semantically it's the users table.
      ALTER TABLE doctors
        ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'doctor'
        CHECK (role IN ('doctor','nurse','cce','lab_tech','admin'));
      CREATE INDEX IF NOT EXISTS idx_doctors_role ON doctors(role);
    `,
  },
  {
    version: 10,
    name: 'encounter_status_extended',
    sql: `
      -- v2.0.0: add three pre-doctor states for the CCE / Triage flow.
      -- Order matters semantically: registered → at_triage → waiting_for_doctor → active.
      ALTER TYPE encounter_status ADD VALUE IF NOT EXISTS 'registered';
      ALTER TYPE encounter_status ADD VALUE IF NOT EXISTS 'at_triage';
      ALTER TYPE encounter_status ADD VALUE IF NOT EXISTS 'waiting_for_doctor';
    `,
  },
  {
    version: 11,
    name: 'opd_rooms',
    sql: `
      -- v2.0.0: physical OPD rooms with a default doctor. CCE assigns
      -- patients to rooms; the room's default doctor owns the queue.
      -- Admin can swap default_doctor_id when shifts change.
      CREATE TABLE IF NOT EXISTS opd_rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT UNIQUE NOT NULL,
        floor TEXT,
        default_doctor_id UUID REFERENCES doctors(id),
        specialty TEXT,                  -- 'Neurology', 'Internal Medicine', ...
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_opd_rooms_active ON opd_rooms(active);
    `,
  },
  {
    version: 12,
    name: 'encounters_v2_columns',
    sql: `
      -- v2.0.0: encounter gains room assignment, CCE-captured visit
      -- reason, a day-of token (defaults to MRN per Round 2 decision),
      -- and triage attribution. doctor_id stays as the encounter's
      -- primary doctor (resolved from room.default_doctor at registration).
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES opd_rooms(id),
        ADD COLUMN IF NOT EXISTS intake_visit_reason TEXT,
        ADD COLUMN IF NOT EXISTS token_number TEXT,
        ADD COLUMN IF NOT EXISTS triage_nurse_id UUID REFERENCES doctors(id),
        ADD COLUMN IF NOT EXISTS triage_completed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS registered_by_cce_id UUID REFERENCES doctors(id),
        ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_encounters_room_status
        ON encounters(room_id, status) WHERE status != 'completed';
    `,
  },
  {
    version: 13,
    name: 'lab_orders_and_results',
    sql: `
      -- v2.1: free-text orders, Qwen-normalized canonical_key. No lab
      -- catalog table per Round 4 decision. Trending works on
      -- lab_results.canonical_key + patient_id.
      CREATE TABLE IF NOT EXISTS lab_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        ordering_doctor_id UUID NOT NULL REFERENCES doctors(id),
        raw_text TEXT NOT NULL,
        canonical_key TEXT,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','in_progress','resulted','cancelled')),
        ordered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resulted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id, ordered_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(status) WHERE status != 'resulted';

      CREATE TABLE IF NOT EXISTS lab_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lab_order_id UUID REFERENCES lab_orders(id) ON DELETE SET NULL,
        patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        canonical_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        value_numeric NUMERIC,
        value_text TEXT,
        unit TEXT,
        reference_range TEXT,
        is_critical BOOLEAN NOT NULL DEFAULT FALSE,
        source_pdf_url TEXT,
        entered_by UUID REFERENCES doctors(id),
        entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lab_results_patient_key
        ON lab_results(patient_id, canonical_key, entered_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lab_results_critical
        ON lab_results(patient_id, is_critical) WHERE is_critical = TRUE;
    `,
  },
  {
    version: 14,
    name: 'encounter_handoff_columns',
    sql: `
      -- v2.3: cross-doctor handoff notes. Set on encounter completion;
      -- shown as a pinned banner on the patient's next encounter open
      -- across any doctor; auto-dismisses when next doctor ack'd.
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS handoff_note TEXT,
        ADD COLUMN IF NOT EXISTS handoff_ack_by UUID REFERENCES doctors(id),
        ADD COLUMN IF NOT EXISTS handoff_ack_at TIMESTAMPTZ;
    `,
  },
  {
    version: 15,
    name: 'encounter_ddi_findings',
    sql: `
      -- v2.2: DDI scan results persist on the encounter for audit + UI rehydration.
      -- Shape: [{ severity, pair: [a,b], rationale, scanned_at }, ...]
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ddi_findings JSONB;
    `,
  },
  {
    version: 16,
    name: 'invite_tokens',
    sql: `
      -- v2.0.1: admin-generated invite tokens for the magic-link signup flow.
      -- An admin pre-stages a user's email + role at /admin/users; the system
      -- emails them a link to /auth/signup?invite=<token>. Accepting the link
      -- INSERTs a row into doctors with the staged role + logs accepted_at.
      --
      -- token is a 32-byte hex string. UNIQUE so URLs can't be guessed.
      -- expires_at defaults to NOW() + 7 days; accept_token() refuses
      -- expired or already-accepted invites.
      CREATE TABLE IF NOT EXISTS invite_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL
          CHECK (role IN ('doctor','nurse','cce','lab_tech','admin')),
        created_by UUID REFERENCES doctors(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        accepted_user_id UUID REFERENCES doctors(id)
      );
      CREATE INDEX IF NOT EXISTS idx_invite_tokens_email ON invite_tokens(lower(email));
      CREATE INDEX IF NOT EXISTS idx_invite_tokens_pending
        ON invite_tokens(expires_at) WHERE accepted_at IS NULL;
    `,
  },
  {
    version: 17,
    name: 'users_deactivated_at',
    sql: `
      -- v2.0.2: admin can deactivate users (e.g. resigned staff) without
      -- losing their historical attribution on encounters / overrides /
      -- audit rows. deactivated_at non-NULL means the user can no longer
      -- sign in.
      ALTER TABLE doctors
        ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_doctors_active
        ON doctors(role) WHERE deactivated_at IS NULL;
    `,
  },
  {
    version: 18,
    name: 'seed_admin_user',
    sql: `
      -- v2.0.2: ensure at least one admin user exists for /admin gate.
      -- V (vinay.bhardwaj@even.in) keeps role='doctor' for clinical
      -- workflow; the admin row is a separate identity.
      INSERT INTO doctors (email, name, mci_registration_number, role)
      VALUES ('admin@even.in', 'Admin', 'EH-EMP-ADMIN-001', 'admin')
      ON CONFLICT (email) DO UPDATE SET role = 'admin';
    `,
  },
  {
    version: 19,
    name: 'lab_orders_v21_extensions',
    sql: `
      -- v2.1.1: Lab Workstation extensions on top of v13's lab_orders/lab_results.
      --
      -- Three things change:
      --   1. CCE can pre-stage labs before the doctor sees the patient
      --      (Round-extra decision: "Doctor + CCE"). pre_staged_by_cce_id
      --      records who, and a new 'pre_staged' status keeps these out of
      --      the lab tech's inbox until the doctor confirms ("Send to lab"
      --      flips pre_staged → pending and atomically pauses the encounter).
      --   2. ordering_doctor_id becomes nullable because a pre_staged
      --      order may not have a confirmed doctor yet (the row gets
      --      stamped with the doctor's id on confirm).
      --   3. Qwen vision auto-post flow needs to remember extraction
      --      confidence + raw response so the tech UI can show why we
      --      auto-posted (or didn't) and the audit trail keeps the raw
      --      JSON for later debugging.

      -- Make ordering_doctor_id nullable (pre_staged orders haven't been
      -- confirmed by a doctor yet).
      ALTER TABLE lab_orders
        ALTER COLUMN ordering_doctor_id DROP NOT NULL;

      -- Track which CCE pre-staged the order, if any.
      ALTER TABLE lab_orders
        ADD COLUMN IF NOT EXISTS pre_staged_by_cce_id UUID
          REFERENCES doctors(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS pre_staged_at TIMESTAMPTZ;

      -- Per-order PDF + Qwen extraction metadata. Lab results live in
      -- the lab_results table; this is order-level provenance.
      ALTER TABLE lab_orders
        ADD COLUMN IF NOT EXISTS source_pdf_url TEXT,
        ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS extraction_confidence NUMERIC,
        ADD COLUMN IF NOT EXISTS extraction_raw JSONB,
        ADD COLUMN IF NOT EXISTS extraction_lab_tech_id UUID
          REFERENCES doctors(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS auto_posted BOOLEAN NOT NULL DEFAULT FALSE;

      -- Extend the status CHECK to allow 'pre_staged'.
      DO $$
      BEGIN
        ALTER TABLE lab_orders DROP CONSTRAINT IF EXISTS lab_orders_status_check;
      EXCEPTION WHEN undefined_object THEN NULL;
      END $$;
      ALTER TABLE lab_orders
        ADD CONSTRAINT lab_orders_status_check
        CHECK (status IN ('pre_staged','pending','in_progress','awaiting_confirmation','resulted','cancelled'));

      -- Index for the lab tech's inbox: anything not pre_staged and not
      -- resulted, ordered FIFO.
      CREATE INDEX IF NOT EXISTS idx_lab_orders_inbox
        ON lab_orders(status, ordered_at)
        WHERE status IN ('pending','in_progress','awaiting_confirmation');

      -- Per-result confidence (from Qwen). Critical for the auto-post
      -- threshold (≥0.9 → auto-post; else edit grid).
      ALTER TABLE lab_results
        ADD COLUMN IF NOT EXISTS confidence_score NUMERIC,
        ADD COLUMN IF NOT EXISTS abnormal_flag TEXT
          CHECK (abnormal_flag IN ('low','high','critical_low','critical_high','normal','unknown'));
    `,
  },
  {
    version: 20,
    name: 'lab_orders_v212_claim_fields',
    sql: `
      -- v2.1.2: soft-claim fields for the /lab workstation.
      --
      -- Why "soft": status (pending → in_progress) is already the
      -- source of truth for actionability. claimed_by_lab_tech_id +
      -- claimed_at give the OTHER techs a "Claimed by Anjali · 2m ago"
      -- banner so they don't double-handle, but a teammate CAN still
      -- open the row and take over if Anjali walks away.
      --
      -- Auto-release isn't in this migration — that's a v2.1.x polish
      -- decision (locked as deferred). For now release is manual or
      -- happens implicitly on status flips that move the row past
      -- in_progress.
      ALTER TABLE lab_orders
        ADD COLUMN IF NOT EXISTS claimed_by_lab_tech_id UUID
          REFERENCES doctors(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

      -- Partial index for "currently claimed" lookups — useful when the
      -- inbox splits "in progress (mine)" from "in progress (others)".
      CREATE INDEX IF NOT EXISTS idx_lab_orders_claimed
        ON lab_orders(claimed_by_lab_tech_id)
        WHERE claimed_by_lab_tech_id IS NOT NULL;
    `,
  },
  {
    version: 21,
    name: 'encounters_ddx_findings',
    sql: `
      -- v2.2.2 — Auto-DDx-on-Submit (PRD Round 5 #12). Mirrors the
      -- v15 ddi_findings column pattern.
      --
      -- Shape:
      --   {
      --     status: 'ok' | 'failed',
      --     findings: [{
      --       condition: string,
      --       likelihood: 'high' | 'medium' | 'low',
      --       rationale: string,
      --       source_encounter_ids: uuid[],   -- past encounters that informed
      --     }],
      --     scanned_at, latency_ms, error?
      --   }
      --
      -- Stays JSONB so we can iterate on shape without migrations. The
      -- DDx is computed once on Submit click and cached so the
      -- confirmation modal renders instantly on subsequent opens.
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ddx_findings JSONB;
    `,
  },
  {
    version: 22,
    name: 'voice_queries',
    sql: `
      -- v2.2.3 — Push-to-talk voice query (PRD Round 5 #11). Stores
      -- transcript + Qwen answer + provenance. NO audio_blob_url —
      -- per lock #14 we keep transcript + answer only to save storage.
      CREATE TABLE IF NOT EXISTS voice_queries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        doctor_id UUID NOT NULL REFERENCES doctors(id),
        question_transcript TEXT NOT NULL,
        answer_text TEXT NOT NULL,
        sources_json JSONB,
        latency_ms INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_voice_queries_encounter
        ON voice_queries(encounter_id, created_at DESC);
    `,
  },
  {
    version: 23,
    name: 'encounters_multi_doctor_handoff',
    sql: `
      -- v2.3 — Multi-doctor handoff (pull model + per-section attribution).
      --
      -- Two new JSONB columns on encounters; no new tables (the data is
      -- cheap to read alongside the encounter row + the shapes can
      -- evolve without migrations).
      --
      -- contributors_json shape:
      --   [
      --     { doctor_id: <uuid>, joined_at: <iso>, via: 'initial' | 'handoff_claim' }
      --   ]
      --   Append-only on each ownership change. First entry is always
      --   the initial doctor; each subsequent claim appends.
      --
      -- section_editors shape:
      --   {
      --     <section_name>: { doctor_id: <uuid>, edited_at: <iso> }
      --   }
      --   Updated by PATCH /api/encounters/[id] for each section
      --   touched in that write. Per-section last-edited-by chip on the
      --   encounter screen reads this map.
      --
      --   Sections tracked:
      --     'chief_complaint' | 'exam_findings' | 'vitals' |
      --     'assessment'      | 'prescription'   | 'disposition'
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS contributors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS section_editors JSONB NOT NULL DEFAULT '{}'::jsonb;

      -- Backfill existing encounters with their initial doctor as the
      -- only contributor. Use the existing doctor_id + started_at as a
      -- reasonable proxy for joined_at.
      UPDATE encounters
      SET contributors_json = jsonb_build_array(
        jsonb_build_object(
          'doctor_id', doctor_id,
          'joined_at', COALESCE(started_at, NOW()),
          'via', 'initial'
        )
      )
      WHERE contributors_json = '[]'::jsonb;
    `,
  },
  {
    version: 24,
    name: 'lab_result_annotations',
    sql: `
      -- Polish #4 — Clinician annotations on posted lab results.
      --
      -- Append-only. The original lab_results row is NEVER edited
      -- (PRD lock: 'add an annotation, never edit the original').
      -- Annotations render inline beneath the value and stay in the
      -- audit trail forever.
      CREATE TABLE IF NOT EXISTS lab_result_annotations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lab_result_id UUID NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
        doctor_id UUID NOT NULL REFERENCES doctors(id),
        note TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lab_result_annotations_result
        ON lab_result_annotations(lab_result_id, created_at DESC);
    `,
  },
  {
    version: 25,
    name: 'v3_diagnostic_foundation',
    sql: `
      -- v3.0 — diagnostic-ordering rebuild FOUNDATION (additive only).
      --
      -- This migration adds every NEW v3 table + the AI suggestion cache
      -- columns on encounters. It does NOT touch lab_orders or any other
      -- v2 table. The v2 lab pipeline keeps working unchanged.
      --
      -- Tables created:
      --   - diagnostic_catalog          (canonical EHRC test catalog,
      --                                  seeded in v3.1 from xlsx)
      --   - diagnostic_bundles          (super-admin curated, seeded v3.4)
      --   - diagnostic_bundle_items     (junction)
      --   - diagnostic_orders           (unified parent — labs + imaging
      --                                  + cardiology + procedure)
      --
      -- Columns added on encounters:
      --   - ai_suggested_orders               JSONB (v3.5a cache)
      --   - ai_suggested_orders_generated_at  TIMESTAMPTZ
      --   - ai_suggested_orders_context_hash  TEXT
      --
      -- The destructive cutover (DROP lab_orders TABLE, replace with
      -- VIEW + INSTEAD OF triggers backfilling into diagnostic_orders
      -- with service_code FK to catalog) is its own migration in
      -- v3.0b — runs AFTER v3.1 (catalog seed) + v3.2 (new ordering UI)
      -- are real-data-tested.

      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      -- 1. diagnostic_catalog ---------------------------------------
      CREATE TABLE IF NOT EXISTS diagnostic_catalog (
        service_code         TEXT PRIMARY KEY,
        display_name         TEXT NOT NULL,
        department           TEXT NOT NULL,
        sub_department       TEXT NOT NULL,
        service_type         TEXT NOT NULL,
        modality             TEXT NOT NULL
          CHECK (modality IN ('lab', 'imaging', 'cardiology', 'procedure')),
        patient_types        TEXT[] NOT NULL DEFAULT '{}',
        is_active            BOOLEAN NOT NULL DEFAULT true,
        is_outsourced        BOOLEAN NOT NULL DEFAULT false,
        schedulable          BOOLEAN NOT NULL DEFAULT false,
        multiple_sittings    BOOLEAN NOT NULL DEFAULT false,
        description          TEXT,
        patient_instructions TEXT,
        synonyms             TEXT[] NOT NULL DEFAULT '{}',
        standard_codes       JSONB NOT NULL DEFAULT '{}'::jsonb,
        tags                 TEXT[] NOT NULL DEFAULT '{}',
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Generated tsvector column for FTS (idempotent add)
      -- Note: Postgres treats to_tsvector(...) AND the 'english'::regconfig
      -- cast as STABLE (not IMMUTABLE) because the registered TS config
      -- could in theory change. GENERATED columns demand IMMUTABLE. The
      -- bulletproof pattern is an IMMUTABLE wrapper function: Postgres
      -- trusts the declared marker at face value.
      CREATE OR REPLACE FUNCTION diagnostic_catalog_search_tsv_immut(
        p_display_name   text,
        p_synonyms       text[],
        p_sub_department text,
        p_description    text
      ) RETURNS tsvector
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $fn$
        SELECT
          setweight(to_tsvector('english'::regconfig, coalesce(p_display_name, '')), 'A') ||
          setweight(to_tsvector('english'::regconfig, coalesce(array_to_string(p_synonyms, ' '), '')), 'B') ||
          setweight(to_tsvector('english'::regconfig, coalesce(p_sub_department, '')), 'C') ||
          setweight(to_tsvector('english'::regconfig, coalesce(p_description, '')), 'D');
      $fn$;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'diagnostic_catalog'
            AND column_name = 'search_tsv'
        ) THEN
          ALTER TABLE diagnostic_catalog
            ADD COLUMN search_tsv tsvector
            GENERATED ALWAYS AS (
              diagnostic_catalog_search_tsv_immut(
                display_name, synonyms, sub_department, description
              )
            ) STORED;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS diagnostic_catalog_tsv_idx
        ON diagnostic_catalog USING GIN (search_tsv);

      -- pg_trgm index on display_name only (simplest IMMUTABLE expression).
      -- Postgres rejects index expressions containing functions that recurse
      -- into STABLE primitives like array_to_string(), even when wrapped in
      -- an IMMUTABLE marker. Synonym trgm-tolerance is acceptable to defer:
      -- synonyms are still FTS-searchable via the search_tsv column with
      -- weight 'B'. A trigger-maintained text column with synonym concat
      -- can be added in v3.2 if doctors complain about synonym typos.
      CREATE INDEX IF NOT EXISTS diagnostic_catalog_trgm_display_idx
        ON diagnostic_catalog
        USING GIN (display_name gin_trgm_ops);

      CREATE INDEX IF NOT EXISTS diagnostic_catalog_modality_active_idx
        ON diagnostic_catalog (modality, is_active);

      CREATE INDEX IF NOT EXISTS diagnostic_catalog_dept_idx
        ON diagnostic_catalog (department, sub_department) WHERE is_active = true;

      -- 2. bundles --------------------------------------------------
      CREATE TABLE IF NOT EXISTS diagnostic_bundles (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                 TEXT NOT NULL UNIQUE,
        description          TEXT,
        specialty_tag        TEXT,
        is_active            BOOLEAN NOT NULL DEFAULT true,
        created_by_doctor_id UUID REFERENCES doctors(id),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS diagnostic_bundle_items (
        bundle_id    UUID NOT NULL REFERENCES diagnostic_bundles(id) ON DELETE CASCADE,
        service_code TEXT NOT NULL REFERENCES diagnostic_catalog(service_code),
        order_n      INTEGER NOT NULL,
        is_optional  BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (bundle_id, service_code)
      );

      CREATE INDEX IF NOT EXISTS diagnostic_bundle_items_bundle_idx
        ON diagnostic_bundle_items (bundle_id, order_n);

      -- 3. diagnostic_orders (unified parent) ----------------------
      CREATE TABLE IF NOT EXISTS diagnostic_orders (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id           UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        service_code           TEXT NOT NULL REFERENCES diagnostic_catalog(service_code),
        modality               TEXT NOT NULL
          CHECK (modality IN ('lab', 'imaging', 'cardiology', 'procedure')),

        -- lifecycle: lab states preserved (pre_staged | ordered | in_progress |
        -- awaiting_confirmation | posted | cancelled), imaging (ordered |
        -- dispatched | completed), procedure (ordered | in_progress | completed)
        status                 TEXT NOT NULL,

        ordered_by_doctor_id   UUID REFERENCES doctors(id),
        ordered_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ordering_actor         TEXT NOT NULL DEFAULT 'doctor'
          CHECK (ordering_actor IN ('cce_prestage', 'doctor', 'auto_bundle', 'ai_suggestion_accepted')),
        source_bundle_id       UUID REFERENCES diagnostic_bundles(id),

        -- lab-specific (mirror v2 lab_orders shape — v3.0b backfill target)
        claimed_by_lab_tech_id UUID REFERENCES doctors(id),
        claimed_at             TIMESTAMPTZ,
        result_pdf_url         TEXT,
        extraction_raw         JSONB,
        extraction_confidence  NUMERIC,
        posted_at              TIMESTAMPTZ,

        -- imaging-specific (v3.6)
        laterality             TEXT,
        body_area              TEXT,
        clinical_indication    TEXT,
        referral_pdf_url       TEXT,

        -- procedure-specific (v3.6)
        operator_doctor_id     UUID REFERENCES doctors(id),
        procedure_note         TEXT,

        -- audit
        cancelled_at           TIMESTAMPTZ,
        cancelled_by_doctor_id UUID REFERENCES doctors(id),
        cancel_reason          TEXT,

        modality_meta          JSONB NOT NULL DEFAULT '{}'::jsonb,

        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS diagnostic_orders_encounter_idx
        ON diagnostic_orders (encounter_id);

      CREATE INDEX IF NOT EXISTS diagnostic_orders_modality_status_idx
        ON diagnostic_orders (modality, status);

      CREATE INDEX IF NOT EXISTS diagnostic_orders_lab_inbox_idx
        ON diagnostic_orders (status, claimed_by_lab_tech_id)
        WHERE modality = 'lab';

      -- 4. encounters.ai_suggested_orders cache (v3.5a consumer) ---
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_orders JSONB;
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_orders_generated_at TIMESTAMPTZ;
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_orders_context_hash TEXT;
    `,
  },
  {
    version: 26,
    name: 'v3_0b_lab_orders_to_view_cutover',
    sql: `
      -- v3.0b — destructive plumbing: lab_orders becomes a VIEW.
      --
      -- This is the high-risk migration of the v3 arc. After it runs:
      --   - All v2 lab pipeline code (lab tech inbox, claim, upload,
      --     Qwen-VL extraction, confirm, sweep cron, annotations) keeps
      --     working because lab_orders is now a VIEW with INSTEAD OF
      --     INSERT/UPDATE/DELETE triggers routing to diagnostic_orders.
      --   - Orders created via the v3.2a strip become visible in /lab
      --     because the view exposes them with the lab_orders schema.
      --   - The v2 lab_orders TABLE no longer exists; diagnostic_orders
      --     is the canonical store.
      --
      -- Rollback procedure if this migration causes prod issues:
      --   1. Re-create lab_orders TABLE from scratch using migration
      --      v13 + v19 + v20 DDL.
      --   2. INSERT INTO lab_orders SELECT mapped cols FROM
      --      diagnostic_orders WHERE modality='lab'.
      --   3. DROP VIEW lab_orders (the post-cutover one).
      --   4. Rename the freshly-restored lab_orders TABLE.
      --   No data loss because we backfilled, not migrated.

      -- Step 1: Add missing columns to diagnostic_orders so the
      -- backfill from lab_orders is lossless.
      ALTER TABLE diagnostic_orders ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
      ALTER TABLE diagnostic_orders ADD COLUMN IF NOT EXISTS raw_text TEXT;
      ALTER TABLE diagnostic_orders ADD COLUMN IF NOT EXISTS canonical_key TEXT;
      ALTER TABLE diagnostic_orders ADD COLUMN IF NOT EXISTS pre_staged_by_cce_id UUID REFERENCES doctors(id) ON DELETE SET NULL;
      ALTER TABLE diagnostic_orders ADD COLUMN IF NOT EXISTS pre_staged_at TIMESTAMPTZ;
      ALTER TABLE diagnostic_orders ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;
      ALTER TABLE diagnostic_orders ADD COLUMN IF NOT EXISTS extraction_lab_tech_id UUID REFERENCES doctors(id) ON DELETE SET NULL;
      ALTER TABLE diagnostic_orders ADD COLUMN IF NOT EXISTS auto_posted BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE INDEX IF NOT EXISTS diagnostic_orders_patient_idx
        ON diagnostic_orders (patient_id, ordered_at DESC);
      CREATE INDEX IF NOT EXISTS diagnostic_orders_lab_inbox_v2_idx
        ON diagnostic_orders (status, ordered_at)
        WHERE modality = 'lab' AND status IN ('pending','in_progress','awaiting_confirmation');
      CREATE INDEX IF NOT EXISTS diagnostic_orders_lab_claimed_idx
        ON diagnostic_orders (claimed_by_lab_tech_id)
        WHERE modality = 'lab' AND claimed_by_lab_tech_id IS NOT NULL;

      -- Step 2: Seed fallback catalog row for any lab_orders.display_name
      -- that can't be fuzzy-matched to an EHRC catalog row. This row
      -- exists ONLY for backfill compat; future orders should never use it.
      INSERT INTO diagnostic_catalog (
        service_code, display_name, department, sub_department, service_type,
        modality, patient_types, is_active, description
      ) VALUES (
        'LEGACY-LAB-UNMATCHED',
        'Legacy lab order (v3 backfill placeholder)',
        'Diagnostic-Lab', 'Legacy', 'Pathology',
        'lab', ARRAY['OP','IP','ER','DC','HC','Registration'], true,
        'Auto-created during v3.0b cutover for lab_orders rows whose display_name could not be fuzzy-matched to an EHRC catalog row. Doctors should re-pick the correct test in the encounter timeline.'
      ) ON CONFLICT (service_code) DO NOTHING;

      -- Step 3: Backfill lab_orders rows into diagnostic_orders.
      -- service_code resolution priority: exact match → trigram fuzzy match → LEGACY-LAB-UNMATCHED.
      INSERT INTO diagnostic_orders (
        id, encounter_id, patient_id, service_code, modality, status,
        ordered_by_doctor_id, ordered_at, ordering_actor,
        raw_text, canonical_key,
        pre_staged_by_cce_id, pre_staged_at,
        result_pdf_url, extracted_at, extraction_confidence, extraction_raw,
        extraction_lab_tech_id, auto_posted,
        claimed_by_lab_tech_id, claimed_at,
        posted_at
      )
      SELECT
        lo.id, lo.encounter_id, lo.patient_id,
        COALESCE(
          (SELECT dc.service_code FROM diagnostic_catalog dc
            WHERE dc.modality='lab' AND LOWER(dc.display_name) = LOWER(lo.display_name) LIMIT 1),
          (SELECT dc.service_code FROM diagnostic_catalog dc
            WHERE dc.modality='lab' AND similarity(dc.display_name, COALESCE(lo.display_name, lo.raw_text)) > 0.3
            ORDER BY similarity(dc.display_name, COALESCE(lo.display_name, lo.raw_text)) DESC LIMIT 1),
          'LEGACY-LAB-UNMATCHED'
        ) AS service_code,
        'lab',
        lo.status,
        lo.ordering_doctor_id,
        lo.ordered_at,
        CASE WHEN lo.pre_staged_by_cce_id IS NOT NULL THEN 'cce_prestage' ELSE 'doctor' END,
        lo.raw_text, lo.canonical_key,
        lo.pre_staged_by_cce_id, lo.pre_staged_at,
        lo.source_pdf_url, lo.extracted_at, lo.extraction_confidence, lo.extraction_raw,
        lo.extraction_lab_tech_id, lo.auto_posted,
        lo.claimed_by_lab_tech_id, lo.claimed_at,
        lo.resulted_at
      FROM lab_orders lo
      WHERE NOT EXISTS (SELECT 1 FROM diagnostic_orders dox WHERE dox.id = lo.id);

      -- Step 4: Verify counts match — fail loud if backfill lost anything.
      DO $$
      DECLARE
        src_count INT;
        dst_count INT;
      BEGIN
        SELECT COUNT(*) INTO src_count FROM lab_orders;
        SELECT COUNT(*) INTO dst_count FROM diagnostic_orders WHERE modality='lab';
        IF src_count != dst_count THEN
          RAISE EXCEPTION 'v3.0b backfill mismatch: lab_orders=% diagnostic_orders.lab=%', src_count, dst_count;
        END IF;
      END $$;

      -- Step 5: Drop the FK constraint on lab_results.lab_order_id (points
      -- to the soon-to-be-dropped table). We'll re-add it after.
      ALTER TABLE lab_results DROP CONSTRAINT IF EXISTS lab_results_lab_order_id_fkey;

      -- Step 6: Drop the lab_orders TABLE.
      DROP TABLE IF EXISTS lab_orders CASCADE;

      -- Step 7: Re-add the FK on lab_results pointing to diagnostic_orders.
      -- IDs preserved during backfill so existing lab_results rows now
      -- correctly reference diagnostic_orders rows.
      ALTER TABLE lab_results
        ADD CONSTRAINT lab_results_lab_order_id_fkey
        FOREIGN KEY (lab_order_id) REFERENCES diagnostic_orders(id) ON DELETE SET NULL;

      -- Step 8: Create lab_orders as a VIEW exposing the v2 column shape.
      CREATE OR REPLACE VIEW lab_orders AS
      SELECT
        do2.id,
        do2.encounter_id,
        do2.patient_id,
        do2.ordered_by_doctor_id AS ordering_doctor_id,
        do2.raw_text,
        do2.canonical_key,
        dc.display_name,
        do2.status,
        do2.ordered_at,
        do2.posted_at AS resulted_at,
        do2.pre_staged_by_cce_id,
        do2.pre_staged_at,
        do2.result_pdf_url AS source_pdf_url,
        do2.extracted_at,
        do2.extraction_confidence,
        do2.extraction_raw,
        do2.extraction_lab_tech_id,
        do2.auto_posted,
        do2.claimed_by_lab_tech_id,
        do2.claimed_at
      FROM diagnostic_orders do2
      LEFT JOIN diagnostic_catalog dc ON dc.service_code = do2.service_code
      WHERE do2.modality = 'lab';

      -- Step 9: INSTEAD OF triggers so existing v2 code that writes to
      -- lab_orders keeps working unchanged.
      CREATE OR REPLACE FUNCTION lab_orders_insert_trigger() RETURNS TRIGGER AS $tfn$
      DECLARE
        v_service_code TEXT;
        v_search_text TEXT;
      BEGIN
        v_search_text := COALESCE(NEW.display_name, NEW.raw_text);

        SELECT dc.service_code INTO v_service_code
        FROM diagnostic_catalog dc
        WHERE dc.modality='lab' AND LOWER(dc.display_name) = LOWER(v_search_text)
        LIMIT 1;

        IF v_service_code IS NULL AND v_search_text IS NOT NULL THEN
          SELECT dc.service_code INTO v_service_code
          FROM diagnostic_catalog dc
          WHERE dc.modality='lab'
            AND similarity(dc.display_name, v_search_text) > 0.3
          ORDER BY similarity(dc.display_name, v_search_text) DESC
          LIMIT 1;
        END IF;

        IF v_service_code IS NULL THEN
          v_service_code := 'LEGACY-LAB-UNMATCHED';
        END IF;

        INSERT INTO diagnostic_orders (
          id, encounter_id, patient_id, service_code, modality, status,
          ordered_by_doctor_id, ordered_at, ordering_actor,
          raw_text, canonical_key,
          pre_staged_by_cce_id, pre_staged_at,
          result_pdf_url, extracted_at, extraction_confidence, extraction_raw,
          extraction_lab_tech_id, auto_posted,
          claimed_by_lab_tech_id, claimed_at,
          posted_at
        ) VALUES (
          COALESCE(NEW.id, gen_random_uuid()),
          NEW.encounter_id, NEW.patient_id, v_service_code, 'lab',
          COALESCE(NEW.status, 'pending'),
          NEW.ordering_doctor_id, COALESCE(NEW.ordered_at, NOW()),
          CASE WHEN NEW.pre_staged_by_cce_id IS NOT NULL THEN 'cce_prestage' ELSE 'doctor' END,
          NEW.raw_text, NEW.canonical_key,
          NEW.pre_staged_by_cce_id, NEW.pre_staged_at,
          NEW.source_pdf_url, NEW.extracted_at, NEW.extraction_confidence, NEW.extraction_raw,
          NEW.extraction_lab_tech_id, COALESCE(NEW.auto_posted, FALSE),
          NEW.claimed_by_lab_tech_id, NEW.claimed_at,
          NEW.resulted_at
        );

        RETURN NEW;
      END;
      $tfn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS lab_orders_insert_instead ON lab_orders;
      CREATE TRIGGER lab_orders_insert_instead
        INSTEAD OF INSERT ON lab_orders
        FOR EACH ROW EXECUTE FUNCTION lab_orders_insert_trigger();

      CREATE OR REPLACE FUNCTION lab_orders_update_trigger() RETURNS TRIGGER AS $tfn$
      BEGIN
        UPDATE diagnostic_orders SET
          status                = COALESCE(NEW.status, status),
          ordered_at            = COALESCE(NEW.ordered_at, ordered_at),
          ordered_by_doctor_id  = NEW.ordering_doctor_id,
          raw_text              = COALESCE(NEW.raw_text, raw_text),
          canonical_key         = NEW.canonical_key,
          pre_staged_by_cce_id  = NEW.pre_staged_by_cce_id,
          pre_staged_at         = NEW.pre_staged_at,
          result_pdf_url        = NEW.source_pdf_url,
          extracted_at          = NEW.extracted_at,
          extraction_confidence = NEW.extraction_confidence,
          extraction_raw        = NEW.extraction_raw,
          extraction_lab_tech_id = NEW.extraction_lab_tech_id,
          auto_posted           = COALESCE(NEW.auto_posted, FALSE),
          claimed_by_lab_tech_id = NEW.claimed_by_lab_tech_id,
          claimed_at            = NEW.claimed_at,
          posted_at             = NEW.resulted_at,
          updated_at            = NOW()
        WHERE id = OLD.id AND modality = 'lab';
        RETURN NEW;
      END;
      $tfn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS lab_orders_update_instead ON lab_orders;
      CREATE TRIGGER lab_orders_update_instead
        INSTEAD OF UPDATE ON lab_orders
        FOR EACH ROW EXECUTE FUNCTION lab_orders_update_trigger();

      CREATE OR REPLACE FUNCTION lab_orders_delete_trigger() RETURNS TRIGGER AS $tfn$
      BEGIN
        DELETE FROM diagnostic_orders WHERE id = OLD.id AND modality = 'lab';
        RETURN OLD;
      END;
      $tfn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS lab_orders_delete_instead ON lab_orders;
      CREATE TRIGGER lab_orders_delete_instead
        INSTEAD OF DELETE ON lab_orders
        FOR EACH ROW EXECUTE FUNCTION lab_orders_delete_trigger();
    `,
  },
  {
    version: 27,
    name: 'v3_8_icd10_llm_cache',
    sql: `
      -- v3.8 — ICD-10 LLM-assist cache columns on encounters.
      --
      -- Mirrors v3.5a's ai_suggested_orders cache shape exactly:
      -- (payload, generated_at, context_hash). Passive chips fire on
      -- mount and re-fire when context_hash changes.
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS ai_suggested_icd10 JSONB;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS ai_suggested_icd10_generated_at TIMESTAMPTZ;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS ai_suggested_icd10_context_hash TEXT;
    `,
  },
  {
    version: 28,
    name: 'v3_9_patient_comorbidities',
    sql: `
      -- v3.9 — Patient comorbidities (chronic conditions across encounters).
      -- Minimal shape per V's lock; severity/duration/notes deferred to v4.
      CREATE TABLE IF NOT EXISTS patient_comorbidities (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        code                TEXT NOT NULL,
        label               TEXT NOT NULL,
        onset_date          DATE,
        is_resolved         BOOLEAN NOT NULL DEFAULT false,
        resolved_at         TIMESTAMPTZ,
        added_by_doctor_id  UUID REFERENCES doctors(id) ON DELETE SET NULL,
        added_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (patient_id, code)
      );
      CREATE INDEX IF NOT EXISTS patient_comorbidities_patient_active_idx
        ON patient_comorbidities (patient_id) WHERE is_resolved = false;
      CREATE INDEX IF NOT EXISTS patient_comorbidities_code_idx
        ON patient_comorbidities (code);
    `,
  },
  {
    version: 29,
    name: 'v3_8_1_assessment_code_labels',
    sql: `
      -- v3.8.1 — Persist ICD-10 chip labels alongside the codes so they
      -- survive page reloads. V noticed codes were rendering as raw codes
      -- (K63.8, B26.9, etc.) without their human-readable labels because
      -- assessmentCodeLabels was React state only. JSONB map: code → label.
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS assessment_code_labels JSONB NOT NULL DEFAULT '{}'::jsonb;
    `,
  },
  {
    version: 30,
    name: 'v3_9_3_demographics_comorbidity_suggest_cache',
    sql: `
      -- v3.9.3 — passive demographics-driven comorbidity suggestion cache
      -- on encounters. Mirrors v3.5a (ai_suggested_orders) + v3.8
      -- (ai_suggested_icd10) shape exactly: payload + generated_at +
      -- context_hash. Re-fires when context_hash changes.
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_comorbidities JSONB;
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_comorbidities_generated_at TIMESTAMPTZ;
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_comorbidities_context_hash TEXT;
    `,
  },
  {
    version: 31,
    name: 'v3_9_4_rx_comorbidity_overrides',
    sql: `
      -- v3.9.4 — Rx-comorbidity coherence: per-encounter audit log of
      -- doctor decisions when a warning fires (drug X usually treats
      -- comorbidity Y, but patient lacks Y on file).
      --
      -- Each entry: { drug_name, comorbidity_code, comorbidity_label,
      --                decision: 'added' | 'overridden',
      --                reason?: string, source: 'static' | 'qwen',
      --                confidence: number, at: ISO timestamp }
      --
      -- Warnings themselves are NOT cached server-side — they regenerate
      -- on demand from prescription_lines (cheap; static map is sub-ms,
      -- Qwen fallback only for unknown drugs).
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS rx_comorbidity_overrides JSONB DEFAULT '[]'::jsonb;
    `,
  },
  {
    version: 32,
    name: 'v3_9_5_comorbidity_control_severity_state',
    sql: `
      -- v3.9.5 — capture control_state + severity_state per patient
      -- comorbidity, per the EHS Comorbidity Catalog v1.0 captured_as
      -- dimension. Optional fields: only conditions with
      -- captured_as containing 'control' or 'severity' should fill these.
      --
      -- control_state values: 'well' | 'partial' | 'uncontrolled' | NULL
      -- severity_state values: 'mild' | 'moderate' | 'severe' | NULL
      --
      -- state_updated_at + state_updated_by_doctor_id form an audit
      -- trail so we know when the assessment was last made.
      ALTER TABLE patient_comorbidities
        ADD COLUMN IF NOT EXISTS control_state TEXT;
      ALTER TABLE patient_comorbidities
        ADD COLUMN IF NOT EXISTS severity_state TEXT;
      ALTER TABLE patient_comorbidities
        ADD COLUMN IF NOT EXISTS state_updated_at TIMESTAMPTZ;
      ALTER TABLE patient_comorbidities
        ADD COLUMN IF NOT EXISTS state_updated_by_doctor_id UUID
        REFERENCES doctors(id) ON DELETE SET NULL;

      -- Free-text constraint via CHECK so writes can't store garbage.
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE patient_comorbidities
            ADD CONSTRAINT patient_comorbidities_control_state_check
            CHECK (control_state IS NULL OR control_state IN ('well','partial','uncontrolled'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
          ALTER TABLE patient_comorbidities
            ADD CONSTRAINT patient_comorbidities_severity_state_check
            CHECK (severity_state IS NULL OR severity_state IN ('mild','moderate','severe'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
      END $$;

      -- Cache for Qwen-suggested states (mirrors v3.5a/v3.8/v3.9.3 shape)
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_comorbidity_states JSONB;
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_comorbidity_states_generated_at TIMESTAMPTZ;
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS ai_suggested_comorbidity_states_context_hash TEXT;
    `,
  },
  {
    version: 33,
    name: 'v3_9_6_patient_tier_override',
    sql: `
      -- v3.9.6 — clinician override of the computed panel tier.
      -- Auto-tier is computed from active comorbidities + modifiers;
      -- the override (when set) wins. Stamped with doctor + at for audit.
      ALTER TABLE patients
        ADD COLUMN IF NOT EXISTS tier_override_state TEXT;
      ALTER TABLE patients
        ADD COLUMN IF NOT EXISTS tier_override_reason TEXT;
      ALTER TABLE patients
        ADD COLUMN IF NOT EXISTS tier_override_by_doctor_id UUID
        REFERENCES doctors(id) ON DELETE SET NULL;
      ALTER TABLE patients
        ADD COLUMN IF NOT EXISTS tier_override_at TIMESTAMPTZ;

      DO $$
      BEGIN
        BEGIN
          ALTER TABLE patients
            ADD CONSTRAINT patients_tier_override_state_check
            CHECK (tier_override_state IS NULL OR tier_override_state IN ('T0','T1','T2','T3'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
      END $$;
    `,
  },
  {
    version: 34,
    name: 'v4_1_1_encounter_active_time_clock',
    sql: `
      -- v4.1.1 — Pause-aware "doctor-active time" clock at the foundation.
      --
      -- The legacy timer in EncounterTopBar/EncounterEditor read
      -- (NOW() - started_at) and never paused, so a row sitting in
      -- 'paused_diagnostics' for hours showed inflated minutes (e.g. 561:00).
      -- We replace it with two durable fields maintained by a trigger so
      -- the bookkeeping is correct for EVERY status write, current and future,
      -- regardless of which route or background job issued it.
      --
      -- Semantics:
      --   active_ms_accumulated  = ms of doctor-active time already banked
      --                            from prior active windows.
      --   active_since           = timestamp the current active window started;
      --                            NULL when the encounter is paused,
      --                            pre-doctor, or completed.
      --
      -- Active states = ('active','ready_to_resume'). Pre-doctor states
      -- ('registered','at_triage','waiting_for_doctor'), 'paused_diagnostics',
      -- 'cancelled', and 'completed' all leave the clock frozen.

      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS active_ms_accumulated BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE encounters
        ADD COLUMN IF NOT EXISTS active_since TIMESTAMPTZ NULL;

      -- Trigger function: maintain the clock on every INSERT and UPDATE OF status.
      -- BEFORE trigger so the row mutation is atomic with the status change.
      CREATE OR REPLACE FUNCTION enc_active_time_maintain()
      RETURNS TRIGGER AS $fn$
      DECLARE
        old_active BOOLEAN;
        new_active BOOLEAN;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          new_active := NEW.status IN ('active','ready_to_resume');
          IF new_active THEN
            NEW.active_since := COALESCE(NEW.active_since, NOW());
          ELSE
            NEW.active_since := NULL;
          END IF;
          RETURN NEW;
        END IF;

        -- UPDATE — only act when status actually changed
        IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
          RETURN NEW;
        END IF;

        old_active := OLD.status IN ('active','ready_to_resume');
        new_active := NEW.status IN ('active','ready_to_resume');

        IF old_active AND NOT new_active THEN
          -- Leaving an active window: bank elapsed ms, clear active_since.
          IF OLD.active_since IS NOT NULL THEN
            NEW.active_ms_accumulated :=
              COALESCE(OLD.active_ms_accumulated, 0)
              + (EXTRACT(EPOCH FROM (NOW() - OLD.active_since)) * 1000)::BIGINT;
          END IF;
          NEW.active_since := NULL;
        ELSIF (NOT old_active) AND new_active THEN
          -- Entering an active window: stamp the start.
          NEW.active_since := NOW();
        END IF;
        -- active <-> active (e.g. active <-> ready_to_resume) and
        -- non-active <-> non-active transitions: no clock change.

        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS encounters_active_time_trg ON encounters;
      CREATE TRIGGER encounters_active_time_trg
        BEFORE INSERT OR UPDATE OF status ON encounters
        FOR EACH ROW
        EXECUTE FUNCTION enc_active_time_maintain();

      -- One-time backfill for rows that existed before v34.
      -- We cannot reconstruct historical pause windows, so this is best-effort:
      --   - currently-active rows ('active' / 'ready_to_resume') get
      --     active_since = NOW() and 0 accumulated. Their clock starts fresh.
      --   - all other rows get active_since = NULL and 0 accumulated, so the
      --     timer reads 0:00 until the encounter next enters an active state.
      UPDATE encounters
         SET active_since = CASE
               WHEN status IN ('active','ready_to_resume') THEN NOW()
               ELSE NULL
             END,
             active_ms_accumulated = 0
       WHERE active_since IS NULL AND active_ms_accumulated = 0;
    `,
  },
  {
    version: 35,
    name: 'v4_1_2_assert_db_timezone_ist',
    sql: `
      -- v4.1.2 — Assert the database default TIMEZONE is Asia/Kolkata.
      --
      -- The hospital runs in IST. We can't ALTER DATABASE inside a
      -- transaction (and migrations all run inside one), so the
      -- timezone is set OUT-OF-BAND via a one-time:
      --   ALTER DATABASE neondb SET TIMEZONE TO 'Asia/Kolkata';
      -- run from the Neon SQL editor.
      --
      -- This migration just verifies the catalog still reflects that
      -- setting. If it doesn't (e.g. DB restored from backup, replica
      -- promoted, new env deployed), the migration loudly RAISE
      -- WARNINGs so the operator notices before users do. Production
      -- impact of a missed TZ: every morning dashboards look empty
      -- because the cron stamps encounter_date with UTC-yesterday's
      -- date relative to IST users.
      DO $$
      DECLARE
        cfg TEXT[];
        has_ist BOOLEAN := FALSE;
      BEGIN
        SELECT setconfig INTO cfg
          FROM pg_db_role_setting s
          JOIN pg_database d ON d.oid = s.setdatabase
         WHERE d.datname = current_database() AND s.setrole = 0;

        IF cfg IS NOT NULL THEN
          has_ist := (
            SELECT bool_or(c LIKE 'TimeZone=Asia/Kolkata%')
              FROM unnest(cfg) AS c
          );
        END IF;

        IF NOT COALESCE(has_ist, FALSE) THEN
          RAISE WARNING $msg$
            DB-default TIMEZONE is NOT set to Asia/Kolkata.
            Run, OUT OF TRANSACTION, from the Neon SQL editor:
              ALTER DATABASE neondb SET TIMEZONE TO 'Asia/Kolkata';
            Without this, every IST morning dashboards look empty
            because encounter_date stamps drift across the UTC midnight
            boundary while IST users perceive the same day.
          $msg$;
        ELSE
          RAISE NOTICE 'DB TIMEZONE asserted: Asia/Kolkata';
        END IF;
      END $$;
    `,
  },
  {
    version: 36,
    name: 'v4_1_4_transcription_comparisons',
    sql: `
      -- v4.1.4 — Dual-engine transcription comparison.
      --
      -- Every section dictation (or ambient recording) is transcribed by
      -- BOTH Deepgram (nova-3-medical, cloud) and Whisper large-v3-turbo
      -- (self-hosted on V's Mac Mini, via Cloudflare tunnel). A third
      -- qwen2.5:14b call judges the pair on a 1-10 scale and picks the
      -- winner. The winning transcript goes into the section input; both
      -- transcripts are persisted for download + later analysis.
      --
      -- This drives the model-scoring effort the 25 May Pulse 2.0 meeting
      -- set up (Ira asked for a structured Deepgram vs alternatives test).
      -- Real recordings → judge scores accumulate as live data.

      CREATE TABLE IF NOT EXISTS transcription_comparisons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,

        -- Source link — either a section dictation or ambient recording
        section_dictation_id UUID NULL REFERENCES section_dictations(id) ON DELETE CASCADE,
        encounter_recording_id UUID NULL REFERENCES encounter_recordings(id) ON DELETE CASCADE,

        -- Audio metadata (denormalized for convenience)
        audio_blob_url TEXT NOT NULL,
        audio_duration_seconds INT,
        audio_mime TEXT,
        section TEXT,

        -- Deepgram result
        deepgram_transcript TEXT,
        deepgram_confidence NUMERIC(4,3),
        deepgram_latency_ms INT,
        deepgram_error TEXT,

        -- Whisper result
        whisper_transcript TEXT,
        whisper_latency_ms INT,
        whisper_error TEXT,

        -- qwen2.5:14b judge
        judge_winner TEXT CHECK (judge_winner IS NULL OR judge_winner IN ('deepgram','whisper','tie')),
        judge_deepgram_score NUMERIC(3,1),
        judge_whisper_score NUMERIC(3,1),
        judge_delta_score NUMERIC(3,1),
        judge_reasoning TEXT,
        judge_latency_ms INT,
        judge_error TEXT,

        total_elapsed_ms INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tc_encounter ON transcription_comparisons(encounter_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tc_section_dictation ON transcription_comparisons(section_dictation_id) WHERE section_dictation_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_tc_winner ON transcription_comparisons(judge_winner) WHERE judge_winner IS NOT NULL;
    `,
  },
  {
    version: 37,
    name: 'v5_0a_encounter_plans',
    sql: `
      -- v5.0a — Plan taxonomy + multi-plan support per encounter.
      -- Replaces the single disposition_kind enum with a richer plan_kind
      -- enum + a 1-to-N encounter_plans table carrying per-kind JSONB
      -- payloads. See PLAN-V5-PRD.md §3-4.
      --
      -- Old disposition columns kept read-only for back-compat; dropped
      -- in v5.2 (migration v39).

      CREATE TYPE plan_kind AS ENUM (
        'discharge', 'follow_up', 'refer', 'diagnostics', 'imaging',
        'medical_admission', 'surgical_plan', 'day_care_procedure',
        'vaccinate', 'emergency_transfer', 'counseling_only',
        'refusal_of_advised_plan', 'no_further_action'
      );

      CREATE TABLE IF NOT EXISTS encounter_plans (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id    UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        kind            plan_kind NOT NULL,
        payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
        predicted       BOOLEAN NOT NULL DEFAULT FALSE,
        prediction_confidence NUMERIC(3,2),
        source          TEXT NOT NULL DEFAULT 'doctor',
        position        INT NOT NULL DEFAULT 0,
        refused_plan_id UUID REFERENCES encounter_plans(id),
        created_by      UUID NOT NULL REFERENCES doctors(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        submitted_at    TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_ep_encounter ON encounter_plans(encounter_id, position);
      CREATE INDEX IF NOT EXISTS idx_ep_kind ON encounter_plans(kind);

      -- Backfill from existing disposition data — one encounter_plans row
      -- per legacy disposition. Source marked legacy_migration so we can
      -- distinguish from v5+ doctor-entered plans.
      INSERT INTO encounter_plans
        (encounter_id, kind, payload, source, created_by, created_at, updated_at, submitted_at)
      SELECT
        e.id,
        CASE e.disposition::text
          WHEN 'discharge'   THEN 'discharge'::plan_kind
          WHEN 'follow_up'   THEN 'follow_up'::plan_kind
          WHEN 'refer'       THEN 'refer'::plan_kind
          WHEN 'diagnostics' THEN 'diagnostics'::plan_kind
          WHEN 'admit'       THEN 'medical_admission'::plan_kind
          WHEN 'vaccinate'   THEN 'vaccinate'::plan_kind
        END,
        jsonb_strip_nulls(jsonb_build_object(
          'legacy_disposition_label_override', e.disposition_label_override,
          'legacy_follow_up_days', e.follow_up_days,
          'legacy_referral_target', e.referral_target
        )),
        'legacy_migration',
        e.doctor_id,
        COALESCE(e.completed_at, e.updated_at, NOW()),
        COALESCE(e.completed_at, e.updated_at, NOW()),
        e.completed_at
      FROM encounters e
      WHERE e.disposition IS NOT NULL;

      COMMENT ON COLUMN encounters.disposition IS 'DEPRECATED v5.0 — use encounter_plans. Read-only.';
      COMMENT ON COLUMN encounters.follow_up_days IS 'DEPRECATED v5.0 — see encounter_plans.payload.';
      COMMENT ON COLUMN encounters.referral_target IS 'DEPRECATED v5.0 — see encounter_plans.payload.';
      COMMENT ON COLUMN encounters.disposition_label_override IS 'DEPRECATED v5.0 — see encounter_plans.';
    `,
  },
  {
    version: 38,
    name: 'v5_0b_plan_support_tables',
    sql: `
      -- v5.0b — support tables for v5 plans:
      --   - vaccine_administrations: structured record per vaccine given
      --   - plan_predictions: AI prediction cache + analytics
      --   - encounter_plan_audits: medico-legal audit trail for every plan mutation

      CREATE TABLE IF NOT EXISTS vaccine_administrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL REFERENCES patients(id),
        plan_id UUID NOT NULL REFERENCES encounter_plans(id) ON DELETE CASCADE,
        vaccine_name TEXT NOT NULL,
        site TEXT,
        batch TEXT,
        expiry DATE,
        manufacturer TEXT,
        next_dose_due_date DATE,
        administered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_va_patient ON vaccine_administrations(patient_id, administered_at DESC);

      CREATE TABLE IF NOT EXISTS plan_predictions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        snapshot_hash TEXT NOT NULL,
        predictions JSONB NOT NULL,
        severity_estimate TEXT,
        model TEXT NOT NULL,
        model_latency_ms INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pp_encounter_recent ON plan_predictions(encounter_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pp_hash ON plan_predictions(snapshot_hash);

      CREATE TABLE IF NOT EXISTS encounter_plan_audits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL REFERENCES encounter_plans(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('created','updated','removed','submitted')),
        payload_before JSONB,
        payload_after JSONB,
        actor_doctor_id UUID NOT NULL REFERENCES doctors(id),
        actor_email TEXT,
        at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_epa_plan ON encounter_plan_audits(plan_id, at DESC);
    `,
  },
  {
    version: 39,
    name: 'v6_0_llm_traces',
    sql: `
      -- v6.0 — Forensic trace table for every LLM-firing route.
      -- See LLM-TRACE-PANEL-PRD.md §5.6.
      --
      -- One row per pipeline run, status tracked from 'in_progress' to
      -- terminal ('completed' | 'errored' | 'aborted'). Events array
      -- accumulates the full NDJSON event stream for forensic replay.
      --
      -- Retention forever (decision Q2). No cron sweep.
      -- Encounter / patient FKs are ON DELETE SET NULL so deleting a
      -- patient or encounter doesn't lose the audit trail — the trace
      -- becomes orphan but readable.

      CREATE TABLE IF NOT EXISTS llm_traces (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        surface         TEXT NOT NULL,
        encounter_id    UUID REFERENCES encounters(id) ON DELETE SET NULL,
        patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
        doctor_email    TEXT,
        request_input   JSONB,
        events          JSONB NOT NULL DEFAULT '[]'::jsonb,
        result_summary  JSONB,
        model_calls     JSONB,
        total_ms        INT,
        status          TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','completed','errored','aborted')),
        error_message   TEXT,
        started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at    TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_llm_traces_surface_started
        ON llm_traces(surface, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_llm_traces_encounter
        ON llm_traces(encounter_id, started_at DESC)
        WHERE encounter_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_llm_traces_patient
        ON llm_traces(patient_id, started_at DESC)
        WHERE patient_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_llm_traces_doctor
        ON llm_traces(doctor_email, started_at DESC);
    `,
  },
  {
    version: 40,
    name: 'v7_0_lifecycle_foundation',
    sql: `
      -- v7.0 / OPD-Demo-2 P0.3 — Lifecycle foundation.
      -- Two-track encounter status (clinical lane + processing pipeline),
      -- multi-session recording (encounter_sessions = the unit that gets
      -- stitched), disposition phases on plans, CDMSS accept/ignore audit,
      -- and session-aware LLM traces.
      -- Legacy encounters.status stays canonical for pre-redesign flows
      -- (lossless); new surfaces read clinical_status/processing_status.

      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS clinical_status TEXT;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'idle';
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS current_phase TEXT NOT NULL DEFAULT 'primary';
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS field_provenance JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS note_json JSONB;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS note_json_edited JSONB;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS cdmss_json JSONB;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS tagged_transcript JSONB;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS detected_language TEXT;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS primary_speaker_clinician_id UUID REFERENCES doctors(id);

      DO $do$ BEGIN
        ALTER TABLE encounters ADD CONSTRAINT chk_enc_clinical_status CHECK (
          clinical_status IS NULL OR clinical_status IN (
            'ready','in_room','out_for_workup','back_ready','processing',
            'ready_for_review','finalizing','complete','cancelled'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

      DO $do$ BEGIN
        ALTER TABLE encounters ADD CONSTRAINT chk_enc_processing_status CHECK (
          processing_status IN ('idle','transcribing','generating','ready','errored'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

      DO $do$ BEGIN
        ALTER TABLE encounters ADD CONSTRAINT chk_enc_current_phase CHECK (
          current_phase IN ('primary','followup','finalizing'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

      -- Backfill the new clinical lane from the legacy status enum.
      UPDATE encounters SET clinical_status = CASE status::text
        WHEN 'registered'         THEN 'ready'
        WHEN 'at_triage'          THEN 'ready'
        WHEN 'waiting_for_doctor' THEN 'ready'
        WHEN 'active'             THEN 'in_room'
        WHEN 'paused_diagnostics' THEN 'out_for_workup'
        WHEN 'ready_to_resume'    THEN 'back_ready'
        WHEN 'completed'          THEN 'complete'
        ELSE 'ready' END
      WHERE clinical_status IS NULL;

      CREATE INDEX IF NOT EXISTS idx_enc_clinical_status
        ON encounters(clinical_status, encounter_date);

      -- One row per recording segment; the unit that gets stitched.
      CREATE TABLE IF NOT EXISTS encounter_sessions (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id      UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        seq               INT NOT NULL,
        phase             TEXT NOT NULL DEFAULT 'primary'
                          CHECK (phase IN ('primary','followup','final_disposition')),
        audio_object_key  TEXT,
        audio_bytes       BIGINT,
        duration_seconds  NUMERIC,
        transcript_raw    TEXT,
        transcript_clean  TEXT,
        tagged_transcript JSONB,
        detected_language TEXT,
        status            TEXT NOT NULL DEFAULT 'recording'
                          CHECK (status IN ('recording','uploaded','transcribed','errored')),
        started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at          TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (encounter_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_es_encounter ON encounter_sessions(encounter_id, seq);

      -- Dispositions become phase-aware: initial pauses, final completes.
      ALTER TABLE encounter_plans ADD COLUMN IF NOT EXISTS disposition_phase TEXT NOT NULL DEFAULT 'final';
      DO $do$ BEGIN
        ALTER TABLE encounter_plans ADD CONSTRAINT chk_ep_disposition_phase CHECK (
          disposition_phase IN ('initial','intermediate','final'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
      UPDATE encounter_plans SET disposition_phase = 'initial'
        WHERE kind IN ('diagnostics','imaging') AND disposition_phase = 'final';

      -- CDMSS accept/ignore audit (per-doctor analytics). item_group rather
      -- than "group" (reserved word).
      CREATE TABLE IF NOT EXISTS encounter_cdmss_items (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id   UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
        session_id     UUID REFERENCES encounter_sessions(id) ON DELETE SET NULL,
        item_group     TEXT NOT NULL CHECK (item_group IN ('what_to_do','what_else','probability')),
        payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
        status         TEXT NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed','accepted','ignored')),
        linked_plan_id UUID REFERENCES encounter_plans(id) ON DELETE SET NULL,
        acted_by       UUID REFERENCES doctors(id),
        acted_at       TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_eci_encounter ON encounter_cdmss_items(encounter_id, item_group);
      CREATE INDEX IF NOT EXISTS idx_eci_status ON encounter_cdmss_items(status) WHERE status <> 'proposed';

      -- Traces become session-aware (per-session draft vs stitch runs).
      ALTER TABLE llm_traces ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES encounter_sessions(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_llm_traces_session
        ON llm_traces(session_id, started_at DESC) WHERE session_id IS NOT NULL;
    `,
  },
  {
    version: 41,
    name: 'v7_1_voiceprints',
    sql: `
      -- v7.1 / OPD-Demo-2 P1.6 — Voiceprints (full ETA shapes, UUID FKs).
      -- voice_print = computed-centroid cache (192-dim ECAPA, 768 bytes);
      -- voice_sample = per-clip retention (enrollment now, passive in P2).
      -- Centroid is the running average of all included samples —
      -- accumulate, never overwrite (ETA Voiceprint Retention PRD).

      CREATE TABLE IF NOT EXISTS voice_print (
        doctor_id                UUID PRIMARY KEY REFERENCES doctors(id) ON DELETE CASCADE,
        centroid                 BYTEA NOT NULL,
        sample_count             INT NOT NULL DEFAULT 0,
        samples_json             JSONB NOT NULL DEFAULT '[]'::jsonb,
        enrolled_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_sample_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        match_confidence_30d_avg DOUBLE PRECISION,
        needs_reenrollment       BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE INDEX IF NOT EXISTS idx_voice_print_needs_reenrollment
        ON voice_print(needs_reenrollment);

      CREATE TABLE IF NOT EXISTS voice_sample (
        id                   TEXT PRIMARY KEY,
        clinician_id         UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
        source               TEXT NOT NULL DEFAULT 'enrollment',
        embedding            BYTEA NOT NULL,
        audio_r2_key         TEXT,
        source_encounter_id  UUID,
        content_type         TEXT,
        duration_ms          INT,
        session_id           TEXT,
        sample_index         INT,
        match_confidence     DOUBLE PRECISION,
        included             BOOLEAN NOT NULL DEFAULT TRUE,
        captured_by_admin_id UUID,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_voice_sample_clinician ON voice_sample(clinician_id);
      CREATE INDEX IF NOT EXISTS idx_voice_sample_source ON voice_sample(source);
    `,
  },
  {
    version: 42,
    name: 'v7_2_session_transcripts',
    sql: `
      -- v7.2 / OPD-Demo-2 P2.1 — per-session pipeline outputs.
      -- The session is the stitch unit (P3 reads these rows directly).
      -- transcript_en = canonical English text (Whisper EN / Sarvam batch
      -- translate non-EN); diarized_json = Sarvam diarization entries when
      -- the batch path ran (pyannote tagging lands in P2.2).

      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS transcript_en TEXT;
      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS transcript_original TEXT;
      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS detected_language TEXT;
      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS diarized_json JSONB;
      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS transcribed_at TIMESTAMPTZ;
      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS transcribe_error TEXT;

      -- Pipeline claim/reap bookkeeping on the encounter (processing_status
      -- itself landed in migration 40).
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS processing_error TEXT;

      CREATE INDEX IF NOT EXISTS idx_sessions_untranscribed
        ON encounter_sessions (encounter_id)
        WHERE status = 'uploaded' AND transcribed_at IS NULL;
    `,
  },
  {
    version: 43,
    name: 'v7_3_session_diarize',
    sql: `
      -- v7.3 / OPD-Demo-2 P2.2 — per-session diarization + speaker tagging.
      -- speakers_json = pyannote speakers (idx/label/type/clinician match/
      -- confidence/embedding handled in code, embedding NOT stored here);
      -- tagged_transcript = reconciled speaker-tagged English turns
      -- (TaggedEntry[]); diarize soft-fails per session (diarize_error set,
      -- diarized_at stays NULL so the hourly sweep retries — P2.2 lock).
      -- encounters.tagged_transcript = all sessions' turns concatenated in
      -- seq order (the P3 stitch reads per-session rows; this is the
      -- whole-encounter convenience view).

      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS speakers_json JSONB;
      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS tagged_transcript JSONB;
      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS diarized_at TIMESTAMPTZ;
      ALTER TABLE encounter_sessions ADD COLUMN IF NOT EXISTS diarize_error TEXT;

      ALTER TABLE encounters ADD COLUMN IF NOT EXISTS tagged_transcript JSONB;

      CREATE INDEX IF NOT EXISTS idx_sessions_undiarized
        ON encounter_sessions (encounter_id)
        WHERE transcribed_at IS NOT NULL AND diarized_at IS NULL;
    `,
  },
];

/**
 * Split SQL string into statements, respecting dollar-quoted blocks.
 *
 * Naive split on `;` breaks DO $$...$$ blocks because they often contain
 * semicolons inside. We track when we're inside a $tag$...$tag$ region
 * and only split outside.
 *
 * This is the same splitter pattern EHRC's EPI.v3.0a sprint had to add
 * after the naive splitter mangled their DO blocks.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let dollarTag: string | null = null;
  let inLineComment = false;

  while (i < sql.length) {
    const ch = sql[i];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      current += ch;
      i++;
      continue;
    }

    if (!dollarTag && ch === '-' && sql[i + 1] === '-') {
      inLineComment = true;
      current += ch;
      i++;
      continue;
    }

    // Detect $tag$ delimiter
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        const tag = m[0];
        if (dollarTag === null) {
          dollarTag = tag;
        } else if (dollarTag === tag) {
          dollarTag = null;
        }
        current += tag;
        i += tag.length;
        continue;
      }
    }

    if (ch === ';' && dollarTag === null) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const last = current.trim();
  if (last.length > 0) statements.push(last);
  return statements;
}
