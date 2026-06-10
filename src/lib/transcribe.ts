/**
 * Deepgram client wrapper.
 *
 * Section dictations are short (< 60s typically), so we POST audio
 * bytes directly to /v1/listen and block on the response. Long-form
 * ambient recording (Sprint 5.2) will switch to URL-source +
 * async-callback so the function isn't held open for minutes.
 *
 * Model: nova-3-medical (medical-domain-tuned) with Indian English bias.
 * Most OPD voice notes mention drug + dosage + frequency — the
 * medical model catches drug names better than the general one.
 */
const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

export type TranscribeResult =
  | { ok: true; transcript: string; confidence: number; latency_ms: number }
  | { ok: false; error: string };

export async function transcribeAudio(
  audio: Blob | Buffer | Uint8Array,
  contentType: string = 'audio/webm',
): Promise<TranscribeResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { ok: false, error: 'deepgram_key_missing' };

  const params = new URLSearchParams({
    model: 'nova-3-medical',
    language: 'en-IN',
    punctuate: 'true',
    smart_format: 'true',
  });

  const t0 = Date.now();
  try {
    // Convert Buffer/Uint8Array to ArrayBuffer for fetch body
    const body =
      audio instanceof Blob
        ? audio
        : audio instanceof Uint8Array
        ? (audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer)
        : (audio as unknown as ArrayBuffer);
    const res = await fetch(`${DEEPGRAM_URL}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': contentType,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `deepgram_${res.status}: ${text.slice(0, 150)}` };
    }
    const data = (await res.json()) as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{ transcript?: string; confidence?: number }>;
        }>;
      };
    };
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    return {
      ok: true,
      transcript: alt?.transcript ?? '',
      confidence: alt?.confidence ?? 0,
      latency_ms: Date.now() - t0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 200) };
  }
}


/**
 * Deepgram diarized batch — English speaker-tagging producer. Runs the
 * prerecorded API with diarize+utterances on the whole recording and returns
 * timed, speaker-labelled English utterances in the SAME shape reconcileTagged
 * (lib/diarize.ts) expects, so the English note path can be speaker-tagged just
 * like the non-English Sarvam path. Anonymous Deepgram speaker ints become
 * "dg_<n>"; reconcileTagged maps them onto pyannote's NAMED speakers by time.
 */
export type DiarizedEntry = { transcript: string; start: number; end: number; speakerId: string };
export type TranscribeDiarizedResult =
  | { ok: true; entries: DiarizedEntry[]; latency_ms: number }
  | { ok: false; error: string };

export async function transcribeDiarized(
  audio: Blob | Buffer | Uint8Array,
  contentType: string = "audio/webm",
): Promise<TranscribeDiarizedResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { ok: false, error: "deepgram_key_missing" };
  const params = new URLSearchParams({
    model: "nova-3-medical",
    language: "en-IN",
    punctuate: "true",
    smart_format: "true",
    diarize: "true",
    utterances: "true",
  });
  const t0 = Date.now();
  try {
    const body =
      audio instanceof Blob
        ? audio
        : audio instanceof Uint8Array
        ? (audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer)
        : (audio as unknown as ArrayBuffer);
    const res = await fetch(`${DEEPGRAM_URL}?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": contentType },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `deepgram_${res.status}: ${text.slice(0, 150)}` };
    }
    const data = (await res.json()) as {
      results?: { utterances?: Array<{ start?: number; end?: number; transcript?: string; speaker?: number }> };
    };
    const utts = data.results?.utterances ?? [];
    const entries: DiarizedEntry[] = utts
      .filter((u) => (u.transcript ?? "").trim().length > 0)
      .map((u) => ({
        transcript: (u.transcript ?? "").trim(),
        start: u.start ?? 0,
        end: u.end ?? 0,
        speakerId: `dg_${u.speaker ?? 0}`,
      }));
    return { ok: true, entries, latency_ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}
