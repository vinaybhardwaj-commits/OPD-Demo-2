/**
 * POST /api/comorbidities/interpret
 *
 * v3.9.1 — Qwen NLP from typed shorthand. Doctor types 'T2DM' or
 * 'long-standing diabetic with neuropathy' → Qwen returns ICD-10
 * comorbidity codes with labels + rationale.
 *
 * Body: { free_text, patient_id? }
 * Returns: { suggestions: [{ code, label, rationale, confidence }] }
 *
 * Format validation only — Qwen outputs any ICD-10 freely per v3.9 lock.
 * Soft-fail HTTP 200 with empty suggestions on Qwen error.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { qwenJson, QwenError } from '@/lib/qwen';
import { isValidIcd10 } from '@/lib/comorbidities-catalog';
import { makeNdjsonStream, ndjsonHeaders, type ProgressEvent } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

type PipelineEmit = (ev: ProgressEvent) => void;
const noopEmit: PipelineEmit = () => {};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Suggestion = { code: string; label: string; rationale: string; confidence: number };

const SYSTEM_PROMPT = `You are an ICD-10 coder for an Indian OPD physician's patient-comorbidity capture flow. Translate clinician shorthand or prose about a patient's chronic conditions into ICD-10-CM codes.

You receive:
- free_text: doctor's input (may be shorthand like "T2DM, HTN, CKD st 3" or prose like "long-standing diabetic with diabetic nephropathy")
- optional patient_demographics: age, sex for disambiguation (e.g. "ASHD" likely CAD in 70M)

Return STRICT JSON:
{
  "suggestions": [
    {
      "code": "<ICD-10 code, e.g. E11.9 or I10 or N18.3>",
      "label": "<canonical ICD-10 description>",
      "rationale": "<≤80 chars: which part of the input this code maps to>",
      "confidence": 0.5–0.95
    }
  ]
}

Rules:
- 1–10 codes, ordered most confident first.
- ICD-10-CM format: capital letter, two digits, optional dot + 1-4 more digits. e.g. "E11.9", "I10", "N18.3".
- PREFER chronic-condition codes (E11.9 over E11.65, I10 over I10.x) unless input explicitly says complication.
- For multi-condition inputs ("HTN + T2DM + CKD"), return separate codes for each.
- confidence: 0.85+ for direct mapping; 0.70+ for typical interpretation; 0.50+ for ambiguous.

Return ONLY the JSON object. No markdown, no preamble.`;

export async function POST(req: Request) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const body = (await req.json()) as { free_text?: string; patient_id?: string };
    const freeText = (body.free_text ?? '').trim();
    if (freeText.length < 2) return NextResponse.json({ ok: true, suggestions: [], note: 'too_short' });

    let demographics: { age?: number; sex?: string } = {};
    if (body.patient_id && /^[0-9a-f-]{36}$/i.test(body.patient_id)) {
      const { rows } = await pool.query<{ age_years: number; sex: string }>(
        `SELECT age_years, sex FROM patients WHERE id = $1 LIMIT 1`,
        [body.patient_id],
      );
      if (rows.length > 0) demographics = { age: rows[0].age_years, sex: rows[0].sex };
    }

    const userMessage = JSON.stringify({
      free_text: freeText,
      patient_demographics: demographics,
    });

    // v6.0 Phase 3 — Accept-header branch (NDJSON streaming variant).
    const accept = req.headers.get('accept') ?? '';
    const wantsStream = accept.includes('application/x-ndjson');

    if (wantsStream) {
      const trace = await openTrace({
        surface: 'comorbidities-interpret',
        encounter_id: null,
        patient_id: body.patient_id && /^[0-9a-f-]{36}$/i.test(body.patient_id) ? body.patient_id : null,
        doctor_email: session.email,
        request_input: { free_text_len: freeText.length, has_demographics: !!demographics.age },
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
          const payload = await runComorbiditiesInterpretPipeline(
            { userMessage, signal: abort.signal },
            emit,
          );
          ndEmit({ type: 'result', data: { ok: true, ...payload } });
          ndEmit({ type: 'done', ms: Date.now() - tStart });
          await trace.finalise({
            status: payload.error ? 'errored' : 'completed',
            result_summary: { suggestions: payload.suggestions.length, latency_ms: payload.latency_ms },
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

    const t0 = Date.now();
    const result = await qwenJson<{ suggestions: Array<{ code: string; label: string; rationale: string; confidence: number }> }>(
      SYSTEM_PROMPT,
      userMessage,
      { timeoutMs: 45_000 },
    );
    const latency_ms = Date.now() - t0;

    const clean: Suggestion[] = (result.json.suggestions ?? [])
      .filter((s) => s.code && isValidIcd10(s.code.trim().toUpperCase()))
      .slice(0, 10)
      .map((s) => ({
        code: s.code.trim().toUpperCase(),
        label: (s.label ?? '').slice(0, 200) || s.code,
        rationale: (s.rationale ?? '').slice(0, 100),
        confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
      }));

    return NextResponse.json({ ok: true, suggestions: clean, latency_ms });
  } catch (e) {
    const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: true, suggestions: [], error: msg.slice(0, 200) });
  }
}

// ---------------------------------------------------------------------------
// v6.0 Phase 3 — runComorbiditiesInterpretPipeline
// Mirrors the legacy inline code; emits progress events.
// JSON branch above unchanged.
// ---------------------------------------------------------------------------

type ComorbiditiesInterpretPipelineCtx = {
  userMessage: string;
  signal?: AbortSignal;
};

type ComorbiditiesInterpretResult = {
  suggestions: Suggestion[];
  latency_ms: number;
  error?: string;
};

async function runComorbiditiesInterpretPipeline(
  ctx: ComorbiditiesInterpretPipelineCtx,
  emit: PipelineEmit,
): Promise<ComorbiditiesInterpretResult> {
  emit({ type: 'progress', stage: 'generating' as Stage, msg: 'Prompting the reasoning model for ICD-10 codes' });

  try {
    const t0 = Date.now();
    const result = await withHeartbeat(emit, 'generating' as Stage, 'Interpreting shorthand', async () =>
      qwenJson<{ suggestions: Array<{ code: string; label: string; rationale: string; confidence: number }> }>(
        SYSTEM_PROMPT,
        ctx.userMessage,
        { timeoutMs: 45_000, signal: ctx.signal },
      ),
    );
    const latency_ms = Date.now() - t0;

    emit({ type: 'progress', stage: 'parsing' as Stage, msg: 'Parsing comorbidity codes', ms: latency_ms });

    const clean: Suggestion[] = (result.json.suggestions ?? [])
      .filter((s) => s.code && isValidIcd10(s.code.trim().toUpperCase()))
      .slice(0, 10)
      .map((s) => ({
        code: s.code.trim().toUpperCase(),
        label: (s.label ?? '').slice(0, 200) || s.code,
        rationale: (s.rationale ?? '').slice(0, 100),
        confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
      }));

    return { suggestions: clean, latency_ms };
  } catch (e) {
    const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
    return { suggestions: [], latency_ms: 0, error: msg.slice(0, 200) };
  }
}

type Stage = 'expanding' | 'retrieving' | 'reranking' | 'fusing' | 'generating' | 'drafting' | 'reviewing' | 'revising' | 'finalizing' | 'parsing' | 'persisting' | 'done' | 'variants';
