/**
 * POST /api/encounters/[id]/ddx
 *
 * v6.0 Phase 2 (sprint A) — first surface wired to the TracePanel.
 * The pipeline body is unchanged; what's new is the streaming/logging
 * scaffold around it.
 *
 * Dual response shapes (decision Q8 — Accept header gate):
 *
 *   Accept: application/x-ndjson    → streaming NDJSON of progress
 *                                      events, ending in `done` or
 *                                      `error`. Response carries the
 *                                      X-Trace-Id header. Used by the
 *                                      v6 client to drive TracePanel.
 *
 *   Accept: <anything else>         → legacy single-shot JSON response
 *                                      `{ok, status, findings, ...}`,
 *                                      unchanged shape.
 *
 * The shared inner function `runDdxPipeline()` is called by both branches
 * with a different `emit` (no-op for JSON, streaming for NDJSON), so the
 * two response shapes can never drift in business logic — only in
 * presentation.
 *
 * Trace log row (decision Q2 retention forever) is written for BOTH
 * branches; the JSON branch trades real-time UX for backwards compat
 * but still gets full forensic audit.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { qwenJson, QwenError } from '@/lib/qwen';
import { kbRetrieve, type KbChunk } from '@/lib/kb';
import { loadComorbidityContext, comorbidityContextForPrompt } from '@/lib/patient-comorbidity-context';
import { makeNdjsonStream, ndjsonHeaders, type ProgressEvent } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type DdxFinding = {
  condition: string;
  likelihood: 'high' | 'medium' | 'low';
  rationale: string;
  source_encounter_ids: string[];
  citation_numbers: number[];
};

type CitationChunk = {
  n: number;
  source: string;
  book: string;
  chapter: string | null;
  section: string | null;
  page: number | null;
  similarity: number;
  text_excerpt: string;
};

type DdxPayload =
  | {
      status: 'ok';
      findings: DdxFinding[];
      citations: CitationChunk[];
      scanned_at: string;
      latency_ms: number;
      kb_latency_ms?: number;
    }
  | {
      status: 'failed';
      error: string;
      scanned_at: string;
    };

const SYSTEM_PROMPT = `You are a clinical reasoning assistant for an Indian OPD EHR. The doctor has just finished examining a patient and is about to submit an encounter. Provide a brief differential diagnosis to help the doctor sanity-check their assessment.

You receive:
- This encounter's chief complaint chips + free text
- This encounter's exam findings + vitals
- This encounter's working assessment (may be partial)
- The patient's cached problem list + active medications + allergies
- Up to 5 past completed encounters with id + chief complaint + assessment
- v3.10.1: A "kb_context" field with up to 8 numbered clinical reference chunks retrieved from MKSAP, StatPearls, UpToDate, OpenFDA, PubMed, textbooks, and clinical guidelines.

Return STRICT JSON:
{
  "findings": [
    {
      "condition": "<diagnosis name>",
      "likelihood": "high" | "medium" | "low",
      "rationale": "<one short clinical sentence with inline [N] citations to kb_context where N is the 1-based chunk number>",
      "source_encounter_ids": ["<past encounter id that informs this>", ...],
      "citation_numbers": [1, 3]
    }
  ]
}

Rules:
- At most 5 findings, ordered most → least likely.
- Skip findings the doctor has clearly already considered (look at the working assessment).
- DO NOT speculate without evidence. If clinical data is sparse, return fewer findings or none.
- Cite past encounters in source_encounter_ids when a finding is informed by recurrence, prior workup, or chronicity. Empty array when the finding is purely from today's encounter.
- v3.10.1 CITATION RULES:
  - When kb_context supports a finding, embed inline [N] markers in the rationale where N matches the kb_context chunk number (1-indexed).
  - Also list those chunk numbers in citation_numbers: [N, ...] for the diagnosis.
  - If kb_context contains nothing relevant for a finding, leave citation_numbers as [] and skip inline markers — do not invent citations.
- One sentence rationale max. No hedging language.

Return ONLY the JSON object. No prose, no markdown.`;

type PipelineEmit = (ev: ProgressEvent) => void;

type PipelineCtx = {
  encounterId: string;
  patientId: string;
  signal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// The shared pipeline. Returns the final payload. Calls emit() at every
// phase boundary so the NDJSON branch can stream progress; the JSON
// branch passes a no-op emit and ignores it.
// ---------------------------------------------------------------------------

async function runDdxPipeline(
  ctx: PipelineCtx,
  emit: PipelineEmit,
): Promise<DdxPayload> {
  const t0 = Date.now();
  const scanned_at = new Date().toISOString();

  // 1. Build clinical picture — encounter + patient context + past encounters.
  emit({ type: 'progress', stage: 'expanding', msg: 'Building the clinical picture' });

  const { rows: encRows } = await pool.query<{
    chief_complaint_chips: string[] | null;
    chief_complaint_text: string | null;
    exam_findings: string | null;
    vitals: unknown | null;
    assessment_codes: string[] | null;
    assessment_text: string | null;
  }>(
    `SELECT chief_complaint_chips, chief_complaint_text,
            exam_findings, vitals, assessment_codes, assessment_text
       FROM encounters WHERE id = $1 LIMIT 1`,
    [ctx.encounterId],
  );
  const enc = encRows[0] ?? {
    chief_complaint_chips: null,
    chief_complaint_text: null,
    exam_findings: null,
    vitals: null,
    assessment_codes: null,
    assessment_text: null,
  };

  const { rows: pRows } = await pool.query<{
    known_allergies: string | null;
    problems_json: { label: string; status?: string }[] | null;
    meds_json: { generic_name?: string; brand_name?: string; dose?: string; status?: string }[] | null;
  }>(
    `SELECT p.known_allergies,
            ps.summary->'problems' AS problems_json,
            ps.summary->'medications_active' AS meds_json
       FROM patients p
       LEFT JOIN patient_summaries ps ON ps.patient_id = p.id
      WHERE p.id = $1 LIMIT 1`,
    [ctx.patientId],
  );
  const pctx = pRows[0] ?? { known_allergies: null, problems_json: null, meds_json: null };

  const { rows: pastRows } = await pool.query<{
    id: string;
    encounter_date: string;
    chief_complaint_text: string | null;
    assessment_text: string | null;
  }>(
    `SELECT id, encounter_date::text AS encounter_date,
            chief_complaint_text, assessment_text
       FROM encounters
      WHERE patient_id = $1 AND status = 'completed' AND id <> $2
      ORDER BY encounter_date DESC
      LIMIT 5`,
    [ctx.patientId, ctx.encounterId],
  );

  const today = {
    chief_complaint_chips: enc.chief_complaint_chips ?? [],
    chief_complaint_text: enc.chief_complaint_text,
    exam_findings: enc.exam_findings,
    vitals: enc.vitals,
    assessment_codes: enc.assessment_codes ?? [],
    assessment_text: enc.assessment_text,
  };
  const background = {
    active_problems: (pctx.problems_json ?? [])
      .filter((p) => !p.status || p.status === 'active')
      .map((p) => p.label)
      .filter(Boolean),
    active_meds: (pctx.meds_json ?? [])
      .filter((m) => !m.status || m.status === 'active')
      .map((m) => `${m.generic_name || m.brand_name || ''} ${m.dose ?? ''}`.trim())
      .filter(Boolean),
    known_allergies: pctx.known_allergies,
  };
  const past_encounters = pastRows.map((r) => ({
    id: r.id,
    encounter_date: r.encounter_date,
    chief_complaint: r.chief_complaint_text,
    assessment: r.assessment_text,
  }));

  const comorbidityCtx = await loadComorbidityContext(ctx.patientId).catch(() => null);

  // 2. Pull relevant evidence from the knowledge base.
  emit({
    type: 'progress',
    stage: 'retrieving',
    msg: 'Pulling relevant evidence from clinical references',
    ms: Date.now() - t0,
  });

  const ddxQuery = [
    today.chief_complaint_text ?? '',
    (today.chief_complaint_chips ?? []).join(' '),
    today.assessment_text ?? '',
    background.active_problems.slice(0, 5).join(' '),
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 1500);

  const kbT0 = Date.now();
  const kbChunks: KbChunk[] = ddxQuery.length >= 5
    ? await kbRetrieve(ddxQuery, { topK: 8, hyde: true, timeoutMs: 25_000 })
    : [];
  const kbLatencyMs = Date.now() - kbT0;

  emit({
    type: 'progress',
    stage: 'retrieving',
    msg: `Retrieved ${kbChunks.length} clinical reference excerpt${kbChunks.length === 1 ? '' : 's'}`,
    ms: Date.now() - t0,
  });

  const kb_context = kbChunks.map((c, i) => ({
    n: i + 1,
    book: c.book,
    chapter: c.chapter,
    section: c.section,
    page: c.page_start,
    text_excerpt: c.text.slice(0, 1200),
  }));

  const userMessage = JSON.stringify({
    today,
    background,
    past_encounters,
    ...(comorbidityCtx ? comorbidityContextForPrompt(comorbidityCtx) : {}),
    kb_context,
  });

  // 3. Draft the differential. Wrap qwen call in withHeartbeat so the
  //    TracePanel sees a ticking line every 5s while the model grinds.
  emit({
    type: 'progress',
    stage: 'drafting',
    msg: 'Drafting differential with the reasoning model',
    ms: Date.now() - t0,
  });

  let payload: DdxPayload;
  try {
    const result = await withHeartbeat(emit, 'drafting', 'Drafting differential', async () =>
      qwenJson<{
        findings?: Array<{
          condition?: string;
          likelihood?: string;
          rationale?: string;
          source_encounter_ids?: unknown;
          citation_numbers?: unknown;
        }>;
      }>(SYSTEM_PROMPT, userMessage, { timeoutMs: 90_000, signal: ctx.signal }),
    );

    const validIds = new Set(past_encounters.map((p) => p.id));
    const maxCitationN = kbChunks.length;
    const findings: DdxFinding[] = [];
    for (const f of result.json.findings ?? []) {
      const condition = String(f.condition ?? '').trim();
      const likelihood = normalizeLikelihood(f.likelihood);
      if (!condition || !likelihood) continue;
      const srcIds = Array.isArray(f.source_encounter_ids)
        ? f.source_encounter_ids.map(String).filter((s): s is string => validIds.has(s))
        : [];
      const citNums = Array.isArray(f.citation_numbers)
        ? Array.from(
            new Set(
              f.citation_numbers
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxCitationN),
            ),
          ).sort((a, b) => a - b)
        : [];
      findings.push({
        condition: condition.slice(0, 120),
        likelihood,
        rationale: String(f.rationale ?? '').slice(0, 500),
        source_encounter_ids: srcIds,
        citation_numbers: citNums,
      });
      if (findings.length >= 5) break;
    }

    emit({
      type: 'progress',
      stage: 'parsing',
      msg: 'Parsing differential JSON',
      ms: Date.now() - t0,
    });

    const referenced = new Set<number>();
    for (const f of findings) for (const n of f.citation_numbers) referenced.add(n);
    const citations: CitationChunk[] = kbChunks
      .map((c, i) => ({
        n: i + 1,
        source: c.source,
        book: c.book,
        chapter: c.chapter,
        section: c.section,
        page: c.page_start,
        similarity: c.similarity,
        text_excerpt: c.text.slice(0, 600),
      }))
      .filter((c) => referenced.has(c.n));

    payload = {
      status: 'ok',
      findings,
      citations,
      scanned_at,
      latency_ms: result.latency_ms,
      kb_latency_ms: kbLatencyMs,
    };
  } catch (e) {
    const msg = e instanceof QwenError
      ? `${e.kind}: ${e.message}`
      : e instanceof Error
        ? e.message
        : String(e);
    payload = { status: 'failed', error: msg.slice(0, 300), scanned_at };
  }

  await pool.query(
    `UPDATE encounters SET ddx_findings = $2::jsonb WHERE id = $1`,
    [ctx.encounterId, JSON.stringify(payload)],
  );

  return payload;
}

// ---------------------------------------------------------------------------
// POST entry point — auth + validation, then branches on Accept header.
// ---------------------------------------------------------------------------

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (session.role !== 'doctor' && session.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'forbidden_role' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }

  // Load + ownership check.
  const { rows: encRows } = await pool.query<{ patient_id: string; doctor_email: string }>(
    `SELECT e.patient_id, d.email AS doctor_email
       FROM encounters e
       JOIN doctors d ON d.id = e.doctor_id
      WHERE e.id = $1 LIMIT 1`,
    [id],
  );
  const owner = encRows[0];
  if (!owner) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (session.role !== 'admin' && owner.doctor_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'not_your_encounter' }, { status: 403 });
  }

  const accept = req.headers.get('accept') ?? '';
  const wantsStream = accept.includes('application/x-ndjson');

  // -------------------------------------------------------------------------
  // NDJSON streaming branch — used by the v6 client to drive TracePanel.
  // -------------------------------------------------------------------------
  if (wantsStream) {
    const trace = await openTrace({
      surface: 'ddx',
      encounter_id: id,
      patient_id: owner.patient_id,
      doctor_email: session.email,
      request_input: { encounter_id: id },
    });
    const { stream, emit, close } = makeNdjsonStream();
    const abort = new AbortController();

    // Wrap emit so every event is also recorded for the audit trail.
    const traceEmit: PipelineEmit = (ev) => {
      emit(ev);
      if (ev.type === 'progress') {
        trace.event(ev.stage, ev.msg, ev.ms);
      } else if (ev.type === 'error') {
        trace.event('done', ev.message, undefined, true, true);
      } else if (ev.type === 'done') {
        trace.event('done', '', ev.ms, true);
      }
    };

    // Fire-and-forget pipeline. Don't await — we return the stream so the
    // client can consume events as they arrive.
    (async () => {
      const t0 = Date.now();
      try {
        const payload = await runDdxPipeline(
          { encounterId: id, patientId: owner.patient_id, signal: abort.signal },
          traceEmit,
        );
        // Send the final result as a `result` event so the client can render
        // findings without re-fetching.
        emit({ type: 'result', data: payload });
        emit({ type: 'done', ms: Date.now() - t0 });
        await trace.finalise({
          status: payload.status === 'ok' ? 'completed' : 'errored',
          result_summary: payload,
          error_message: payload.status === 'failed' ? payload.error : undefined,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emit({ type: 'error', message: msg });
        await trace.finalise({ status: 'errored', error_message: msg });
      } finally {
        close();
      }
    })();

    // If the client closes the stream (navigates away), trigger the abort
    // so the qwen call cancels (decision Q5).
    req.signal?.addEventListener('abort', () => abort.abort(), { once: true });

    return new Response(stream, {
      headers: {
        ...Object.fromEntries(ndjsonHeaders()),
        'X-Trace-Id': trace.id,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Legacy JSON branch — unchanged response shape.
  // -------------------------------------------------------------------------
  const trace = await openTrace({
    surface: 'ddx',
    encounter_id: id,
    patient_id: owner.patient_id,
    doctor_email: session.email,
    request_input: { encounter_id: id, mode: 'json' },
  });
  const t0 = Date.now();
  try {
    const traceEmit: PipelineEmit = (ev) => {
      if (ev.type === 'progress') trace.event(ev.stage, ev.msg, ev.ms);
    };
    const payload = await runDdxPipeline(
      { encounterId: id, patientId: owner.patient_id },
      traceEmit,
    );
    trace.event('done', '', Date.now() - t0, true);
    await trace.finalise({
      status: payload.status === 'ok' ? 'completed' : 'errored',
      result_summary: payload,
      error_message: payload.status === 'failed' ? payload.error : undefined,
    });
    return NextResponse.json({ ok: true, ...payload }, {
      headers: { 'X-Trace-Id': trace.id },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await trace.finalise({ status: 'errored', error_message: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function normalizeLikelihood(s: unknown): DdxFinding['likelihood'] | null {
  if (typeof s !== 'string') return null;
  const v = s.toLowerCase().trim();
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return null;
}
