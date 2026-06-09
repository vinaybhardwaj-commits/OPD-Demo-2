-- ==================== v37 ====================

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
    
-- ==================== end v37 ====================

-- ==================== v38 ====================

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
    
-- ==================== end v38 ====================

