"use client";

import * as React from "react";

/**
 * useMediaRecorder — thin React wrapper around MediaRecorder.
 *
 * Emits Blob chunks at a fixed cadence (default 5s) via onChunk. The
 * downstream consumer is responsible for transcription, durability
 * (IndexedDB), and upload. This hook only owns the recorder itself.
 *
 * State machine:
 *   idle → permission_pending → recording ⇄ paused → finalizing → idle
 *   any state → permission_denied (terminal until reload)
 *   any state → error (terminal until reload)
 *
 * Codec preference: audio/webm;codecs=opus (Chrome/Firefox/Edge),
 * audio/mp4 (Safari iOS 16+), falls back to default.
 */

export type RecorderState =
  | "idle"
  | "permission_pending"
  | "permission_denied"
  | "recording"
  | "paused"
  | "finalizing"
  | "error";

type Options = {
  chunkMs?: number;
  onChunk?: (chunk: Blob, indexFromZero: number) => void;
  onError?: (e: Error) => void;
  /** Fired with the live MediaStream when recording starts, and null when it
   *  stops — lets a consumer attach an AnalyserNode for a live level meter. */
  onStream?: (stream: MediaStream | null) => void;
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

export function useMediaRecorder(opts: Options = {}) {
  const chunkMs = opts.chunkMs ?? 250;
  const [state, setState] = React.useState<RecorderState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [mimeType, setMimeType] = React.useState<string | undefined>(undefined);
  const recRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunkIdxRef = React.useRef(0);
  // B4 fix: soft-pause guard. iOS Safari's MediaRecorder.pause() has historic
  // bugs (no-ops on some versions, silently drops chunks on others). If the
  // native pause fails, we still want the UI to behave as paused — so we
  // ALSO gate ondataavailable through this ref. Set to true on pause click,
  // false on resume/stop. Even if the native MediaRecorder keeps recording,
  // no chunks reach IDB or the live transcript pipeline while soft-paused.
  const softPausedRef = React.useRef(false);
  const optsRef = React.useRef(opts);
  React.useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const start = React.useCallback(async () => {
    if (state === "recording" || state === "paused") return;
    setError(null);
    setState("permission_pending");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // B19 P1: use `ideal` (not exact) so devices/headless-Chromium that
          // can't open at exactly 16 kHz / mono don't throw OverconstrainedError
          // (which silently aborted recording). The pipeline tolerates other rates.
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 16000 },
        },
      });
      streamRef.current = stream;
      try { optsRef.current.onStream?.(stream); } catch { /* noop */ }
      const mt = pickMime();
      setMimeType(mt);
      const rec = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
      recRef.current = rec;
      chunkIdxRef.current = 0;
      rec.ondataavailable = (e: BlobEvent) => {
        if (!e.data || e.data.size === 0) return;
        if (softPausedRef.current) return; // B4: soft-pause guard
        const i = chunkIdxRef.current;
        chunkIdxRef.current = i + 1;
        try {
          optsRef.current.onChunk?.(e.data, i);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          optsRef.current.onError?.(new Error(`onChunk handler failed: ${msg}`));
        }
      };
      rec.onerror = (ev: Event) => {
        const msg = (ev as unknown as { error?: { message?: string } }).error?.message ?? "recorder_error";
        setError(msg);
        setState("error");
        optsRef.current.onError?.(new Error(msg));
      };
      softPausedRef.current = false;
      rec.start(chunkMs);
      setState("recording");
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setState("permission_denied");
        setError("microphone_permission_denied");
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState("error");
      optsRef.current.onError?.(new Error(msg));
    }
  }, [state, chunkMs]);

  // iOS Safari fix (B-pause): we do NOT call native MediaRecorder.pause()/
  // resume(). On iOS Safari, resume() after pause() frequently fails to
  // restart timeslice data emission — ondataavailable never fires again, so
  // recording is stuck even though rec.state reports "recording" (exactly the
  // "recording froze after Resume" report). Instead the recorder runs
  // CONTINUOUSLY for the whole session and we SOFT-pause: ondataavailable is
  // gated by softPausedRef, so chunks recorded while paused are dropped (never
  // written to IDB, never sent to Deepgram/Whisper/Sarvam). The final audio is
  // therefore the non-paused chunks with a time gap where the pause was —
  // which is exactly what the user wants (the paused audio is excluded).
  // Resume is just a flag flip; there is no fragile native call to fail.
  const pause = React.useCallback(() => {
    if (!recRef.current) return;
    softPausedRef.current = true;
    setState("paused");
  }, []);

  const resume = React.useCallback(() => {
    if (!recRef.current) return;
    softPausedRef.current = false;
    setState("recording");
  }, []);

  const stop = React.useCallback(async (): Promise<void> => {
    const rec = recRef.current;
    if (!rec) return;
    setState("finalizing");
    return new Promise<void>((resolve) => {
      const onStop = () => {
        rec.removeEventListener("stop", onStop);
        try {
          streamRef.current?.getTracks().forEach((t) => t.stop());
        } catch {
          /* noop */
        }
        streamRef.current = null;
        recRef.current = null;
        softPausedRef.current = false;
        try { optsRef.current.onStream?.(null); } catch { /* noop */ }
        setState("idle");
        resolve();
      };
      rec.addEventListener("stop", onStop);
      try {
        rec.stop();
      } catch {
        onStop();
      }
    });
  }, []);

  React.useEffect(() => {
    return () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        /* noop */
      }
    };
  }, []);

  return { state, error, mimeType, start, pause, resume, stop };
}
