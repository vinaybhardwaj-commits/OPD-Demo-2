/**
 * POST /api/encounters/[id]/voice-query
 *
 * v2.2.3 — Push-to-talk voice query (PRD Round 5 #11).
 *
 * Doctor presses-and-holds the FAB on the encounter screen, MediaRecorder
 * captures WebM/WAV, releases → POSTs the audio here.
 *
 * Pipeline (one round-trip from the doctor's POV, even though three
 * services are involved):
 *   1. Auth (encounter doctor or admin)
 *   2. Deepgram nova-3-medical: audio → transcript (reuses
 *      src/lib/transcribe.ts from v1 Sprint 5)
 *   3. Qwen text model: transcript + patient context → answer +
 *      source_encounter_ids (provenance per PRD #14)
 *   4. Persist {question_transcript, answer_text, sources_json,
 *      latency_ms} to voice_queries (migration v22)
 *   5. Return everything to the client
 *
 * Per lock #14 — transcript + answer only. We deliberately do NOT
 * archive the audio blob.
 *
 * GET /api/encounters/[id]/voice-query
 *   Returns the last N voice queries on this encounter — the FAB
 *   drawer uses this to re-render history on remount.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { transcribeAudio } from '@/lib/transcribe';
import { qwenJson, QwenError } from '@/lib/qwen';
import { loadComorbidityContext, comorbidityContextForPrompt } from '@/lib/patient-comorbidity-context';
import { makeNdjsonStream, ndjsonHeaders, type ProgressEvent } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

type PipelineEmit = (ev: ProgressEvent) => void;
const noopEmit: PipelineEmit = () => {};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type StoredVoiceQuery = {
  id: string;
  question_transcript: string;
  answer_text: string;
  sources_json: { encounter_ids?: string[] } | null;
  latency_ms: number | null;
  created_at: string;
};

const SYSTEM_PROMPT = `You are an in-encounter clinical assistant for an Indian OPD doctor. The doctor asks you a short question by voice; you have access to this patient's history.

Inputs:
- the doctor's spoken question (transcribed)
- the patient's cached problem list, active meds, allergies
- up to 5 past completed encounters with id + chief complaint + assessment + medications

Return STRICT JSON:
{
  "answer": "<one or two short clinical sentences, no hedging>",
  "source_encounter_ids": ["<past encounter id that informs the answer>", ...]
}

Rules:
- Answer the question directly. Don't repeat it back. Don't add disclaimers.
- Cite past encounter_ids in source_encounter_ids only when the answer is informed by them. Empty array when the answer doesn't lean on history.
- If the question is out of scope (e.g. asks for the time of day) say so briefly.
- No markdown. JSON only.`;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const t0 = Date.now();
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

  // Encounter ownership.
  const { rows: encRows } = await pool.query<{
    id: string;
    patient_id: string;
    doctor_email: string;
    doctor_id: string;
  }>(
    `SELECT e.id, e.patient_id, d.email AS doctor_email, d.id AS doctor_id
     FROM encounters e JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 LIMIT 1`,
    [id],
  );
  const enc = encRows[0];
  if (!enc) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  if (
    session.role !== 'admin' &&
    enc.doctor_email.toLowerCase() !== session.email.toLowerCase()
  ) {
    return NextResponse.json({ ok: false, error: 'not_your_encounter' }, { status: 403 });
  }

  // Doctor's id for the voice_queries row.
  let doctorId = enc.doctor_id;
  if (session.role === 'admin') {
    const { rows: aRows } = await pool.query<{ id: string }>(
      `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
      [session.email],
    );
    if (aRows[0]?.id) doctorId = aRows[0].id;
  }

  // Multipart audio.
  let audio: Blob;
  let mimeType: string;
  try {
    const form = await req.formData();
    const f = form.get('audio');
    if (!(f instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'audio_missing' },
        { status: 400 },
      );
    }
    audio = f;
    mimeType = f.type || 'audio/webm';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'invalid_multipart', detail: msg.slice(0, 200) },
      { status: 400 },
    );
  }

  // v6.0 Phase 2E — Accept-header branch.
  const accept = req.headers.get('accept') ?? '';
  const wantsStream = accept.includes('application/x-ndjson');

  if (wantsStream) {
    const trace = await openTrace({
      surface: 'voice-query',
      encounter_id: id,
      patient_id: enc.patient_id,
      doctor_email: session.email,
      request_input: { mime: mimeType },
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
        const result = await runVoiceQueryPipeline(
          { encounterId: id, patientId: enc.patient_id, doctorId, audio, mimeType, signal: abort.signal },
          emit,
        );
        ndEmit({ type: 'result', data: result });
        ndEmit({ type: 'done', ms: Date.now() - tStart });
        await trace.finalise({
          status: 'completed',
          result_summary: {
            question_len: result.question_transcript.length,
            answer_len: result.answer_text.length,
            latency_ms: result.latency_ms,
            source_count: result.source_encounter_ids.length,
          },
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

  // 1. Deepgram.
  const transcribed = await transcribeAudio(audio, mimeType);
  if (!transcribed.ok) {
    return NextResponse.json(
      { ok: false, error: 'transcribe_failed', detail: transcribed.error },
      { status: 502 },
    );
  }
  const question = transcribed.transcript.trim();
  if (!question) {
    return NextResponse.json(
      { ok: false, error: 'empty_transcript' },
      { status: 400 },
    );
  }

  // 2. Patient context (cached summary + past encounters).
  const { rows: pRows } = await pool.query<{
    known_allergies: string | null;
    problems_json: { label: string; status?: string }[] | null;
    meds_json:
      | {
          generic_name?: string;
          brand_name?: string;
          dose?: string;
          status?: string;
        }[]
      | null;
  }>(
    `SELECT p.known_allergies,
            ps.summary->'problems' AS problems_json,
            ps.summary->'medications_active' AS meds_json
     FROM patients p
     LEFT JOIN patient_summaries ps ON ps.patient_id = p.id
     WHERE p.id = $1 LIMIT 1`,
    [enc.patient_id],
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
     ORDER BY encounter_date DESC LIMIT 5`,
    [enc.patient_id, id],
  );

  const validIds = new Set(pastRows.map((r) => r.id));
  // v3.9.1b — comorbidity-aware prompt context
  const comorbidityCtx = await loadComorbidityContext(enc.patient_id).catch(() => null);

  const userMessage = JSON.stringify({
    question,
    background: {
      active_problems: (pctx.problems_json ?? [])
        .filter((p) => !p.status || p.status === 'active')
        .map((p) => p.label),
      active_meds: (pctx.meds_json ?? [])
        .filter((m) => !m.status || m.status === 'active')
        .map((m) => `${m.generic_name || m.brand_name || ''} ${m.dose ?? ''}`.trim()),
      known_allergies: pctx.known_allergies,
    },
    past_encounters: pastRows.map((r) => ({
      id: r.id,
      date: r.encounter_date,
      chief_complaint: r.chief_complaint_text,
      assessment: r.assessment_text,
    })),
    ...(comorbidityCtx ? comorbidityContextForPrompt(comorbidityCtx) : {})
  });

  // 3. Qwen.
  let answer = '';
  let sourceIds: string[] = [];
  try {
    const result = await qwenJson<{
      answer?: string;
      source_encounter_ids?: unknown;
    }>(SYSTEM_PROMPT, userMessage, { timeoutMs: 90_000 });
    answer = String(result.json.answer ?? '').slice(0, 1200).trim();
    if (!answer) answer = '(Qwen returned no answer.)';
    if (Array.isArray(result.json.source_encounter_ids)) {
      sourceIds = result.json.source_encounter_ids
        .map(String)
        .filter((s): s is string => validIds.has(s));
    }
  } catch (e) {
    const msg =
      e instanceof QwenError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e);
    answer = `(Qwen failed: ${msg.slice(0, 200)})`;
  }

  const latency = Date.now() - t0;

  // 4. Persist.
  const { rows: insRows } = await pool.query<{ id: string }>(
    `INSERT INTO voice_queries (
       encounter_id, doctor_id, question_transcript, answer_text, sources_json, latency_ms
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      id,
      doctorId,
      question,
      answer,
      JSON.stringify({ encounter_ids: sourceIds }),
      latency,
    ],
  );

  return NextResponse.json({
    ok: true,
    id: insRows[0]?.id ?? null,
    question_transcript: question,
    answer_text: answer,
    source_encounter_ids: sourceIds,
    latency_ms: latency,
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_id' }, { status: 400 });
  }
  const { rows } = await pool.query<StoredVoiceQuery>(
    `SELECT id, question_transcript, answer_text, sources_json,
            latency_ms, created_at::text AS created_at
     FROM voice_queries
     WHERE encounter_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [id],
  );
  return NextResponse.json({ ok: true, queries: rows });
}

// ---------------------------------------------------------------------------
// v6.0 Phase 2E — runVoiceQueryPipeline
//
// Shared inner pipeline used by the NDJSON branch. Mirrors the inline
// JSON branch's flow (transcribe → load context → qwen → persist) but
// emits progress events at each phase. The JSON branch keeps its
// original inline code for backwards compatibility.
// ---------------------------------------------------------------------------

type VoiceQueryCtx = {
  encounterId: string;
  patientId: string;
  doctorId: string;
  audio: Blob;
  mimeType: string;
  signal?: AbortSignal;
};

type VoiceQueryResult = {
  ok: true;
  id: string | null;
  question_transcript: string;
  answer_text: string;
  source_encounter_ids: string[];
  latency_ms: number;
};

async function runVoiceQueryPipeline(
  ctx: VoiceQueryCtx,
  emit: PipelineEmit,
): Promise<VoiceQueryResult> {
  const t0 = Date.now();

  // 1. Transcribe with Deepgram.
  emit({ type: 'progress', stage: 'transcribing' as any, msg: 'Transcribing your question with Deepgram nova-3-medical' });
  const transcribed = await transcribeAudio(ctx.audio, ctx.mimeType);
  if (!transcribed.ok) {
    throw new Error(`transcribe_failed: ${transcribed.error}`);
  }
  const question = transcribed.transcript.trim();
  if (!question) {
    throw new Error('empty_transcript');
  }
  emit({ type: 'progress', stage: 'transcribing' as any, msg: `Transcribed (${question.length} chars)`, ms: Date.now() - t0 });

  // 2. Load patient context.
  emit({ type: 'progress', stage: 'expanding' as any, msg: 'Building chart context (problems + Rx + past encounters)' });

  const { rows: pRows } = await pool.query<{
    known_allergies: string | null;
    problems_json: { label: string; status?: string }[] | null;
    meds_json:
      | { generic_name?: string; brand_name?: string; dose?: string; status?: string }[]
      | null;
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
      ORDER BY encounter_date DESC LIMIT 5`,
    [ctx.patientId, ctx.encounterId],
  );

  const validIds = new Set(pastRows.map((r) => r.id));
  const comorbidityCtx = await loadComorbidityContext(ctx.patientId).catch(() => null);

  const userMessage = JSON.stringify({
    question,
    background: {
      active_problems: (pctx.problems_json ?? [])
        .filter((p) => !p.status || p.status === 'active')
        .map((p) => p.label),
      active_meds: (pctx.meds_json ?? [])
        .filter((m) => !m.status || m.status === 'active')
        .map((m) => `${m.generic_name || m.brand_name || ''} ${m.dose ?? ''}`.trim()),
      known_allergies: pctx.known_allergies,
    },
    past_encounters: pastRows.map((r) => ({
      id: r.id,
      date: r.encounter_date,
      chief_complaint: r.chief_complaint_text,
      assessment: r.assessment_text,
    })),
    ...(comorbidityCtx ? comorbidityContextForPrompt(comorbidityCtx) : {}),
  });

  emit({ type: 'progress', stage: 'expanding' as any, msg: `Context built — ${pastRows.length} past encounter${pastRows.length === 1 ? '' : 's'} loaded`, ms: Date.now() - t0 });

  // 3. qwen call, wrapped in withHeartbeat for the long path.
  emit({ type: 'progress', stage: 'generating' as any, msg: 'Answering with the reasoning model, grounded in chart context' });

  let answer = '';
  let sourceIds: string[] = [];
  try {
    const result = await withHeartbeat(emit, 'generating' as any, 'Answering from the chart', async () =>
      qwenJson<{ answer?: string; source_encounter_ids?: unknown }>(
        SYSTEM_PROMPT,
        userMessage,
        { timeoutMs: 90_000, signal: ctx.signal },
      ),
    );
    answer = String(result.json.answer ?? '').slice(0, 1200).trim();
    if (!answer) answer = '(The model returned no answer.)';
    if (Array.isArray(result.json.source_encounter_ids)) {
      sourceIds = result.json.source_encounter_ids
        .map(String)
        .filter((s): s is string => validIds.has(s));
    }
  } catch (e) {
    const msg =
      e instanceof QwenError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e);
    answer = `(Model call failed: ${msg.slice(0, 200)})`;
  }

  const latency = Date.now() - t0;

  // 4. Persist.
  const { rows: insRows } = await pool.query<{ id: string }>(
    `INSERT INTO voice_queries (
       encounter_id, doctor_id, question_transcript, answer_text, sources_json, latency_ms
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      ctx.encounterId,
      ctx.doctorId,
      question,
      answer,
      JSON.stringify({ encounter_ids: sourceIds }),
      latency,
    ],
  );

  return {
    ok: true,
    id: insRows[0]?.id ?? null,
    question_transcript: question,
    answer_text: answer,
    source_encounter_ids: sourceIds,
    latency_ms: latency,
  };
}
