/**
 * cdmss-pipeline — OPD-Demo-2 P2.4. KB-grounded, citation-audited clinical
 * decision support over the encounter's draft note. Adapted from ETA
 * lib/cdmss-pipeline.ts (PRD §4.11 flow) onto OPD's OpdNote + shared KB.
 *
 * Flow: seed question from OpdNote → retrieve top-K excerpts (lib/kb.ts
 * kbRetrieve — HyDE expansion + nomic embed + pgvector over the 418k-chunk
 * KB) → draft (qwen2.5:14b, JSON, [N] cites) → critique (llama3.1:8b,
 * citation audit) → revise (qwen2.5:14b, only when critique flags).
 *
 * Output (P2.4 lock — V: "all 6"): one cited payload with SIX groups —
 * OPD design §12.2's two ACTIONABLE groups (what_to_do {kind, summary,
 * reasoning}, what_else_to_ask {question, rationale} — these become
 * encounter_cdmss_items accept/ignore rows) + ETA's four ADVISORY groups
 * (differentials_to_consider, red_flags, evidence_based_suggestions,
 * follow_up_considerations — display-only in the violet card).
 * Outcome probabilities stay P3.
 *
 * Soft-fail (P2.4 lock): CDS is advisory — every failure tier returns
 * ok:false and the caller records cdmss_error; never blocks 'ready'.
 */
import { qwenJson, QwenError } from './qwen';
import { kbHyDE, kbEmbed, kbVectorSearch, type KbChunk } from './kb';
import type { OpdNote } from './note-generation';

const DRAFT_MODEL = process.env.CDS_DRAFT_MODEL || 'qwen2.5:14b';
const CRITIQUE_MODEL = process.env.CDS_CRITIQUE_MODEL || 'llama3.1:8b';
const REVISE_MODEL = process.env.CDS_REVISE_MODEL || 'qwen2.5:14b';
const PROB_MODEL = process.env.CDS_PROB_MODEL || 'qwen2.5:14b';
const DRAFT_TIMEOUT_MS = 180_000;
const CRITIQUE_TIMEOUT_MS = 45_000;
const REVISE_TIMEOUT_MS = 90_000;
const PROB_TIMEOUT_MS = 90_000;

export type CdmssSource = {
  index: number; // 1-based citation marker
  id: number;
  book: string | null;
  chapter: string | null;
  section: string | null;
  page_start: number | null;
  page_end: number | null;
  excerpt: string;
  similarity: number;
};

export type WhatToDoKind = 'investigation' | 'treatment' | 'referral' | 'follow_up' | 'red_flag';
export type WhatToDoItem = { kind: WhatToDoKind; summary: string; reasoning: string; cites: number[] };
export type WhatElseItem = { question: string; rationale: string; cites: number[] };
export type CitedItem = { text: string; cites: number[] };
export type CitedDdx = { dx: string; why: string; cites: number[] };
/** P3b — one outcome-probability row (§12.2.3, two LOCKED groups). */
export type ProbRow = {
  label: string;
  group: 'differential' | 'risk';
  pct: number;
  basis: string;
  cites: number[];
};

export type OpdCdmss = {
  what_to_do: WhatToDoItem[];
  what_else_to_ask: WhatElseItem[];
  differentials_to_consider: CitedDdx[];
  red_flags: CitedItem[];
  evidence_based_suggestions: CitedItem[];
  follow_up_considerations: CitedItem[];
  /** P3b: differential likelihoods + clinical-outcome/risk probabilities. */
  probabilities: ProbRow[];
  sources: CdmssSource[];
  retrieval_meta?: {
    topK: number;
    hits: number;
    top_book: string | null;
    top_sim: number;
    draft_ms: number;
    critique_ms?: number;
    revise_ms?: number;
    prob_ms?: number;
    used_critique: boolean;
    used_revise: boolean;
  };
};

export type CdmssResult =
  | { ok: true; cdmss: OpdCdmss; latency_ms: number; models: Array<{ model: string; latency_ms: number }> }
  | { ok: false; error: string; latency_ms: number };

// ---------- seed ----------

export function noteToSeedQuery(note: OpdNote): string {
  const lines: string[] = [];
  if (note.chief_complaint) lines.push(`Chief complaint: ${note.chief_complaint}`);
  if (note.assessment) lines.push(`Working assessment: ${note.assessment}`);
  if (note.history_present_illness) lines.push(`HPI: ${note.history_present_illness}`);
  if (note.examination) lines.push(`Exam findings: ${note.examination}`);
  if (note.differential.length) lines.push(`Stated differentials: ${note.differential.join('; ')}`);
  if (note.past_medical_history.length) lines.push(`PMH: ${note.past_medical_history.join('; ')}`);
  if (note.current_medications.length) lines.push(`Medications: ${note.current_medications.join('; ')}`);
  const plan = [
    ...note.plan.investigations.map((s) => `investigation: ${s}`),
    ...note.plan.treatment.map((s) => `treatment: ${s}`),
  ];
  if (plan.length) lines.push(`Current plan: ${plan.join('; ')}`);
  return lines.join('\n');
}

// ---------- sanitizers ----------

function sanitizeCites(v: unknown, maxIndex: number): number[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(
      v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
        .map((x) => Math.floor(x))
        .filter((x) => x >= 1 && x <= maxIndex),
    ),
  ).slice(0, 5);
}
function sStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function sanitizeCitedItems(v: unknown, maxIndex: number): CitedItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o) => {
      if (typeof o === 'string') return { text: o.slice(0, 800), cites: [] as number[] };
      if (o && typeof o === 'object') {
        const obj = o as { text?: unknown; cites?: unknown };
        return { text: sStr(obj.text, 800), cites: sanitizeCites(obj.cites, maxIndex) };
      }
      return { text: '', cites: [] as number[] };
    })
    .filter((x) => x.text.length > 0)
    .slice(0, 15);
}
const KINDS: WhatToDoKind[] = ['investigation', 'treatment', 'referral', 'follow_up', 'red_flag'];
function sanitizeWhatToDo(v: unknown, maxIndex: number): WhatToDoItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o) => {
      if (!o || typeof o !== 'object') return null;
      const x = o as { kind?: unknown; summary?: unknown; reasoning?: unknown; cites?: unknown };
      const kind = KINDS.includes(x.kind as WhatToDoKind) ? (x.kind as WhatToDoKind) : 'follow_up';
      return {
        kind,
        summary: sStr(x.summary, 300),
        reasoning: sStr(x.reasoning, 600),
        cites: sanitizeCites(x.cites, maxIndex),
      };
    })
    .filter((x): x is WhatToDoItem => x !== null && x.summary.length > 0)
    .slice(0, 10);
}
function sanitizeWhatElse(v: unknown, maxIndex: number): WhatElseItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o) => {
      if (!o || typeof o !== 'object') return null;
      const x = o as { question?: unknown; rationale?: unknown; cites?: unknown };
      return {
        question: sStr(x.question, 300),
        rationale: sStr(x.rationale, 600),
        cites: sanitizeCites(x.cites, maxIndex),
      };
    })
    .filter((x): x is WhatElseItem => x !== null && x.question.length > 0)
    .slice(0, 10);
}
function sanitizeDdx(v: unknown, maxIndex: number): CitedDdx[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o) => {
      if (!o || typeof o !== 'object') return null;
      const x = o as { dx?: unknown; why?: unknown; cites?: unknown };
      return { dx: sStr(x.dx, 200), why: sStr(x.why, 600), cites: sanitizeCites(x.cites, maxIndex) };
    })
    .filter((x): x is CitedDdx => x !== null && x.dx.length > 0)
    .slice(0, 5);
}

function sanitizeProbs(v: unknown, maxIndex: number): ProbRow[] {
  if (!Array.isArray(v)) return [];
  const rows = v
    .map((o) => {
      if (!o || typeof o !== 'object') return null;
      const x = o as { label?: unknown; group?: unknown; pct?: unknown; basis?: unknown; cites?: unknown };
      const group = x.group === 'differential' || x.group === 'risk' ? x.group : null;
      const pct = typeof x.pct === 'number' && Number.isFinite(x.pct) ? Math.max(0, Math.min(100, Math.round(x.pct))) : null;
      if (!group || pct === null) return null;
      return {
        label: sStr(x.label, 160),
        group,
        pct,
        basis: sStr(x.basis, 400),
        cites: sanitizeCites(x.cites, maxIndex),
      };
    })
    .filter((x): x is ProbRow => x !== null && x.label.length > 0);
  return [
    ...rows.filter((r) => r.group === 'differential').slice(0, 6),
    ...rows.filter((r) => r.group === 'risk').slice(0, 5),
  ];
}

// ---------- prompts ----------

const DRAFT_SYSTEM = `You are a clinical decision support assistant reviewing an outpatient encounter note alongside excerpts from a medical knowledge base (MKSAP, StatPearls, UpToDate and similar). Surface what an attentive senior physician would point out.

You will receive numbered SOURCE excerpts. For every claim you make, cite the supporting source excerpts via the "cites" field (array of 1-based source numbers). If no source supports a claim, do NOT make the claim.

Return ONLY a JSON object matching exactly this schema (no preamble, no markdown fence):

{
  "what_to_do": [
    { "kind": "investigation" | "treatment" | "referral" | "follow_up" | "red_flag", "summary": string, "reasoning": string, "cites": [number, ...] }
  ],
  "what_else_to_ask": [
    { "question": string, "rationale": string, "cites": [number, ...] }
  ],
  "differentials_to_consider": [
    { "dx": string, "why": string, "cites": [number, ...] }
  ],
  "red_flags": [
    { "text": string, "cites": [number, ...] }
  ],
  "evidence_based_suggestions": [
    { "text": string, "cites": [number, ...] }
  ],
  "follow_up_considerations": [
    { "text": string, "cites": [number, ...] }
  ]
}

Group meanings — keep them distinct, do not duplicate one item across groups:
- what_to_do: concrete ADDITIONS to the current plan the doctor should consider ordering or doing now (each is one actionable order/step; "summary" is the order itself, "reasoning" the one-line why; kind "red_flag" = an urgent action triggered by a present finding)
- what_else_to_ask: specific history or examination questions NOT yet covered that would change management, derived from the working differential
- differentials_to_consider: at most 5 diagnoses beyond those already stated, ordered by likelihood, each with why it fits this presentation
- red_flags: present-tense findings or absences in THIS note warranting urgent attention (statements, not orders)
- evidence_based_suggestions: guideline/management pearls about what is ALREADY planned (dosing, duration, monitoring) — not new orders
- follow_up_considerations: safety-netting and return advice

Rules:
- Be specific — "ECG plus high-sensitivity troponin now" not "cardiac workup"
- Every item MUST have at least one supporting cite; otherwise omit it
- Do not repeat what the note already plans, except to refine it (evidence_based_suggestions)
- Empty arrays are valid when nothing applies`;


const PROB_SYSTEM = `You estimate clinical probabilities for an outpatient encounter, grounded in the SOURCE excerpts. Two labeled groups:

1. group "differential" — likelihood of each candidate diagnosis given THIS presentation. Start from the differentials already entertained (listed in the context); you MAY add a diagnosis nobody voiced IF the sources clearly support it for this presentation. Percentages across the differential group should approximately sum to 100 (an "Other" row is allowed).
2. group "risk" — clinical-outcome/risk probabilities relevant to this patient (e.g. likelihood of hospital admission, deterioration within 48h, a specific complication). These are independent probabilities, NOT a distribution.

Return ONLY a JSON object:
{
  "probabilities": [
    { "label": string, "group": "differential" | "risk", "pct": number, "basis": string, "cites": [number, ...] }
  ]
}

Rules:
- "basis" = ONE line citing the discriminating features ("burning post-prandial pain + age <50 + no exertional component")
- Every row needs at least one source cite; omit rows you cannot ground
- pct are integers 0-100; be conservative — avoid false precision beyond 5% steps
- At most 6 differential rows and 5 risk rows; fewer is better than padded`;

const CRITIQUE_SYSTEM = `You are auditing a draft clinical decision support output for citation support. You will receive:
1. The numbered SOURCE excerpts the draft was generated from
2. The draft JSON

For each item across ALL six groups (what_to_do, what_else_to_ask, differentials_to_consider, red_flags, evidence_based_suggestions, follow_up_considerations), verify the cited source excerpts actually support the claim. List items where the citation is missing, irrelevant, or contradicts the source.

Return ONLY a JSON object:

{
  "unsupported_items": [
    { "category": string, "item_text": string, "problem": string }
  ],
  "overall_quality": "good" | "needs_revision"
}

If everything is well-supported, return empty unsupported_items and overall_quality "good".`;

const REVISE_SYSTEM = `You are revising a clinical decision support draft based on critique feedback. The original SOURCES are unchanged. The critique identified specific items as unsupported.

For each unsupported item, either:
- Find a different source that DOES support the claim, and cite it
- Rewrite the claim to match what the sources actually say
- Remove the item entirely

Return the SAME six-group JSON schema as the draft (what_to_do, what_else_to_ask, differentials_to_consider, red_flags, evidence_based_suggestions, follow_up_considerations). Every remaining claim must have at least one cite. Return ONLY the revised JSON.`;

// ---------- helpers ----------

function formatSources(hits: KbChunk[]): { numbered: string; sources: CdmssSource[] } {
  const sources: CdmssSource[] = hits.map((h, i) => ({
    index: i + 1,
    id: h.id,
    book: h.book ?? null,
    chapter: h.chapter,
    section: h.section,
    page_start: h.page_start,
    page_end: h.page_end,
    excerpt: (h.text || '').slice(0, 1200),
    similarity: typeof h.similarity === 'number' ? Number(h.similarity.toFixed(4)) : 0,
  }));
  const numbered = sources
    .map((s) => `[${s.index}] ${s.book ?? '—'} · ${s.chapter ?? '—'}${s.section ? ` · ${s.section}` : ''}\n${s.excerpt}`)
    .join('\n\n---\n\n');
  return { numbered, sources };
}

type RawDraft = {
  what_to_do?: unknown;
  what_else_to_ask?: unknown;
  differentials_to_consider?: unknown;
  red_flags?: unknown;
  evidence_based_suggestions?: unknown;
  follow_up_considerations?: unknown;
};
type RawCritique = { unsupported_items?: unknown; overall_quality?: string };
type RawProbs = { probabilities?: unknown };

async function callJson<T>(
  model: string,
  timeoutMs: number,
  system: string,
  user: string,
  temperature: number,
): Promise<{ ok: true; data: T; raw: string; latency_ms: number } | { ok: false; error: string; latency_ms: number }> {
  const t0 = Date.now();
  try {
    const r = await qwenJson<T>(system, user, { model, timeoutMs, temperature });
    return { ok: true, data: r.json, raw: r.raw, latency_ms: r.latency_ms };
  } catch (e) {
    const latency_ms = Date.now() - t0;
    const msg = e instanceof QwenError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 200), latency_ms };
  }
}

// ---------- main ----------

export async function runCdmssPipeline(
  note: OpdNote,
  opts: { topK?: number; onEvent?: (stage: string, msg: string, ms?: number) => void } = {},
): Promise<CdmssResult> {
  const totalT0 = Date.now();
  const topK = opts.topK ?? 8;
  const models: Array<{ model: string; latency_ms: number }> = [];

  // 1. Seed
  const seed = noteToSeedQuery(note);
  if (!seed.trim()) return { ok: false, error: 'note_too_empty_for_seed', latency_ms: Date.now() - totalT0 };
  opts.onEvent?.('seed', `Seed question built (${seed.length} chars)`);

  // 2+3. Retrieve — HyDE expand (soft) → embed → pgvector top-K. Steps are
  // called individually so failures are ATTRIBUTABLE (a dropped LLM tunnel
  // reads 'kb_embed_failed', not a misleading 'kb_no_hits').
  const expanded = (await kbHyDE(seed)) ?? seed;
  const vec = await kbEmbed(expanded === seed ? seed : `${seed}\n\n${expanded}`);
  if (!vec) return { ok: false, error: 'kb_embed_failed (LLM tunnel?)', latency_ms: Date.now() - totalT0 };
  const hits: KbChunk[] = await kbVectorSearch(vec, { topK });
  if (hits.length === 0) return { ok: false, error: 'kb_no_hits', latency_ms: Date.now() - totalT0 };
  opts.onEvent?.('retrieve', `${hits.length} KB excerpts (top: ${hits[0]?.book ?? '—'})`);
  const { numbered, sources } = formatSources(hits);
  const maxIndex = sources.length;

  // 4. Draft
  const draft = await callJson<RawDraft>(
    DRAFT_MODEL, DRAFT_TIMEOUT_MS, DRAFT_SYSTEM,
    `ENCOUNTER CONTEXT (seed question):\n${seed}\n\nSOURCES:\n\n${numbered}\n\nReturn the CDS JSON.`,
    0.1,
  );
  if (!draft.ok) return { ok: false, error: `draft_failed: ${draft.error}`, latency_ms: Date.now() - totalT0 };
  models.push({ model: DRAFT_MODEL, latency_ms: draft.latency_ms });
  opts.onEvent?.('draft', 'CDS draft generated', draft.latency_ms);

  // 5. Critique
  const critique = await callJson<RawCritique>(
    CRITIQUE_MODEL, CRITIQUE_TIMEOUT_MS, CRITIQUE_SYSTEM,
    `SOURCES:\n\n${numbered}\n\nDRAFT:\n${draft.raw}\n\nReturn the audit JSON.`,
    0,
  );
  let finalParsed: RawDraft = draft.data;
  let critiqueMs: number | undefined;
  let reviseMs: number | undefined;
  let usedRevise = false;
  if (critique.ok) {
    critiqueMs = critique.latency_ms;
    models.push({ model: CRITIQUE_MODEL, latency_ms: critique.latency_ms });
    const unsupported = Array.isArray(critique.data.unsupported_items) ? critique.data.unsupported_items.length : 0;
    opts.onEvent?.('critique', unsupported > 0 ? `${unsupported} unsupported item(s) flagged` : 'Draft passed citation audit', critique.latency_ms);

    // 6. Revise — only when the audit flags problems
    if (critique.data.overall_quality === 'needs_revision' && unsupported > 0) {
      const revise = await callJson<RawDraft>(
        REVISE_MODEL, REVISE_TIMEOUT_MS, REVISE_SYSTEM,
        `ENCOUNTER CONTEXT:\n${seed}\n\nSOURCES:\n\n${numbered}\n\nORIGINAL DRAFT:\n${draft.raw}\n\nCRITIQUE:\n${critique.raw}\n\nReturn the revised CDS JSON.`,
        0.05,
      );
      if (revise.ok) {
        finalParsed = revise.data;
        reviseMs = revise.latency_ms;
        usedRevise = true;
        models.push({ model: REVISE_MODEL, latency_ms: revise.latency_ms });
        opts.onEvent?.('revise', 'Unsupported claims revised', revise.latency_ms);
      } else {
        opts.onEvent?.('revise', `Revision unavailable (${revise.error}) — shipping audited draft`);
      }
    }
  } else {
    opts.onEvent?.('critique', `Citation audit unavailable (${critique.error}) — shipping draft`);
  }

  // 6b. P3b — outcome probabilities (two locked groups; soft: failure ships
  // the CDS without probability rows). Same sources; the final CDS draft +
  // the note's entertained differentials anchor the distribution (model MAY
  // add KB-supported diagnoses — P3 lock).
  let probRows: ProbRow[] = [];
  let probMs: number | undefined;
  {
    const entertained = [
      ...note.differential,
      ...(Array.isArray(finalParsed.differentials_to_consider)
        ? (finalParsed.differentials_to_consider as Array<{ dx?: unknown }>).map((d) => (typeof d?.dx === 'string' ? d.dx : '')).filter(Boolean)
        : []),
    ];
    const prob = await callJson<RawProbs>(
      PROB_MODEL, PROB_TIMEOUT_MS, PROB_SYSTEM,
      `ENCOUNTER CONTEXT:\n${seed}\n\nDIFFERENTIALS ALREADY ENTERTAINED:\n${entertained.length ? entertained.map((d) => `- ${d}`).join('\n') : '(none stated)'}\n\nSOURCES:\n\n${numbered}\n\nReturn the probabilities JSON.`,
      0,
    );
    if (prob.ok) {
      probRows = sanitizeProbs(prob.data.probabilities, maxIndex);
      probMs = prob.latency_ms;
      models.push({ model: PROB_MODEL, latency_ms: prob.latency_ms });
      opts.onEvent?.('probabilities', `${probRows.filter((r) => r.group === 'differential').length} differential + ${probRows.filter((r) => r.group === 'risk').length} risk row(s)`, prob.latency_ms);
    } else {
      opts.onEvent?.('probabilities', `Probability pass unavailable (${prob.error}) — shipping CDS without it`);
    }
  }

  // 7. Sanitize + shape
  const cdmss: OpdCdmss = {
    what_to_do: sanitizeWhatToDo(finalParsed.what_to_do, maxIndex),
    what_else_to_ask: sanitizeWhatElse(finalParsed.what_else_to_ask, maxIndex),
    differentials_to_consider: sanitizeDdx(finalParsed.differentials_to_consider, maxIndex),
    red_flags: sanitizeCitedItems(finalParsed.red_flags, maxIndex),
    evidence_based_suggestions: sanitizeCitedItems(finalParsed.evidence_based_suggestions, maxIndex),
    follow_up_considerations: sanitizeCitedItems(finalParsed.follow_up_considerations, maxIndex),
    probabilities: probRows,
    sources,
    retrieval_meta: {
      topK,
      hits: hits.length,
      top_book: hits[0]?.book ?? null,
      top_sim: typeof hits[0]?.similarity === 'number' ? Number(hits[0].similarity.toFixed(3)) : 0,
      draft_ms: draft.latency_ms,
      critique_ms: critiqueMs,
      revise_ms: reviseMs,
      prob_ms: probMs,
      used_critique: critique.ok,
      used_revise: usedRevise,
    },
  };
  return { ok: true, cdmss, latency_ms: Date.now() - totalT0, models };
}
