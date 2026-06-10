"use client";

import * as React from "react";
import { boundedWindowStart, MAX_WINDOW_BYTES } from "@/lib/live-window";

// Front-trim consumed chunks (ETA Tier-4 #17 parity), default OFF.
const TRIM_LIVE_BUFFERS = process.env.NEXT_PUBLIC_OPD2_TRIM_LIVE_BUFFERS === "1";

/**
 * useSarvamRolling — low-latency multilingual live transcription via Sarvam REST.
 * Ported from ETA (OPD-Demo-2 adaptations: bare /api route — opd_session cookie
 * is Path=/; TRIM_LIVE_BUFFERS from NEXT_PUBLIC_OPD2_TRIM_LIVE_BUFFERS, default OFF).
 *
 * Model (latency rework — "growing-window refine + commit"): instead of one
 * non-overlapping window every 10s, we keep a small UNCOMMITTED span and
 * re-transcribe it in full every ~`intervalMs` (~2s). Because Sarvam codemix
 * returns in <1s, the live tail refreshes every couple of seconds and — since
 * each refresh re-runs the WHOLE uncommitted span with full context — words
 * split across tick boundaries self-heal (no per-window fragmentation). When
 * the uncommitted span approaches Sarvam's 30s sync cap we COMMIT it (freeze
 * the text, advance the watermark) and start a fresh span. The displayed
 * transcript is `committed + tail`, one continuous code-mixed trace.
 *
 *   display = committedText + " " + tailText
 *   each tick:  window = [header?] + chunks[watermark..end]  → Sarvam → tailText
 *   commit when (end - watermark) ≥ COMMIT_CHUNKS:  committed += tail; watermark = end
 *
 * Each window is independently decodable: block 0 already contains the webm
 * init segment; later windows prepend the first chunk (the init segment) so
 * Sarvam can decode them. English encounters ignore this (Deepgram path).
 *
 * True sub-250ms streaming is the WebSocket follow-up (Sarvam Saaras v3 WS);
 * this REST refine is the no-new-infra interim that cuts latency ~10s → ~2s.
 */

export type SarvamBlock = {
  block_idx: number;
  text: string | null;          // freshly re-transcribed tail for this tick
  language_code: string | null;
  latency_ms: number;
  received_at: number;
};

export type SarvamRollingState = "idle" | "running" | "in_flight" | "error" | "stopped";

type Options = {
  enabled: boolean;
  encounterId?: string;
  intervalMs?: number;
  onBlock?: (b: SarvamBlock) => void;
  onError?: (e: Error) => void;
};

// recorder emits 250ms chunks → ~4 chunks/sec. Commit the span a little under
// Sarvam's 30s sync cap so the prepended-header (~0.25s) never pushes us over.
const CHUNK_MS = 250;
const COMMIT_SECONDS = 22;
const COMMIT_CHUNKS = Math.round((COMMIT_SECONDS * 1000) / CHUNK_MS); // ~88

export function useSarvamRolling(opts: Options) {
  const intervalMs = opts.intervalMs ?? 2_000;
  const [state, setState] = React.useState<SarvamRollingState>("idle");
  const [text, setText] = React.useState("");           // committed + tail (display)
  const [language, setLanguage] = React.useState<string | null>(null);
  const [latest, setLatest] = React.useState<SarvamBlock | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const chunksRef = React.useRef<Blob[]>([]);
  const headerRef = React.useRef<Blob | null>(null);
  const mimeRef = React.useRef<string>("audio/webm");
  const committedRef = React.useRef<string>("");   // frozen prefix
  const watermarkRef = React.useRef(0);            // chunk idx where committed ends (absolute)
  const baseRef = React.useRef(0);                 // absolute idx of chunksRef.current[0] (front-trim offset)
  const blockIdxRef = React.useRef(0);
  const inFlightRef = React.useRef(false);
  const optsRef = React.useRef(opts);
  React.useEffect(() => { optsRef.current = opts; }, [opts]);

  const sendChunk = React.useCallback((chunk: Blob) => {
    if (!chunk || chunk.size === 0) return;
    if (chunksRef.current.length === 0) headerRef.current = chunk; // webm init segment
    chunksRef.current.push(chunk);
    if (chunk.type) mimeRef.current = chunk.type;
  }, []);

  const flush = React.useCallback(async () => {
    if (inFlightRef.current) return;
    const all = chunksRef.current;
    const base = baseRef.current;
    const start = watermarkRef.current;
    const end = base + all.length;
    if (end <= start) return; // nothing new since last commit

    inFlightRef.current = true;
    setState("in_flight");
    const idx = ++blockIdxRef.current;

    // Bound the window under Vercel's serverless payload cap. Walk back from the
    // newest chunk, keeping only what fits the byte budget, and slide the
    // effective start forward — dropping the oldest UNCOMMITTED audio from the
    // live window only (the submitted note is still built from the full audio).
    const headerSize = start > 0 && headerRef.current ? headerRef.current.size : 0;
    const effStart = boundedWindowStart(all.map((b) => b.size), start, base, headerSize, MAX_WINDOW_BYTES);
    const forcedAdvance = effStart > start;

    // Decodable window over the (bounded) uncommitted span. Span 0 already has
    // the header; later windows prepend the webm init segment so Sarvam decodes.
    const parts =
      effStart === 0
        ? all.slice(0, end - base)
        : headerRef.current
          ? [headerRef.current, ...all.slice(effStart - base, end - base)]
          : all.slice(effStart - base, end - base);
    const blob = new Blob(parts, { type: mimeRef.current });

    try {
      const form = new FormData();
      form.append("audio", blob, `sarvam_block_${idx}.webm`);
      form.append("block_idx", String(idx));
      if (optsRef.current.encounterId) form.append("encounter_id", optsRef.current.encounterId);

      const res = await fetch(
        "/api/transcribe/sarvam-live",
        { method: "POST", body: form, cache: "no-store" },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`http_${res.status}: ${t.slice(0, 120)}`);
      }
      const json = (await res.json()) as {
        text?: string | null;
        language_code?: string | null;
        latency_ms?: number;
      };
      const tail = (json.text ?? "").trim();

      // Refresh the live tail (committed prefix stays frozen).
      setText(`${committedRef.current}${committedRef.current && tail ? " " : ""}${tail}`.trim());
      if (json.language_code) setLanguage(json.language_code);

      const block: SarvamBlock = {
        block_idx: idx,
        text: tail || null,
        language_code: json.language_code ?? null,
        latency_ms: json.latency_ms ?? 0,
        received_at: Date.now(),
      };
      setLatest(block);
      setState("running");
      setError(null);
      optsRef.current.onBlock?.(block);

      // Commit (freeze the tail, advance the watermark) when the uncommitted
      // span nears the 30s cap so windows stay bounded — OR when we had to
      // force-advance to fit the payload cap. Committing on chunk-count even if
      // this tick's tail is empty prevents silence from growing the span
      // without bound (the http_413 wedge). Tail text is appended only when
      // present; the authoritative note always uses the full submitted audio.
      const shouldCommit = end - start >= COMMIT_CHUNKS || forcedAdvance;
      if (shouldCommit) {
        if (tail) committedRef.current = `${committedRef.current}${committedRef.current ? " " : ""}${tail}`.trim();
        watermarkRef.current = end;
        // Drop committed chunks off the front (the header is kept in headerRef
        // and prepended to later windows). Bounds memory on long consults.
        if (TRIM_LIVE_BUFFERS) {
          const consumed = watermarkRef.current - baseRef.current;
          if (consumed > 0) { all.splice(0, consumed); baseRef.current += consumed; }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState("error");
      optsRef.current.onError?.(new Error(msg));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    if (!opts.enabled) { setState("stopped"); return; }
    setState("running");
    const id = window.setInterval(() => { void flush(); }, intervalMs);
    return () => {
      window.clearInterval(id);
      void flush(); // final tail flush
    };
  }, [opts.enabled, intervalMs, flush]);

  return { state, text, language, latest, error, sendChunk, flushNow: flush };
}
