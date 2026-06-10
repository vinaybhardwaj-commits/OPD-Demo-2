/**
 * src/lib/plan-prediction.ts
 *
 * v5.1 — AI plan prediction layer.
 *
 * - buildSnapshot(encounterId): pulls the encounter + patient + comorbidities +
 *   rx + lab orders + a short past-history summary into the shape described
 *   in PLAN-V5-PRD.md §5.3.
 * - snapshotHash(snapshot): deterministic sha256 prefix used for cache + dedup.
 * - predictPlans(snapshot): calls qwen2.5:14b with the verbatim system prompt
 *   from PRD Appendix B. Soft-fails to `{predictions:[],reason:'llm_unavailable'}`
 *   so the UI never blocks. Persists every successful prediction to
 *   plan_predictions for analytics.
 *
 * Caching: in-process LRU keyed by snapshotHash (60s TTL). The cache lives
 * inside the lambda warm scope — multi-region misses are fine, predictions
 * are not authoritative.
 *
 * v5.0 ships WITHOUT calling predictPlans (manual plan picking only).
 * v5.1 wires this into /api/encounters/[id]/predict-plans + the
 * SuggestedPlans component.
 */

import { createHash } from 'crypto';
import { pool } from './db';
import { qwenJson, QwenError, QWEN_MODEL } from './qwen';
import type { ProgressEvent } from './llm-trace/stream';
import { withHeartbeat } from './llm-trace/heartbeat';

export type PredictEmit = (ev: ProgressEvent) => void;
const noopEmit: PredictEmit = () => {};
import type { PlanKind } from './plan-schemas';
import { PLAN_KINDS } from './plan-schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EncounterSnapshot = {
  patient: {
    age_years: number;
    sex: string | null;
    comorbidities: Array<{
      code: string;
      label: string;
      onset_date?: string | null;
      is_resolved?: boolean;
    }>;
    allergies: string | null;
    tier: string | null;
  };
  encounter: {
    chief_complaint_chips: string[];
    chief_complaint_text: string | null;
    vitals: Record<string, unknown> | null;
    exam_findings: string | null;
    assessment_text: string | null;
    assessment_codes: string[];
    prescription_lines: unknown[];
    lab_orders: Array<{
      name: string;
      status: string;
      result?: string | null;
    }>;
  };
  encounter_history: {
    past_encounters_summary: string;
  };
  // Reserved for v5.2 — feedback loop where prior predictions inform future ones.
  previous_predictions: Array<{
    kind: PlanKind;
    confidence: number;
    accepted: boolean;
  }>;
};

export type PredictedPlan = {
  rank: number;
  kind: PlanKind;
  confidence: number;
  reasoning: string;
  prefill: Record<string, unknown>;
};

export type PredictionResult =
  | {
      ok: true;
      predictions: PredictedPlan[];
      severity_estimate: 'low' | 'moderate' | 'high';
      model: string;
      latency_ms: number;
      snapshot_hash: string;
      generated_at: string;
      cached: boolean;
    }
  | {
      ok: false;
      predictions: [];
      reason:
        | 'llm_unavailable'
        | 'llm_timeout'
        | 'llm_invalid_json'
        | 'snapshot_failed';
      detail?: string;
      snapshot_hash?: string;
    };

// ---------------------------------------------------------------------------
// 1. buildSnapshot — gather encounter data into the PRD §5.3 shape
// ---------------------------------------------------------------------------

/**
 * Pulls everything needed for a single prediction call. Returns null if the
 * encounter does not exist. All queries are tolerant — missing rows are
 * coerced to empty defaults so the snapshot is always well-formed.
 */
export async function buildSnapshot(
  encounterId: string,
): Promise<EncounterSnapshot | null> {
  const { rows: encRows } = await pool.query<{
    id: string;
    patient_id: string;
    chief_complaint_chips: string[] | null;
    chief_complaint_text: string | null;
    vitals: Record<string, unknown> | null;
    exam_findings: string | null;
    assessment_text: string | null;
    assessment_codes: string[] | null;
  }>(
    `SELECT id, patient_id,
            chief_complaint_chips, chief_complaint_text,
            vitals, exam_findings,
            assessment_text, assessment_codes
       FROM encounters
      WHERE id = $1
      LIMIT 1`,
    [encounterId],
  );
  const enc = encRows[0];
  if (!enc) return null;

  // Run patient + comorbidities + rx + labs + past in parallel.
  const [patRes, comRes, rxRes, labRes, pastRes] = await Promise.all([
    pool.query<{
      age_years: number | null;
      sex: string | null;
      known_allergies: string | null;
      tier_override_state: string | null;
    }>(
      `SELECT age_years, sex, known_allergies, tier_override_state
         FROM patients WHERE id = $1 LIMIT 1`,
      [enc.patient_id],
    ),
    pool.query<{
      code: string;
      label: string;
      onset_date: string | null;
      is_resolved: boolean;
    }>(
      `SELECT code, label, onset_date::text AS onset_date, is_resolved
         FROM patient_comorbidities WHERE patient_id = $1`,
      [enc.patient_id],
    ),
    pool.query<{ lines: unknown }>(
      `SELECT lines FROM prescriptions WHERE encounter_id = $1 LIMIT 1`,
      [encounterId],
    ),
    pool.query<{
      test_name: string;
      status: string | null;
      raw_text: string | null;
    }>(
      `SELECT
         -- B4: fresh-run schema has display_name/raw_text, never test_name
         -- (the legacy column only existed in the long-lived v6.1 DB) —
         -- this hard-500'd predict-plans, soft-failing SuggestedPlans to
         -- invisible.
         COALESCE(display_name, raw_text, 'unspecified') AS test_name,
         status::text AS status,
         raw_text
       FROM lab_orders
       WHERE encounter_id = $1
       ORDER BY ordered_at ASC NULLS LAST`,
      [encounterId],
    ),
    pool.query<{
      n: number;
      complaints: string[] | null;
      impressions: string[] | null;
    }>(
      `SELECT
         COUNT(*)::int AS n,
         ARRAY_AGG(chief_complaint_text)
           FILTER (WHERE chief_complaint_text IS NOT NULL) AS complaints,
         ARRAY_AGG(assessment_text)
           FILTER (WHERE assessment_text IS NOT NULL) AS impressions
       FROM (
         SELECT chief_complaint_text, assessment_text
           FROM encounters
          WHERE patient_id = $1 AND id <> $2 AND status = 'completed'
          ORDER BY encounter_date DESC
          LIMIT 5
       ) recent`,
      [enc.patient_id, encounterId],
    ),
  ]);

  const pat = patRes.rows[0] ?? {
    age_years: null,
    sex: null,
    known_allergies: null,
    tier_override_state: null,
  };

  // Lab orders → human-readable shape with result preview when present.
  const labs: EncounterSnapshot['encounter']['lab_orders'] = labRes.rows.map((r) => ({
    name: r.test_name,
    status: r.status ?? 'unknown',
    result: r.raw_text ? r.raw_text.slice(0, 240) : null,
  }));

  // Past encounters summary — keep it short, model doesn't need the full text.
  const past = pastRes.rows[0];
  const past_encounters_summary = (() => {
    const n = past?.n ?? 0;
    if (n === 0) return 'No prior encounters.';
    const complaints = (past?.complaints ?? []).filter(Boolean).slice(0, 3);
    const impressions = (past?.impressions ?? []).filter(Boolean).slice(0, 3);
    const themes = [...complaints, ...impressions]
      .map((s) => (s ?? '').slice(0, 60))
      .filter(Boolean);
    if (themes.length === 0) return `${n} past encounter(s) — no chief complaint text recorded.`;
    return `${n} past encounter(s). Recent themes: ${themes.slice(0, 5).join('; ')}.`;
  })();

  // Comorbidities — model wants ICD-10 code + plain label.
  const comorbidities = comRes.rows.map((r) => ({
    code: r.code,
    label: r.label,
    onset_date: r.onset_date,
    is_resolved: r.is_resolved,
  }));

  // Rx lines come as JSONB — coerce to array. Don't trust shape.
  const rxRaw = rxRes.rows[0]?.lines;
  const prescription_lines: unknown[] = Array.isArray(rxRaw) ? rxRaw : [];

  return {
    patient: {
      age_years: pat.age_years ?? 0,
      sex: pat.sex,
      comorbidities,
      allergies: pat.known_allergies,
      tier: pat.tier_override_state ?? null,
    },
    encounter: {
      chief_complaint_chips: enc.chief_complaint_chips ?? [],
      chief_complaint_text: enc.chief_complaint_text,
      vitals: enc.vitals,
      exam_findings: enc.exam_findings,
      assessment_text: enc.assessment_text,
      assessment_codes: enc.assessment_codes ?? [],
      prescription_lines,
      lab_orders: labs,
    },
    encounter_history: {
      past_encounters_summary,
    },
    previous_predictions: [],
  };
}

// ---------------------------------------------------------------------------
// 2. snapshotHash — deterministic key for cache + plan_predictions row
// ---------------------------------------------------------------------------

/**
 * 24-char sha256 prefix of canonical JSON. Keys ordered to make hash stable
 * across small reorderings of insertion. We deliberately INCLUDE patient
 * static fields so two encounters from the same patient don't collide.
 */
export function snapshotHash(snapshot: EncounterSnapshot): string {
  const canonical = JSON.stringify(snapshot, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

// ---------------------------------------------------------------------------
// 3. The verbatim system prompt (PRD Appendix B)
// ---------------------------------------------------------------------------

const PREDICTION_SYSTEM_PROMPT = `You are a clinical decision-support assistant for an Indian OPD (out-patient department). Your job: predict the TOP 5 plans a doctor is most likely to choose at the end of the current encounter.

INPUT: a JSON snapshot of the encounter so far — patient demographics, comorbidities, allergies, vitals, chief complaint, exam findings, assessment, prescription, ordered tests + results, brief past-history summary.

OUTPUT: STRICT JSON only. No markdown, no prose around the JSON. Schema:

{
  "predictions": [
    {
      "rank": <int 1..5>,
      "kind": <one of: discharge, follow_up, refer, diagnostics, imaging, medical_admission, surgical_plan, day_care_procedure, vaccinate, emergency_transfer, counseling_only, refusal_of_advised_plan, no_further_action>,
      "confidence": <float 0.00..1.00>,
      "reasoning": "<one or two sentences citing specific evidence from the encounter>",
      "prefill": { <per-kind structured payload — see schemas below> }
    }
  ],
  "encounter_severity_estimate": <"low" | "moderate" | "high">,
  "prediction_generated_at": "<ISO8601 timestamp>",
  "model": "qwen2.5:14b"
}

PER-KIND PREFILL SCHEMAS:

discharge: {
  "advice_text": <string, optional>,
  "red_flag_warnings": [<string>],
  "sos_criteria": <string, optional>
}

follow_up: {
  "when": { "kind": "absolute", "date": "<YYYY-MM-DD>" } or { "kind": "relative", "days": <int> },
  "with_doctor_id": <uuid, optional>,
  "with_specialty": <string, optional>,
  "reason": <string, optional>,
  "mode": <"in_person" | "tele_consult">,
  "bring": [<string>]
}

refer: {
  "to_doctor_id": <uuid, optional>,
  "to_specialty": <string, optional>,
  "is_external": <bool>,
  "external_doctor_name": <string, optional>,
  "external_facility": <string, optional>,
  "reason": <string, optional>,
  "specific_question": <string, optional>,
  "urgency": <"routine" | "urgent" | "emergent">,
  "attach_encounter": <bool>,
  "is_preop_clearance_for_plan_id": <uuid, optional>
}

diagnostics: {
  "lab_order_ids": [<uuid>],
  "urgency": <"routine" | "urgent" | "stat">,
  "post_result_action": <"return_to_doctor" | "discharge_with_protocol" | "auto_followup">,
  "post_result_followup_when": <string, optional>
}

imaging: {
  "modality": <"xray" | "ct" | "mri" | "us" | "mammography" | "dexa" | "other">,
  "body_part": <string>,
  "indication": <string>,
  "contrast": <"none" | "with" | "without" | "with_and_without">,
  "is_external": <bool>,
  "urgency": <"routine" | "urgent" | "stat">,
  "post_result_action": <"return_to_doctor" | "discharge_with_protocol" | "auto_followup">
}

medical_admission: {
  "bed_type": <"general_ward" | "private" | "semi_private" | "hdu" | "icu" | "step_down">,
  "admit_under_doctor_id": <uuid, optional>,
  "admit_under_specialty": <string, optional>,
  "anticipated_los_days": <int, optional>,
  "pre_admission_referrals_needed": [<"cardio" | "pulmo" | "nephro" | "endo" | "hema" | "id" | "other">],
  "special_orders": <string, optional>,
  "mrsa_screen": <bool, optional>,
  "fall_risk_assessment": <bool, optional>,
  "isolation_precautions": <"none" | "contact" | "droplet" | "airborne">
}

surgical_plan: {
  "procedure_name": <string>,
  "procedure_code": <string, optional>,
  "urgency": <"emergent" | "urgent" | "semi_urgent" | "elective">,
  "planned_date": <YYYY-MM-DD, optional>,
  "planned_admission_date": <YYYY-MM-DD, optional>,
  "surgeon_doctor_id": <uuid, optional>,
  "anesthesia_type": <"ga" | "regional" | "local" | "mac_sedation">,
  "expected_los_nights": <int, optional>,
  "preop_clearances_needed": [<"cardio" | "anesthesia" | "pulmo" | "nephro" | "endo" | "hema" | "other">],
  "preop_tests_to_repeat": [<string>],
  "blood_crossmatch_needed": <bool>,
  "blood_units": <int, optional>,
  "special_equipment": [<string>],
  "implants_needed": [<string>]
}

day_care_procedure: {
  "procedure_name": <string>,
  "scheduled_at": <ISO8601 timestamp>,
  "anesthesia_type": <"none" | "local" | "sedation" | "ga">,
  "preprocedure_prep": <string, optional>,
  "observation_hours": <int, optional>,
  "accompaniment_required": <bool>
}

vaccinate: {
  "vaccines": [
    {
      "name": <string>,
      "site": <"L-deltoid" | "R-deltoid" | "L-thigh" | "R-thigh" | "L-glute" | "R-glute" | "subcutaneous">,
      "next_dose_due_date": <YYYY-MM-DD, optional>
    }
  ],
  "vis_given": <bool>
}

emergency_transfer: {
  "target_facility": <string>,
  "transfer_mode": <"bls_ambulance" | "als_ambulance" | "private_vehicle" | "air">,
  "accompanying_staff": <"none" | "nurse" | "doctor">,
  "stabilization_status": <string, optional>,
  "interventions_completed": <string, optional>
}

counseling_only: {
  "topics": [<string>],
  "summary": <string>,
  "materials_given": [<string>],
  "followup_suggested": <bool>
}

refusal_of_advised_plan: {
  "advised_summary": <string>,
  "what_refused": <string>,
  "reason": <string>,
  "high_risk": <bool>
}

no_further_action: {
  "tracking_item": <string>,
  "next_review_trigger": <string, optional>
}

SCORING RUBRIC (use this to assign confidence):
- 0.85-1.00 — Strong evidence (acute hard finding, decompensated chronic condition, abnormal critical investigation, clear surgical indication). Plan is the top recommended action.
- 0.60-0.84 — Probable. Evidence supports this plan but a higher-acuity option exists or context is incomplete.
- 0.30-0.59 — Plausible. Plan fits the picture but other options are more likely.
- 0.10-0.29 — Lower probability but worth surfacing for completeness or as a backup.
- 0.00-0.09 — Don't include in top 5.

PRIORITIZE CLINICAL SAFETY:
- If the encounter shows ANY signs of an emergency (chest pain + ECG changes, sepsis criteria, GCS drop, respiratory distress, hypotension, severe hypoxia, suspected stroke), the #1 prediction MUST be either medical_admission, surgical_plan, or emergency_transfer — never discharge or follow_up.
- If the patient has any allergy that conflicts with a chosen drug/contrast, do not predict a plan that uses that drug/contrast without flagging the conflict in reasoning.
- Never predict refusal_of_advised_plan or no_further_action as rank #1 — these are reactive plans.

INDIAN OPD CONTEXT:
- Drug names may be brand (Indian formulary): Glycomet (metformin), Telma (telmisartan), Cardace (ramipril), Eltroxin (levothyroxine), etc.
- Vital ranges may show different baselines for South Asian populations (BP > 140/90, BMI > 23 cutoffs).
- Code-switching in chief complaint text (English with Hindi/Kannada) is normal — interpret it.

OUTPUT JSON ONLY. NO OTHER TEXT.`;

function buildUserMessage(snapshot: EncounterSnapshot): string {
  return `ENCOUNTER SNAPSHOT:

${JSON.stringify(snapshot, null, 2)}

Predict the top 5 plans. Output JSON only.`;
}

// ---------------------------------------------------------------------------
// 4. In-process LRU cache (60s TTL)
// ---------------------------------------------------------------------------

type CacheEntry = {
  hash: string;
  result: Extract<PredictionResult, { ok: true }>;
  expires_at: number;
};

const PREDICTION_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;

function cacheGet(hash: string): CacheEntry | null {
  const e = PREDICTION_CACHE.get(hash);
  if (!e) return null;
  if (e.expires_at < Date.now()) {
    PREDICTION_CACHE.delete(hash);
    return null;
  }
  return e;
}

function cacheSet(entry: CacheEntry): void {
  if (PREDICTION_CACHE.size >= CACHE_MAX_ENTRIES) {
    // Evict oldest insertion (Map preserves insertion order).
    const firstKey = PREDICTION_CACHE.keys().next().value;
    if (firstKey !== undefined) PREDICTION_CACHE.delete(firstKey);
  }
  PREDICTION_CACHE.set(entry.hash, entry);
}

/** Test/admin helper — clears the in-process cache. Never called in prod paths. */
export function clearPredictionCache(): void {
  PREDICTION_CACHE.clear();
}

// ---------------------------------------------------------------------------
// 5. predictPlans — orchestrator
// ---------------------------------------------------------------------------

const PLAN_KIND_SET = new Set<string>(PLAN_KINDS);

type RawQwenResponse = {
  predictions?: Array<{
    rank?: number;
    kind?: string;
    confidence?: number;
    reasoning?: string;
    prefill?: Record<string, unknown>;
  }>;
  encounter_severity_estimate?: string;
};

/**
 * Validates the raw qwen response and normalizes it to PredictedPlan[].
 * Drops items whose `kind` is not a known PlanKind. Clamps confidence to
 * [0, 1]. Sorts by rank then confidence. Caps to 5.
 */
function normalizePredictions(raw: RawQwenResponse): {
  predictions: PredictedPlan[];
  severity: 'low' | 'moderate' | 'high';
} {
  const items: PredictedPlan[] = [];
  for (const p of raw.predictions ?? []) {
    if (!p.kind || !PLAN_KIND_SET.has(p.kind)) continue;
    const conf = Math.max(0, Math.min(1, Number(p.confidence ?? 0)));
    items.push({
      rank: Math.max(1, Math.min(5, Math.floor(Number(p.rank ?? items.length + 1)))),
      kind: p.kind as PlanKind,
      confidence: Number(conf.toFixed(2)),
      reasoning: typeof p.reasoning === 'string' ? p.reasoning.slice(0, 600) : '',
      prefill: (p.prefill && typeof p.prefill === 'object') ? p.prefill : {},
    });
  }
  items.sort((a, b) => a.rank - b.rank || b.confidence - a.confidence);
  // Re-rank 1..N to be safe — model occasionally repeats ranks.
  items.forEach((p, i) => {
    p.rank = i + 1;
  });
  const trimmed = items.slice(0, 5);

  const rawSev = (raw.encounter_severity_estimate ?? '').toLowerCase();
  const severity: 'low' | 'moderate' | 'high' =
    rawSev === 'low' || rawSev === 'high' ? rawSev : 'moderate';

  return { predictions: trimmed, severity };
}

/**
 * Persist a successful prediction. Soft-fails — analytics, not authoritative.
 */
async function persistPrediction(
  encounterId: string,
  hash: string,
  predictions: PredictedPlan[],
  severity: string,
  latency_ms: number,
  model: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO plan_predictions
         (encounter_id, snapshot_hash, predictions, severity_estimate, model, model_latency_ms)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
      [
        encounterId,
        hash,
        JSON.stringify(predictions),
        severity,
        model,
        latency_ms,
      ],
    );
  } catch (e) {
    // Analytics insertion must not fail the request.
    console.warn(
      '[plan-prediction] persist failed',
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Main entry point. Resolves with either a successful PredictionResult or a
 * soft-failed `{ok:false, predictions:[], reason}`. Never throws.
 *
 * @param encounterId  Required for analytics persistence. Pass even if unknown.
 * @param snapshot     The pre-built snapshot.
 * @param opts.force   If true, bypass cache and force a fresh LLM call.
 */
export async function predictPlans(
  encounterId: string,
  snapshot: EncounterSnapshot,
  opts: { force?: boolean; emit?: PredictEmit; signal?: AbortSignal } = {},
): Promise<PredictionResult> {
  const hash = snapshotHash(snapshot);
  const emit = opts.emit ?? noopEmit;

  // v6.0 Phase 2C — emit a cache-hit event so the TracePanel renders
  // even on warm cache (1-event trace ending in done).
  if (!opts.force) {
    const cached = cacheGet(hash);
    if (cached) {
      emit({ type: 'progress', stage: 'generating' as any, msg: 'Cached prediction — no LLM call' });
      return { ...cached.result, cached: true };
    }
  }

  try {
    emit({ type: 'progress', stage: 'expanding' as any, msg: 'Building encounter snapshot for the model' });
    const t0 = Date.now();
    emit({ type: 'progress', stage: 'generating' as any, msg: 'Predicting top 5 plans with the reasoning model' });
    const { json, latency_ms, model } = await withHeartbeat(emit, 'generating' as any, 'Predicting top 5 plans', async () =>
      qwenJson<RawQwenResponse>(
        PREDICTION_SYSTEM_PROMPT,
        buildUserMessage(snapshot),
        { timeoutMs: 12_000, signal: opts.signal },
      ),
    );
    const total_ms = Date.now() - t0;
    emit({ type: 'progress', stage: 'parsing' as any, msg: 'Parsing predictions', ms: total_ms });
    const { predictions, severity } = normalizePredictions(json ?? {});

    const result: Extract<PredictionResult, { ok: true }> = {
      ok: true,
      predictions,
      severity_estimate: severity,
      model: model ?? QWEN_MODEL,
      latency_ms,
      snapshot_hash: hash,
      generated_at: new Date().toISOString(),
      cached: false,
    };

    cacheSet({
      hash,
      result,
      expires_at: Date.now() + CACHE_TTL_MS,
    });

    // Fire-and-forget persistence — don't block on it.
    void persistPrediction(
      encounterId,
      hash,
      predictions,
      severity,
      total_ms,
      result.model,
    );

    return result;
  } catch (e) {
    if (e instanceof QwenError) {
      const reason: Exclude<PredictionResult, { ok: true }>['reason'] =
        e.kind === 'timeout'
          ? 'llm_timeout'
          : e.kind === 'parse_error'
            ? 'llm_invalid_json'
            : 'llm_unavailable';
      return {
        ok: false,
        predictions: [],
        reason,
        detail: e.message,
        snapshot_hash: hash,
      };
    }
    return {
      ok: false,
      predictions: [],
      reason: 'llm_unavailable',
      detail: e instanceof Error ? e.message : String(e),
      snapshot_hash: hash,
    };
  }
}

// ---------------------------------------------------------------------------
// 6. Convenience: read the latest cached/persisted prediction for an encounter
// ---------------------------------------------------------------------------

/**
 * Returns the most recent persisted prediction for an encounter, regardless
 * of snapshot hash. Used by GET /api/encounters/[id]/predict-plans to render
 * something useful without spending an LLM call.
 */
export async function getLatestPrediction(
  encounterId: string,
): Promise<PredictionResult | null> {
  try {
    const { rows } = await pool.query<{
      snapshot_hash: string;
      predictions: unknown;
      severity_estimate: string | null;
      model: string;
      model_latency_ms: number | null;
      created_at: string;
    }>(
      `SELECT snapshot_hash, predictions, severity_estimate,
              model, model_latency_ms, created_at::text AS created_at
         FROM plan_predictions
        WHERE encounter_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [encounterId],
    );
    const row = rows[0];
    if (!row) return null;

    const items = Array.isArray(row.predictions) ? row.predictions : [];
    const predictions: PredictedPlan[] = items
      .map((p) => {
        const obj = (p ?? {}) as Record<string, unknown>;
        const kind = obj.kind;
        if (typeof kind !== 'string' || !PLAN_KIND_SET.has(kind)) return null;
        return {
          rank: Number(obj.rank ?? 0),
          kind: kind as PlanKind,
          confidence: Math.max(0, Math.min(1, Number(obj.confidence ?? 0))),
          reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
          prefill:
            obj.prefill && typeof obj.prefill === 'object'
              ? (obj.prefill as Record<string, unknown>)
              : {},
        };
      })
      .filter((x): x is PredictedPlan => x !== null);

    const sev = (row.severity_estimate ?? 'moderate').toLowerCase();
    const severity: 'low' | 'moderate' | 'high' =
      sev === 'low' || sev === 'high' ? sev : 'moderate';

    return {
      ok: true,
      predictions,
      severity_estimate: severity,
      model: row.model,
      latency_ms: row.model_latency_ms ?? 0,
      snapshot_hash: row.snapshot_hash,
      generated_at: row.created_at,
      cached: true,
    };
  } catch (e) {
    console.warn(
      '[plan-prediction] getLatestPrediction failed',
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}
