"use client";

import * as React from "react";

/**
 * useSarvamStreaming — real-time multilingual live transcription via the Sarvam
 * streaming WebSocket (Saaras v3, codemix, VAD), through the Mac Mini relay.
 * Ported from ETA (OPD-Demo-2 adaptation: token route = bare /api/transcribe/stt-token).
 *
 * LANGUAGE STABILITY (fix): with language-code=unknown Sarvam re-detects the
 * language on every short VAD utterance, so a single-language conversation can
 * flip Marathi→Hindi→Kannada window-to-window (and misdetected windows produce
 * garbled/English output). So we AUTO-DETECT then LOCK: connect on `unknown`,
 * tally the detected language of the first few utterances, and once one Indian
 * language clearly dominates we reconnect with it pinned — the audio graph and
 * the accumulated transcript are preserved across the reconnect; only the
 * upstream socket is swapped. English stays inline either way (codemix).
 *
 * Public surface mirrors useSarvamRolling: { state, text, language, latest,
 * error, sendChunk } (sendChunk is a no-op — streaming uses the raw stream).
 */

export type SarvamStreamState = "idle" | "connecting" | "live" | "listening" | "error" | "stopped";

type Options = {
  enabled: boolean;
  stream: MediaStream | null;
  relayUrl: string | null;
  onError?: (e: Error) => void;
};

function abToBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

export function useSarvamStreaming(opts: Options) {
  const [state, setState] = React.useState<SarvamStreamState>("idle");
  const [text, setText] = React.useState("");
  const [language, setLanguage] = React.useState<string | null>(null);
  const [latest, setLatest] = React.useState<{ latency_ms: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const committedRef = React.useRef("");
  const optsRef = React.useRef(opts);
  React.useEffect(() => { optsRef.current = opts; }, [opts]);

  React.useEffect(() => {
    if (!opts.enabled || !opts.stream || !opts.relayUrl) { setState("stopped"); return; }

    let cancelled = false;
    let ctx: AudioContext | null = null;
    let node: AudioWorkletNode | null = null;
    let src: MediaStreamAudioSourceNode | null = null;
    let sink: GainNode | null = null;
    let ws: WebSocket | null = null;
    let flushTimer: number | null = null;

    // language auto-detect → lock (confidence-weighted by utterance length)
    const langWeight = new Map<string, number>();
    let locked: string | null = null;
    let dataSeen = 0;
    // auto-reconnect (mid-encounter WS drop) state
    let reconnectAttempts = 0;
    let reconnectTimer: number | null = null;
    let intentionalClose = false;
    let everOpened = false;
    const MAX_RECONNECTS = 5;

    const clearFlush = () => { if (flushTimer != null) { clearInterval(flushTimer); flushTimer = null; } };
    const clearReconnect = () => { if (reconnectTimer != null) { clearTimeout(reconnectTimer); reconnectTimer = null; } };
    // Reconnect after an UNEXPECTED drop (network blip, relay/Sarvam idle close)
    // with exponential backoff, preserving the audio graph + accumulated
    // transcript (only the upstream socket is recreated). After MAX_RECONNECTS,
    // surface error so RecordingScreen falls back to the REST refine path.
    const scheduleReconnect = (lang: string) => {
      if (cancelled) return;
      clearReconnect();
      if (reconnectAttempts >= MAX_RECONNECTS) { setError("ws_lost"); setState("error"); return; }
      const delay = Math.min(8000, 500 * 2 ** reconnectAttempts);
      reconnectAttempts += 1;
      setState("connecting");
      reconnectTimer = window.setTimeout(() => {
        if (cancelled) return;
        void openConnection(lang).catch(() => scheduleReconnect(lang));
      }, delay);
    };

    const openConnection = async (lang: string) => {
      const tr = await fetch("/api/transcribe/stt-token", { cache: "no-store" });
      const tj = (await tr.json().catch(() => ({}))) as { token?: string; relay_url?: string };
      const token = tj.token;
      const relay = (tj.relay_url || optsRef.current.relayUrl) as string;
      if (!token || !relay) throw new Error("no_token");
      if (cancelled) return;
      const url = `${relay.replace(/\/$/, "")}/ws?token=${encodeURIComponent(token)}&language-code=${encodeURIComponent(lang)}&mode=codemix`;
      const w = new WebSocket(url);
      ws = w;

      w.onopen = () => {
        if (cancelled) return;
        setState("live");
        everOpened = true;
        reconnectAttempts = 0;
        clearReconnect();
        clearFlush();
        flushTimer = window.setInterval(() => { try { w.readyState === WebSocket.OPEN && w.send(JSON.stringify({ type: "flush" })); } catch { /* noop */ } }, 1500);
      };
      w.onmessage = (ev) => {
        let r: { type?: string; data?: { transcript?: string; language_code?: string; signal_type?: string; metrics?: { processing_latency?: number } } };
        try { r = JSON.parse(String(ev.data)); } catch { return; }
        if (r.type === "data" && r.data?.transcript) {
          const t = r.data.transcript.trim();
          if (!t) return;
          committedRef.current = `${committedRef.current}${committedRef.current ? " " : ""}${t}`.trim();
          setText(committedRef.current);
          setLatest({ latency_ms: Math.round((r.data.metrics?.processing_latency ?? 0) * 1000) });
          setState("live");
          const lc = r.data.language_code || null;
          if (locked) {
            setLanguage(locked);
          } else if (lc) {
            setLanguage(lc);
            dataSeen += 1;
            // Confidence-weighted vote: weight each detection by the utterance's
            // word count. A long, clearly-vernacular utterance is far more
            // reliable than a 1-2 word blip that can misdetect hi vs mr.
            if (lc !== "en-IN") {
              const wc = t.split(/\s+/).filter(Boolean).length;
              langWeight.set(lc, (langWeight.get(lc) ?? 0) + Math.max(1, wc));
            }
            // Lock when the leader has enough accumulated weight AND clearly
            // beats the runner-up; or, as a timeout fallback, after 10
            // utterances pick the leader if it is ahead at all.
            let pick: string | null = null;
            const ranked = [...langWeight.entries()].sort((a, b) => b[1] - a[1]);
            if (ranked.length > 0) {
              const [topLang, topW] = ranked[0];
              const runnerW = ranked[1]?.[1] ?? 0;
              const enoughWeight = topW >= 12;
              const clearMargin = topW >= runnerW * 1.5 + 2;
              if ((enoughWeight && clearMargin) || (dataSeen >= 10 && topW > runnerW)) {
                pick = topLang;
              }
            }
            if (pick) {
              locked = pick;
              setLanguage(pick);
              // swap the socket to the pinned language; keep audio + transcript
              intentionalClose = true;
              try { w.close(); } catch { /* noop */ }
              clearFlush();
              void openConnection(pick).catch(() => scheduleReconnect(pick));
            }
          }
        } else if (r.type === "events") {
          if (r.data?.signal_type === "START_SPEECH") setState("listening");
        } else if (r.type === "error") {
          setState("error");
        }
      };
      w.onerror = () => { /* a close event always follows; reconnect/fallback handled in onclose */ };
      w.onclose = () => {
        clearFlush();
        if (cancelled) return;
        if (intentionalClose) { intentionalClose = false; return; } // lock-swap, expected
        if (!everOpened) { setError("ws_error"); setState("error"); return; } // initial connect failed -> REST fallback
        scheduleReconnect(locked ?? "unknown");
      };
    };

    (async () => {
      setState("connecting");
      committedRef.current = "";
      setText("");
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctx();
        await ctx.audioWorklet.addModule("/pcm16-worklet.js");
        if (cancelled) return;
        src = ctx.createMediaStreamSource(opts.stream!);
        node = new AudioWorkletNode(ctx, "pcm16-worklet");
        sink = ctx.createGain(); sink.gain.value = 0;
        src.connect(node); node.connect(sink); sink.connect(ctx.destination);
        node.port.onmessage = (e: MessageEvent) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          try { ws.send(JSON.stringify({ audio: { data: abToBase64(e.data as ArrayBuffer), sample_rate: "16000", encoding: "audio/wav" } })); } catch { /* noop */ }
        };
        await openConnection("unknown");
      } catch (e) {
        if (cancelled) return;
        const m = e instanceof Error ? e.message : String(e);
        setError(m); setState("error");
        optsRef.current.onError?.(new Error(m));
      }
    })();

    return () => {
      cancelled = true;
      clearFlush();
      clearReconnect();
      try { ws?.close(); } catch { /* noop */ }
      try { node?.disconnect(); src?.disconnect(); sink?.disconnect(); } catch { /* noop */ }
      try { void ctx?.close(); } catch { /* noop */ }
    };
  }, [opts.enabled, opts.stream, opts.relayUrl]);

  const sendChunk = React.useCallback((_chunk: Blob) => { /* streaming uses the raw stream */ }, []);

  return { state, text, language, latest, error, sendChunk };
}
