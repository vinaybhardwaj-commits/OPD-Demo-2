/**
 * Voice-enrollment producer client (v2.1, V2.SD.1).
 *
 * Calls the Mac Mini diarize service's /enroll endpoint to turn a voice clip
 * into a 192-dim ECAPA embedding (same model /diarize matches against), and
 * averages N sentence embeddings into the stored centroid.
 *
 * Env: DIARIZE_BASE_URL (shared with lib/diarize.ts).
 */

const DIARIZE_BASE = process.env.DIARIZE_BASE_URL;
const ENROLL_TIMEOUT_MS = 60_000;
const DIM = 192;

export type EnrollOutcome =
  | { ok: true; embeddingBase64: string }
  | { ok: false; error: string };

export async function runEnroll(
  audio: Buffer | Uint8Array,
  contentType: string,
): Promise<EnrollOutcome> {
  if (!DIARIZE_BASE) return { ok: false, error: "diarize_base_url_missing" };
  const baseType = (contentType.split(";")[0] || "").trim().toLowerCase() || "audio/webm";
  const ext = baseType.includes("webm") ? "webm" : baseType.includes("mp4") ? "mp4" : baseType.includes("wav") ? "wav" : "webm";
  const form = new FormData();
  form.append("audio", new Blob([audio], { type: baseType }), `audio.${ext}`);
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ENROLL_TIMEOUT_MS);
  try {
    const res = await fetch(`${DIARIZE_BASE.replace(/\/+$/, "")}/enroll`, {
      method: "POST", body: form, signal: ctrl.signal, cache: "no-store",
    });
    clearTimeout(tid);
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `http_${res.status}: ${text.slice(0, 160)}` };
    const j = JSON.parse(text) as { ok?: boolean; embedding_base64?: string; dim?: number; error?: string };
    if (j.ok === false || !j.embedding_base64) return { ok: false, error: j.error || "no_embedding" };
    return { ok: true, embeddingBase64: j.embedding_base64 };
  } catch (e: unknown) {
    clearTimeout(tid);
    return { ok: false, error: ctrl.signal.aborted ? "timeout" : `network: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Average N base64 float32[192] embeddings → base64 float32[192] centroid. */
export function averageEmbeddings(b64s: string[]): string {
  const mean = new Float32Array(DIM);
  let n = 0;
  for (const b of b64s) {
    const buf = Buffer.from(b, "base64");
    if (buf.length < DIM * 4) continue;
    const v = new Float32Array(buf.buffer, buf.byteOffset, DIM);
    for (let i = 0; i < DIM; i++) mean[i] += v[i];
    n++;
  }
  if (n === 0) throw new Error("no_valid_embeddings");
  for (let i = 0; i < DIM; i++) mean[i] /= n;
  return Buffer.from(mean.buffer, mean.byteOffset, DIM * 4).toString("base64");
}

/** Cosine similarity between two base64 float32[192] embeddings. */
export function cosineSimilarity(aB64: string, bB64: string): number | null {
  const a = b64ToF32(aB64);
  const b = b64ToF32(bB64);
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function b64ToF32(b64: string): Float32Array | null {
  const buf = Buffer.from(b64, "base64");
  if (buf.length < DIM * 4) return null;
  // copy into a fresh, 4-byte-aligned ArrayBuffer (Buffer.from may be unaligned)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + DIM * 4);
  return new Float32Array(ab);
}
