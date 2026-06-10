'use client';

import * as React from 'react';

/**
 * useSpeakerIdentify — P2.2 live clinician identification for the Room's
 * speaker pill (ported from ETA lib/use-speaker-identify.ts, V2.SD.2).
 * Every `intervalMs`, sends a short recent audio window (header chunk +
 * last ~9s) to /api/voice/identify, which embeds it (Mac Mini /enroll) and
 * compares to the doctor's stored voice_print centroid. Surfaces whether
 * the clinician is identified + the best confidence. Latches once
 * identified; `current` is the latest window (NOT latched) and drives the
 * live You/other-voice cue. Buffers reset on every new recording session.
 */

type Options = { enabled: boolean; intervalMs?: number; windowChunks?: number };

// Only the recent tail window (+ header) is ever read — cap the buffer so a
// long consult can't grow it without bound (~30s at 250ms chunks, far more
// than the ~9s window). The header is held separately, so front-trim is safe.
const SPK_MAX_CHUNKS = 120;

export function useSpeakerIdentify(opts: Options) {
  const intervalMs = opts.intervalMs ?? 8000;
  const windowChunks = opts.windowChunks ?? 36; // ~9s at 250ms
  const [enrolled, setEnrolled] = React.useState<boolean | null>(null);
  const [name, setName] = React.useState<string | null>(null);
  const [confidence, setConfidence] = React.useState<number | null>(null);
  const [identified, setIdentified] = React.useState(false);
  const [current, setCurrent] = React.useState<{ isClinician: boolean; confidence: number } | null>(null);

  const chunksRef = React.useRef<Blob[]>([]);
  const headerRef = React.useRef<Blob | null>(null);
  const mimeRef = React.useRef('audio/webm');
  const inFlightRef = React.useRef(false);
  const bestRef = React.useRef(0);

  const sendChunk = React.useCallback((chunk: Blob) => {
    if (!chunk || chunk.size === 0) return;
    if (chunksRef.current.length === 0) headerRef.current = chunk;
    chunksRef.current.push(chunk);
    if (chunk.type) mimeRef.current = chunk.type;
    if (chunksRef.current.length > SPK_MAX_CHUNKS) {
      chunksRef.current.splice(0, chunksRef.current.length - SPK_MAX_CHUNKS);
    }
  }, []);

  const flush = React.useCallback(async () => {
    if (inFlightRef.current) return;
    const all = chunksRef.current;
    if (all.length < 2) return;
    inFlightRef.current = true;
    try {
      const tail = all.slice(Math.max(1, all.length - windowChunks));
      const parts = headerRef.current ? [headerRef.current, ...tail] : tail;
      const blob = new Blob(parts, { type: mimeRef.current });
      const form = new FormData();
      form.append('audio', blob, 'id_window.webm');
      const res = await fetch('/api/voice/identify', { method: 'POST', body: form, cache: 'no-store' });
      if (!res.ok) return;
      const j = (await res.json()) as {
        enrolled?: boolean;
        name?: string | null;
        confidence?: number | null;
        identified?: boolean;
      };
      setEnrolled(!!j.enrolled);
      if (j.name) setName(j.name);
      if (typeof j.confidence === 'number') {
        setCurrent({ isClinician: !!j.identified, confidence: j.confidence });
        if (j.confidence > bestRef.current) {
          bestRef.current = j.confidence;
          setConfidence(j.confidence);
        }
      }
      if (j.identified) setIdentified(true);
    } catch {
      /* intentional: non-critical live cue — pill keeps its last state */
    } finally {
      inFlightRef.current = false;
    }
  }, [windowChunks]);

  React.useEffect(() => {
    if (!opts.enabled) return;
    // Fresh session: the recorder restarts (new WebM header), so stale
    // buffered chunks from a previous session would corrupt the window.
    chunksRef.current = [];
    headerRef.current = null;
    bestRef.current = 0;
    setIdentified(false);
    setCurrent(null);
    const id = window.setInterval(() => { void flush(); }, intervalMs);
    return () => window.clearInterval(id);
  }, [opts.enabled, intervalMs, flush]);

  return { enrolled, name, confidence, identified, current, sendChunk };
}
