/**
 * POST /api/demo/ddi-check
 *
 * Encounter-less Qwen DDI scan for the public demo surface at
 * /demo/drug-ddi. Mirrors the prompt + output shape of
 * /api/encounters/[id]/ddi-scan but takes the inputs straight from
 * the request body instead of pulling them out of a real encounter.
 *
 * Body:
 *   {
 *     drugs:       string[]   // e.g. ["Amitriptyline 25mg", "Tramadol 50mg"]
 *     allergies?:  string     // free text
 *     conditions?: string     // free text, e.g. "Type 2 diabetes; CKD stage 3"
 *   }
 *
 * Returns the same DdiFinding[] structure as the encounter endpoint.
 * No auth — this is the public demo. Rate-limit / lock down via env
 * if you ever expose it outside the demo URL.
 */
import { NextResponse } from 'next/server';
import { qwenJson, QwenError } from '@/lib/qwen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

type DdiFinding = {
  severity: 'low' | 'moderate' | 'high' | 'severe';
  pair: [string, string];
  rationale: string;
  recommendation: string | null;
  scanned_at: string;
};

const SYSTEM_PROMPT = `You are a clinical pharmacology safety screen for an Indian OPD EHR.

Given a list of prescribed drugs + the patient's active problems + known allergies, identify drug-drug interactions and drug-condition contraindications.

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

Conservatively skip findings the doctor would already know. Prioritise findings that are likely to change the prescriber's mind today.

Return ONLY the JSON object. No prose, no markdown fences.`;

function normalizeSeverity(s: unknown): DdiFinding['severity'] | null {
  if (typeof s !== 'string') return null;
  const v = s.toLowerCase().trim();
  if (v === 'low' || v === 'moderate' || v === 'high' || v === 'severe') return v;
  return null;
}

export async function POST(req: Request) {
  let body: { drugs?: unknown; allergies?: unknown; conditions?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const drugs = (Array.isArray(body.drugs) ? body.drugs : [])
    .map((d) => (typeof d === 'string' ? d.trim() : ''))
    .filter((d) => d.length > 0 && d.length <= 200);
  if (drugs.length < 1) {
    return NextResponse.json(
      { ok: false, error: 'no_drugs', detail: 'Pick at least one drug.' },
      { status: 400 },
    );
  }
  const allergies =
    typeof body.allergies === 'string'
      ? body.allergies.trim().slice(0, 500)
      : '';
  const conditions =
    typeof body.conditions === 'string'
      ? body.conditions.trim().slice(0, 500)
      : '';

  const userMessage = JSON.stringify({
    new_today: drugs,
    background_meds: [],
    active_problems: conditions ? conditions.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean) : [],
    known_allergies: allergies || null,
  });

  const scanned_at = new Date().toISOString();
  try {
    const result = await qwenJson<{
      findings?: Array<{
        severity?: string;
        pair?: unknown;
        rationale?: string;
        recommendation?: string | null;
      }>;
    }>(SYSTEM_PROMPT, userMessage, { timeoutMs: 75_000 });

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

    return NextResponse.json({
      ok: true,
      status: 'ok',
      findings,
      scanned_at,
      latency_ms: result.latency_ms,
    });
  } catch (e) {
    const msg =
      e instanceof QwenError
        ? `${e.kind}: ${e.message}`
        : e instanceof Error
        ? e.message
        : String(e);
    return NextResponse.json({
      ok: true,
      status: 'failed',
      error: msg.slice(0, 300),
      scanned_at,
    });
  }
}
