'use client';

import * as React from 'react';

/**
 * useDeepgramLive — Browser-side WebSocket to Deepgram's live transcription
 * endpoint, authenticated with a short-lived temp key minted by our server.
 * Ported from ETA lib/use-deepgram-live.ts; OPD-Demo-2 adaptations:
 *   - token route is /api/transcribe/deepgram-token (no slug; opd_session cookie)
 *   - KeepAlive ping every 5s while the WS is open, so a soft-paused mic
 *     (Mute — no audio flowing) doesn't trip Deepgram's ~10s idle close.
 *   - reconnect-on-abnormal-close kept, gated by
 *     NEXT_PUBLIC_OPD2_DEEPGRAM_RECONNECT=1 (default OFF, ETA Tier-4 parity).
 *
 * Lifecycle (driven by `enabled` prop):
 *   enabled=false → state="idle", no WS
 *   enabled=true  → mint token → open WS → state="open"
 *   WS message    → parse Results → fire onInterim / onFinal
 *   enabled flips false (or unmount) → close(1000)
 *
 * Audio: caller pushes Blob chunks via sendChunk(). If the WS is not
 * yet open, chunks queue and drain on open. (MediaRecorder emits the
 * WebM container header in the first chunk; Deepgram auto-detects.)
 */

const DEEPGRAM_RECONNECT = process.env.NEXT_PUBLIC_OPD2_DEEPGRAM_RECONNECT === '1';

export type LiveWord = {
  word: string;
  punctuated?: string;
  start: number;
  end: number;
  confidence: number;
};

export type LiveUtterance = {
  id: string;
  text: string;
  words: LiveWord[];
  is_final: boolean;
  speech_final: boolean;
};

export type DeepgramLiveState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error';

type Options = {
  enabled: boolean;
  encounterId?: string;
  onInterim?: (u: LiveUtterance) => void;
  onFinal?: (u: LiveUtterance) => void;
  onError?: (e: Error) => void;
};

const DG_WS_BASE = 'wss://api.deepgram.com/v1/listen';
const DG_PARAMS = new URLSearchParams({
  model: 'nova-3-medical',
  language: 'en-IN',
  punctuate: 'true',
  smart_format: 'true',
  interim_results: 'true',
  endpointing: '300',
  channels: '1',
});

// Backoff cap for the (flag-gated) live WS reconnect on an unexpected drop.
const MAX_RECONNECTS = 5;
const KEEPALIVE_MS = 5000;

export function useDeepgramLive(opts: Options) {
  const [state, setState] = React.useState<DeepgramLiveState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const queueRef = React.useRef<Blob[]>([]);
  const utteranceCounterRef = React.useRef(0);
  const optsRef = React.useRef(opts);
  React.useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  React.useEffect(() => {
    if (!opts.enabled) return;
    let cancelled = false;
    let attempts = 0;
    let reconnectTimer: number | undefined;
    let keepaliveTimer: number | undefined;

    function stopKeepalive() {
      if (keepaliveTimer) {
        window.clearInterval(keepaliveTimer);
        keepaliveTimer = undefined;
      }
    }

    function scheduleReconnect() {
      // No-op unless the flag is on -> flag-off behaviour is identical.
      if (cancelled || !DEEPGRAM_RECONNECT) return;
      attempts += 1;
      if (attempts > MAX_RECONNECTS) {
        setState('error');
        setError('ws_reconnect_exhausted');
        return;
      }
      const delay = Math.min(1000 * 2 ** (attempts - 1), 8000); // 1s,2s,4s,8s,8s
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delay);
    }

    async function connect() {
      if (cancelled) return;
      setError(null);
      setState('connecting');

      // 1) Mint temp key
      let key: string;
      try {
        const tRes = await fetch('/api/transcribe/deepgram-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encounter_id: opts.encounterId ?? null }),
        });
        if (!tRes.ok) throw new Error(`token_${tRes.status}`);
        const tJson = (await tRes.json()) as { key?: string };
        if (!tJson.key) throw new Error('token_response_no_key');
        key = tJson.key;
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState('error');
        setError(msg);
        optsRef.current.onError?.(new Error(msg));
        scheduleReconnect();
        return;
      }

      if (cancelled) return;

      // 2) Open WS
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${DG_WS_BASE}?${DG_PARAMS}`, ['token', key]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState('error');
        setError(msg);
        optsRef.current.onError?.(new Error(msg));
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (cancelled) return;
        attempts = 0; // a successful connect resets the backoff
        setState('open');
        // KeepAlive so a muted mic (no audio frames) doesn't hit
        // Deepgram's idle-close (~10s without audio).
        stopKeepalive();
        keepaliveTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'KeepAlive' }));
            } catch {
              /* intentional: best-effort ping */
            }
          }
        }, KEEPALIVE_MS);
        // drain queue
        const q = queueRef.current;
        queueRef.current = [];
        for (const b of q) {
          try {
            ws.send(b);
          } catch {
            /* intentional: drop on send failure */
          }
        }
      };

      ws.onmessage = (ev) => {
        try {
          const raw =
            typeof ev.data === 'string'
              ? ev.data
              : new TextDecoder().decode(ev.data as ArrayBuffer);
          const msg = JSON.parse(raw);
          if (msg.type !== 'Results') return;
          const alt = msg?.channel?.alternatives?.[0];
          if (!alt) return;
          const text: string = (alt.transcript ?? '').trim();
          if (!text) return;
          const words: LiveWord[] = Array.isArray(alt.words)
            ? alt.words.map((w: Record<string, unknown>) => ({
                word: String(w.word ?? ''),
                punctuated:
                  typeof w.punctuated_word === 'string'
                    ? (w.punctuated_word as string)
                    : undefined,
                start: typeof w.start === 'number' ? w.start : 0,
                end: typeof w.end === 'number' ? w.end : 0,
                confidence: typeof w.confidence === 'number' ? w.confidence : 0,
              }))
            : [];
          utteranceCounterRef.current += 1;
          const u: LiveUtterance = {
            id: `u_${utteranceCounterRef.current}`,
            text,
            words,
            is_final: !!msg.is_final,
            speech_final: !!msg.speech_final,
          };
          if (msg.is_final) {
            optsRef.current.onFinal?.(u);
          } else {
            optsRef.current.onInterim?.(u);
          }
        } catch {
          /* intentional: Deepgram also sends Metadata / SpeechStarted */
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setState('error');
        setError('ws_error');
        optsRef.current.onError?.(new Error('ws_error'));
      };

      ws.onclose = (ev) => {
        if (cancelled) return;
        stopKeepalive();
        setState('closed');
        const abnormal = ev.code !== 1000 && ev.code !== 1005;
        if (abnormal) setError(`ws_close_${ev.code}`);
        // Unexpected mid-consult drop -> reconnect (re-mints the token).
        // No-op when the flag is off.
        if (abnormal && optsRef.current.enabled) scheduleReconnect();
      };
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      stopKeepalive();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            // Tell Deepgram to flush any pending finals before close
            try {
              ws.send(JSON.stringify({ type: 'CloseStream' }));
            } catch {
              /* intentional */
            }
          }
          ws.close(1000, 'client_close');
        } catch {
          /* intentional */
        }
      }
      queueRef.current = [];
      setState('idle');
    };
  }, [opts.enabled, opts.encounterId]);

  const sendChunk = React.useCallback((chunk: Blob) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(chunk);
      } catch {
        /* intentional */
      }
    } else {
      // queue until WS opens (drained in onopen)
      queueRef.current.push(chunk);
      // Cap the pre-open queue at 200 chunks (~50s at 250ms cadence). The FIRST
      // chunk carries the WebM/opus container header (EBML + init segment); drop
      // it and Deepgram can't decode the drained media clusters, so the live
      // transcript is garbled after a slow WS open. Preserve index 0 and
      // evict the oldest *non-header* chunk instead.
      if (queueRef.current.length > 200) queueRef.current.splice(1, 1);
    }
  }, []);

  return { state, error, sendChunk };
}
