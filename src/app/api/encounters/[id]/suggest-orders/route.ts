/**
 * GET /api/encounters/[id]/suggest-orders
 *
 * v3.5a — passive Qwen-driven order suggestions from encounter context.
 *
 * Returns 3–8 catalog suggestions Qwen thinks the doctor should consider
 * given the visit_reason, active problems, and last 5 encounters. Caches
 * to encounters.ai_suggested_orders (JSONB) + context_hash so a re-open
 * with the same context is free.
 *
 * Provenance: builds an allowed_catalog subset (top 200 by keyword
 * relevance to context + alphabetic fallback). Qwen receives only
 * those service_codes; server-side filter rejects anything Qwen
 * hallucinates outside the sent set. Same always-warn-never-block
 * pattern as v2 DDx.
 *
 * Failure: returns { status: 'failed' } with HTTP 200. Strip renders no
 * chips, no error toast. Search still works.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { qwenJson, QwenError } from '@/lib/qwen';
import { kbRetrieve, type KbChunk } from '@/lib/kb';
import { loadComorbidityContext, comorbidityContextForPrompt } from '@/lib/patient-comorbidity-context';
import { createHash } from 'node:crypto';
import { makeNdjsonStream, ndjsonHeaders, type ProgressEvent } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

type PipelineEmit = (ev: ProgressEvent) => void;
const noopEmit: PipelineEmit = () => {};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

type Suggestion = {
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: 'lab' | 'imaging' | 'cardiology' | 'procedure';
  rationale: string;
  confidence: number;
  /** v3.10.2 — KB chunk numbers (1-based) that ground this suggestion. */
  citation_numbers?: number[];
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

type CachedPayload =
  | {
      status: 'ok';
      findings: Suggestion[];
      citations?: CitationChunk[];
      generated_at: string;
      latency_ms: number;
      kb_latency_ms?: number;
    }
  | { status: 'failed'; error: string; generated_at: string };

const SYSTEM_PROMPT = `You are a clinical decision-support assistant for an Indian OPD physician. Given the patient's visit reason, active problems, and last few encounters, suggest a STARTER set of diagnostic tests the physician should consider ordering.

You receive:
- visit_reason: the chief complaint as captured by the CCE/nurse
- active_problems: cached Qwen-summarised problem list
- recent_encounters: brief one-line summary of up to 5 past completed encounters
- allowed_catalog: an array of {service_code, display_name, sub_department} the doctor can order
- v3.10.2: kb_context — up to 6 numbered chunks from clinical guidelines + UpToDate that may inform the workup choice.

Return STRICT JSON:
{
  "findings": [
    {
      "service_code": "<MUST be from allowed_catalog>",
      "rationale": "<one-line clinical reason, ≤120 chars, with inline [N] markers when kb_context supports the test>",
      "confidence": 0.5–0.95,
      "citation_numbers": [1, 3]
    }
  ]
}

Rules:
- 3–8 findings, ordered most → least relevant.
- Only suggest tests in allowed_catalog. If nothing fits, return an empty findings array.
- Skip tests the recent_encounters show were already ordered very recently for the same indication.
- rationale: plain clinical English, no hedging.
- confidence: 0.85+ for highly indicated (recurrent monitoring of known condition); 0.70+ for likely; 0.50+ for worth considering.
- v3.10.2 CITATION RULES:
  - When a kb_context chunk supports a recommendation, embed inline [N] in the rationale where N matches the chunk number (1-indexed).
  - Also list those chunk numbers in citation_numbers: [N, ...].
  - If kb_context contains nothing relevant for a suggestion, leave citation_numbers as [] and skip inline markers.
  - Never invent citation numbers — only use numbers that appear in kb_context.
Return ONLY the JSON object. No markdown, no prose.`;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
  const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  
    const { id: encounterId } = await ctx.params;
    const url = new URL(req.url);
    const force = url.searchParams.get('force') === '1';
  
    // 1. Load encounter + context
    const encRes = await pool.query<{
      id: string;
      patient_id: string;
      intake_visit_reason: string | null;
      chief_complaint_text: string | null;
      ai_suggested_orders: CachedPayload | null;
      ai_suggested_orders_context_hash: string | null;
    }>(
      `SELECT id, patient_id, intake_visit_reason, chief_complaint_text,
              ai_suggested_orders, ai_suggested_orders_context_hash
       FROM encounters WHERE id = $1 LIMIT 1`,
      [encounterId],
    );
    if (encRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
    }
    const enc = encRes.rows[0];
    const visitReason = (enc.intake_visit_reason || enc.chief_complaint_text || '').trim();
  
    // 2. Load active problems + last 5 encounters
    const [problemsRes, recentRes] = await Promise.all([
      pool.query<{ summary: { problems?: string[]; medications?: string[] } | null }>(
        `SELECT summary FROM patient_summaries WHERE patient_id = $1 LIMIT 1`,
        [enc.patient_id],
      ),
      pool.query<{ id: string; encounter_date: string; chief_complaint_text: string | null; impression: string | null }>(
        `SELECT id::text, encounter_date::text, chief_complaint_text, assessment_text AS impression
         FROM encounters
         WHERE patient_id = $1 AND id != $2 AND status='completed'
         ORDER BY encounter_date DESC LIMIT 5`,
        [enc.patient_id, encounterId],
      ),
    ]);
    const problems = problemsRes.rows[0]?.summary?.problems ?? [];
    const recentEncs = recentRes.rows;
  
    // 3. Hash + cache check
    const contextHash = createHash('sha256')
      .update(JSON.stringify({ visitReason, problems, recentIds: recentEncs.map((r) => r.id).sort() }))
      .digest('hex')
      .slice(0, 24);
  
    if (!force && enc.ai_suggested_orders_context_hash === contextHash && enc.ai_suggested_orders) {
      return NextResponse.json({ ok: true, cached: true, payload: enc.ai_suggested_orders });
    }

    // D.4 (V, 10 Jun): ?cache_only=1 — opening the Diagnostics workspace
    // must NEVER fire qwen. Stale cache is still shown (marked); fresh runs
    // come only from the doctor's button.
    if (new URL(req.url).searchParams.get('cache_only') === '1') {
      if (enc.ai_suggested_orders) {
        return NextResponse.json({ ok: true, cached: true, stale: true, payload: enc.ai_suggested_orders });
      }
      return NextResponse.json({ ok: true, cached: false, no_cached: true, payload: null });
    }

    // v6.0 Phase 2D — Accept-header branch. NDJSON path emits progress
    // events while we build catalog + retrieve KB + fire qwen; JSON path
    // (legacy) runs the same logic with a no-op emit.
    const accept = req.headers.get('accept') ?? '';
    const wantsStream = accept.includes('application/x-ndjson');

    if (wantsStream) {
      const trace = await openTrace({
        surface: 'suggest-orders',
        encounter_id: encounterId,
        patient_id: enc.patient_id,
        doctor_email: session.email,
        request_input: { visit_reason: visitReason, force },
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
          const payload = await runSuggestOrdersPipeline(
            { encounterId, enc, problems, recentEncs, visitReason, contextHash, signal: abort.signal },
            emit,
          );
          ndEmit({ type: 'result', data: { ok: true, cached: false, payload } });
          ndEmit({ type: 'done', ms: Date.now() - tStart });
          await trace.finalise({
            status: payload.status === 'ok' ? 'completed' : 'errored',
            result_summary: payload.status === 'ok' ? {
              count: payload.findings.length,
              latency_ms: payload.latency_ms,
            } : { reason: payload.error },
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

    // 4. Build allowed_catalog — keyword-relevance scoring then alphabetic fallback
    const keywords = visitReason.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
    // Pull top 200 lab + imaging + cardiology tests scored by keyword overlap.
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
                    CASE WHEN LOWER(display_name) LIKE '%' || k || '%' THEN 3 ELSE 0 END +
                    CASE WHEN LOWER(sub_department) LIKE '%' || k || '%' THEN 2 ELSE 0 END +
                    CASE WHEN EXISTS (SELECT 1 FROM unnest(synonyms) s WHERE LOWER(s) LIKE '%' || k || '%') THEN 2 ELSE 0 END
                  )::int
                  FROM unnest($1::text[]) AS k
                ), 0) AS score
         FROM diagnostic_catalog
         WHERE is_active = true
           AND modality IN ('lab','imaging','cardiology')
           AND 'OP' = ANY(patient_types)
       )
       SELECT * FROM scored
       ORDER BY score DESC, display_name ASC
       LIMIT 200`,
      [keywords.length > 0 ? keywords : ['']],
    );
  
    // 5. Call Qwen
    // v3.9.1b — comorbidity-aware prompt context
  const comorbidityCtx = await loadComorbidityContext(enc.patient_id).catch(() => null);

  // v3.10.2 — KB retrieval for workup grounding (guideline + uptodate only).
  // Soft-fail: empty chunks → behave like pre-v3.10.2.
  const kbQuery = [
    visitReason,
    problems.slice(0, 5).join(' '),
  ].filter(Boolean).join(' · ').slice(0, 1200);

  const kbT0 = Date.now();
  const kbChunks: KbChunk[] = kbQuery.length >= 5
    ? await kbRetrieve(kbQuery, {
        sources: ['guideline', 'uptodate'],
        topK: 6,
        hyde: true,
        timeoutMs: 20_000,
      })
    : [];
  const kbLatencyMs = Date.now() - kbT0;

  const kb_context = kbChunks.map((c, i) => ({
    n: i + 1,
    book: c.book,
    chapter: c.chapter,
    section: c.section,
    text_excerpt: c.text.slice(0, 800),
  }));

  const userMessage = JSON.stringify({
      visit_reason: visitReason || '(none captured)',
      active_problems: problems,
      recent_encounters: recentEncs.map((r) => ({
        date: r.encounter_date,
        cc: (r.chief_complaint_text || '').slice(0, 100),
        impression: (r.impression || '').slice(0, 200),
      })),
      allowed_catalog: catalog.map((c) => ({
        service_code: c.service_code,
        display_name: c.display_name,
        sub_department: c.sub_department,
      })),
      ...(comorbidityCtx ? comorbidityContextForPrompt(comorbidityCtx) : {}),
      kb_context,
    });
  
    let payload: CachedPayload;
    try {
      const t0 = Date.now();
      const result = await qwenJson<{ findings: Array<{ service_code: string; rationale: string; confidence: number; citation_numbers?: unknown }> }>(
        SYSTEM_PROMPT,
        userMessage,
        { timeoutMs: 60_000 },
      );
      const latency_ms = Date.now() - t0;
  
      // Provenance filter: only allow service_codes that were in the sent allowed_catalog
      const allowedSet = new Set(catalog.map((c) => c.service_code));
      const catalogByCode = new Map(catalog.map((c) => [c.service_code, c]));
      const maxCitationN = kbChunks.length;
      const cleanFindings: Suggestion[] = (result.json.findings ?? [])
        .filter((f) => f.service_code && allowedSet.has(f.service_code))
        .slice(0, 8)
        .map((f) => {
          const c = catalogByCode.get(f.service_code)!;
          const citNums = Array.isArray(f.citation_numbers)
            ? Array.from(new Set(
                f.citation_numbers
                  .map((n) => Number(n))
                  .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxCitationN),
              )).sort((a, b) => a - b)
            : [];
          return {
            service_code: f.service_code,
            display_name: c.display_name,
            sub_department: c.sub_department,
            modality: c.modality,
            rationale: (f.rationale ?? '').slice(0, 200),
            confidence: Math.max(0, Math.min(1, Number(f.confidence) || 0.5)),
            citation_numbers: citNums,
          };
        });

      // Only include chunks actually referenced by at least one finding
      const referenced = new Set<number>();
      for (const f of cleanFindings) for (const n of (f.citation_numbers ?? [])) referenced.add(n);
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
        findings: cleanFindings,
        citations,
        generated_at: new Date().toISOString(),
        latency_ms,
        kb_latency_ms: kbLatencyMs,
      };
    } catch (e) {
      const msg = e instanceof QwenError
        ? `Qwen ${e.kind}${e.status ? ` (${e.status})` : ''}`
        : e instanceof Error ? e.message : String(e);
      payload = {
        status: 'failed',
        error: msg.slice(0, 200),
        generated_at: new Date().toISOString(),
      };
    }
  
    // 6. Cache
    await pool.query(
      `UPDATE encounters
       SET ai_suggested_orders = $2::jsonb,
           ai_suggested_orders_generated_at = NOW(),
           ai_suggested_orders_context_hash = $3
       WHERE id = $1`,
      [encounterId, JSON.stringify(payload), contextHash],
    );
  
    return NextResponse.json({ ok: true, cached: false, payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[suggest-orders] uncaught", msg);
    return NextResponse.json({ ok: false, error: "server_error", detail: msg.slice(0, 300) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// v6.0 Phase 2D — runSuggestOrdersPipeline
//
// Shared inner pipeline used by the NDJSON branch. Builds the allowed
// catalog (keyword-scored 200), retrieves KB excerpts, calls qwen with
// heartbeats, normalises findings against the allowed_catalog, caches
// the payload, and returns it. Emits progress events at every phase
// boundary; the JSON branch above uses the original inline code instead
// (kept for backwards compat — both paths produce the same CachedPayload).
// ---------------------------------------------------------------------------

type PipelineCtx = {
  encounterId: string;
  enc: { id: string; patient_id: string };
  problems: string[];
  recentEncs: Array<{ id: string; encounter_date: string; chief_complaint_text: string | null; impression: string | null }>;
  visitReason: string;
  contextHash: string;
  signal?: AbortSignal;
};

async function runSuggestOrdersPipeline(
  ctx: PipelineCtx,
  emit: PipelineEmit,
): Promise<CachedPayload> {
  emit({ type: 'progress', stage: 'expanding' as Stage, msg: 'Building allowed catalog' });

  // Build allowed_catalog (same keyword scoring as the JSON path).
  const keywords = ctx.visitReason.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
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
                  CASE WHEN LOWER(display_name) LIKE '%' || k || '%' THEN 3 ELSE 0 END +
                  CASE WHEN LOWER(sub_department) LIKE '%' || k || '%' THEN 2 ELSE 0 END +
                  CASE WHEN EXISTS (SELECT 1 FROM unnest(synonyms) s WHERE LOWER(s) LIKE '%' || k || '%') THEN 2 ELSE 0 END
                )::int
                FROM unnest($1::text[]) AS k
              ), 0) AS score
       FROM diagnostic_catalog
       WHERE is_active = true
         AND modality IN ('lab','imaging','cardiology')
         AND 'OP' = ANY(patient_types)
     )
     SELECT * FROM scored
     ORDER BY score DESC, display_name ASC
     LIMIT 200`,
    [keywords.length > 0 ? keywords : ['']],
  );

  emit({ type: 'progress', stage: 'retrieving' as Stage, msg: `Built catalog of ${catalog.length} candidate tests` });

  const comorbidityCtx = await loadComorbidityContext(ctx.enc.patient_id).catch(() => null);
  const kbQuery = [ctx.visitReason, ctx.problems.slice(0, 5).join(' ')].filter(Boolean).join(' · ').slice(0, 1200);

  const kbT0 = Date.now();
  const kbChunks: KbChunk[] = kbQuery.length >= 5
    ? await kbRetrieve(kbQuery, { sources: ['guideline', 'uptodate'], topK: 6, hyde: true, timeoutMs: 20_000 })
    : [];
  const kbLatencyMs = Date.now() - kbT0;

  emit({ type: 'progress', stage: 'retrieving' as Stage, msg: `Retrieved ${kbChunks.length} clinical reference excerpts`, ms: kbLatencyMs });

  const kb_context = kbChunks.map((c, i) => ({
    n: i + 1,
    book: c.book,
    chapter: c.chapter,
    section: c.section,
    text_excerpt: c.text.slice(0, 800),
  }));

  const userMessage = JSON.stringify({
    visit_reason: ctx.visitReason || '(none captured)',
    active_problems: ctx.problems,
    recent_encounters: ctx.recentEncs.map((r) => ({
      date: r.encounter_date,
      cc: (r.chief_complaint_text || '').slice(0, 100),
      impression: (r.impression || '').slice(0, 200),
    })),
    allowed_catalog: catalog.map((c) => ({
      service_code: c.service_code,
      display_name: c.display_name,
      sub_department: c.sub_department,
    })),
    ...(comorbidityCtx ? comorbidityContextForPrompt(comorbidityCtx) : {}),
    kb_context,
  });

  emit({ type: 'progress', stage: 'generating' as Stage, msg: 'Prompting the reasoning model for relevant orders' });

  let payload: CachedPayload;
  try {
    const t0 = Date.now();
    const result = await withHeartbeat(emit, 'generating' as Stage, 'Prompting for orders', async () =>
      qwenJson<{ findings: Array<{ service_code: string; rationale: string; confidence: number; citation_numbers?: unknown }> }>(
        SYSTEM_PROMPT,
        userMessage,
        { timeoutMs: 60_000, signal: ctx.signal },
      ),
    );
    const latency_ms = Date.now() - t0;

    emit({ type: 'progress', stage: 'parsing' as Stage, msg: 'Parsing suggested orders', ms: latency_ms });

    const allowedSet = new Set(catalog.map((c) => c.service_code));
    const catalogByCode = new Map(catalog.map((c) => [c.service_code, c]));
    const maxCitationN = kbChunks.length;
    const cleanFindings: Suggestion[] = (result.json.findings ?? [])
      .filter((f) => f.service_code && allowedSet.has(f.service_code))
      .slice(0, 8)
      .map((f) => {
        const c = catalogByCode.get(f.service_code)!;
        const citNums = Array.isArray(f.citation_numbers)
          ? Array.from(new Set(
              f.citation_numbers
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxCitationN),
            )).sort((a, b) => a - b)
          : [];
        return {
          service_code: f.service_code,
          display_name: c.display_name,
          sub_department: c.sub_department,
          modality: c.modality,
          rationale: (f.rationale ?? '').slice(0, 200),
          confidence: Math.max(0, Math.min(1, Number(f.confidence) || 0.5)),
          citation_numbers: citNums,
        };
      });

    const referenced = new Set<number>();
    for (const f of cleanFindings) for (const n of (f.citation_numbers ?? [])) referenced.add(n);
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
      findings: cleanFindings,
      citations,
      generated_at: new Date().toISOString(),
      latency_ms,
      kb_latency_ms: kbLatencyMs,
    };
  } catch (e) {
    const msg = e instanceof QwenError
      ? `Qwen ${e.kind}${e.status ? ` (${e.status})` : ''}`
      : e instanceof Error ? e.message : String(e);
    payload = { status: 'failed', error: msg.slice(0, 200), generated_at: new Date().toISOString() };
  }

  // Persist the cache (same SQL as JSON branch).
  await pool.query(
    `UPDATE encounters
     SET ai_suggested_orders = $2::jsonb,
         ai_suggested_orders_generated_at = NOW(),
         ai_suggested_orders_context_hash = $3
     WHERE id = $1`,
    [ctx.encounterId, JSON.stringify(payload), ctx.contextHash],
  );

  return payload;
}

// Re-export Stage for the helper's emit signature.
type Stage = 'expanding' | 'retrieving' | 'reranking' | 'fusing' | 'generating' | 'drafting' | 'reviewing' | 'revising' | 'finalizing' | 'parsing' | 'persisting' | 'done' | 'variants';
