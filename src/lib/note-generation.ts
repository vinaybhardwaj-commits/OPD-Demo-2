/**
 * note-generation — OPD-Demo-2 P2.3. Per-session (and whole-encounter)
 * structured draft notes from speaker-tagged transcripts.
 *
 * Adapted from ETA lib/note-generation.ts prompt scaffolding, but targeting
 * OPD's OWN note schema (P2.3 lock — NOT ETA's EncounterNote): the design
 * §10.3 Sections, including a differential list. Speaker-aware: when the
 * P2.2 tagged transcript exists, each line carries the speaker's name/role
 * so patient-reported history and clinician findings stay attributed.
 *
 * Model: qwen2.5:14b via the shared LLM tunnel (lib/qwen.ts qwenJson —
 * JSON mode, QwenError taxonomy). Env override: NOTE_MODEL.
 */
import { qwenJson, QwenError, QWEN_MODEL } from './qwen';
import type { TaggedEntry } from './diarize';

export const NOTE_MODEL = process.env.NOTE_MODEL || QWEN_MODEL;
const NOTE_TIMEOUT_MS = 120_000;
const NOTE_TEMPERATURE = 0.2;

/** OPD structured draft note — design §10.3 sections (P2.3 lock). */
export type OpdNote = {
  chief_complaint: string;
  history_present_illness: string;
  past_medical_history: string[];
  current_medications: string[];
  allergies: string[];
  examination: string;
  differential: string[];
  assessment: string;
  plan: {
    investigations: string[];
    treatment: string[];
    follow_up: string;
  };
};

/** The OPD note JSON schema block — shared by the per-session prompt and the
 *  P3 stitch prompt so both always emit the same shape. */
export const OPD_NOTE_SCHEMA_BLOCK = `{
  "chief_complaint": string,                      // one line, patient's words when possible
  "history_present_illness": string,              // 2-6 sentence prose narrative
  "past_medical_history": [string, ...],          // each comorbidity/condition mentioned
  "current_medications": [string, ...],           // include dose + frequency when stated
  "allergies": [string, ...],                     // empty array if NKDA or not discussed
  "examination": string,                          // exam findings prose, may include vital signs
  "differential": [string, ...],                  // differentials the clinician actually voiced, most likely first
  "assessment": string,                           // working dx + clinical reasoning as stated
  "plan": {
    "investigations": [string, ...],              // labs, imaging, procedures ordered
    "treatment": [string, ...],                   // medications started/changed + non-drug treatments
    "follow_up": string                           // when to return, red-flag advice
  }
}`;

const SYSTEM = `You are converting an outpatient clinic consultation into a structured OPD Encounter Note. The transcript may be in English, an Indian language (e.g. Hindi, Kannada), or code-mixed — ALWAYS write the note in clear clinical English, translating faithfully and never adding content. Use ONLY information explicitly stated in the transcript — do not invent symptoms, medications, exam findings, doses, differentials, or follow-up plans. If a section was not discussed, return an empty string or empty array for that field.

The transcript may be speaker-tagged, one utterance per line, e.g.:
  Dr Sharma (clinician): ...
  Patient (patient): ...
  Speaker 2 (other): ...
Attribute information correctly: symptoms and history reported by the patient (or an attender) belong in the history sections; findings, impressions and instructions stated by the clinician belong in examination, assessment and plan. Never attribute a statement to the clinician that the patient made, or vice versa. If the transcript is untagged, infer attribution conservatively from content.

Return ONLY a JSON object matching exactly this schema (no preamble, no markdown fence, no explanation):

{
  "chief_complaint": string,                      // one line, patient's words when possible
  "history_present_illness": string,              // 2-6 sentence prose narrative
  "past_medical_history": [string, ...],          // each comorbidity/condition mentioned
  "current_medications": [string, ...],           // include dose + frequency when stated
  "allergies": [string, ...],                     // empty array if NKDA or not discussed
  "examination": string,                          // exam findings prose, may include vital signs
  "differential": [string, ...],                  // differentials the clinician actually voiced, most likely first
  "assessment": string,                           // working dx + clinical reasoning as stated
  "plan": {
    "investigations": [string, ...],              // labs, imaging, procedures ordered
    "treatment": [string, ...],                   // medications started/changed + non-drug treatments
    "follow_up": string                           // when to return, red-flag advice
  }
}

Style rules:
- Preserve exact medication doses, frequencies, lab values, vital signs, exam findings
- Use clinical shorthand the doctor used (BD/TDS/QID/PRN/SOB/CP) — don't expand
- Prefer the doctor's wording over reformulation
- Do not add a diagnosis or differential the doctor didn't state
- If the transcript is too short or non-clinical, fill what you can and leave the rest empty`;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];

/** Coerce the model's JSON into a well-formed OpdNote (no throw). */
export function normalizeOpdNote(j: unknown): OpdNote {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const plan = (o.plan && typeof o.plan === 'object' ? o.plan : {}) as Record<string, unknown>;
  return {
    chief_complaint: str(o.chief_complaint),
    history_present_illness: str(o.history_present_illness),
    past_medical_history: strArr(o.past_medical_history),
    current_medications: strArr(o.current_medications),
    allergies: strArr(o.allergies),
    examination: str(o.examination),
    differential: strArr(o.differential),
    assessment: str(o.assessment),
    plan: {
      investigations: strArr(plan.investigations),
      treatment: strArr(plan.treatment),
      follow_up: str(plan.follow_up),
    },
  };
}

export function noteHasContent(n: OpdNote): boolean {
  return !!(
    n.chief_complaint || n.history_present_illness || n.examination || n.assessment ||
    n.past_medical_history.length || n.current_medications.length || n.differential.length ||
    n.plan.investigations.length || n.plan.treatment.length || n.plan.follow_up
  );
}

/**
 * Build the note-gen input from the P2.2 tagged transcript when present
 * (speaker-attributed lines), else the plain canonical transcript.
 */
export function transcriptForNote(
  tagged: unknown,
  plain: string | null | undefined,
): string {
  if (Array.isArray(tagged) && tagged.length > 0) {
    const lines = (tagged as TaggedEntry[])
      .filter((t) => t && typeof t.text === 'string' && t.text.trim().length > 0)
      .map((t) => `${t.name || 'Speaker'} (${t.type || 'other'}): ${t.text.trim()}`);
    if (lines.length > 0) return lines.join('\n');
  }
  return (plain ?? '').trim();
}

export type NoteGenResult =
  | { ok: true; note: OpdNote; latency_ms: number; model: string }
  | { ok: false; error: string; latency_ms: number };

/** Generate one OPD draft note. Never throws. */
export async function generateOpdNote(
  transcript: string,
  opts: { signal?: AbortSignal } = {},
): Promise<NoteGenResult> {
  const clean = transcript.trim();
  if (clean.length === 0) return { ok: false, error: 'empty_transcript', latency_ms: 0 };
  const t0 = Date.now();
  try {
    const r = await qwenJson<unknown>(SYSTEM, `Transcript:\n\n${clean}`, {
      model: NOTE_MODEL,
      temperature: NOTE_TEMPERATURE,
      timeoutMs: NOTE_TIMEOUT_MS,
      signal: opts.signal,
    });
    return { ok: true, note: normalizeOpdNote(r.json), latency_ms: r.latency_ms, model: r.model };
  } catch (e) {
    const latency_ms = Date.now() - t0;
    if (e instanceof QwenError) {
      return { ok: false, error: `${e.kind}: ${e.message}`.slice(0, 300), latency_ms };
    }
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300), latency_ms };
  }
}
