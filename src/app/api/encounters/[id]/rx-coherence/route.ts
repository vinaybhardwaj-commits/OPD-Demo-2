/**
 * POST /api/encounters/[id]/rx-coherence
 *
 * v3.9.4 — Real-time Rx ↔ comorbidity coherence check.
 *
 * Body: { lines: PrescriptionLine[] }
 *
 * Pipeline:
 *  1. Load patient's current canonical comorbidity codes (so we dedup)
 *  2. Also load the encounter's rx_comorbidity_overrides (so already-
 *     handled warnings are dropped from the response)
 *  3. For each prescription line:
 *     a. Static lookup via lib/rx-comorbidity-map (sub-ms)
 *     b. If miss AND drug name looks plausible, queue for Qwen fallback
 *  4. Batched Qwen call asks 'for each of these drugs, is it primarily
 *     a chronic medication? If so, what comorbidity does it imply?'
 *  5. Build warning list, dedup against patient comorbidities + overrides
 *
 * Returns: { warnings: [{ rx_index, drug_name, comorbidity_code,
 *                         comorbidity_label, source, confidence }] }
 *
 * Soft-fail: any error returns 200 with empty warnings — the rest of the
 * encounter must keep working even if this endpoint blows up.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { qwenJson, QwenError } from '@/lib/qwen';
import { lookupChronicRx, type ChronicRxEntry } from '@/lib/rx-comorbidity-map';
import { isValidIcd10 } from '@/lib/comorbidities-catalog';
import { makeNdjsonStream, ndjsonHeaders, type ProgressEvent } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

type PipelineEmit = (ev: ProgressEvent) => void;
const noopEmit: PipelineEmit = () => {};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type PrescriptionLineLite = {
  item_code?: string;
  generic_name?: string;
  brand_name?: string;
};

type Warning = {
  rx_index: number;
  drug_name: string;
  comorbidity_code: string;
  comorbidity_label: string;
  source: 'static' | 'qwen';
  confidence: number;
};

type OverrideEntry = {
  drug_name?: string;
  comorbidity_code?: string;
  decision?: 'added' | 'overridden';
};

const QWEN_SYSTEM_PROMPT = `You are an Indian OPD physician's pharmacovigilance assistant. Given a list of drug names, identify which ones are PRIMARILY chronic-condition medications and what comorbidity each implies.

You receive:
- drugs: array of { index, name } — drug names that did NOT match a static chronic-Rx list

Return STRICT JSON:
{
  "findings": [
    {
      "index": <int — matches input>,
      "comorbidity_code": "<ICD-10 code, e.g. E78.5>",
      "comorbidity_label": "<short canonical condition name>",
      "confidence": 0.50–0.85
    }
  ]
}

Rules:
- Only include drugs that are PRIMARILY chronic (≥80% of clinical use is for the implied chronic condition).
- Skip antibiotics, NSAIDs, PPIs, opioids, gabapentinoids, antihistamines, paracetamol, antiemetics — these have heterogeneous use.
- Skip vitamins, supplements, OTC products.
- Skip drugs you don't recognize — omit them rather than guess.
- ICD-10-CM format: capital letter, two digits, optional dot + 1-4 more digits.
- Confidence MAX 0.85 — these are inferences, not diagnoses.
- Return findings ONLY for drugs that ARE chronic. Omit non-chronic drugs entirely.

Return ONLY the JSON object. No markdown, no preamble.`;

export async function POST(
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

    const body = (await req.json()) as { lines?: PrescriptionLineLite[] };
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (lines.length === 0) {
      return NextResponse.json({ ok: true, warnings: [], stats: { total: 0, static: 0, qwen: 0 } });
    }

    // Load encounter → patient_id + existing overrides
    const encRes = await pool.query<{
      patient_id: string;
      rx_comorbidity_overrides: OverrideEntry[] | null;
    }>(
      `SELECT patient_id, rx_comorbidity_overrides
       FROM encounters WHERE id = $1 LIMIT 1`,
      [encounterId],
    );
    if (encRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'encounter_not_found' }, { status: 404 });
    }
    const patientId = encRes.rows[0].patient_id;
    const overrides = encRes.rows[0].rx_comorbidity_overrides ?? [];

    // Load patient's existing comorbidity codes (active only — resolved
    // shouldn't suppress the warning since the doctor may need to re-add)
    const comRes = await pool.query<{ code: string }>(
      `SELECT code FROM patient_comorbidities WHERE patient_id = $1 AND is_resolved = false`,
      [patientId],
    );
    const existingCodes = new Set(comRes.rows.map((r) => r.code.toUpperCase()));

    // Build override-suppression set: skip any warning the doctor already
    // handled (added or overridden) in this encounter
    const handledKeys = new Set<string>(
      overrides
        .filter((o) => o.drug_name && o.comorbidity_code && o.decision)
        .map((o) => `${(o.drug_name as string).toLowerCase()}::${(o.comorbidity_code as string).toUpperCase()}`),
    );

    // --- Static pass ---
    const warnings: Warning[] = [];
    const unmappedForQwen: Array<{ index: number; name: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const candidates = [line.generic_name, line.brand_name].filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      );
      let hit: ChronicRxEntry | null = null;
      let matchedName = '';
      for (const c of candidates) {
        const h = lookupChronicRx(c);
        if (h) { hit = h; matchedName = c; break; }
      }
      if (hit) {
        const key = `${matchedName.toLowerCase()}::${hit.icd10.toUpperCase()}`;
        if (existingCodes.has(hit.icd10.toUpperCase())) continue;
        if (handledKeys.has(key)) continue;
        warnings.push({
          rx_index: i,
          drug_name: matchedName,
          comorbidity_code: hit.icd10,
          comorbidity_label: hit.label,
          source: 'static',
          confidence: hit.confidence,
        });
      } else if (candidates.length > 0) {
        // Plausible drug name, no static match — queue for Qwen
        unmappedForQwen.push({ index: i, name: candidates[0] });
      }
    }

    // v6.0 Phase 3 — Accept-header branch (NDJSON streaming variant).
    const accept = req.headers.get('accept') ?? '';
    const wantsStream = accept.includes('application/x-ndjson');

    if (wantsStream) {
      const trace = await openTrace({
        surface: 'rx-coherence',
        encounter_id: encounterId,
        patient_id: patientId,
        doctor_email: session.email,
        request_input: { line_count: lines.length, static_warnings: warnings.length, qwen_candidates: unmappedForQwen.length },
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
          const payload = await runRxCoherencePipeline(
            { warnings: warnings.slice(), unmappedForQwen, existingCodes, handledKeys, signal: abort.signal },
            emit,
          );
          ndEmit({ type: 'result', data: { ok: true, ...payload } });
          ndEmit({ type: 'done', ms: Date.now() - tStart });
          await trace.finalise({
            status: 'completed',
            result_summary: { warnings: payload.warnings.length, stats: payload.stats },
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

    // --- Qwen fallback for unmapped drugs ---
    let qwenAdded = 0;
    if (unmappedForQwen.length > 0) {
      try {
        const result = await qwenJson<{ findings: Array<{ index: number; comorbidity_code: string; comorbidity_label: string; confidence: number }> }>(
          QWEN_SYSTEM_PROMPT,
          JSON.stringify({ drugs: unmappedForQwen }),
          { timeoutMs: 30_000 },
        );
        const findings = result.json.findings ?? [];
        for (const f of findings) {
          if (typeof f.index !== 'number') continue;
          const rxLine = unmappedForQwen.find((u) => u.index === f.index);
          if (!rxLine) continue;
          const code = (f.comorbidity_code || '').trim().toUpperCase();
          if (!isValidIcd10(code)) continue;
          if (existingCodes.has(code)) continue;
          const key = `${rxLine.name.toLowerCase()}::${code}`;
          if (handledKeys.has(key)) continue;
          warnings.push({
            rx_index: rxLine.index,
            drug_name: rxLine.name,
            comorbidity_code: code,
            comorbidity_label: (f.comorbidity_label || '').slice(0, 200) || code,
            source: 'qwen',
            confidence: Math.min(0.85, Math.max(0, Number(f.confidence) || 0.5)),
          });
          qwenAdded++;
        }
      } catch (e) {
        // Soft-fail Qwen — static warnings still surface
        const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
        return NextResponse.json({
          ok: true,
          warnings,
          stats: { total: warnings.length, static: warnings.length, qwen: 0 },
          qwen_failed: msg.slice(0, 120),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      warnings,
      stats: { total: warnings.length, static: warnings.length - qwenAdded, qwen: qwenAdded },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// v6.0 Phase 3 — runRxCoherencePipeline
// Mirrors the legacy inline Qwen-fallback code; emits progress events.
// JSON branch above is unchanged.
// ---------------------------------------------------------------------------

type RxCoherencePipelineCtx = {
  warnings: Warning[];
  unmappedForQwen: Array<{ index: number; name: string }>;
  existingCodes: Set<string>;
  handledKeys: Set<string>;
  signal?: AbortSignal;
};

type RxCoherenceResult = {
  warnings: Warning[];
  stats: { total: number; static: number; qwen: number };
  qwen_failed?: string;
};

async function runRxCoherencePipeline(
  ctx: RxCoherencePipelineCtx,
  emit: PipelineEmit,
): Promise<RxCoherenceResult> {
  const warnings = ctx.warnings;
  let qwenAdded = 0;

  if (ctx.unmappedForQwen.length === 0) {
    emit({ type: 'progress', stage: 'parsing' as Stage, msg: 'No unmapped drugs needed LLM fallback' });
    return {
      warnings,
      stats: { total: warnings.length, static: warnings.length, qwen: 0 },
    };
  }

  emit({ type: 'progress', stage: 'generating' as Stage, msg: `Prompting the reasoning model for ${ctx.unmappedForQwen.length} unmapped drug(s)` });

  try {
    const t0 = Date.now();
    const result = await withHeartbeat(emit, 'generating' as Stage, 'Inferring chronic-drug mappings', async () =>
      qwenJson<{ findings: Array<{ index: number; comorbidity_code: string; comorbidity_label: string; confidence: number }> }>(
        QWEN_SYSTEM_PROMPT,
        JSON.stringify({ drugs: ctx.unmappedForQwen }),
        { timeoutMs: 30_000, signal: ctx.signal },
      ),
    );
    const latency_ms = Date.now() - t0;
    emit({ type: 'progress', stage: 'parsing' as Stage, msg: 'Parsing Rx coherence findings', ms: latency_ms });

    const findings = result.json.findings ?? [];
    for (const f of findings) {
      if (typeof f.index !== 'number') continue;
      const rxLine = ctx.unmappedForQwen.find((u) => u.index === f.index);
      if (!rxLine) continue;
      const code = (f.comorbidity_code || '').trim().toUpperCase();
      if (!isValidIcd10(code)) continue;
      if (ctx.existingCodes.has(code)) continue;
      const key = `${rxLine.name.toLowerCase()}::${code}`;
      if (ctx.handledKeys.has(key)) continue;
      warnings.push({
        rx_index: rxLine.index,
        drug_name: rxLine.name,
        comorbidity_code: code,
        comorbidity_label: (f.comorbidity_label || '').slice(0, 200) || code,
        source: 'qwen',
        confidence: Math.min(0.85, Math.max(0, Number(f.confidence) || 0.5)),
      });
      qwenAdded++;
    }
    return {
      warnings,
      stats: { total: warnings.length, static: warnings.length - qwenAdded, qwen: qwenAdded },
    };
  } catch (e) {
    const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
    return {
      warnings,
      stats: { total: warnings.length, static: warnings.length, qwen: 0 },
      qwen_failed: msg.slice(0, 120),
    };
  }
}

type Stage = 'expanding' | 'retrieving' | 'reranking' | 'fusing' | 'generating' | 'drafting' | 'reviewing' | 'revising' | 'finalizing' | 'parsing' | 'persisting' | 'done' | 'variants';
