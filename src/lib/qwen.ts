/**
 * Qwen bridge — server-side client for the Cloudflare-Tunnelled Ollama
 * instance on V's Mac Mini.
 *
 * Same pattern EHRC uses (see EHRC-CARRYOVER §10). The tunnel exposes an
 * OpenAI-compatible `/chat/completions` endpoint at `LLM_BASE_URL`. We
 * use it via `fetch` + JSON mode (`response_format: { type: 'json_object' }`)
 * for deterministic-ish structured output.
 *
 * Latency budget: ~5-15s warm. Cold start is ~47s if the Mac sleeps —
 * the `/api/keep-alive` cron in PH.1.3 will be added to fix that.
 *
 * Failure modes:
 *   - fetch error / timeout → throw QwenError{ kind: 'timeout' | 'network' }
 *   - non-2xx HTTP → throw QwenError{ kind: 'http', status }
 *   - non-JSON response or response.choices empty → throw QwenError{ kind: 'parse_error' }
 *
 * Callers (recompute-summary etc.) catch QwenError and decide whether
 * to mark the cache row as failed.
 */

export const QWEN_MODEL = 'qwen2.5:14b';
export const QWEN_TEMPERATURE = 0.2;
export const QWEN_TIMEOUT_MS = 60_000; // 60s ceiling — covers warm + ~one cold start

export type QwenErrorKind =
  | 'timeout'
  | 'network'
  | 'http'
  | 'parse_error'
  | 'no_env';

export class QwenError extends Error {
  kind: QwenErrorKind;
  status?: number;
  detail?: string;
  constructor(kind: QwenErrorKind, message: string, opts?: { status?: number; detail?: string }) {
    super(message);
    this.name = 'QwenError';
    this.kind = kind;
    this.status = opts?.status;
    this.detail = opts?.detail;
  }
}

export type QwenJsonResult<T = unknown> = {
  json: T;
  raw: string;
  latency_ms: number;
  model: string;
};

/**
 * Call Qwen with system + user messages, expect a JSON object back.
 * `T` is the caller's expected output shape (no runtime validation —
 * caller validates with its own schema).
 */
export async function qwenJson<T = unknown>(
  systemMessage: string,
  userMessage: string,
  opts: { timeoutMs?: number; model?: string; temperature?: number; signal?: AbortSignal } = {},
): Promise<QwenJsonResult<T>> {
  const base = process.env.LLM_BASE_URL;
  if (!base) {
    throw new QwenError('no_env', 'LLM_BASE_URL is not configured');
  }
  const model = opts.model ?? QWEN_MODEL;
  const temperature = opts.temperature ?? QWEN_TEMPERATURE;
  const timeoutMs = opts.timeoutMs ?? QWEN_TIMEOUT_MS;

  const apiKey = process.env.LLM_API_KEY ?? 'ollama';

  const url = `${base.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  // v6.0 (Q5) — if the caller passed an AbortSignal (e.g. from a route
  // whose NDJSON stream closed because the client disconnected), wire
  // it through. Either timeout or external abort cancels the Mac Mini
  // fetch and frees the qwen call.
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort();
    } else {
      opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

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
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (e: unknown) {
    clearTimeout(tid);
    const msg = e instanceof Error ? e.message : String(e);
    if (controller.signal.aborted) {
      throw new QwenError('timeout', `Qwen call exceeded ${timeoutMs}ms`);
    }
    throw new QwenError('network', `Qwen fetch failed: ${msg}`);
  }
  clearTimeout(tid);
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new QwenError('http', `Qwen returned HTTP ${res.status}`, {
      status: res.status,
      detail: body.slice(0, 500),
    });
  }

  let outer: unknown;
  try {
    outer = await res.json();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new QwenError('parse_error', `Qwen response was not JSON: ${msg}`);
  }

  // Extract the content out of OpenAI-shaped response
  const content = (() => {
    if (!outer || typeof outer !== 'object') return null;
    const choices = (outer as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const c0 = choices[0];
    if (!c0 || typeof c0 !== 'object') return null;
    const msg = (c0 as { message?: { content?: unknown } }).message;
    if (!msg || typeof msg !== 'object') return null;
    const content = (msg as { content?: unknown }).content;
    return typeof content === 'string' ? content : null;
  })();

  if (content === null) {
    throw new QwenError('parse_error', 'Qwen returned no choices[0].message.content');
  }

  // JSON-mode means the assistant content itself is a JSON string
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new QwenError('parse_error', `Qwen content was not JSON: ${msg}`, {
      detail: content.slice(0, 500),
    });
  }

  return {
    json: parsed as T,
    raw: content,
    latency_ms,
    model,
  };
}

/**
 * Tiny liveness check used by /api/keep-alive (PH.1.3) and admin
 * health probes. Sends a 3-token prompt and expects any valid JSON
 * back. Returns { ok, latency_ms } and never throws.
 */
export async function qwenPing(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    await qwenJson<{ ok?: boolean }>(
      'Respond with the JSON object {"ok":true}. Nothing else.',
      'ping',
      { timeoutMs: 15_000 },
    );
    return { ok: true, latency_ms: Date.now() - t0 };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, latency_ms: Date.now() - t0, error: msg };
  }
}
