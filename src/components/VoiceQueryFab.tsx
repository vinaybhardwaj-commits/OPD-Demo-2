'use client';

/**
 * <VoiceQueryFab /> — v2.2.3 push-to-talk voice query button (PRD lock:
 * "Global FAB in encounter header").
 *
 * UX:
 *   - Persistent mic button mounted in the encounter header.
 *   - Press-and-hold (mousedown / touchstart): MediaRecorder starts
 *     capturing webm/opus from getUserMedia.
 *   - Release: stop recording → POST multipart to /voice-query.
 *   - While waiting: spinner + "Asking Qwen…" inside the drawer.
 *   - Answer renders in a right-side drawer that auto-opens on first
 *     answer and stays open until dismissed. Subsequent queries
 *     append to the top.
 *   - Drawer also lists the last 20 voice queries on this encounter
 *     (loaded from GET on first open) — doctor can scroll back to
 *     earlier answers.
 *
 * Permissions: requests mic on first press. If denied, shows a small
 * error toast in the drawer.
 *
 * Auth: parent should only mount this for encounter doctors (role
 * check happens server-side too).
 *
 * No audio archive (per lock #14): the MediaRecorder Blob is sent to
 * the server and dropped from memory after the response.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';

type VoiceQuery = {
  id: string;
  question_transcript: string;
  answer_text: string;
  source_encounter_ids?: string[];
  sources_json?: { encounter_ids?: string[] } | null;
  latency_ms?: number | null;
  created_at?: string;
};

type Phase = 'idle' | 'recording' | 'uploading' | 'error';

export function VoiceQueryFab({ encounterId }: { encounterId: string }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [history, setHistory] = useState<VoiceQuery[]>([]);

  // v6.0 Phase 2E — TracePanel state
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [traceTotalMs, setTraceTotalMs] = useState<number | undefined>(undefined);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedHistory, setLoadedHistory] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Load history when drawer opens for the first time.
  useEffect(() => {
    if (!drawerOpen || loadedHistory) return;
    setLoadedHistory(true);
    fetch(`/api/encounters/${encounterId}/voice-query`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; queries?: VoiceQuery[] }) => {
        if (j.ok && j.queries) {
          setHistory(
            j.queries.map((q) => ({
              ...q,
              source_encounter_ids: q.sources_json?.encounter_ids ?? [],
            })),
          );
        }
      })
      .catch(() => {
        /* swallow — drawer will just be empty until next query */
      });
  }, [drawerOpen, loadedHistory, encounterId]);

  const stopAndCleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (phase !== 'idle') return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];
        stopAndCleanupStream();
        if (blob.size < 500) {
          setPhase('idle');
          setError('Recording too short — hold a bit longer.');
          return;
        }
        setPhase('uploading');
        setDrawerOpen(true);
        // Reset trace state on every fire.
        setTraceEvents([]);
        setTraceTotalMs(undefined);
        setTraceId(null);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'voice.webm');
          const res = await fetch(
            `/api/encounters/${encounterId}/voice-query`,
            {
              method: 'POST',
              headers: { Accept: 'application/x-ndjson' },
              body: fd,
            },
          );
          const tid = res.headers.get('X-Trace-Id');
          if (tid) setTraceId(tid);
          if (!res.ok) {
            setError(`HTTP ${res.status}`);
            setPhase('error');
            return;
          }
          type VQResult = {
            ok?: boolean;
            id?: string;
            question_transcript?: string;
            answer_text?: string;
            source_encounter_ids?: string[];
            latency_ms?: number;
            error?: string;
            detail?: string;
          };
          const resultRef: { current: VQResult | null } = { current: null };
          await consumeNdjson(res, (ev) => {
            if (ev.type === 'progress') {
              setTraceEvents((prev) => {
                const next = prev.map((p, i) => (i === prev.length - 1 && !p.done ? { ...p, done: true } : p));
                return [...next, { stage: ev.stage, msg: ev.msg, ms: ev.ms, done: false, ts: Date.now() }];
              });
            } else if (ev.type === 'result') {
              resultRef.current = ev.data as VQResult;
            } else if (ev.type === 'done') {
              setTraceTotalMs(ev.ms);
              setTraceEvents((prev) => [...prev, { stage: 'done', msg: '', ms: ev.ms, done: true, ts: Date.now() }]);
            } else if (ev.type === 'error') {
              setTraceEvents((prev) => [...prev, { stage: 'done', msg: ev.message, done: true, error: true, ts: Date.now() }]);
            }
          });
          const j = resultRef.current;
          if (!j || !j.ok) {
            setError(j?.detail ?? j?.error ?? 'voice_query_failed');
            setPhase('error');
            return;
          }
          setHistory((prev) => [
            {
              id: j.id ?? '',
              question_transcript: j.question_transcript ?? '',
              answer_text: j.answer_text ?? '',
              source_encounter_ids: j.source_encounter_ids ?? [],
              latency_ms: j.latency_ms ?? null,
              created_at: new Date().toISOString(),
            },
            ...prev,
          ]);
          setPhase('idle');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'network_error');
          setPhase('error');
        }
      };
      mr.start();
      recorderRef.current = mr;
      setPhase('recording');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'mic_permission_denied';
      setError(msg);
      setPhase('error');
      stopAndCleanupStream();
    }
  }, [encounterId, phase, stopAndCleanupStream]);

  const stopRecording = useCallback(() => {
    if (phase !== 'recording') return;
    recorderRef.current?.stop();
    // onstop handler does the upload + state transition
  }, [phase]);

  const onPressStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      void startRecording();
    },
    [startRecording],
  );
  const onPressEnd = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

  return (
    <>
      <button
        type="button"
        onMouseDown={onPressStart}
        onMouseUp={onPressEnd}
        onMouseLeave={onPressEnd}
        onTouchStart={onPressStart}
        onTouchEnd={onPressEnd}
        title="Press & hold to ask about this patient"
        className={`group inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition select-none ${
          phase === 'recording'
            ? 'bg-even-pink-700 text-white shadow-md scale-105'
            : phase === 'uploading'
            ? 'bg-amber-500 text-white'
            : 'bg-even-blue text-white hover:bg-even-blue-700'
        }`}
        aria-label="Push to talk — ask the AI"
      >
        <MicIcon className="h-3.5 w-3.5" />
        <span>
          {phase === 'recording'
            ? 'Listening…'
            : phase === 'uploading'
            ? 'Asking…'
            : 'Ask AI'}
        </span>
      </button>

      {drawerOpen && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-even-ink-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-even-ink-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-even-navy">Voice query</p>
              <p className="text-[10px] uppercase tracking-wider text-even-ink-500">
                ✨ Press &amp; hold the mic in the header to ask
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="text-xs text-even-ink-500 hover:text-even-navy"
            >
              Close
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {error && (
              <div className="rounded-md bg-even-pink-50 px-3 py-2 text-[11px] text-even-pink-800">
                {error}
              </div>
            )}
            {(phase === 'uploading' || traceEvents.length > 0) && (
              <div>
                <TracePanel
                  events={traceEvents}
                  totalMs={traceTotalMs}
                  traceId={traceId}
                  surface="voice-query"
                />
              </div>
            )}
            {history.length === 0 && phase !== 'uploading' && !error && (
              <p className="text-[11px] text-even-ink-400">
                No questions yet. Press &amp; hold the mic to ask something
                like &quot;what&apos;s the HbA1c trend?&quot; or &quot;check
                drug interactions for ibuprofen&quot;.
              </p>
            )}
            <ul className="space-y-3">
              {history.map((q) => (
                <li
                  key={q.id || q.created_at}
                  className="rounded-lg border border-even-ink-200 bg-white p-3"
                >
                  <p className="text-[10px] uppercase tracking-wider text-even-ink-500">
                    You asked
                  </p>
                  <p className="mt-0.5 text-xs italic text-even-ink-700">
                    &ldquo;{q.question_transcript}&rdquo;
                  </p>
                  <p className="mt-2 text-[10px] uppercase tracking-wider text-even-blue-700">
                    ✨
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-even-navy">
                    {q.answer_text}
                  </p>
                  {q.source_encounter_ids && q.source_encounter_ids.length > 0 && (
                    <p className="mt-2 font-mono text-[9px] text-even-ink-400">
                      Based on{' '}
                      {q.source_encounter_ids.map((id) => id.slice(0, 8)).join(', ')}
                    </p>
                  )}
                  {typeof q.latency_ms === 'number' && (
                    <p className="mt-1 text-[9px] text-even-ink-400">
                      {q.latency_ms}ms
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M5 11a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21a1 1 0 1 1-2 0v-3.07A7 7 0 0 1 5 11z" />
    </svg>
  );
}
