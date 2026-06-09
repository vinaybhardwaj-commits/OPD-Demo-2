/**
 * POST /api/diagnostics/interpret
 *
 * v3.5b — active Qwen NLP from doctor's typed free-text.
 *
 * Body: { encounter_id, free_text, modality? }
 * Returns: { suggestions: [{ service_code, display_name, sub_department,
 *                            modality, rationale, confidence }] }
 *
 * Doctor types "diabetic FU + thyroid + b12" in the strip's free-text
 * input + presses Enter / Submit → this endpoint interprets the intent
 * against the EHRC catalog and returns 3–15 candidates with rationale.
 *
 * Hybrid context: free_text is the PRIMARY signal, but the endpoint
 * also pulls the encounter's visit_reason + active_problems to inform
 * Qwen (helps disambiguate "thyroid" → screening vs follow-up).
 *
 * Provenance filter: same allowed_catalog pattern as v3.5a. Qwen output
 * service_codes validated against the sent set; hallucinated codes
 * dropped silently.
 *
 * NOT cached (different free_text each call = different result).
 * Failure: returns { suggestions: [] } with HTTP 200 so the strip's
 * deterministic results stay visible.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { qwenJson, QwenError } from '@/lib/qwen';
import { loadComorbidityContext, comorbidityContextForPrompt } from '@/lib/patient-comorbidity-context';
import { makeNdjsonStream, ndjsonHeaders, type ProgressEvent } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

type PipelineEmit = (ev: ProgressEvent) => void;
const noopEmit: PipelineEmit = () => {};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Suggestion = {
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: 'lab' | 'imaging' | 'cardiology' | 'procedure';
  rationale: string;
  confidence: number;
};

const SYSTEM_PROMPT = `You are an Indian OPD physician's intent interpreter. The doctor has typed a free-text description of the tests they want to order. Translate that intent into specific catalog tests.

You receive:
- free_text: what the doctor typed (clinician shorthand, e.g. "diabetic FU + thyroid + b12")
- visit_reason: optional encounter context for disambiguation
- active_problems: optional patient context
- allowed_catalog: an array of {service_code, display_name, sub_department, modality} the doctor can order

Return STRICT JSON:
{
  "suggestions": [
    {
      "service_code": "<MUST be from allowed_catalog>",
      "rationale": "<≤80 chars, why this maps to the doctor's intent>",
      "confidence": 0.5–0.95
    }
  ]
}

Rules:
- 3–15 suggestions covering the doctor's full intent. If they say "diabetic FU panel" return 4–8 tests typical for that panel.
- ONLY suggest tests in allowed_catalog. If the intent doesn't match any catalog row, return empty suggestions.
- Order most-confident first.
- rationale: plain clinical English explaining WHY this maps. e.g. "HbA1c — primary diabetic control marker".
- confidence: 0.85+ for direct intent match; 0.70+ for likely interpretation; 0.50+ for tangentially related.
- Don't repeat tests already in the patient's active orders.

Return ONLY the JSON object. No markdown, no prose.`;

export async function POST(req: Request) {
  try {
  const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  
    const body = (await req.json()) as { encounter_id?: string; free_text?: string; modality?: string };
    const encounterId = body.encounter_id;
    const freeText = (body.free_text ?? '').trim();
    const modalityFilter = body.modality;
  
    if (!encounterId || !/^[0-9a-f-]{36}$/i.test(encounterId)) {
      return NextResponse.json({ ok: false, error: 'bad_encounter_id' }, { status: 400 });
    }
    if (freeText.length < 2) {
      return NextResponse.json({ ok: true, suggestions: [], note: 'too_short' });
    }
  
    // Encounter context for disambiguation
    const encRes = await pool.query<{
      id: string;
      patient_id: string;
      intake_visit_reason: string | null;
      chief_complaint_text: string | null;
    }>(
      `SELECT id, patient_id, intake_visit_reason, chief_complaint_text
       FROM encounters WHERE id = $1 LIMIT 1`,
      [encounterId],
    );
    if (encRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
    }
    const enc = encRes.rows[0];
    const visitReason = (enc.intake_visit_reason || enc.chief_complaint_text || '').trim();
  
    const problemsRes = await pool.query<{ summary: { problems?: string[] } | null }>(
      `SELECT summary FROM patient_summaries WHERE patient_id = $1 LIMIT 1`,
      [enc.patient_id],
    );
    const problems = problemsRes.rows[0]?.summary?.problems ?? [];
  
    // Build allowed_catalog scored by free_text keywords (primary) + visit_reason keywords (secondary)
    const freeTextKw = freeText.toLowerCase().split(/\W+/).filter((w) => w.length >= 2);
    const visitKw = visitReason.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
  
    const modalityClause = modalityFilter
      ? `AND modality = '${modalityFilter.replace(/[^a-z]/g, '')}'`
      : `AND modality IN ('lab','imaging','cardiology','procedure')`;
  
    const { rows: catalog } = await pool.query<{
      service_code: string;
      display_name: string;
      sub_department: string;
      modality: Suggestion['modality'];
      score: number;
    }>(
      `WITH scored AS (
         SELECT service_code, display_name, sub_department, modality,
                COALESCE((
                  SELECT SUM(
                    CASE WHEN LOWER(display_name) LIKE '%' || k || '%' THEN 5 ELSE 0 END +
                    CASE WHEN LOWER(sub_department) LIKE '%' || k || '%' THEN 2 ELSE 0 END +
                    CASE WHEN EXISTS (SELECT 1 FROM unnest(synonyms) s WHERE LOWER(s) LIKE '%' || k || '%') THEN 3 ELSE 0 END
                  )::int
                  FROM unnest($1::text[]) AS k
                ), 0)
              + COALESCE((
                  SELECT SUM(
                    CASE WHEN LOWER(display_name) LIKE '%' || k || '%' THEN 1 ELSE 0 END
                  )::int
                  FROM unnest($2::text[]) AS k
                ), 0) AS score
         FROM diagnostic_catalog
         WHERE is_active = true ${modalityClause}
           AND 'OP' = ANY(patient_types)
       )
       SELECT * FROM scored
       WHERE score > 0
       ORDER BY score DESC, display_name ASC
       LIMIT 100`,
      [freeTextKw.length > 0 ? freeTextKw : [''], visitKw.length > 0 ? visitKw : ['']],
    );
  
    // If no keyword hits, fall back to alphabetic top-50 (Qwen still gets something to work with)
    if (catalog.length === 0) {
      const { rows: fallback } = await pool.query<{
        service_code: string;
        display_name: string;
        sub_department: string;
        modality: Suggestion['modality'];
        score: number;
      }>(
        `SELECT service_code, display_name, sub_department, modality, 0 AS score
         FROM diagnostic_catalog
         WHERE is_active = true ${modalityClause}
           AND 'OP' = ANY(patient_types)
         ORDER BY display_name ASC
         LIMIT 50`,
      );
      catalog.push(...fallback);
    }
  
    // Call Qwen
    // v3.9.1b — comorbidity-aware prompt context
  const comorbidityCtx = await loadComorbidityContext(enc.patient_id).catch(() => null);

  const userMessage = JSON.stringify({
      free_text: freeText,
      visit_reason: visitReason || '(none captured)',
      active_problems: problems,
      allowed_catalog: catalog.map((c) => ({
        service_code: c.service_code,
        display_name: c.display_name,
        sub_department: c.sub_department,
        modality: c.modality,
      })),
      ...(comorbidityCtx ? comorbidityContextForPrompt(comorbidityCtx) : {})
    });
  
    // v6.0 Phase 3 — Accept-header branch (NDJSON streaming variant).
    const accept = req.headers.get('accept') ?? '';
    const wantsStream = accept.includes('application/x-ndjson');

    if (wantsStream) {
      const trace = await openTrace({
        surface: 'diagnostics-interpret',
        encounter_id: encounterId,
        patient_id: enc.patient_id,
        doctor_email: session.email,
        request_input: { free_text_len: freeText.length, modality: modalityFilter ?? null, candidates: catalog.length },
      });
      const { stream, emit: ndEmit, close } = makeNdjsonStream();
      const abort = new AbortController();
      const emit: PipelineEmit = (ev) => {
        ndEmit(ev);
        if (ev.type === 'progress') trace.event(ev.stage, ev.msg, ev.ms);
      };
      const tStart = Date.now();

      (async () => {
        try {
          const payload = await runDiagnosticsInterpretPipeline(
            { catalog, userMessage, signal: abort.signal },
            emit,
          );
          ndEmit({ type: 'result', data: { ok: true, ...payload } });
          ndEmit({ type: 'done', ms: Date.now() - tStart });
          await trace.finalise({
            status: payload.error ? 'errored' : 'completed',
            result_summary: { suggestions: payload.suggestions.length, latency_ms: payload.latency_ms ?? 0 },
            error_message: payload.error,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ndEmit({ type: 'error', message: msg });
          await trace.finalise({ status: 'errored', error_message: msg });
        } finally {
          close();
        }
      })();

      req.signal?.addEventListener('abort', () => abort.abort(), { once: true });

      return new Response(stream, {
        headers: {
          ...Object.fromEntries(ndjsonHeaders()),
          'X-Trace-Id': trace.id,
        },
      });
    }

    try {
      const t0 = Date.now();
      const result = await qwenJson<{ suggestions: Array<{ service_code: string; rationale: string; confidence: number }> }>(
        SYSTEM_PROMPT,
        userMessage,
        { timeoutMs: 45_000 },
      );
      const latency_ms = Date.now() - t0;
  
      const allowedSet = new Set(catalog.map((c) => c.service_code));
      const catalogByCode = new Map(catalog.map((c) => [c.service_code, c]));
      const cleanSuggestions: Suggestion[] = (result.json.suggestions ?? [])
        .filter((s) => s.service_code && allowedSet.has(s.service_code))
        .slice(0, 15)
        .map((s) => {
          const c = catalogByCode.get(s.service_code)!;
          return {
            service_code: s.service_code,
            display_name: c.display_name,
            sub_department: c.sub_department,
            modality: c.modality,
            rationale: (s.rationale ?? '').slice(0, 100),
            confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
          };
        });
  
      return NextResponse.json({
        ok: true,
        suggestions: cleanSuggestions,
        latency_ms,
        candidates_sent: catalog.length,
      });
    } catch (e) {
      const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
      return NextResponse.json({
        ok: true,                            // soft-fail so the strip's deterministic UI keeps working
        suggestions: [],
        error: msg.slice(0, 200),
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[interpret] uncaught", msg);
    return NextResponse.json({ ok: false, error: "server_error", detail: msg.slice(0, 300) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// v6.0 Phase 3 — runDiagnosticsInterpretPipeline
// Mirrors the legacy inline Qwen interpreter; emits progress events.
// JSON branch above unchanged.
// ---------------------------------------------------------------------------

type DiagnosticsInterpretPipelineCtx = {
  catalog: Array<{ service_code: string; display_name: string; sub_department: string; modality: Suggestion['modality']; score: number }>;
  userMessage: string;
  signal?: AbortSignal;
};

type DiagnosticsInterpretResult = {
  suggestions: Suggestion[];
  latency_ms?: number;
  candidates_sent: number;
  error?: string;
};

async function runDiagnosticsInterpretPipeline(
  ctx: DiagnosticsInterpretPipelineCtx,
  emit: PipelineEmit,
): Promise<DiagnosticsInterpretResult> {
  emit({ type: 'progress', stage: 'retrieving' as Stage, msg: `Sending ${ctx.catalog.length} candidate tests` });

  emit({ type: 'progress', stage: 'generating' as Stage, msg: 'Prompting the reasoning model for catalog mapping' });

  try {
    const t0 = Date.now();
    const result = await withHeartbeat(emit, 'generating' as Stage, 'Interpreting intent', async () =>
      qwenJson<{ suggestions: Array<{ service_code: string; rationale: string; confidence: number }> }>(
        SYSTEM_PROMPT,
        ctx.userMessage,
        { timeoutMs: 45_000, signal: ctx.signal },
      ),
    );
    const latency_ms = Date.now() - t0;

    emit({ type: 'progress', stage: 'parsing' as Stage, msg: 'Parsing diagnostic suggestions', ms: latency_ms });

    const allowedSet = new Set(ctx.catalog.map((c) => c.service_code));
    const catalogByCode = new Map(ctx.catalog.map((c) => [c.service_code, c]));
    const cleanSuggestions: Suggestion[] = (result.json.suggestions ?? [])
      .filter((s) => s.service_code && allowedSet.has(s.service_code))
      .slice(0, 15)
      .map((s) => {
        const c = catalogByCode.get(s.service_code)!;
        return {
          service_code: s.service_code,
          display_name: c.display_name,
          sub_department: c.sub_department,
          modality: c.modality,
          rationale: (s.rationale ?? '').slice(0, 100),
          confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
        };
      });

    return {
      suggestions: cleanSuggestions,
      latency_ms,
      candidates_sent: ctx.catalog.length,
    };
  } catch (e) {
    const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
    return {
      suggestions: [],
      candidates_sent: ctx.catalog.length,
      error: msg.slice(0, 200),
    };
  }
}

type Stage = 'expanding' | 'retrieving' | 'reranking' | 'fusing' | 'generating' | 'drafting' | 'reviewing' | 'revising' | 'finalizing' | 'parsing' | 'persisting' | 'done' | 'variants';
