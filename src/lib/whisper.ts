/**
 * Whisper bridge — server-side client for the Cloudflare-tunnelled
 * whisper.cpp server running on V's Mac Mini.
 *
 * Model: ggml-large-v3-turbo (Whisper large-v3 turbo distillation,
 * 798M params, 4-layer decoder, ~8x faster than full large-v3 on Apple
 * Silicon, 100 languages incl. Hindi + Kannada).
 *
 * Why local: same Mac Mini that hosts qwen2.5:14b, so no extra cloud
 * round-trip; audio stays inside the hospital network; zero per-minute
 * cost; multilingual one-pass for English↔Hindi↔Kannada code-switching.
 *
 * The whisper.cpp server exposes a POST /inference endpoint that
 * accepts multipart/form-data with a `file` part. Returns JSON like:
 *   { "text": "...", "language": "en", "duration": 2.34, "segments": [...] }
 *
 * Env vars:
 *   - WHISPER_BASE_URL  e.g. https://whisper.llmvinayminihome.uk
 *
 * Same shape as TranscribeResult from ./transcribe so the comparison
 * orchestrator can treat both engines uniformly.
 */

export type WhisperResult =
  | {
      ok: true;
      transcript: string;
      language?: string;
      duration_seconds?: number;
      latency_ms: number;
    }
  | { ok: false; error: string; latency_ms: number };

export async function transcribeWithWhisper(
  audio: Buffer | Uint8Array,
  contentType: string = 'audio/webm',
): Promise<WhisperResult> {
  const base = process.env.WHISPER_BASE_URL;
  if (!base) {
    return { ok: false, error: 'whisper_base_url_missing', latency_ms: 0 };
  }

  const url = `${base.replace(/\/+$/, '')}/inference`;

  // Construct multipart body. whisper.cpp's server expects a `file` field.
  const ext =
    contentType.includes('webm')
      ? 'webm'
      : contentType.includes('mp4')
        ? 'mp4'
        : contentType.includes('ogg')
          ? 'ogg'
          : contentType.includes('wav')
            ? 'wav'
            : 'webm';

  const form = new FormData();
  // Wrap Buffer as Blob so undici FormData treats it as a file
  const blob = new Blob([audio], { type: contentType });
  form.append('file', blob, `audio.${ext}`);
  form.append('response_format', 'json');
  form.append('temperature', '0.0');
  // Hint at language — let whisper auto-detect; for Indian-context recordings
  // this lets it handle English/Hindi/Kannada code-switching naturally.
  // (If we set language='en' explicitly, we lose the code-switch benefit.)

  // 90s ceiling — short dictations should return in 1-5s; long ambient
  // recordings (60-180s) might need more. Cap at 90s as a safety net.
  const controller = new AbortController();
  const timeoutMs = 90_000;
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(tid);
    const latency_ms = Date.now() - t0;

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `http_${res.status}: ${body.slice(0, 200)}`,
        latency_ms,
      };
    }

    const json = (await res.json()) as {
      text?: string;
      language?: string;
      duration?: number;
    };

    const transcript = (json.text ?? '').trim();
    if (!transcript) {
      return { ok: false, error: 'empty_transcript', latency_ms };
    }

    return {
      ok: true,
      transcript,
      language: json.language,
      duration_seconds: json.duration,
      latency_ms,
    };
  } catch (e: unknown) {
    clearTimeout(tid);
    const latency_ms = Date.now() - t0;
    if (controller.signal.aborted) {
      return { ok: false, error: `timeout_${timeoutMs}ms`, latency_ms };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `network: ${msg}`, latency_ms };
  }
}
