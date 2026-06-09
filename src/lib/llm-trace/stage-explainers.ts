/**
 * src/lib/llm-trace/stage-explainers.ts
 *
 * Per-stage explainer content rendered in the TracePanel's explainer
 * card while a stage is active. Ported from even-staff-portal's
 * lib/cdmss/stage-explainers.ts with OPD-specific surface overrides.
 *
 * Educational + contextual + tied to live state — tells the doctor
 * WHAT the system is doing right now in clinician-friendly terms.
 */
export type StageExplainer = { title: string; body: string };

/**
 * Default explainers — used when a surface has no override for a given
 * stage. Mostly matches the portal's /ask-flavored copy.
 */
export const STAGE_EXPLAINERS: Record<string, StageExplainer> = {
  expanding: {
    title: 'Building context',
    body: 'Compiling the relevant clinical context from this encounter — chief complaint, history, exam, vitals, current Rx, comorbidities — into a structured input the model can reason over.',
  },
  variants: {
    title: 'Query variants generated',
    body: 'Multiple angles of the same clinical question are running in parallel against the knowledge base. The result sets are unioned, deduplicated, and the highest-scoring matches are kept.',
  },
  retrieving: {
    title: 'Hybrid retrieval',
    body: 'Searching the indexed clinical knowledge base — vector similarity (semantic match) plus keyword search, combined by Reciprocal Rank Fusion. The result pool is narrowed to the most relevant excerpts.',
  },
  reranking: {
    title: 'Cross-encoder reranking',
    body: 'A second model is re-scoring the top results against the clinical question. Vector search is fast at finding candidates but isn’t great at ranking them — the reranker takes the candidates and re-orders by question-specific relevance.',
  },
  fusing: {
    title: 'Source-quality fusion',
    body: 'Each retained excerpt is weighted by source quality before the reasoning model sees them.',
  },
  drafting: {
    title: 'Drafting',
    body: 'The reasoning model is writing the first draft, grounding every clinical claim against the retrieved sources. This is the slowest single step — large model, long context, careful generation.',
  },
  reviewing: {
    title: 'Auditing',
    body: 'The draft is being audited by a second model that looks for unsupported claims, missing caveats, clinical errors. If issues are found, the draft will be revised.',
  },
  revising: {
    title: 'Revising',
    body: 'The audit found issues. The model is rewriting the draft to fix every flagged problem while preserving the parts that were correct.',
  },
  generating: {
    title: 'Generating',
    body: 'The reasoning model is generating the response in a single pass without a separate audit step.',
  },
  finalizing: {
    title: 'Finalizing',
    body: 'Final formatting and persistence.',
  },
  parsing: {
    title: 'Parsing response',
    body: 'Parsing the model’s structured response into the application schema.',
  },
  persisting: {
    title: 'Saving trace',
    body: 'Persisting the full pipeline trace for forensic review.',
  },
  'cold-start': {
    title: 'Warming the model',
    body: 'The Mac Mini’s Ollama runtime is warming up — first request after a quiet period can take ~20s. Subsequent fires will be much faster.',
  },
  done: { title: 'Done', body: '' },
};

/**
 * /api/encounters/[id]/ddx — Differential generation. Multi-phase:
 * expand → retrieve → draft → audit → revise → parse.
 */
const DDX_EXPLAINERS: Record<string, StageExplainer> = {
  expanding: {
    title: 'Building the clinical picture',
    body: 'Compiling the chief complaint, exam findings, vitals, and assessment into a structured prompt. Past encounters with similar presentations are pulled in as additional context.',
  },
  retrieving: {
    title: 'Pulling relevant evidence',
    body: 'Searching the patient’s past encounters + the active problem list + comorbidities for context that might shift the differential.',
  },
  drafting: {
    title: 'Drafting the differential',
    body: 'The reasoning model is enumerating likely diagnoses, ranking by clinical likelihood, identifying cannot-miss conditions, and proposing distinguishing features + next investigations for each.',
  },
  reviewing: {
    title: 'Auditing the DDx',
    body: 'A second pass checks for missing cannot-miss diagnoses, likelihood errors, unsupported clinical claims, and gaps in distinguishing features. If issues are found, the DDx will be revised.',
  },
  revising: {
    title: 'Revising the DDx',
    body: 'The audit flagged issues. The reasoning model is regenerating the differential to address each finding.',
  },
  generating: {
    title: 'Reasoning through the case',
    body: 'Single-pass reasoning (Live mode — audit/revise off for speed). Lighter-weight differential without a second-opinion check.',
  },
  parsing: {
    title: 'Parsing the differential',
    body: 'Converting the model output into the structured DDx schema (cannot-miss diagnoses, likelihood, distinguishing features, next investigations).',
  },
};

/**
 * /api/transcribe-compare — Parallel Deepgram + Whisper + qwen judge.
 */
const TRANSCRIBE_EXPLAINERS: Record<string, StageExplainer> = {
  'transcribing-deepgram': {
    title: 'Deepgram (cloud)',
    body: 'Sending the audio to Deepgram’s nova-3-medical model, biased for Indian English clinical speech. Fastest path — expect ~1–2s.',
  },
  'deepgram-complete': {
    title: 'Deepgram returned',
    body: 'Cloud transcription complete. Waiting for Whisper (Mac Mini) to finish so the judge can compare.',
  },
  'transcribing-whisper': {
    title: 'Whisper (Mac Mini)',
    body: 'Sending the same audio to your Mac Mini’s Whisper large-v3-turbo in parallel. Local inference — expect ~3–10s depending on audio length.',
  },
  'whisper-complete': {
    title: 'Whisper returned',
    body: 'Mac Mini transcription complete. Both transcripts are now in.',
  },
  judging: {
    title: 'Comparing the two',
    body: 'qwen2.5:14b is scoring both transcripts 1–10 on clinical accuracy, picking a winner, and explaining the delta.',
  },
};

/**
 * /api/encounters/[id]/suggest-orders — fast single-call.
 */
const SUGGEST_ORDERS_EXPLAINERS: Record<string, StageExplainer> = {
  expanding: {
    title: 'Building catalog context',
    body: 'Narrowing the EHRC service catalog (2,300+ tests) by keyword relevance to the reason for visit. Top 200 candidates go to the model.',
  },
  generating: {
    title: 'Suggesting orders',
    body: 'The model is picking 3–8 tests most relevant to the current presentation, with rationale + confidence + citation numbers.',
  },
  parsing: {
    title: 'Parsing suggestions',
    body: 'Converting the model output into the order-suggestion schema.',
  },
};

/**
 * /api/encounters/[id]/predict-plans — v5.1 AI plan prediction.
 */
const PREDICT_PLANS_EXPLAINERS: Record<string, StageExplainer> = {
  expanding: {
    title: 'Building encounter snapshot',
    body: 'Compiling patient demographics, comorbidities, allergies, today’s vitals + exam + assessment + Rx + ordered labs into the snapshot the model will reason over.',
  },
  generating: {
    title: 'Predicting top 5 plans',
    body: 'The reasoning model is ranking the 13 plan kinds (discharge / follow-up / refer / diagnostics / imaging / admission / surgery / day-care / vaccinate / emergency-transfer / counseling / refusal / tracking-only) by clinical likelihood and pre-filling each plan’s structured payload.',
  },
  parsing: {
    title: 'Parsing predictions',
    body: 'Validating the model’s top-5 list against the plan_kind enum and the per-kind schemas. Invalid suggestions are dropped.',
  },
};

/**
 * /api/encounters/[id]/voice-query — voice question against the chart.
 */
const VOICE_QUERY_EXPLAINERS: Record<string, StageExplainer> = {
  transcribing: {
    title: 'Transcribing your question',
    body: 'Deepgram is converting your spoken question into text.',
  },
  expanding: {
    title: 'Building chart context',
    body: 'Compiling the patient’s active problems, current Rx, last 5 encounters, recent labs into context the model can answer against.',
  },
  generating: {
    title: 'Answering from the chart',
    body: 'The reasoning model is answering your question grounded in this patient’s actual data — not generic clinical knowledge.',
  },
};

/**
 * /api/encounters/[id]/rx-coherence — checks the Rx for issues.
 */
const RX_COHERENCE_EXPLAINERS: Record<string, StageExplainer> = {
  generating: {
    title: 'Checking Rx coherence',
    body: 'The model is reviewing the current prescription for drug-allergy conflicts, dose appropriateness for age/weight/renal function, duplication, and missing supportive meds.',
  },
};

/**
 * /api/encounters/[id]/ddi-scan — drug-drug interaction scan.
 */
const DDI_SCAN_EXPLAINERS: Record<string, StageExplainer> = {
  retrieving: {
    title: 'Pairwise excerpt retrieval',
    body: 'For n drugs we check n(n-1)/2 pairs. Excerpt retrieval + class-overlap pre-flag run in parallel for each pair.',
  },
  generating: {
    title: 'Analyzing pairs',
    body: 'The reasoning model is classifying each pair’s severity (contraindicated / major / moderate / minor) and writing the mechanism + management.',
  },
};

/**
 * Comorbidity-related explainers — shared across history / context /
 * states / interpret surfaces.
 */
const COMORBIDITY_EXPLAINERS: Record<string, StageExplainer> = {
  expanding: {
    title: 'Loading patient history',
    body: 'Pulling the past completed encounters + current problem list + active Rx to give the model the full picture.',
  },
  generating: {
    title: 'Inferring comorbidities',
    body: 'The model is identifying chronic conditions implied by the history, current Rx, or recurrent symptoms — flagging anything not already on the problem list.',
  },
  parsing: {
    title: 'Validating ICD-10 codes',
    body: 'Looking up each inferred condition against the ICD-10 catalog and dropping anything that doesn’t resolve to a real code.',
  },
};

/**
 * ICD-10 helpers — suggest / interpret / lookup-batch.
 */
const ICD10_EXPLAINERS: Record<string, StageExplainer> = {
  generating: {
    title: 'Suggesting ICD-10 codes',
    body: 'The model is reading the assessment text and proposing matching ICD-10 codes with rationale + confidence.',
  },
  parsing: {
    title: 'Looking up codes',
    body: 'Resolving each suggested code against the ICD-10 catalog and dropping any that don’t match.',
  },
};

/**
 * Patient-summary — background recompute.
 */
const PATIENT_SUMMARY_EXPLAINERS: Record<string, StageExplainer> = {
  expanding: {
    title: 'Loading encounter history',
    body: 'Aggregating the past 10 completed encounters (or 12 months, whichever is broader) + comorbidities + current Rx + doctor overrides.',
  },
  generating: {
    title: 'Drafting the summary',
    body: 'The reasoning model is producing the structured patient-summary JSON: problems, current Rx, allergies, key past events, narrative.',
  },
  parsing: {
    title: 'Validating the summary',
    body: 'Checking the model output against the summary schema; flagging any required field that’s missing or malformed.',
  },
};

/**
 * Diagnostics-interpret — uploaded report PDF interpretation.
 */
const DIAGNOSTICS_INTERPRET_EXPLAINERS: Record<string, StageExplainer> = {
  expanding: {
    title: 'Extracting report text',
    body: 'Running OCR + structure extraction on the uploaded PDF to pull lab values, ranges, units, and the impression text.',
  },
  generating: {
    title: 'Interpreting the report',
    body: 'The reasoning model is flagging abnormal values in the patient’s clinical context, identifying critical results, and proposing follow-up.',
  },
};

/**
 * Get the explainer for a stage on a given surface. Falls back to
 * STAGE_EXPLAINERS when no override exists.
 */
export function getStageExplainer(
  stage: string,
  surface?: string,
): StageExplainer | undefined {
  switch (surface) {
    case 'ddx':
      return DDX_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'transcribe-compare':
      return TRANSCRIBE_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'suggest-orders':
      return SUGGEST_ORDERS_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'predict-plans':
      return PREDICT_PLANS_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'voice-query':
      return VOICE_QUERY_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'rx-coherence':
      return RX_COHERENCE_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'ddi-scan':
      return DDI_SCAN_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'comorbidity-history':
    case 'comorbidity-context':
    case 'comorbidity-states':
    case 'comorbidities-interpret':
      return COMORBIDITY_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'icd10-suggest':
    case 'icd10-interpret':
      return ICD10_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'patient-summary':
      return PATIENT_SUMMARY_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    case 'diagnostics-interpret':
      return DIAGNOSTICS_INTERPRET_EXPLAINERS[stage] ?? STAGE_EXPLAINERS[stage];
    default:
      return STAGE_EXPLAINERS[stage];
  }
}
