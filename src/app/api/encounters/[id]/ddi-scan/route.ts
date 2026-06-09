/**
 * POST /api/encounters/[id]/ddi-scan
 *
 * v2.2.1 — Qwen-only DDI checker (PRD Round 5 #13).
 *
 * Flow:
 *   1. Auth: only the encounter's doctor (or admin) can scan.
 *   2. Read current prescription_lines from the encounter's prescription
 *      row (created earlier by /api/encounters/[id]/prescription).
 *   3. Read patient context: known_allergies + the cached Qwen summary's
 *      `problems` + `medications_active` (from patient_summaries).
 *   4. Build a tight system prompt + user message and call qwenJson().
 *   5. Persist findings to encounters.ddi_findings (JSONB, already
 *      migrated in v15).
 *   6. Return { findings, scanned_at, latency_ms }.
 *
 * Severity tiers (locked):
 *   low      → silent flag in the row
 *   moderate → yellow inline warning, soft-confirm
 *   high     → red banner (still doesn't block Submit per UX lock —
 *              "always warn, never block")
 *   severe   → red banner, recommended replacement called out
 *
 * Output shape:
 *   ddi_findings: [
 *     { severity, pair: [drug_a, drug_b], rationale, recommendation,
 *       scanned_at }
 *   ]
 *
 * On Qwen failure (timeout / parse): persist `{ status: 'failed',
 * error }` to ddi_findings; UI shows a soft "DDI check unavailable"
 * notice. Per the always-warn-never-block lock, a Qwen outage doesn't
 * gate Submit either.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { qwenJson, QwenError } from '@/lib/qwen';
import type { PrescriptionLine } from '@/components/DrugRow';
import { makeNdjsonStream, ndjsonHeaders, type ProgressEvent } from '@/lib/llm-trace/stream';
import { openTrace } from '@/lib/llm-trace/log';
import { withHeartbeat } from '@/lib/llm-trace/heartbeat';

type PipelineEmit = (ev: ProgressEvent) => void;
const noopEmit: PipelineEmit = () => {};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type DdiFinding = {
  severity: 'low' | 'moderate' | 'high' | 'severe';
  pair: [string, string];
  rationale: string;
  recommendation: string | null;
  scanned_at: string;
};

type DdiPayload =
  | {
      status: 'ok';
      findings: DdiFinding[];
      scanned_at: string;
      latency_ms: number;
    }
  | {
      status: 'failed';
      error: string;
      scanned_at: string;
    };

const SYSTEM_PROMPT = `You are a clinical pharmacology safety screen for an Indian OPD EHR.

Given a list of currently-prescribed drugs + the patient's active problems + known allergies, identify drug-drug interactions and drug-condition contraindications.

Return STRICT JSON:
{
  "findings": [
    {
      "severity": "low" | "moderate" | "high" | "severe",
      "pair": ["<drug A or condition A>", "<drug B>"],
      "rationale": "<one short clinical sentence>",
      "recommendation": "<one short suggestion, or null>"
    }
  ]
}

Severity rules:
- low: theoretical or minor effect, monitoring sufficient
- moderate: needs dose adjustment, monitoring, or staggered timing
- high: significant risk in this patient, prefer alternative
- severe: contraindicated, would cause harm

Conservatively skip findings the doctor would already know (NSAID + warfarin; ACE inhibitor + ARB). Prioritise findings that are likely to change THIS doctor's prescribing today.

Return ONLY the JSON object. No prose, no markdown fences.`;

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

  // Load encounter + ownership check.
  const { rows: encRows } = await pool.query<{
    id: string;
    patient_id: string;
    status: string;
    doctor_email: string;
  }>(
    `SELECT e.id, e.patient_id, e.status::text AS status, d.email AS doctor_email
     FROM encounters e
     JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1
     LIMIT 1`,
    [id],
  );
  const enc = encRows[0];
  if (!enc) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (
    session.role !== 'admin' &&
    enc.doctor_email.toLowerCase() !== session.email.toLowerCase()
  ) {
    return NextResponse.json({ ok: false, error: 'not_your_encounter' }, { status: 403 });
  }

  // Load the prescription lines.
  const { rows: rxRows } = await pool.query<{
    lines: PrescriptionLine[] | null;
  }>(
    `SELECT lines FROM prescriptions WHERE encounter_id = $1 LIMIT 1`,
    [id],
  );
  const lines: PrescriptionLine[] = rxRows[0]?.lines ?? [];

  // Load patient context: allergies + cached summary problems/meds.
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
    `SELECT
       p.known_allergies,
       ps.summary->'problems' AS problems_json,
       ps.summary->'medications_active' AS meds_json
     FROM patients p
     LEFT JOIN patient_summaries ps ON ps.patient_id = p.id
     WHERE p.id = $1
     LIMIT 1`,
    [enc.patient_id],
  );
  const pctx = pRows[0] ?? {
    known_allergies: null,
    problems_json: null,
    meds_json: null,
  };

  // Short-circuit: if there are no prescription lines, no DDI to scan.
  if (lines.length === 0) {
    const empty: DdiPayload = {
      status: 'ok',
      findings: [],
      scanned_at: new Date().toISOString(),
      latency_ms: 0,
    };
    await pool.query(
      `UPDATE encounters SET ddi_findings = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(empty)],
    );
    return NextResponse.json({ ok: true, ...empty });
  }

  // Build the user message.
  const currentMeds = lines.map(
    (l, i) =>
      `${i + 1}. ${l.generic_name || l.brand_name || ''} ${l.strength ?? ''} ${l.frequency ?? ''}`
        .trim()
        .replace(/\s+/g, ' '),
  );
  const activeProblems = (pctx.problems_json ?? [])
    .filter((p) => !p.status || p.status === 'active')
    .map((p) => p.label)
    .filter(Boolean);
  const activeBackgroundMeds = (pctx.meds_json ?? [])
    .filter((m) => !m.status || m.status === 'active')
    .map(
      (m) =>
        `${m.generic_name || m.brand_name || ''} ${m.dose ?? ''}`
          .trim()
          .replace(/\s+/g, ' '),
    )
    .filter(Boolean);

  const userMessage = JSON.stringify({
    new_today: currentMeds,
    background_meds: activeBackgroundMeds,
    active_problems: activeProblems,
    known_allergies: pctx.known_allergies,
  });

  const scanned_at = new Date().toISOString();

  // v6.0 Phase 3 — Accept-header branch (NDJSON streaming variant).
  const accept = req.headers.get('accept') ?? '';
  const wantsStream = accept.includes('application/x-ndjson');

  if (wantsStream) {
    const trace = await openTrace({
      surface: 'ddi-scan',
      encounter_id: id,
      patient_id: enc.patient_id,
      doctor_email: session.email,
      request_input: { rx_lines: lines.length, problems: activeProblems.length, allergies: pctx.known_allergies ? 1 : 0 },
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
        const payload = await runDdiScanPipeline(
          { id, userMessage, scanned_at, signal: abort.signal },
          emit,
        );
        ndEmit({ type: 'result', data: { ok: true, ...payload } });
        ndEmit({ type: 'done', ms: Date.now() - tStart });
        await trace.finalise({
          status: payload.status === 'ok' ? 'completed' : 'errored',
          result_summary: payload.status === 'ok' ? { findings: payload.findings.length, latency_ms: payload.latency_ms } : { reason: payload.error },
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

  let payload: DdiPayload;
  try {
    const result = await qwenJson<{
      findings?: Array<{
        severity?: string;
        pair?: unknown;
        rationale?: string;
        recommendation?: string | null;
      }>;
    }>(SYSTEM_PROMPT, userMessage, { timeoutMs: 90_000 });

    const findings: DdiFinding[] = [];
    for (const f of result.json.findings ?? []) {
      const severity = normalizeSeverity(f.severity);
      if (!severity) continue;
      const pair = Array.isArray(f.pair)
        ? (f.pair.slice(0, 2).map(String) as [string, string])
        : null;
      if (!pair || pair.length < 2) continue;
      findings.push({
        severity,
        pair,
        rationale: String(f.rationale ?? '').slice(0, 400),
        recommendation: f.recommendation ? String(f.recommendation).slice(0, 200) : null,
        scanned_at,
      });
    }

    payload = {
      status: 'ok',
      findings,
      scanned_at,
      latency_ms: result.latency_ms,
    };
  } catch (e) {
    const msg =
      e instanceof QwenError
        ? `${e.kind}: ${e.message}`
        : e instanceof Error
        ? e.message
        : String(e);
    payload = {
      status: 'failed',
      error: msg.slice(0, 300),
      scanned_at,
    };
  }

  await pool.query(
    `UPDATE encounters SET ddi_findings = $2::jsonb WHERE id = $1`,
    [id, JSON.stringify(payload)],
  );

  return NextResponse.json({ ok: true, ...payload });
}

function normalizeSeverity(
  s: unknown,
): DdiFinding['severity'] | null {
  if (typeof s !== 'string') return null;
  const v = s.toLowerCase().trim();
  if (v === 'low' || v === 'moderate' || v === 'high' || v === 'severe')
    return v;
  return null;
}

// ---------------------------------------------------------------------------
// v6.0 Phase 3 — runDdiScanPipeline
// Mirrors the legacy inline DDI scan; emits progress events.
// JSON branch above unchanged.
// ---------------------------------------------------------------------------

type DdiScanPipelineCtx = {
  id: string;
  userMessage: string;
  scanned_at: string;
  signal?: AbortSignal;
};

async function runDdiScanPipeline(
  ctx: DdiScanPipelineCtx,
  emit: PipelineEmit,
): Promise<DdiPayload> {
  emit({ type: 'progress', stage: 'generating' as Stage, msg: 'Prompting the reasoning model for DDI scan' });

  let payload: DdiPayload;
  try {
    const result = await withHeartbeat(emit, 'generating' as Stage, 'Scanning drug-drug interactions', async () =>
      qwenJson<{
        findings?: Array<{
          severity?: string;
          pair?: unknown;
          rationale?: string;
          recommendation?: string | null;
        }>;
      }>(SYSTEM_PROMPT, ctx.userMessage, { timeoutMs: 90_000, signal: ctx.signal }),
    );

    emit({ type: 'progress', stage: 'parsing' as Stage, msg: 'Parsing DDI findings', ms: result.latency_ms });

    const findings: DdiFinding[] = [];
    for (const f of result.json.findings ?? []) {
      const severity = normalizeSeverity(f.severity);
      if (!severity) continue;
      const pair = Array.isArray(f.pair)
        ? (f.pair.slice(0, 2).map(String) as [string, string])
        : null;
      if (!pair || pair.length < 2) continue;
      findings.push({
        severity,
        pair,
        rationale: String(f.rationale ?? '').slice(0, 400),
        recommendation: f.recommendation ? String(f.recommendation).slice(0, 200) : null,
        scanned_at: ctx.scanned_at,
      });
    }

    payload = {
      status: 'ok',
      findings,
      scanned_at: ctx.scanned_at,
      latency_ms: result.latency_ms,
    };
  } catch (e) {
    const msg =
      e instanceof QwenError
        ? `${e.kind}: ${e.message}`
        : e instanceof Error
        ? e.message
        : String(e);
    payload = {
      status: 'failed',
      error: msg.slice(0, 300),
      scanned_at: ctx.scanned_at,
    };
  }

  emit({ type: 'progress', stage: 'persisting' as Stage, msg: 'Caching DDI findings' });

  await pool.query(
    `UPDATE encounters SET ddi_findings = $2::jsonb WHERE id = $1`,
    [ctx.id, JSON.stringify(payload)],
  );

  return payload;
}

type Stage = 'expanding' | 'retrieving' | 'reranking' | 'fusing' | 'generating' | 'drafting' | 'reviewing' | 'revising' | 'finalizing' | 'parsing' | 'persisting' | 'done' | 'variants';
