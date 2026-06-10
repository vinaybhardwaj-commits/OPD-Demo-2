'use client';

/**
 * RoomCapture — tiny client-side bus connecting the recorder (RoomControls,
 * top bar) to the live transcript rail (LiveTranscript, center column).
 * P1.3.
 *
 * RoomControls keeps OWNING the MediaRecorder (P1.2 record loop is
 * untouched); it just mirrors two things into this context:
 *   - emitChunk(blob): every 250ms audio chunk (already soft-pause gated
 *     upstream in use-media-recorder — muted audio never reaches here)
 *   - setRecording(bool): whether a capture session is live (recording
 *     OR paused — the WS stays open across Mute; KeepAlive covers the gap)
 *   - setStream(MediaStream|null): the live mic stream (P1.4 — feeds the
 *     Sarvam streaming relay's pcm16 worklet; null when recording stops)
 *
 * Subscribers (the Deepgram hook) get chunks via subscribe(). Chunks are
 * NOT buffered here — durability is IndexedDB + the in-memory failsafe in
 * RoomControls; this bus is purely for live streaming.
 */
import * as React from 'react';

type ChunkListener = (chunk: Blob) => void;

type RoomCaptureValue = {
  recording: boolean;
  setRecording: (r: boolean) => void;
  stream: MediaStream | null;
  setStream: (s: MediaStream | null) => void;
  emitChunk: (chunk: Blob) => void;
  subscribe: (fn: ChunkListener) => () => void;
};

const RoomCaptureContext = React.createContext<RoomCaptureValue | null>(null);

export function RoomCaptureProvider({ children }: { children: React.ReactNode }) {
  const [recording, setRecording] = React.useState(false);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const listenersRef = React.useRef<Set<ChunkListener>>(new Set());

  const emitChunk = React.useCallback((chunk: Blob) => {
    listenersRef.current.forEach((fn) => {
      try {
        fn(chunk);
      } catch {
        /* intentional: one bad listener must not break the loop */
      }
    });
  }, []);

  const subscribe = React.useCallback((fn: ChunkListener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const value = React.useMemo(
    () => ({ recording, setRecording, stream, setStream, emitChunk, subscribe }),
    [recording, stream, emitChunk, subscribe],
  );

  return <RoomCaptureContext.Provider value={value}>{children}</RoomCaptureContext.Provider>;
}

/** Null outside a provider — consumers must tolerate that (RoomControls
 *  also renders in contexts/tests without the Room shell). */
export function useRoomCapture(): RoomCaptureValue | null {
  return React.useContext(RoomCaptureContext);
}
