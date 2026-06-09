/**
 * Patient summary — input serialiser, prompt builder, and output validator.
 *
 * The Qwen client (`src/lib/qwen.ts`) handles transport. This module
 * handles the structured input we ship and the JSON shape we expect
 * back, per OPD-PATIENT-HISTORY-PRD §4.1.
 *
 * Output JSON schema:
 *   {
 *     summary_text: string (2-3 lines)
 *     problem_list: [{ label, since, status, current_meds[], last_managed_at, source_encounters[] }]
 *     medication_history: [{ generic, active, first_prescribed, last_prescribed, frequency_normal }]
 *     allergy_aggregation: [{ allergen, source, confidence }]
 *     cc_chip_rankings: string[24]
 *     cc_chip_additions: string[0..3]
 *     disposition_recommendation: enum
 *     disposition_additions: string[0..2]
 *     red_flags: [{ kind, text, severity }]
 *   }
 *
 * Validation is shape-only: required keys present, arrays are arrays, etc.
 * Anything else falls through as best-effort — the UI tolerates missing
 * fields, and the audit row records a 'schema_violation' result.
 */

import { createHash } from 'node:crypto';
import { pool } from '@/lib/db';
import { CC_CHIPS } from '@/lib/cc-chips';
import { qwenJson, QwenError, QWEN_MODEL } from '@/lib/qwen';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

// -----------------------------------------------------------------------------
// Input gathering
// -----------------------------------------------------------------------------

export type PatientDemographics = {
  id: string;
  mrn: string;
  name: string;
  age_years: number;
  sex: string | null;
  known_allergies: string | null;
};

export type EncounterForPrompt = {
  encounter_number: string;
  encounter_date: string; // YYYY-MM-DD
  chief_complaint_chips: string[] | null;
  chief_complaint_text: string | null;
  exam_findings: string | null;
  assessment_codes: string[] | null;
  assessment_text: string | null;
  disposition: string | null;
  follow_up_days: number | null;
  referral_target: string | null;
  prescription_lines: unknown | null;
};

export type DoctorOverrideRow = {
  target_kind: string;
  target_key: string;
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type SummaryInputBundle = {
  demographics: PatientDemographics;
  encounters: EncounterForPrompt[];
  overrides: DoctorOverrideRow[];
  window_start: string; // ISO date
  window_end: string;
};

/**
 * Pulls past 10 completed encounters OR 12 months (whichever is broader)
 * for the given patient, with prescription lines joined in. Newest first.
 */
export async function buildSummaryInput(patientId: string): Promise<SummaryInputBundle | null> {
  const { rows: pRows } = await pool.query<PatientDemographics>(
    `SELECT id, mrn, name, age_years, sex, known_allergies
       FROM patients WHERE id = $1 LIMIT 1`,
    [patientId],
  );
  const demographics = pRows[0];
  if (!demographics) return null;

  // Past 10 completed encounters OR everything from past 12 months,
  // whichever is broader. Postgres UNION over JSONB needs special handling
  // (JSONB doesn't define a hashable equality for set-dedup in all cases),
  // so we just pull the broader bucket — 12 months OR top 10 — with a
  // GREATEST clause via two passes in app code. For 25 seed patients
  // this is trivially small; revisit if patient history ever exceeds a
  // few dozen encounters.
  const { rows: encRows } = await pool.query<EncounterForPrompt & { id: string; completed_at: string | null }>(
    `SELECT e.id, e.encounter_number,
            e.encounter_date::text AS encounter_date,
            e.chief_complaint_chips, e.chief_complaint_text,
            e.exam_findings, e.assessment_codes, e.assessment_text,
            e.disposition::text AS disposition,
            e.follow_up_days, e.referral_target,
            p.lines AS prescription_lines,
            e.completed_at
       FROM encounters e
       LEFT JOIN prescriptions p ON p.encounter_id = e.id
      WHERE e.patient_id = $1
        AND e.status = 'completed'
      ORDER BY e.encounter_date DESC, e.completed_at DESC
      LIMIT 40`,
    [patientId],
  );

  // Of those, keep all rows in the last 365 days OR the first 10, whichever
  // bucket is larger.
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const last12Months = encRows.filter((r) => r.encounter_date >= cutoff);
  const top10 = encRows.slice(0, 10);
  const keep = last12Months.length >= top10.length ? last12Months : top10;
  // Re-slice encRows to the chosen set, preserving order.
  // (We can't reassign const, so build a new array.)
  const keepIds = new Set(keep.map((r) => r.id));
  const filtered = encRows.filter((r) => keepIds.has(r.id));

  // Compute window bounds. If no completed encounters, return empty window.
  const dates = filtered.map((r) => r.encounter_date).filter(Boolean);
  const window_end = dates[0] ?? new Date().toISOString().slice(0, 10);
  const window_start = dates[dates.length - 1] ?? window_end;

  // Strip the `id` and `completed_at` helper columns from the payload.
  const encounters: EncounterForPrompt[] = filtered.map((r) => ({
    encounter_number: r.encounter_number,
    encounter_date: r.encounter_date,
    chief_complaint_chips: r.chief_complaint_chips,
    chief_complaint_text: r.chief_complaint_text,
    exam_findings: r.exam_findings,
    assessment_codes: r.assessment_codes,
    assessment_text: r.assessment_text,
    disposition: r.disposition,
    follow_up_days: r.follow_up_days,
    referral_target: r.referral_target,
    prescription_lines: r.prescription_lines,
  }));

  // PH.5: pull doctor overrides for this patient. Newest-first so the
  // most recent guidance wins when the same target was edited twice.
  const { rows: overrideRows } = await pool.query<DoctorOverrideRow>(
    `SELECT target_kind, target_key, action, payload,
            created_at::text AS created_at
       FROM doctor_overrides
      WHERE patient_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [patientId],
  );

  return {
    demographics,
    encounters,
    overrides: overrideRows,
    window_start,
    window_end,
  };
}

// -----------------------------------------------------------------------------
// Prompt construction
// -----------------------------------------------------------------------------

export const SUMMARY_SYSTEM_PROMPT = `
You are a clinical summarisation assistant for OPD doctors at Even Hospital in Bengaluru, India.

You will be given:
  - patient demographics
  - the patient's past OPD encounters (chronological, newest first)
  - the catalogue of 24 standard chief-complaint chips the doctor can pick from
  - the catalogue of 6 standard disposition values

Your job is to return ONE JSON object summarising the patient's clinical history and predicting what the doctor will likely need to capture in TODAY's encounter. The doctor will see this output in a side panel while documenting.

Rules:
  - Output ONLY valid JSON. No prose, no markdown.
  - Be concise. Doctors scan, they do not read.
  - Use Indian generic-drug naming conventions (Telmisartan not Micardis).
  - If a problem appears resolved (e.g., URTI from 18 months ago, no recurrence), do not list it as active.
  - For cc_chip_rankings: re-rank ALL 24 standard chips in the order most likely to be relevant for this patient. Use exact chip labels from the provided catalogue. Do not invent.
  - For cc_chip_additions: 0 to 3 patient-specific net-new chip labels (e.g., "BP medication review", "HbA1c due"). These do NOT need to be in the standard catalogue.
  - HONOUR doctor_overrides: when the input includes overrides (PH.5), treat them as authoritative. If an override marks a problem as "resolved" or "dismiss", DO NOT re-list it as active. If an override renames a problem, use the new label. If an override dismisses an allergy as false_positive, DO NOT include it in allergy_aggregation.
  - For disposition_recommendation: pick ONE of: discharge, follow_up, refer, diagnostics, admit, vaccinate.
  - For disposition_additions: 0 to 2 short labels naming specialist referrals if relevant (e.g., "Refer to Dr. Iyer · Cardiology"). Empty array if none.
  - For red_flags: 0 to 5 items covering critical drug allergies, dangerous interactions, or recurring acute conditions.
  - Dates use YYYY-MM-DD or YYYY-MM. Use null if unknown.

Required output shape:
{
  "summary_text": "2-3 short sentences",
  "problem_list": [{ "label": "string", "since": "YYYY-MM|null", "status": "active|controlled|resolved", "current_meds": ["string"], "last_managed_at": "YYYY-MM-DD|null", "source_encounters": ["ENC-..."] }],
  "medication_history": [{ "generic": "string", "active": true|false, "first_prescribed": "YYYY-MM|null", "last_prescribed": "YYYY-MM-DD|null", "frequency_normal": "string" }],
  "allergy_aggregation": [{ "allergen": "string", "source": "string", "confidence": "high|medium|low" }],
  "cc_chip_rankings": ["24 items, all from the standard catalogue, re-ordered"],
  "cc_chip_additions": ["0-3 patient-specific chip labels"],
  "disposition_recommendation": "discharge|follow_up|refer|diagnostics|admit|vaccinate",
  "disposition_additions": ["0-2 strings"],
  "red_flags": [{ "kind": "allergy|drug_interaction|recurrence|other", "text": "string", "severity": "high|medium|low" }]
}
`.trim();

export function buildSummaryUserMessage(bundle: SummaryInputBundle): string {
  const standardChips = CC_CHIPS.map((c) => c.label);
  const standardDispositions = [
    'discharge',
    'follow_up',
    'refer',
    'diagnostics',
    'admit',
    'vaccinate',
  ];

  return JSON.stringify(
    {
      patient: bundle.demographics,
      standard_cc_chips: standardChips,
      standard_dispositions: standardDispositions,
      window: { start: bundle.window_start, end: bundle.window_end },
      encounters: bundle.encounters,
      // PH.5: doctor overrides — model must honour these.
      doctor_overrides: bundle.overrides,
    },
    null,
    2,
  );
}

// -----------------------------------------------------------------------------
// Output validation (shape-only, lenient)
// -----------------------------------------------------------------------------

export type ValidatedSummary = {
  summary_text: string;
  problem_list: unknown[];
  medication_history: unknown[];
  allergy_aggregation: unknown[];
  cc_chip_rankings: string[];
  cc_chip_additions: string[];
  disposition_recommendation: string;
  disposition_additions: string[];
  red_flags: unknown[];
};

export type ValidationResult =
  | { ok: true; value: ValidatedSummary }
  | { ok: false; reason: string };

const ALLOWED_DISPOSITIONS = new Set([
  'discharge',
  'follow_up',
  'refer',
  'diagnostics',
  'admit',
  'vaccinate',
]);

export function validateSummary(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_object' };
  const r = raw as Record<string, unknown>;

  const summary_text = typeof r.summary_text === 'string' ? r.summary_text : null;
  if (!summary_text) return { ok: false, reason: 'missing_summary_text' };

  const problem_list = Array.isArray(r.problem_list) ? r.problem_list : null;
  if (!problem_list) return { ok: false, reason: 'missing_problem_list' };

  const medication_history = Array.isArray(r.medication_history) ? r.medication_history : null;
  if (!medication_history) return { ok: false, reason: 'missing_medication_history' };

  const allergy_aggregation = Array.isArray(r.allergy_aggregation) ? r.allergy_aggregation : null;
  if (!allergy_aggregation) return { ok: false, reason: 'missing_allergy_aggregation' };

  const cc_chip_rankings = Array.isArray(r.cc_chip_rankings)
    ? r.cc_chip_rankings.filter((x): x is string => typeof x === 'string')
    : null;
  if (!cc_chip_rankings) return { ok: false, reason: 'missing_cc_chip_rankings' };

  const cc_chip_additions = Array.isArray(r.cc_chip_additions)
    ? r.cc_chip_additions.filter((x): x is string => typeof x === 'string')
    : [];

  const dispRec = typeof r.disposition_recommendation === 'string' ? r.disposition_recommendation : null;
  if (!dispRec) return { ok: false, reason: 'missing_disposition_recommendation' };
  if (!ALLOWED_DISPOSITIONS.has(dispRec)) {
    return { ok: false, reason: `bad_disposition_recommendation:${dispRec}` };
  }

  const disposition_additions = Array.isArray(r.disposition_additions)
    ? r.disposition_additions.filter((x): x is string => typeof x === 'string')
    : [];

  const red_flags = Array.isArray(r.red_flags) ? r.red_flags : [];

  return {
    ok: true,
    value: {
      summary_text,
      problem_list,
      medication_history,
      allergy_aggregation,
      cc_chip_rankings,
      cc_chip_additions,
      disposition_recommendation: dispRec,
      disposition_additions,
      red_flags,
    },
  };
}

// -----------------------------------------------------------------------------
// Core recompute — called by the API route + the admin backfill action.
// -----------------------------------------------------------------------------

export type RecomputeOutcome =
  | { ok: true; latency_ms: number; encounter_count: number; window: { start: string; end: string } }
  | { ok: false; reason: string; detail?: string };

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

async function writeQwenAudit(args: {
  patient_id: string;
  doctor_id: string | null;
  prompt: string;
  output: string;
  latency_ms: number | null;
  result:
    | 'success'
    | 'parse_error'
    | 'timeout'
    | 'schema_violation'
    | 'http_error'
    | 'network'
    | 'patient_not_found';
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO qwen_call_audit
         (patient_id, doctor_id, prompt_hash, output_hash, qwen_model, qwen_latency_ms, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        args.patient_id,
        args.doctor_id,
        sha256(args.prompt),
        sha256(args.output ?? ''),
        QWEN_MODEL,
        args.latency_ms,
        args.result,
      ],
    );
  } catch {
    /* swallow */
  }
}

/**
 * Recompute the summary for one patient. Upserts `patient_summaries`,
 * writes a `qwen_call_audit` row, returns a structured outcome.
 *
 * Used by:
 *   - POST /api/internal/recompute-summary (HTTP wrapper)
 *   - Admin "Backfill all summaries" server action (direct call)
 *   - (future PH.1.x) the post-/complete hook on encounter submit
 *
 * Never throws — Qwen failures become { ok: false, reason: ... } and
 * the patient_summaries row is left with status='failed' + fail_reason.
 */
export async function recomputePatientSummary(args: {
  patientId: string;
  doctorId: string | null;
}): Promise<RecomputeOutcome> {
  const { patientId, doctorId } = args;

  // v6.0 Phase 4 — open a trace for this background fire. The
  // BackgroundTraceToaster polling on the patient page picks this up
  // while it's in_progress; the AI activity tab lists it once done.
  const trace = await openTrace({
    surface: 'patient-summary',
    patient_id: patientId,
    doctor_email: null,
    request_input: { patientId, doctorId },
  });

  const bundle = await buildSummaryInput(patientId);
  if (!bundle) {
    await trace.finalise({ status: 'errored', error_message: 'patient_not_found' });
    return { ok: false, reason: 'patient_not_found' };
  }

  trace.event('expanding', `Loaded ${bundle.encounters.length} encounter${bundle.encounters.length === 1 ? '' : 's'} for window ${bundle.window_start} → ${bundle.window_end}`);

  // Mark as computing for observability.
  await pool.query(
    `INSERT INTO patient_summaries
       (patient_id, summary, source_encounter_count, source_window_start, source_window_end, qwen_model, status)
     VALUES ($1, '{}'::jsonb, $2, $3, $4, $5, 'computing')
     ON CONFLICT (patient_id) DO UPDATE SET status='computing'`,
    [patientId, bundle.encounters.length, bundle.window_start, bundle.window_end, QWEN_MODEL],
  );

  const userMessage = buildSummaryUserMessage(bundle);

  let qwenLatency: number | null = null;
  try {
    trace.event('generating', 'Drafting summary with the reasoning model');
    const result = await withHeartbeat(
      (ev) => {
        if (ev.type === 'progress') trace.event(ev.stage, ev.msg, ev.ms);
      },
      'generating',
      'Drafting patient summary',
      async () => qwenJson<unknown>(SUMMARY_SYSTEM_PROMPT, userMessage),
    );
    qwenLatency = result.latency_ms;
    trace.event('parsing', 'Validating summary schema', result.latency_ms);

    const v = validateSummary(result.json);
    if (!v.ok) {
      await writeQwenAudit({
        patient_id: patientId,
        doctor_id: doctorId,
        prompt: userMessage,
        output: result.raw,
        latency_ms: qwenLatency,
        result: 'schema_violation',
      });
      await pool.query(
        `UPDATE patient_summaries
            SET status='failed', fail_reason=$2, qwen_latency_ms=$3
          WHERE patient_id=$1`,
        [patientId, `schema_violation:${v.reason}`, qwenLatency],
      );
      return { ok: false, reason: 'schema_violation', detail: v.reason };
    }

    await pool.query(
      `INSERT INTO patient_summaries
         (patient_id, summary, source_encounter_count, source_window_start,
          source_window_end, qwen_model, qwen_latency_ms, computed_at, status, fail_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'fresh', NULL)
       ON CONFLICT (patient_id) DO UPDATE SET
         summary = EXCLUDED.summary,
         source_encounter_count = EXCLUDED.source_encounter_count,
         source_window_start = EXCLUDED.source_window_start,
         source_window_end = EXCLUDED.source_window_end,
         qwen_model = EXCLUDED.qwen_model,
         qwen_latency_ms = EXCLUDED.qwen_latency_ms,
         computed_at = NOW(),
         status = 'fresh',
         fail_reason = NULL`,
      [
        patientId,
        JSON.stringify(v.value),
        bundle.encounters.length,
        bundle.window_start,
        bundle.window_end,
        QWEN_MODEL,
        qwenLatency,
      ],
    );

    await writeQwenAudit({
      patient_id: patientId,
      doctor_id: doctorId,
      prompt: userMessage,
      output: result.raw,
      latency_ms: qwenLatency,
      result: 'success',
    });

    return {
      ok: true,
      latency_ms: qwenLatency,
      encounter_count: bundle.encounters.length,
      window: { start: bundle.window_start, end: bundle.window_end },
    };
  } catch (e: unknown) {
    const isQwenErr = e instanceof QwenError;
    const auditResult: 'parse_error' | 'timeout' | 'http_error' | 'network' = isQwenErr
      ? e.kind === 'timeout'
        ? 'timeout'
        : e.kind === 'http'
          ? 'http_error'
          : e.kind === 'parse_error'
            ? 'parse_error'
            : 'network'
      : 'network';
    const reason = e instanceof Error ? e.message : 'unknown';

    await writeQwenAudit({
      patient_id: patientId,
      doctor_id: doctorId,
      prompt: userMessage,
      output: '',
      latency_ms: qwenLatency,
      result: auditResult,
    });
    await pool.query(
      `UPDATE patient_summaries
          SET status='failed', fail_reason=$2, qwen_latency_ms=$3
        WHERE patient_id=$1`,
      [patientId, `${auditResult}:${reason.slice(0, 200)}`, qwenLatency],
    );

    return { ok: false, reason: auditResult, detail: reason };
  }
}

// -----------------------------------------------------------------------------
// Backfill status (PH.1.3)
// -----------------------------------------------------------------------------

export type SummaryBackfillStatus = {
  eligible: number;    // patients with ≥1 completed encounter
  fresh: number;       // up-to-date summaries
  computing: number;   // mid-run (rare)
  failed: number;      // last attempt errored
  missing: number;     // no row at all
  remaining: number;   // eligible - fresh
};

export async function getSummaryBackfillStatus(): Promise<SummaryBackfillStatus> {
  const { rows } = await pool.query<{
    eligible: string;
    fresh: string;
    computing: string;
    failed: string;
    missing: string;
  }>(
    `WITH eligible_patients AS (
       SELECT DISTINCT patient_id
         FROM encounters
        WHERE status = 'completed'
     )
     SELECT
       COUNT(*)::text AS eligible,
       COUNT(*) FILTER (WHERE s.status = 'fresh')::text AS fresh,
       COUNT(*) FILTER (WHERE s.status = 'computing')::text AS computing,
       COUNT(*) FILTER (WHERE s.status = 'failed')::text AS failed,
       COUNT(*) FILTER (WHERE s.patient_id IS NULL)::text AS missing
     FROM eligible_patients e
     LEFT JOIN patient_summaries s ON s.patient_id = e.patient_id`,
  );
  const r = rows[0] ?? { eligible: '0', fresh: '0', computing: '0', failed: '0', missing: '0' };
  const eligible = parseInt(r.eligible, 10);
  const fresh = parseInt(r.fresh, 10);
  return {
    eligible,
    fresh,
    computing: parseInt(r.computing, 10),
    failed: parseInt(r.failed, 10),
    missing: parseInt(r.missing, 10),
    remaining: Math.max(0, eligible - fresh),
  };
}
