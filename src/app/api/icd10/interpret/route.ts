/**
 * POST /api/icd10/interpret
 *
 * v3.8 — active Qwen ICD-10 extraction from free text.
 *
 * Two consumers:
 * 1. Icd10Typeahead's "Suggest with Qwen ↩" button — passes the search
 *    input text (clinician shorthand like "T2DM" or "HTN uncontrolled").
 * 2. Assessment section's "Extract codes" button — passes the full
 *    assessment textarea contents (clinician prose).
 *
 * Body: { free_text, encounter_id? }
 * Returns: { suggestions: [{ code, label, rationale, confidence }] }
 *
 * Per V's locked decision #2: Qwen outputs ICD-10 codes freely (model
 * is well-trained on the taxonomy). Server validates format only via
 * regex ^[A-Z]\\d{2}(\\.\\d{1,2})?$ and trusts Qwen's label.
 *
 * NOT cached (free_text differs per call). Soft-fail on Qwen error.
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

const ICD10_REGEX = /^[A-Z]\d{2}(\.\d{1,2})?$/;

type Suggestion = { code: string; label: string; rationale: string; confidence: number };

const SYSTEM_PROMPT = `You are an ICD-10 coder for an Indian OPD physician. Given a free-text clinical input (clinician shorthand, prose assessment, or partial diagnosis name), return the most likely ICD-10 codes.

You receive:
- free_text: doctor's input (may be shorthand like "T2DM", "HTN uncontrolled", or full prose like "Hypertension with target organ damage, poorly controlled diabetic")
- optional visit_reason: chief complaint context
- optional active_problems: cached patient problem list for disambiguation

Return STRICT JSON:
{
  "suggestions": [
    {
      "code": "<ICD-10 code, e.g. E11.9 or J45.901 or I10>",
      "label": "<canonical ICD-10 description>",
      "rationale": "<≤80 chars: which part of the input this code maps to>",
      "confidence": 0.5–0.95
    }
  ]
}

Rules:
- 1–8 codes, ordered most confident first.
- Use the standard ICD-10-CM format: a capital letter, two digits, optional dot + 1-2 more digits. e.g. "E11.9", "I10", "J45.901".
- Prefer well-controlled / uncomplicated codes (E11.9 over E11.65) unless the input explicitly says complications, target organ damage, or uncontrolled.
- For multi-condition inputs ("HTN + T2DM"), return separate codes for each condition.
- confidence: 0.85+ for direct unambiguous mapping; 0.70+ for typical interpretation; 0.50+ for tangential or partial match.

Return ONLY the JSON object. No markdown, no prose, no preamble.`;

export async function POST(req: Request) {
  try {
  // Auth — session OR migration secret (the secret path is for debug curl).
    const headerSecret = req.headers.get('x-migration-secret');
    const expectedSecret = process.env.MIGRATION_SECRET;
    let authed = !!expectedSecret && headerSecret === expectedSecret;
    if (!authed) {
      const session = await getCurrentUser();
      if (session) authed = true;
    }
    if (!authed) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  
    const body = (await req.json()) as { free_text?: string; encounter_id?: string; patient_id?: string };
    const freeText = (body.free_text ?? '').trim();
    if (freeText.length < 2) {
      return NextResponse.json({ ok: true, suggestions: [], note: 'too_short' });
    }
  
    // Optional encounter context (improves disambiguation but not required)
    let visitReason = '';
    let problems: string[] = [];
    let derivedPatientId: string | null = null;
    if (body.encounter_id && /^[0-9a-f-]{36}$/i.test(body.encounter_id)) {
      const encRes = await pool.query<{
        patient_id: string;
        intake_visit_reason: string | null;
        chief_complaint_text: string | null;
      }>(
        `SELECT patient_id, intake_visit_reason, chief_complaint_text
         FROM encounters WHERE id = $1 LIMIT 1`,
        [body.encounter_id],
      );
      if (encRes.rows.length > 0) {
        const enc = encRes.rows[0];
        derivedPatientId = enc.patient_id;
        visitReason = (enc.intake_visit_reason || enc.chief_complaint_text || '').trim();
        const probRes = await pool.query<{ summary: { problems?: string[] } | null }>(
          `SELECT summary FROM patient_summaries WHERE patient_id = $1 LIMIT 1`,
          [enc.patient_id],
        );
        problems = probRes.rows[0]?.summary?.problems ?? [];
      }
    }
  
    // v3.9.1b — comorbidity-aware prompt context (when patient_id provided directly OR derivable from encounter_id)
  const ctxPatientId = body.patient_id ?? derivedPatientId;
  const comorbidityCtx = ctxPatientId
    ? await loadComorbidityContext(ctxPatientId).catch(() => null)
    : null;

  const userMessage = JSON.stringify({
      free_text: freeText,
      visit_reason: visitReason || '(none)',
      active_problems: problems,
      ...(comorbidityCtx ? comorbidityContextForPrompt(comorbidityCtx) : {})
    });
  
    // v6.0 Phase 3 — Accept-header branch (NDJSON streaming variant).
    const accept = req.headers.get('accept') ?? '';
    const wantsStream = accept.includes('application/x-ndjson');

    if (wantsStream) {
      const trace = await openTrace({
        surface: 'icd10-interpret',
        encounter_id: body.encounter_id && /^[0-9a-f-]{36}$/i.test(body.encounter_id) ? body.encounter_id : null,
        patient_id: ctxPatientId,
        doctor_email: (await getCurrentUser())?.email ?? 'migration-secret',
        request_input: { free_text_len: freeText.length, has_encounter: !!body.encounter_id, has_patient: !!ctxPatientId },
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
          const payload = await runIcd10InterpretPipeline(
            { userMessage, signal: abort.signal },
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
      const result = await qwenJson<{ suggestions: Array<{ code: string; label: string; rationale: string; confidence: number }> }>(
        SYSTEM_PROMPT,
        userMessage,
        { timeoutMs: 45_000 },
      );
      const latency_ms = Date.now() - t0;
  
      // Validate format only — per V's locked decision #2.
      const clean: Suggestion[] = (result.json.suggestions ?? [])
        .filter((s) => s.code && ICD10_REGEX.test(s.code.trim().toUpperCase()))
        .slice(0, 8)
        .map((s) => ({
          code: s.code.trim().toUpperCase(),
          label: (s.label ?? '').slice(0, 200) || s.code,
          rationale: (s.rationale ?? '').slice(0, 100),
          confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
        }));
  
      return NextResponse.json({ ok: true, suggestions: clean, latency_ms });
    } catch (e) {
      const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
      return NextResponse.json({
        ok: true,                                  // soft-fail
        suggestions: [],
        error: msg.slice(0, 200),
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[icd10/interpret] uncaught", msg);
    return NextResponse.json({ ok: false, error: "server_error", detail: msg.slice(0, 300) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// v6.0 Phase 3 — runIcd10InterpretPipeline
// Mirrors the legacy inline Qwen interpreter; emits progress events.
// JSON branch above unchanged.
// ---------------------------------------------------------------------------

type Icd10InterpretPipelineCtx = {
  userMessage: string;
  signal?: AbortSignal;
};

type Icd10InterpretResult = {
  suggestions: Suggestion[];
  latency_ms?: number;
  error?: string;
};

async function runIcd10InterpretPipeline(
  ctx: Icd10InterpretPipelineCtx,
  emit: PipelineEmit,
): Promise<Icd10InterpretResult> {
  emit({ type: 'progress', stage: 'generating' as Stage, msg: 'Prompting the reasoning model for ICD-10 codes' });

  try {
    const t0 = Date.now();
    const result = await withHeartbeat(emit, 'generating' as Stage, 'Interpreting clinical text', async () =>
      qwenJson<{ suggestions: Array<{ code: string; label: string; rationale: string; confidence: number }> }>(
        SYSTEM_PROMPT,
        ctx.userMessage,
        { timeoutMs: 45_000, signal: ctx.signal },
      ),
    );
    const latency_ms = Date.now() - t0;

    emit({ type: 'progress', stage: 'parsing' as Stage, msg: 'Parsing ICD-10 suggestions', ms: latency_ms });

    const clean: Suggestion[] = (result.json.suggestions ?? [])
      .filter((s) => s.code && ICD10_REGEX.test(s.code.trim().toUpperCase()))
      .slice(0, 8)
      .map((s) => ({
        code: s.code.trim().toUpperCase(),
        label: (s.label ?? '').slice(0, 200) || s.code,
        rationale: (s.rationale ?? '').slice(0, 100),
        confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
      }));

    return { suggestions: clean, latency_ms };
  } catch (e) {
    const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
    return { suggestions: [], error: msg.slice(0, 200) };
  }
}

type Stage = 'expanding' | 'retrieving' | 'reranking' | 'fusing' | 'generating' | 'drafting' | 'reviewing' | 'revising' | 'finalizing' | 'parsing' | 'persisting' | 'done' | 'variants';
