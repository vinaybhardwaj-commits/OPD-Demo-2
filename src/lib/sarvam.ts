/**
 * Sarvam AI speech-to-text bridge (multilingual testbed engine).
 *
 * Why: Deepgram (nova-3-medical) is English-only and returns nothing for
 * Kannada/most Indian languages; Whisper large-v3-turbo mistranslates and
 * romanizes Indian-language audio. Sarvam (Saaras v3) handles Indian
 * languages accurately for both transcription (original script) and
 * translation to English, and accepts the browser's webm/opus directly.
 *
 * Endpoints (REST, synchronous, <=30s audio):
 *   POST /speech-to-text            mode=transcribe  -> original-language text
 *   POST /speech-to-text-translate  mode=translate   -> English text
 * Auth: header `api-subscription-key`. Response: {request_id, transcript, language_code}.
 *
 * For audio >30s use the Batch API (see sarvamBatch* below).
 *
 * Env: SARVAM_API_KEY (required), SARVAM_STT_MODEL (default 'saaras:v3').
 */

const SARVAM_BASE = "https://api.sarvam.ai";
const MODEL = process.env.SARVAM_STT_MODEL || "saaras:v3";
const SYNC_TIMEOUT_MS = 60_000;

export type SarvamMode = "transcribe" | "translate";

export type SarvamResult =
  | { ok: true; transcript: string; languageCode: string | null; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

function extName(contentType: string): string {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "mp4";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  return "webm";
}

async function callSync(
  path: string,
  mode: SarvamMode,
  audio: Buffer | Uint8Array,
  contentType: string,
): Promise<SarvamResult> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return { ok: false, error: "sarvam_api_key_missing", latencyMs: 0 };

  // Sarvam's MIME allow-list rejects parameterized types like
  // "audio/webm; codecs=opus" (what MediaRecorder blobs carry) — it only
  // accepts the BARE type "audio/webm". Strip any ;codecs=... parameter.
  const baseType = (contentType.split(";")[0] || "").trim().toLowerCase() || "audio/webm";
  const form = new FormData();
  const blob = new Blob([audio], { type: baseType });
  form.append("file", blob, `audio.${extName(baseType)}`);
  form.append("model", MODEL);
  form.append("mode", mode);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`${SARVAM_BASE}${path}`, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(tid);
    const latencyMs = Date.now() - t0;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      // Surface Sarvam's structured error code/message when present.
      let msg = `http_${res.status}`;
      try {
        const j = JSON.parse(text);
        msg = `http_${res.status}: ${j?.error?.code || ""} ${j?.error?.message || text.slice(0, 160)}`.trim();
      } catch { msg = `http_${res.status}: ${text.slice(0, 160)}`; }
      return { ok: false, error: msg, latencyMs };
    }
    const j = JSON.parse(text) as { transcript?: string; language_code?: string | null };
    const transcript = (j.transcript ?? "").trim();
    if (!transcript) return { ok: false, error: "empty_transcript", latencyMs };
    return { ok: true, transcript, languageCode: j.language_code ?? null, latencyMs };
  } catch (e: unknown) {
    clearTimeout(tid);
    const latencyMs = Date.now() - t0;
    if (controller.signal.aborted) return { ok: false, error: `timeout_${SYNC_TIMEOUT_MS}ms`, latencyMs };
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}`, latencyMs };
  }
}

/** Transcribe audio in its original language (<=30s). Returns original-script text + detected language. */
export function sarvamTranscribe(audio: Buffer | Uint8Array, contentType = "audio/webm"): Promise<SarvamResult> {
  return callSync("/speech-to-text", "transcribe", audio, contentType);
}

/** Translate audio to English (<=30s). Auto-detects source language. */
export function sarvamTranslate(audio: Buffer | Uint8Array, contentType = "audio/webm"): Promise<SarvamResult> {
  return callSync("/speech-to-text-translate", "translate", audio, contentType);
}

/** A BCP-47 code is non-English if present and not en-*. NULL/unknown => treat as English. */
export function isNonEnglish(languageCode: string | null | undefined): boolean {
  if (!languageCode) return false;
  const c = languageCode.toLowerCase();
  if (c === "unknown") return false;
  return !c.startsWith("en");
}

/** Code-mixed transcription (mode=codemix): English words in English, Indic in
 *  native script — the natural single-box live view for bilingual consults. */
export function sarvamCodemix(audio: Buffer | Uint8Array, contentType = "audio/webm"): Promise<SarvamResult> {
  return callSync("/speech-to-text", "codemix" as SarvamMode, audio, contentType);
}

// ---------------------------------------------------------------------------
// Batch translate (full-file, >30s) — async job. Used at submit for the
// canonical English transcript: whole-conversation context => materially
// better accuracy than the per-window live rolling, and a robust safety net
// independent of what the live panel accumulated.
//
// Flow: init -> upload-files (presigned) -> Azure PUT -> start -> poll status
//       -> download-files -> GET output JSON. Model saaras:v2.5 (translate job).
// ---------------------------------------------------------------------------

export type SarvamDiarEntry = { transcript: string; start: number; end: number; speakerId: string };

export type SarvamBatchResult =
  | { ok: true; transcript: string; languageCode: string | null; entries: SarvamDiarEntry[]; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

type BatchOpts = { prompt?: string; signal?: AbortSignal; maxWaitMs?: number; pollMs?: number; withDiarization?: boolean; numSpeakers?: number };

// Per-request timeouts so a hung Azure/Sarvam transfer can't stall /process to
// its maxDuration. Combines an outer caller signal with a per-request deadline
// (no reliance on AbortSignal.any / .timeout being present).
const SARVAM_CTRL_TIMEOUT_MS = 20_000;   // control plane (init/upload-links/start/download-links)
const SARVAM_XFER_TIMEOUT_MS = 60_000;   // bulk transfers (Azure PUT, output download)
const SARVAM_POLL_TIMEOUT_MS = 15_000;   // a single status poll

async function tfetch(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(new Error("request_timeout")), timeoutMs);
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener("abort", onAbort);
  }
}

export async function sarvamBatchTranslate(
  audio: Buffer | Uint8Array,
  contentType = "audio/webm",
  opts: BatchOpts = {},
): Promise<SarvamBatchResult> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return { ok: false, error: "sarvam_api_key_missing", latencyMs: 0 };
  const H = { "api-subscription-key": key, "Content-Type": "application/json" };
  const t0 = Date.now();
  const maxWaitMs = opts.maxWaitMs ?? 150_000;
  const pollMs = opts.pollMs ?? 4_000;
  const baseType = (contentType.split(";")[0] || "").trim().toLowerCase() || "audio/webm";
  const fname = `audio.${extName(baseType)}`;

  try {
    // 1. init
    const initRes = await tfetch(`${SARVAM_BASE}/speech-to-text-translate/job/v1`, {
      method: "POST", headers: H, cache: "no-store",
      body: JSON.stringify({ job_parameters: { model: "saaras:v2.5", ...(opts.prompt ? { prompt: opts.prompt } : {}), ...(opts.withDiarization ? { with_diarization: true } : {}), ...(opts.numSpeakers ? { num_speakers: opts.numSpeakers } : {}) } }),
    }, SARVAM_CTRL_TIMEOUT_MS, opts.signal);
    if (!initRes.ok) return { ok: false, error: `init_${initRes.status}: ${(await initRes.text()).slice(0, 120)}`, latencyMs: Date.now() - t0 };
    const jobId = (await initRes.json() as { job_id: string }).job_id;

    // 2. presigned upload URL
    const upRes = await tfetch(`${SARVAM_BASE}/speech-to-text-translate/job/v1/upload-files`, {
      method: "POST", headers: H, cache: "no-store",
      body: JSON.stringify({ job_id: jobId, files: [fname] }),
    }, SARVAM_CTRL_TIMEOUT_MS, opts.signal);
    if (!upRes.ok) return { ok: false, error: `upload_links_${upRes.status}`, latencyMs: Date.now() - t0 };
    const upJson = await upRes.json() as { upload_urls: Record<string, { file_url: string }> };
    const putUrl = upJson.upload_urls[fname]?.file_url;
    if (!putUrl) return { ok: false, error: "no_upload_url", latencyMs: Date.now() - t0 };

    // 3. PUT to Azure blob
    const sv = /[?&]sv=([^&]+)/.exec(putUrl)?.[1];
    const putRes = await tfetch(putUrl, {
      method: "PUT",
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": baseType, ...(sv ? { "x-ms-version": sv } : {}) },
      body: Buffer.from(audio),
    }, SARVAM_XFER_TIMEOUT_MS, opts.signal);
    if (!putRes.ok) return { ok: false, error: `azure_put_${putRes.status}`, latencyMs: Date.now() - t0 };

    // 4. start
    const startRes = await tfetch(`${SARVAM_BASE}/speech-to-text-translate/job/v1/${jobId}/start`, {
      method: "POST", headers: H, cache: "no-store", body: "{}",
    }, SARVAM_CTRL_TIMEOUT_MS, opts.signal);
    if (!startRes.ok) return { ok: false, error: `start_${startRes.status}`, latencyMs: Date.now() - t0 };

    // 5. poll status
    let outputs: string[] = [];
    let state = "Pending";
    while (Date.now() - t0 < maxWaitMs) {
      if (opts.signal?.aborted) return { ok: false, error: "aborted", latencyMs: Date.now() - t0 };
      await new Promise((r) => setTimeout(r, pollMs));
      let stRes: Response;
      try {
        stRes = await tfetch(`${SARVAM_BASE}/speech-to-text-translate/job/v1/${jobId}/status`, { headers: H, cache: "no-store" }, SARVAM_POLL_TIMEOUT_MS, opts.signal);
      } catch {
        continue; // a single slow/timed-out poll: retry within the maxWaitMs window
      }
      if (!stRes.ok) continue;
      const st = await stRes.json() as { job_state: string; job_details?: Array<{ outputs?: Array<{ file_name: string }> }> };
      state = st.job_state;
      if (state === "Completed") {
        outputs = (st.job_details ?? []).flatMap((d) => (d.outputs ?? []).map((o) => o.file_name));
        break;
      }
      if (state === "Failed") return { ok: false, error: "job_failed", latencyMs: Date.now() - t0 };
    }
    if (state !== "Completed") return { ok: false, error: `timeout_state_${state}`, latencyMs: Date.now() - t0 };
    if (outputs.length === 0) return { ok: false, error: "no_outputs", latencyMs: Date.now() - t0 };

    // 6. download output(s) + concat transcripts
    const dlRes = await tfetch(`${SARVAM_BASE}/speech-to-text-translate/job/v1/download-files`, {
      method: "POST", headers: H, cache: "no-store",
      body: JSON.stringify({ job_id: jobId, files: outputs }),
    }, SARVAM_CTRL_TIMEOUT_MS, opts.signal);
    if (!dlRes.ok) return { ok: false, error: `download_links_${dlRes.status}`, latencyMs: Date.now() - t0 };
    const dlJson = await dlRes.json() as { download_urls: Record<string, { file_url: string }> };
    let transcript = ""; let lang: string | null = null; const entries: SarvamDiarEntry[] = [];
    for (const name of outputs) {
      const u = dlJson.download_urls[name]?.file_url;
      if (!u) continue;
      const r = await tfetch(u, { cache: "no-store" }, SARVAM_XFER_TIMEOUT_MS, opts.signal);
      if (!r.ok) continue;
      const j = await r.json() as { transcript?: string; language_code?: string | null; diarized_transcript?: { entries?: Array<{ transcript?: string; start_time_seconds?: number; end_time_seconds?: number; speaker_id?: string }> } };
      if (j.transcript) transcript += (transcript ? " " : "") + j.transcript.trim();
      if (!lang && j.language_code) lang = j.language_code;
      for (const e of j.diarized_transcript?.entries ?? []) {
        if (e.transcript && e.transcript.trim()) {
          entries.push({ transcript: e.transcript.trim(), start: e.start_time_seconds ?? 0, end: e.end_time_seconds ?? 0, speakerId: String(e.speaker_id ?? "") });
        }
      }
    }
    if (!transcript.trim()) return { ok: false, error: "empty_batch_transcript", latencyMs: Date.now() - t0 };
    return { ok: true, transcript: transcript.trim(), languageCode: lang, entries, latencyMs: Date.now() - t0 };
  } catch (e: unknown) {
    return { ok: false, error: `batch_exc: ${e instanceof Error ? e.message : String(e)}`, latencyMs: Date.now() - t0 };
  }
}

/** Medical-context prompt passed to Sarvam translate to nudge clinical accuracy. */
export const SARVAM_MEDICAL_PROMPT =
  "Medical doctor-patient consultation in an Indian OPD clinic. Preserve drug names, dosages, symptoms, and clinical terms accurately.";
