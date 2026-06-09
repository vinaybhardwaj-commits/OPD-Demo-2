/**
 * Qwen Vision client (v2.1 Lab Workstation) — extracts structured lab
 * panel data from a scanned-PDF or photographed lab report.
 *
 * Same Cloudflare-tunnelled Ollama instance as src/lib/qwen.ts, but
 * routes to the multimodal model (`qwen2.5vl:7b`) and packs the image
 * into an OpenAI-style multimodal `content` array:
 *   content: [
 *     { type: 'text', text: '<instructions>' },
 *     { type: 'image_url', image_url: { url: 'data:image/png;base64,…' } },
 *   ]
 *
 * Lab reports vary wildly (multi-column, stamps, Hindi/Kannada headers,
 * brand watermarks). The strategy is:
 *   1. Caller renders the source PDF to a high-res PNG (one per page).
 *   2. We send each page to Qwen-VL with the same structured-extraction
 *      prompt, parse the JSON, and merge.
 *   3. Per-item confidence comes back in the JSON; we compute an
 *      overall_confidence as the min of per-item confidences.
 *
 * Auto-post rule (PRD lock L.6): overall_confidence ≥ 0.9 → auto-post
 * by the /lab tech UI. Otherwise → side-by-side edit grid.
 *
 * Errors reuse QwenError from src/lib/qwen.ts for consistency.
 */
import { QwenError } from '@/lib/qwen';

export const QWEN_VL_MODEL = 'qwen2.5vl:7b';
export const QWEN_VL_TEMPERATURE = 0.1; // lower temp than text Qwen — extraction is mechanical
export const QWEN_VL_TIMEOUT_MS = 90_000; // VL is slower than text; one cold start + one warm page

/**
 * Canonical extraction shape. Matches lab_results columns 1:1 so the
 * caller can INSERT without renaming.
 *
 *   canonical_key — lower-snake-case stable ID (e.g. 'hb_a1c', 'cbc_wbc')
 *                   used for cross-encounter trending. Qwen returns its
 *                   best guess; the schema doesn't enforce a vocabulary.
 *   display_name  — human label as printed on the report
 *   value_numeric — parsed numeric value, null if textual (e.g. 'POSITIVE')
 *   value_text    — when not numeric (urine RBC = 'occasional')
 *   unit          — 'g/dL', 'mg/dL', '%', 'cells/uL' etc.
 *   reference_range — '4.0–5.5', '<140', '>40 (M)/>50 (F)'
 *   abnormal_flag — low | high | critical_low | critical_high | normal | unknown
 *   confidence    — Qwen's own [0,1] estimate
 */
export type ExtractedLabItem = {
  canonical_key: string;
  display_name: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  reference_range: string | null;
  abnormal_flag: 'low' | 'high' | 'critical_low' | 'critical_high' | 'normal' | 'unknown';
  confidence: number;
};

export type LabExtractionResult = {
  items: ExtractedLabItem[];
  overall_confidence: number;
  /** Raw JSON Qwen returned for audit + debugging. */
  raw: unknown;
  /** Convenience: extraction round-trip time per page. */
  latency_ms: number;
  model: string;
};

const SYSTEM_PROMPT = `You are a clinical-grade lab report extractor for an Indian OPD electronic health record.

Read the lab report image and return a STRICT JSON object:
{
  "items": [
    {
      "canonical_key": "<lower_snake_case stable key, e.g. hb_a1c, cbc_wbc, ldl_cholesterol>",
      "display_name": "<exact label as printed>",
      "value_numeric": <number or null>,
      "value_text": "<string or null when value is non-numeric>",
      "unit": "<unit string or null>",
      "reference_range": "<as printed, or null>",
      "abnormal_flag": "low" | "high" | "critical_low" | "critical_high" | "normal" | "unknown",
      "confidence": <0.0 to 1.0>
    }
  ],
  "overall_confidence": <0.0 to 1.0, the MIN of per-item confidences>
}

Rules:
- Skip metadata rows (patient name, sample ID, date, sign-offs).
- Only extract numeric or categorical lab measurements.
- canonical_key MUST be lower_snake_case English even if the report is in Hindi/Kannada/etc.
- If a value is "POSITIVE", "NEGATIVE", "TRACE", "OCCASIONAL" etc → put it in value_text and leave value_numeric null.
- abnormal_flag: derive from H/L/HH/LL markers on the report OR from comparing value vs reference_range. Use "unknown" only when neither is available.
- confidence: lower it (≤0.7) when handwriting, smudges, unusual abbreviations, or ambiguous reference ranges are involved.
- Return ONLY the JSON object. No prose, no markdown fences.`;

/**
 * Extract lab items from one rendered page image (PNG or JPEG).
 *
 * `pageImageBase64` should be the *content* portion of a data URL —
 * just the base64 payload, no "data:image/png;base64," prefix.
 * `mimeType` defaults to `image/png` (what pdf-to-image renderers
 * typically emit).
 */
export async function extractLabPage(
  pageImageBase64: string,
  opts: {
    mimeType?: 'image/png' | 'image/jpeg';
    timeoutMs?: number;
    model?: string;
    temperature?: number;
  } = {},
): Promise<LabExtractionResult> {
  const base = process.env.LLM_BASE_URL;
  if (!base) {
    throw new QwenError('no_env', 'LLM_BASE_URL is not configured');
  }
  const model = opts.model ?? QWEN_VL_MODEL;
  const temperature = opts.temperature ?? QWEN_VL_TEMPERATURE;
  const timeoutMs = opts.timeoutMs ?? QWEN_VL_TIMEOUT_MS;
  const mimeType = opts.mimeType ?? 'image/png';

  const apiKey = process.env.LLM_API_KEY ?? 'ollama';
  const url = `${base.replace(/\/+$/, '')}/chat/completions`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        // Ollama's multimodal endpoint accepts the OpenAI-style content array.
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract every lab measurement from this report.',
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${pageImageBase64}` },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (e: unknown) {
    clearTimeout(tid);
    const msg = e instanceof Error ? e.message : String(e);
    if (controller.signal.aborted) {
      throw new QwenError('timeout', `Qwen-VL call exceeded ${timeoutMs}ms`);
    }
    throw new QwenError('network', `Qwen-VL fetch failed: ${msg}`);
  }
  clearTimeout(tid);
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new QwenError('http', `Qwen-VL HTTP ${res.status}`, {
      status: res.status,
      detail: body.slice(0, 500),
    });
  }

  let outer: unknown;
  try {
    outer = await res.json();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new QwenError('parse_error', `Qwen-VL response was not JSON: ${msg}`);
  }

  const content = (() => {
    if (!outer || typeof outer !== 'object') return null;
    const choices = (outer as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const c0 = choices[0];
    if (!c0 || typeof c0 !== 'object') return null;
    const msg = (c0 as { message?: { content?: unknown } }).message;
    if (!msg || typeof msg !== 'object') return null;
    const cContent = (msg as { content?: unknown }).content;
    return typeof cContent === 'string' ? cContent : null;
  })();

  if (content === null) {
    throw new QwenError('parse_error', 'Qwen-VL returned no choices[0].message.content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new QwenError('parse_error', `Qwen-VL content was not JSON: ${msg}`, {
      detail: content.slice(0, 500),
    });
  }

  // Normalise: trust Qwen to return the schema, but be defensive about types.
  const items = normalizeItems(parsed);
  const overall_confidence =
    items.length === 0
      ? 0
      : Math.min(...items.map((i) => clamp01(i.confidence)));

  return {
    items,
    overall_confidence,
    raw: parsed,
    latency_ms,
    model,
  };
}

/**
 * Extract over multiple rendered pages and merge into a single result.
 * Used when a single lab report spans more than one page. Confidence is
 * the min over all per-item confidences across all pages.
 */
export async function extractLabPages(
  pageImagesBase64: string[],
  opts?: Parameters<typeof extractLabPage>[1],
): Promise<LabExtractionResult> {
  if (pageImagesBase64.length === 0) {
    throw new QwenError('parse_error', 'extractLabPages called with 0 pages');
  }
  const perPage = await Promise.all(
    pageImagesBase64.map((b64) => extractLabPage(b64, opts)),
  );
  const allItems = perPage.flatMap((p) => p.items);
  const overall_confidence =
    allItems.length === 0
      ? 0
      : Math.min(...allItems.map((i) => clamp01(i.confidence)));
  const total_latency = perPage.reduce((s, p) => s + p.latency_ms, 0);
  return {
    items: allItems,
    overall_confidence,
    raw: perPage.map((p) => p.raw),
    latency_ms: total_latency,
    model: perPage[0]?.model ?? QWEN_VL_MODEL,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clamp01(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const VALID_FLAGS = new Set([
  'low',
  'high',
  'critical_low',
  'critical_high',
  'normal',
  'unknown',
]);

function normalizeItems(parsed: unknown): ExtractedLabItem[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const raw = (parsed as { items?: unknown }).items;
  if (!Array.isArray(raw)) return [];

  const out: ExtractedLabItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const canonical_key = asString(o.canonical_key);
    const display_name = asString(o.display_name);
    if (!canonical_key || !display_name) continue;
    const flagRaw = asString(o.abnormal_flag) ?? 'unknown';
    const flag = VALID_FLAGS.has(flagRaw)
      ? (flagRaw as ExtractedLabItem['abnormal_flag'])
      : 'unknown';
    out.push({
      canonical_key: canonical_key
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, ''),
      display_name,
      value_numeric: asNumber(o.value_numeric),
      value_text: asString(o.value_text),
      unit: asString(o.unit),
      reference_range: asString(o.reference_range),
      abnormal_flag: flag,
      confidence: clamp01(o.confidence),
    });
  }
  return out;
}
