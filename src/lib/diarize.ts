/**
 * Diarize bridge — ported from ETA lib/diarize.ts (P2.2). Server-side client
 * for the Mac Mini pyannote diarization service: POST the session recording,
 * get back speaker clusters, role labels, overlap windows, and speech-time
 * aggregates. Plus the reconciliation helpers that map anonymous timed text
 * entries (Sarvam batch / Deepgram batch) onto pyannote's NAMED speakers by
 * time overlap, and the conservative first-person → Patient role override.
 *
 * Non-critical: diarization never blocks an encounter. Callers soft-fail
 * (P2.2 lock: keep the plain transcript, mark diarize_error on the session
 * row, continue; the hourly sweep retries).
 *
 * Env: DIARIZE_BASE_URL (shared with lib/enroll.ts),
 *      DIARIZE_TIMEOUT_MS (default 90000).
 */

const DIARIZE_BASE = process.env.DIARIZE_BASE_URL;
const TIMEOUT_MS = Number(process.env.DIARIZE_TIMEOUT_MS || 90_000);

export type DiarizeSpeaker = {
  idx: number;
  label: string;
  type: string; // clinician|patient|attender|nurse|other (forward-compatible)
  total_speech_sec?: number;
  first_heard_at_sec?: number;
  manually_relabeled?: boolean;
  source?: string;
  clinician_id?: string;
  confidence?: number;
  role_source?: string;
  embedding_base64?: string; // Sprint B: per-speaker ECAPA embedding (Mini returns it → passive capture)
};
export type DiarizeResult = {
  speakers: DiarizeSpeaker[];
  transcript_segments: unknown[];
  overlap_windows: unknown[];
  aggregates: unknown;
  latency_ms?: number;
  model_versions?: unknown;
};
export type DiarizeOutcome =
  | { ok: true; result: DiarizeResult; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

export async function runDiarize(
  audio: Buffer | Uint8Array,
  contentType: string,
  opts: {
    encounterId: string;
    clinicianCentroids?: unknown[];
    manualRelabels?: unknown[];
    batchThreshold?: number;
    signal?: AbortSignal;
  },
): Promise<DiarizeOutcome> {
  if (!DIARIZE_BASE) return { ok: false, error: "diarize_base_url_missing", latencyMs: 0 };
  const baseType = (contentType.split(";")[0] || "").trim().toLowerCase() || "audio/webm";
  const ext = baseType.includes("webm") ? "webm" : baseType.includes("mp4") ? "mp4" : baseType.includes("wav") ? "wav" : "webm";

  const form = new FormData();
  form.append("audio", new Blob([audio], { type: baseType }), `audio.${ext}`);
  form.append("encounter_id", opts.encounterId);
  form.append("clinician_centroids", JSON.stringify(opts.clinicianCentroids ?? []));
  form.append("manual_relabels", JSON.stringify(opts.manualRelabels ?? []));
  if (typeof opts.batchThreshold === "number") form.append("batch_threshold", String(opts.batchThreshold));

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const t0 = Date.now();
  try {
    const res = await fetch(`${DIARIZE_BASE.replace(/\/+$/, "")}/diarize`, {
      method: "POST", body: form, signal: controller.signal, cache: "no-store",
    });
    clearTimeout(tid);
    const latencyMs = Date.now() - t0;
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `http_${res.status}: ${text.slice(0, 180)}`, latencyMs };
    const j = JSON.parse(text) as Partial<DiarizeResult>;
    return {
      ok: true,
      latencyMs,
      result: {
        speakers: Array.isArray(j.speakers) ? (j.speakers as DiarizeSpeaker[]) : [],
        transcript_segments: Array.isArray(j.transcript_segments) ? j.transcript_segments : [],
        overlap_windows: Array.isArray(j.overlap_windows) ? j.overlap_windows : [],
        aggregates: j.aggregates ?? {},
        latency_ms: typeof j.latency_ms === "number" ? j.latency_ms : undefined,
        model_versions: j.model_versions,
      },
    };
  } catch (e: unknown) {
    clearTimeout(tid);
    const latencyMs = Date.now() - t0;
    if (controller.signal.aborted) return { ok: false, error: `timeout_${TIMEOUT_MS}ms`, latencyMs };
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}`, latencyMs };
  }
}

// ---------------------------------------------------------------------------
// Note speaker-tagging (V2.SD — reconciliation)
//
// Sarvam batch translate (with_diarization) yields ENGLISH text segments with
// timing + an ANONYMOUS speaker_id ("speaker_0"…). pyannote (/diarize) yields
// NAMED speakers (clinician matched by voiceprint) + timed segments but NO
// text. We reconcile by TIME OVERLAP: each Sarvam speaker_id is mapped to the
// pyannote speaker index it overlaps most (summed across all its entries),
// then every English entry inherits that pyannote speaker's name/role. The
// result is a speaker-tagged English conversation for the note + admin view.
// ---------------------------------------------------------------------------

export type TaggedEntry = {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker_id: string;       // Sarvam's anonymous id
  speaker_idx: number | null; // matched pyannote idx (null = unmatched)
  name: string;             // resolved display name (clinician name / role / "Speaker N")
  type: string;             // clinician|patient|attender|nurse|other
};

export type DiarEntryLike = { transcript: string; start: number; end: number; speakerId: string };
export type SegLike = { start_ms?: number; end_ms?: number; speaker_idx?: number };

export function reconcileTagged(
  entries: DiarEntryLike[],
  segments: SegLike[],
  speakers: DiarizeSpeaker[],
): TaggedEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  // 1. accumulate overlap(ms) between each Sarvam speaker_id and each pyannote idx
  const overlap = new Map<string, Map<number, number>>();
  for (const e of entries) {
    const es = e.start * 1000, ee = e.end * 1000;
    const m = overlap.get(e.speakerId) ?? new Map<number, number>();
    for (const s of segments) {
      const ss = s.start_ms ?? 0, se = s.end_ms ?? 0;
      const ov = Math.min(ee, se) - Math.max(es, ss);
      if (ov > 0 && typeof s.speaker_idx === "number") m.set(s.speaker_idx, (m.get(s.speaker_idx) ?? 0) + ov);
    }
    overlap.set(e.speakerId, m);
  }
  // 2. argmax → sarvam speaker_id ⇒ pyannote idx
  const idxFor = new Map<string, number | null>();
  for (const [sid, m] of overlap) {
    let best: number | null = null, bestv = 0;
    for (const [idx, v] of m) if (v > bestv) { bestv = v; best = idx; }
    idxFor.set(sid, best);
  }
  // 3. tag every entry; unmatched ids get a stable "Speaker N"
  const byIdx = new Map(speakers.map((s) => [s.idx, s] as const));
  const fallback = new Map<string, number>(); let fc = 0;
  return entries.map((e) => {
    const idx = idxFor.get(e.speakerId) ?? null;
    const sp = idx != null ? byIdx.get(idx) : undefined;
    let name = sp?.label, type = sp?.type;
    if (!name) {
      if (!fallback.has(e.speakerId)) fallback.set(e.speakerId, ++fc);
      name = `Speaker ${fallback.get(e.speakerId)}`; type = "other";
    }
    return { text: e.transcript, start_ms: Math.round(e.start * 1000), end_ms: Math.round(e.end * 1000), speaker_id: e.speakerId, speaker_idx: idx, name, type: type ?? "other" };
  });
}

// ---------------------------------------------------------------------------
// Role refinement (diarization polish) — first-person "patient" override.
// pyannote/Mac-Mini role labels are coarse (duration/segment heuristics). Now
// that we have per-speaker text (tagged_transcript), promote the speaker with
// the strongest first-person symptom language to Patient — UNLESS they are the
// enrolled-clinician auto-match (never override that). Conservative: needs ≥2
// first-person markers and only relabels a non-patient, non-clinician speaker.
// ---------------------------------------------------------------------------
const FIRST_PERSON = /\b(i\s+(have|had|feel|felt|am|was|get|got|can'?t|cannot|need|noticed|started|stopped|take|took)|i'?ve\s+been|i'?m\s+(having|feeling|getting)|my\s+(pain|chest|head|stomach|belly|back|leg|arm|knee|fever|cough|cold|throat|breathing|sugar|bp|pressure|period|wound|eye|ear|skin)|it\s+(hurts|pains)|since\s+(yesterday|last|two|three|four|five|a\s+(week|month|year)))\b/gi;

export function applyRoleOverrides(
  speakers: DiarizeSpeaker[],
  tagged: TaggedEntry[],
): { speakers: DiarizeSpeaker[]; changed: boolean } {
  if (!Array.isArray(tagged) || tagged.length === 0) return { speakers, changed: false };
  const hits = new Map<number, number>();
  for (const t of tagged) {
    if (t.speaker_idx == null || !t.text) continue;
    const m = t.text.match(FIRST_PERSON);
    if (m) hits.set(t.speaker_idx, (hits.get(t.speaker_idx) ?? 0) + m.length);
  }
  let bestIdx = -1, bestN = 0;
  for (const [idx, n] of hits) {
    const sp = speakers.find((s) => s.idx === idx);
    if (!sp || sp.source === "auto") continue;   // never override an enrolled-clinician match
    if (n > bestN) { bestN = n; bestIdx = idx; }
  }
  if (bestIdx < 0 || bestN < 2) return { speakers, changed: false };
  let changed = false;
  const out = speakers.map((s) => {
    if (s.idx === bestIdx && s.type !== "patient") {
      changed = true;
      return { ...s, type: "patient", label: "Patient", role_source: "first_person_override" };
    }
    return s;
  });
  return { speakers: out, changed };
}
