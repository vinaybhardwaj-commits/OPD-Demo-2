/**
 * POST /api/icd10/lookup-batch
 *
 * v3.8.1 — batch lookup ICD-10 code → canonical label. Used by
 * EncounterEditor on mount to backfill labels for codes that exist
 * in assessment_codes[] but not yet in assessment_code_labels JSONB
 * (e.g. codes added in a prior session before v3.8.1 persistence).
 *
 * Body: { codes: string[] }
 * Returns: { labels: { [code]: string } }
 *
 * Algorithm:
 *   1. For each code, try static lookupIcd10() — sub-ms, hits common codes.
 *   2. For codes still missing, batch one Qwen call asking for canonical
 *      ICD-10-CM labels for the remaining codes.
 *   3. Returns the merged map. Codes Qwen couldn't resolve get the
 *      code itself as their label (graceful fallback so chips never
 *      look empty).
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { lookupIcd10 } from '@/lib/icd10';
import { qwenJson, QwenError } from '@/lib/qwen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an ICD-10-CM coder. Given an array of ICD-10-CM codes, return the canonical short description for each.

Return STRICT JSON:
{
  "labels": {
    "<code>": "<canonical description>",
    ...
  }
}

Rules:
- Use the official ICD-10-CM short description (or the closest available canonical phrasing).
- Keep each label ≤ 100 chars.
- For codes you don't recognise, omit them — don't invent.
- Do NOT include any preamble or markdown.`;

export async function POST(req: Request) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

    const body = (await req.json()) as { codes?: string[] };
    const codes = Array.isArray(body.codes) ? body.codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean) : [];
    if (codes.length === 0) return NextResponse.json({ ok: true, labels: {} });

    // Stage 1 — static lookup for the common ones
    const labels: Record<string, string> = {};
    const unresolved: string[] = [];
    for (const c of codes) {
      const hit = lookupIcd10(c);
      if (hit) labels[c] = hit;
      else unresolved.push(c);
    }

    // Stage 2 — single Qwen batch call for the remainder
    if (unresolved.length > 0) {
      try {
        const result = await qwenJson<{ labels: Record<string, string> }>(
          SYSTEM_PROMPT,
          JSON.stringify({ codes: unresolved }),
          { timeoutMs: 40_000 },
        );
        const fromQwen = result.json.labels ?? {};
        for (const c of unresolved) {
          if (fromQwen[c] && typeof fromQwen[c] === 'string') {
            labels[c] = String(fromQwen[c]).slice(0, 200);
          }
        }
      } catch (e) {
        // Soft-fail Qwen; codes without labels just stay as code.
        const msg = e instanceof QwenError ? `Qwen ${e.kind}` : e instanceof Error ? e.message : String(e);
        console.error('[icd10 lookup-batch] qwen failed', msg);
      }
    }

    // Stage 3 — graceful fallback: any code without a label gets the code as its label
    for (const c of codes) {
      if (!labels[c]) labels[c] = c;
    }

    return NextResponse.json({ ok: true, labels });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
