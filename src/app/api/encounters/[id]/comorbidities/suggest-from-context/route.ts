/**
 * GET /api/encounters/[id]/comorbidities/suggest-from-context
 *
 * v3.9.3 — Passive demographics-driven comorbidity chips for the
 * empty-state ComorbidityBand on new-patient encounters.
 *
 * ONLY fires when patient has zero canonical comorbidities (cold-start).
 * Once doctor adds even one, this endpoint short-circuits with empty
 * suggestions — the band's "Suggest from history" button (v3.9.2) is
 * the right tool once there's any signal at all.
 *
 * Returns: { ok, cached, payload: { status, findings[], generated_at, latency_ms } }
 *
 * Cached on encounters.ai_suggested_comorbidities JSONB. Hash inputs:
 * sha256(age + sex + visit_reason). Recompute if hash changes (e.g. CCE
 * updates visit_reason mid-flow).
 *
 * Confidence framed lower than other v3.9 suggest endpoints because the
 * input (demographics + 1 chief complaint) carries weaker signal than
 * history. UI surfaces as 'just a guess, confirm' framing per PRD §7.3.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { qwenJson, QwenError } from '@/lib/qwen';
import { isValidIcd10 } from '@/lib/comorbidities-catalog';
import { createHash } from 'node:crypto';
import { makeNdjsonStream, ndjsonHeaders, type ProgressEvent } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

type PipelineEmit = (ev: ProgressEvent) => void;
const noopEmit: PipelineEmit = () => {};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Suggestion = { code: string; label: string; rationale: string; confidence: number };
type CachedPayload =
  | { status: 'ok'; findings: Suggestion[]; generated_at: string; latency_ms: number }
  | { status: 'failed'; error: string; generated_at: string }
  | { status: 'not_eligible'; reason: string; generated_at: string };

const SYSTEM_PROMPT = `You are an Indian OPD physician's clinical-prior assistant. Given a NEW patient's demographics and chief complaint (no prior history available), suggest which CHRONIC comorbidities the doctor should screen for / consider.

You receive:
- age: years
- sex: M | F | O
- visit_reason: chief complaint as captured at registration/triage

Return STRICT JSON:
{
  "suggestions": [
    {
      "code": "<ICD-10 code, e.g. I10 or E11.9>",
      "label": "<canonical short description>",
      "rationale": "<≤80 chars: why this is plausible given demographics+CC>",
      "confidence": 0.50–0.75
    }
  ]
}

Rules:
- 2–6 suggestions, ordered by clinical plausibility.
- Confidence MAX 0.75 — these are PRIORS based on weak demographic + single-CC signal, not evidence-based diagnoses.
- Prefer the most common chronic patterns by age/sex (e.g. 60+M with chest pain → HTN, T2DM, CAD, dyslipidemia)
- Skip acute conditions, transient symptoms, post-op states.
- ICD-10-CM format: capital letter, two digits, optional dot + 1-4 more digits.

Return ONLY the JSON object. No markdown, no preamble.`;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const { id: encounterId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(encounterId)) {
      return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
    }

    const encRes = await pool.query<{
      patient_id: string;
      intake_visit_reason: string | null;
      chief_complaint_text: string | null;
      ai_suggested_comorbidities: CachedPayload | null;
      ai_suggested_comorbidities_context_hash: string | null;
    }>(
      `SELECT patient_id, intake_visit_reason, chief_complaint_text,
              ai_suggested_comorbidities, ai_suggested_comorbidities_context_hash
       FROM encounters WHERE id = $1 LIMIT 1`,
      [encounterId],
    );
    if (encRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
    }
    const enc = encRes.rows[0];

    // Eligibility: patient has ZERO canonical comorbidities (active OR resolved)
    const comRes = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM patient_comorbidities WHERE patient_id = $1`,
      [enc.patient_id],
    );
    const totalCom = comRes.rows[0]?.n ?? 0;
    if (totalCom > 0) {
      const payload: CachedPayload = {
        status: 'not_eligible',
        reason: 'patient_already_has_comorbidities',
        generated_at: new Date().toISOString(),
      };
      return NextResponse.json({ ok: true, cached: false, payload });
    }

    // Load demographics
    const patRes = await pool.query<{ age_years: number; sex: string }>(
      `SELECT age_years, sex FROM patients WHERE id = $1 LIMIT 1`,
      [enc.patient_id],
    );
    if (patRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'patient_not_found' }, { status: 404 });
    }
    const { age_years, sex } = patRes.rows[0];
    const visitReason = (enc.intake_visit_reason || enc.chief_complaint_text || '').trim();

    // Hash + cache check
    const contextHash = createHash('sha256')
      .update(JSON.stringify({ age: age_years, sex, visitReason }))
      .digest('hex')
      .slice(0, 24);

    if (enc.ai_suggested_comorbidities_context_hash === contextHash && enc.ai_suggested_comorbidities) {
      return NextResponse.json({ ok: true, cached: true, payload: enc.ai_suggested_comorbidities });
    }

    // v6.0 Phase 3 — Accept-header branch (NDJSON streaming variant).
    const accept = req.headers.get('accept') ?? '';
    const wantsStream = accept.includes('application/x-ndjson');

    if (wantsStream) {
      const trace = await openTrace({
        surface: 'comorbidity-context',
        encounter_id: encounterId,
        patient_id: enc.patient_id,
        doctor_email: session.email,
        request_input: { age: age_years, sex, visit_reason: visitReason },
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
          const payload = await runComorbidityContextPipeline(
            { encounterId, age_years, sex, visitReason, contextHash, signal: abort.signal },
            emit,
          );
          ndEmit({ type: 'result', data: { ok: true, cached: false, payload } });
          ndEmit({ type: 'done', ms: Date.now() - tStart });
          await trace.finalise({
            status: payload.status === 'ok' ? 'completed' : 'errored',
            result_summary: payload.status === 'ok' ? { count: payload.findings.length, latency_ms: payload.latency_ms } : { reason: (payload as { error?: string; reason?: string }).error ?? (payload as { reason?: string }).reason ?? 'unknown' },
            error_message: payload.status === 'failed' ? payload.error : undefined,
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

    // Qwen
    const userMessage = JSON.stringify({
      age: age_years,
      sex,
      visit_reason: visitReason || '(none captured)',
    });

    let payload: CachedPayload;
    try {
      const t0 = Date.now();
      const result = await qwenJson<{ suggestions: Array<{ code: string; label: string; rationale: string; confidence: number }> }>(
        SYSTEM_PROMPT,
        userMessage,
        { timeoutMs: 45_000 },
      );
      const latency_ms = Date.now() - t0;

      const clean: Suggestion[] = (result.json.suggestions ?? [])
        .filter((s) => s.code && isValidIcd10(s.code.trim().toUpperCase()))
        .slice(0, 6)
        .map((s) => ({
          code: s.code.trim().toUpperCase(),
          label: (s.label ?? '').slice(0, 200) || s.code,
          rationale: (s.rationale ?? '').slice(0, 100),
          // hard-cap confidence at 0.75 to enforce "just a guess" framing
          confidence: Math.min(0.75, Math.max(0, Number(s.confidence) || 0.5)),
        }));

      payload = {
        status: 'ok',
        findings: clean,
        generated_at: new Date().toISOString(),
        latency_ms,
      };
    } catch (e) {
      const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
      payload = { status: 'failed', error: msg.slice(0, 200), generated_at: new Date().toISOString() };
    }

    await pool.query(
      `UPDATE encounters
       SET ai_suggested_comorbidities = $2::jsonb,
           ai_suggested_comorbidities_generated_at = NOW(),
           ai_suggested_comorbidities_context_hash = $3
       WHERE id = $1`,
      [encounterId, JSON.stringify(payload), contextHash],
    );

    return NextResponse.json({ ok: true, cached: false, payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// v6.0 Phase 3 — runComorbidityContextPipeline
// Mirrors the legacy inline code; emits progress events.
// JSON branch above unchanged.
// ---------------------------------------------------------------------------

type ComorbidityContextPipelineCtx = {
  encounterId: string;
  age_years: number;
  sex: string;
  visitReason: string;
  contextHash: string;
  signal?: AbortSignal;
};

async function runComorbidityContextPipeline(
  ctx: ComorbidityContextPipelineCtx,
  emit: PipelineEmit,
): Promise<CachedPayload> {
  emit({ type: 'progress', stage: 'expanding' as Stage, msg: 'Bundling demographics + chief complaint' });

  const userMessage = JSON.stringify({
    age: ctx.age_years,
    sex: ctx.sex,
    visit_reason: ctx.visitReason || '(none captured)',
  });

  emit({ type: 'progress', stage: 'generating' as Stage, msg: 'Prompting the reasoning model for likely comorbidities' });

  let payload: CachedPayload;
  try {
    const t0 = Date.now();
    const result = await withHeartbeat(emit, 'generating' as Stage, 'Inferring comorbidity priors', async () =>
      qwenJson<{ suggestions: Array<{ code: string; label: string; rationale: string; confidence: number }> }>(
        SYSTEM_PROMPT,
        userMessage,
        { timeoutMs: 45_000, signal: ctx.signal },
      ),
    );
    const latency_ms = Date.now() - t0;

    emit({ type: 'progress', stage: 'parsing' as Stage, msg: 'Parsing comorbidity suggestions', ms: latency_ms });

    const clean: Suggestion[] = (result.json.suggestions ?? [])
      .filter((s) => s.code && isValidIcd10(s.code.trim().toUpperCase()))
      .slice(0, 6)
      .map((s) => ({
        code: s.code.trim().toUpperCase(),
        label: (s.label ?? '').slice(0, 200) || s.code,
        rationale: (s.rationale ?? '').slice(0, 100),
        confidence: Math.min(0.75, Math.max(0, Number(s.confidence) || 0.5)),
      }));

    payload = {
      status: 'ok',
      findings: clean,
      generated_at: new Date().toISOString(),
      latency_ms,
    };
  } catch (e) {
    const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
    payload = { status: 'failed', error: msg.slice(0, 200), generated_at: new Date().toISOString() };
  }

  emit({ type: 'progress', stage: 'persisting' as Stage, msg: 'Caching comorbidity priors' });

  await pool.query(
    `UPDATE encounters
     SET ai_suggested_comorbidities = $2::jsonb,
         ai_suggested_comorbidities_generated_at = NOW(),
         ai_suggested_comorbidities_context_hash = $3
     WHERE id = $1`,
    [ctx.encounterId, JSON.stringify(payload), ctx.contextHash],
  );

  return payload;
}

type Stage = 'expanding' | 'retrieving' | 'reranking' | 'fusing' | 'generating' | 'drafting' | 'reviewing' | 'revising' | 'finalizing' | 'parsing' | 'persisting' | 'done' | 'variants';
