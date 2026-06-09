'use client';

/**
 * <AmbientRecorder /> — the "big red record button" per design doc §4.2.
 *
 * Captures the full encounter audio (long-form, multi-minute). One
 * snippet per start/stop cycle. Sprint 6's pause/resume creates
 * additional snippets tied to the same encounter.
 *
 * Differences from <DictateButton>:
 *   - bigger, more prominent (encounter header, not section header)
 *   - encounter-wide, not section-scoped
 *   - posts to /api/encounters/[id]/recordings (not /dictations)
 *   - parent component refreshes the transcript viewer on success
 */
import { useEffect, useRef, useState } from 'react';

export type AmbientRecorderProps = {
  encounterId: string;
  onSnippetSaved?: () => void;
  disabled?: boolean;
};

type State = 'idle' | 'asking' | 'recording' | 'saving' | 'saved' | 'error';

export function AmbientRecorder({
  encounterId,
  onSnippetSaved,
  disabled,
}: AmbientRecorderProps) {
  const [state, setState] = useState<State>('idle');
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const startRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setState('idle'), 3000);
    return () => clearTimeout(t);
  }, [state]);

  function preferredMime(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  async function start() {
    if (disabled || state === 'saving' || state === 'recording') return;
    setErrorMsg(null);

    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
      setState('error');
      setErrorMsg('Audio recording not supported.');
      return;
    }

    setState('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = preferredMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => void uploadOnStop(rec.mimeType || mime);
      recorderRef.current = rec;
      // 10s timeslice — chunks land periodically so a tab crash mid-recording
      // doesn't lose everything (Sprint 8 will pull them up into the offline queue).
      rec.start(10000);
      startRef.current = Date.now();
      setSeconds(0);
      setState('recording');
      tickRef.current = setInterval(() => {
        if (startRef.current == null) return;
        setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
      }, 1000);
    } catch (e) {
      setState('error');
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(
        msg.includes('Permission') || msg.includes('denied')
          ? 'Microphone permission denied.'
          : 'Could not start recording.',
      );
    }
  }

  function stop() {
    if (state !== 'recording') return;
    if (tickRef.current) clearInterval(tickRef.current);
    setState('saving');
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function uploadOnStop(mimeType: string) {
    if (startRef.current == null) return;
    const duration = Math.max(1, Math.floor((Date.now() - startRef.current) / 1000));
    startRef.current = null;

    try {
      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
      const form = new FormData();
      form.append('audio', blob, `snippet.${(mimeType || 'audio/webm').split('/')[1].split(';')[0]}`);
      form.append('duration_seconds', String(duration));

      const res = await fetch(`/api/encounters/${encounterId}/recordings`, {
        method: 'POST',
        body: form,
      });
      const j = (await res.json()) as {
        ok?: boolean;
        recording?: { transcribe_error?: string | null };
        error?: string;
        detail?: string;
      };
      if (!res.ok || !j.ok) {
        setState('error');
        setErrorMsg(j.detail ?? j.error ?? 'Save failed.');
        return;
      }
      setSeconds(duration);
      setState('saved');
      onSnippetSaved?.();
      if (j.recording?.transcribe_error) {
        setErrorMsg(`Saved, transcription failed: ${j.recording.transcribe_error}`);
      }
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Network error.');
    }
  }

  const isRecording = state === 'recording';
  const isWorking = state === 'saving' || state === 'asking';
  const label =
    state === 'recording'
      ? `Stop · ${fmt(seconds)}`
      : state === 'asking'
      ? 'Asking for mic…'
      : state === 'saving'
      ? 'Saving + transcribing…'
      : state === 'saved'
      ? `Saved · ${fmt(seconds)}`
      : state === 'error'
      ? 'Retry'
      : 'Start recording';

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled || isWorking}
        onClick={isRecording ? stop : start}
        title={
          state === 'idle'
            ? 'Capture the full encounter. Transcript appears below when you stop.'
            : undefined
        }
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50 ${
          isRecording
            ? 'border-even-pink-400 bg-even-pink-100 text-even-pink-900 ring-2 ring-even-pink-200'
            : state === 'saved'
            ? 'border-even-blue-300 bg-even-blue-50 text-even-blue-700'
            : state === 'error'
            ? 'border-even-pink-300 bg-white text-even-pink-700'
            : 'border-even-pink-200 bg-even-pink-50 text-even-pink-800 hover:bg-even-pink-100'
        }`}
      >
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            isRecording
              ? 'bg-even-pink-700 animate-pulse'
              : state === 'saved'
              ? 'bg-even-blue-600'
              : 'bg-even-pink-600'
          }`}
          aria-hidden
        />
        {label}
      </button>
      {errorMsg && state !== 'recording' && (
        <span className="text-[10px] text-even-pink-700" title={errorMsg}>
          {errorMsg.length > 50 ? errorMsg.slice(0, 48) + '…' : errorMsg}
        </span>
      )}
    </div>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
