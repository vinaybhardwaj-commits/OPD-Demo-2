'use client';

/**
 * <DictateButton /> — captures a short voice note, uploads it, gets a
 * transcript back, and (optionally) hands the transcript to the parent
 * so the section field can be auto-filled.
 *
 * Flow (v4.1.4):
 *   1. Idle. Tap → request mic permission, start MediaRecorder.
 *   2. Recording. Pulsing pink ring + MM:SS ticker. Tap again to stop.
 *   3. Saving. POST multipart (audio + section + duration) to
 *      /api/encounters/[id]/dictations. Server uploads to Blob, then
 *      runs Deepgram + Whisper (Mac Mini) in parallel and qwen2.5:14b
 *      judges the pair. Winning transcript comes back along with the
 *      full compare result (scores, latencies, judge reasoning).
 *   4. Done. Show "✓ MM:SS" briefly; if transcript came back, call
 *      onTranscript so the parent can insert it. Below the button, a
 *      compare pill shows the scores + ⬇ download icons for both
 *      engines' transcripts.
 *
 * Falls back gracefully if MediaRecorder / getUserMedia isn't available
 * (e.g. http context) — still posts a JSON-only row marking intent.
 */
import { useEffect, useRef, useState } from 'react';
import TracePanel, { type TraceEvent } from '@/components/llm-trace/TracePanel';
import { consumeNdjson } from '@/lib/llm-trace/ndjson-client';

type Section =
  | 'chief_complaint'
  | 'exam_findings'
  | 'assessment'
  | 'prescription'
  | 'disposition';

type EnginePayload = {
  transcript: string | null;
  latency_ms: number;
  error: string | null;
  confidence?: number | null;
};

type JudgePayload = {
  winner: 'deepgram' | 'whisper' | 'tie' | null;
  deepgram_score: number | null;
  whisper_score: number | null;
  delta_score: number | null;
  reasoning: string | null;
  latency_ms: number;
  error: string | null;
};

type ComparePayload = {
  id: string | null;
  deepgram: EnginePayload;
  whisper: EnginePayload;
  judge: JudgePayload;
  total_elapsed_ms: number;
};

export type DictateButtonProps = {
  encounterId: string;
  section: Section;
  onTranscript?: (transcript: string) => void;
  disabled?: boolean;
};

type State = 'idle' | 'asking' | 'recording' | 'saving' | 'saved' | 'error';

export function DictateButton({
  encounterId,
  section,
  onTranscript,
  disabled,
}: DictateButtonProps) {
  const [state, setState] = useState<State>('idle');
  const [seconds, setSeconds] = useState(0);
  // v4.1.4 — compare result from the dual-engine run.
  const [compare, setCompare] = useState<ComparePayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const startRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // v6.0 Phase 2B — TracePanel state
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [traceTotalMs, setTraceTotalMs] = useState<number | undefined>(undefined);
  const [traceId, setTraceId] = useState<string | null>(null);

  useEffect(() => () => {
    // On unmount, stop any in-progress stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(t);
  }, [state]);

  function preferredMime(): string {
    if (typeof MediaRecorder === 'undefined') return 'audio/webm';
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

    // No MediaRecorder → JSON fallback (records intent only)
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
      setState('error');
      setErrorMsg('Audio recording not supported in this browser.');
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
      rec.start();
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
      form.append('audio', blob, `dictation.${(mimeType || 'audio/webm').split('/')[1].split(';')[0]}`);
      form.append('section', section);
      form.append('duration_seconds', String(duration));

      // v6.0 Phase 2B — request NDJSON so we can stream progress events
      // to the TracePanel. Server still returns the same payload shape via
      // a final `result` event.
      setTraceEvents([]);
      setTraceTotalMs(undefined);
      setTraceId(null);
      const res = await fetch(`/api/encounters/${encounterId}/dictations`, {
        method: 'POST',
        headers: { Accept: 'application/x-ndjson' },
        body: form,
      });
      const tid = res.headers.get('X-Trace-Id');
      if (tid) setTraceId(tid);
      if (!res.ok) {
        setState('error');
        setErrorMsg(`HTTP ${res.status}`);
        return;
      }
      type DictResult = {
        ok?: boolean;
        dictation?: { transcript_text?: string | null; transcribe_error?: string | null };
        compare?: ComparePayload;
        error?: string;
      };
      const resultRef: { current: DictResult | null } = { current: null };
      await consumeNdjson(res, (ev) => {
        if (ev.type === 'progress') {
          setTraceEvents((prev) => {
            // Mark previous in-progress event as done when a new stage starts.
            const next = prev.map((p, i) =>
              i === prev.length - 1 && !p.done ? { ...p, done: true } : p,
            );
            return [...next, { stage: ev.stage, msg: ev.msg, ms: ev.ms, done: false, ts: Date.now() }];
          });
        } else if (ev.type === 'result') {
          resultRef.current = ev.data as DictResult;
        } else if (ev.type === 'done') {
          setTraceTotalMs(ev.ms);
          setTraceEvents((prev) => {
            // Terminal event must also close the last in-progress step —
            // otherwise the final stage (judge/drafting) spins forever.
            const next = prev.map((p, i) =>
              i === prev.length - 1 && !p.done ? { ...p, done: true } : p,
            );
            return [...next, { stage: 'done', msg: '', ms: ev.ms, done: true, ts: Date.now() }];
          });
        } else if (ev.type === 'error') {
          setTraceEvents((prev) => {
            const next = prev.map((p, i) =>
              i === prev.length - 1 && !p.done ? { ...p, done: true } : p,
            );
            return [...next, { stage: 'done', msg: ev.message, done: true, error: true, ts: Date.now() }];
          });
        }
      });
      const j = resultRef.current;
      if (!j || !j.ok) {
        setState('error');
        setErrorMsg(j?.error ?? 'Save failed.');
        return;
      }
      setSeconds(duration);
      setState('saved');
      const transcript = j.dictation?.transcript_text;
      if (transcript && onTranscript) onTranscript(transcript);
      if (j.compare) setCompare(j.compare);
      if (j.dictation?.transcribe_error) {
        setErrorMsg(`Audio saved, transcription failed: ${j.dictation.transcribe_error}`);
      }
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Network error.');
    }
  }

  const label =
    state === 'recording'
      ? `${fmt(seconds)} · stop`
      : state === 'asking'
      ? 'mic…'
      : state === 'saving'
      ? 'transcribing…'
      : state === 'saved'
      ? `✓ ${fmt(seconds)}`
      : state === 'error'
      ? 'retry'
      : 'dictate';

  const tone =
    state === 'recording'
      ? 'border-even-pink-400 bg-even-pink-50 text-even-pink-800 ring-2 ring-even-pink-100 animate-pulse'
      : state === 'saved'
      ? 'border-even-blue-300 bg-even-blue-50 text-even-blue-700'
      : state === 'error'
      ? 'border-even-pink-300 bg-white text-even-pink-700'
      : state === 'saving' || state === 'asking'
      ? 'border-even-ink-300 bg-white text-even-ink-700'
      : 'border-even-ink-200 bg-white text-even-ink-600 hover:border-even-blue-300';

  return (
    <span className="inline-flex flex-wrap items-start gap-2">
      <button
        type="button"
        disabled={disabled || state === 'saving' || state === 'asking'}
        onClick={state === 'recording' ? stop : start}
        title={
          state === 'idle'
            ? 'Tap to record a quick voice note. Auto-transcribed via Deepgram and inserted into this section.'
            : undefined
        }
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
      >
        <MicIcon />
        <span>{label}</span>
      </button>
      {errorMsg && state !== 'recording' && (
        <span
          className="text-[10px] text-even-pink-700"
          title={errorMsg}
        >
          {errorMsg.length > 40 ? errorMsg.slice(0, 38) + '…' : errorMsg}
        </span>
      )}
      {(traceEvents.length > 0 || state === 'saving') && (
        <span className="block w-full">
          <TracePanel
            events={traceEvents}
            totalMs={traceTotalMs}
            traceId={traceId}
            surface="transcribe-compare"
          />
        </span>
      )}
      {compare && <ComparisonCard compare={compare} />}
    </span>
  );
}

/**
 * Detailed comparison card (v4.1.6 — replaces ComparePill).
 *
 * Renders ALL the data inline (no tooltip), per V's request:
 *   ┌─ Transcription compare ─────────────────────────────────────┐
 *   │ ✓ Whisper wins  Δ 1.4   total 5.0s                          │
 *   │                                                             │
 *   │ Deepgram  ▰▰▰▰▰▰▰▱▱▱  7.8/10   1.7s                         │
 *   │ Whisper   ▰▰▰▰▰▰▰▰▰▱  9.2/10   2.4s                         │
 *   │ Judge     qwen2.5:14b                          0.9s         │
 *   │                                                             │
 *   │ "Whisper captured 'Telmisartan' and the Hindi phrase        │
 *   │ 'thoda kam ho gaya' correctly; Deepgram mis-transcribed     │
 *   │ both."                                                      │
 *   │                                                             │
 *   │ ⬇ Deepgram .txt   ⬇ Whisper .txt                            │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Persists below the dictate button until the next dictation in this
 * section overwrites it.
 */
function ComparisonCard({ compare }: { compare: ComparePayload }) {
  const j = compare.judge;
  const dg = compare.deepgram;
  const w = compare.whisper;
  const winner = j.winner;

  const winnerLabel =
    winner === 'deepgram'
      ? 'Deepgram wins'
      : winner === 'whisper'
        ? 'Whisper wins'
        : winner === 'tie'
          ? 'Tie'
          : 'No winner';

  const winnerTone =
    winner === 'whisper'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : winner === 'deepgram'
        ? 'text-violet-700 bg-violet-50 border-violet-200'
        : winner === 'tie'
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-even-ink-500 bg-white border-even-ink-200';

  const fmtMs = (ms: number | null | undefined) =>
    ms && ms > 0 ? `${(ms / 1000).toFixed(2)}s` : '–';

  return (
    <div
      className={`mt-2 w-full max-w-md rounded-lg border ${winnerTone} px-3 py-2 text-[11px]`}
    >
      {/* Header — winner + delta + total */}
      <div className="flex items-center justify-between border-b border-current/10 pb-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]">
          <span aria-hidden>{winner === 'tie' ? '≡' : winner ? '✓' : '○'}</span>
          {winnerLabel}
          {j.delta_score !== null && j.delta_score > 0 && (
            <span className="font-mono normal-case tracking-normal">
              Δ {j.delta_score.toFixed(1)}
            </span>
          )}
        </span>
        <span className="font-mono tabular-nums text-even-ink-500">
          total {fmtMs(compare.total_elapsed_ms)}
        </span>
      </div>

      {/* Engine rows — score bar + numerical + latency */}
      <div className="mt-2 space-y-1 text-even-ink-700">
        <EngineRow
          name="Deepgram"
          isWinner={winner === 'deepgram'}
          score={j.deepgram_score}
          latency={dg.latency_ms}
          accent="violet"
          error={dg.error}
          model="nova-3-medical"
        />
        <EngineRow
          name="Whisper"
          isWinner={winner === 'whisper'}
          score={j.whisper_score}
          latency={w.latency_ms}
          accent="emerald"
          error={w.error}
          model="large-v3-turbo"
        />
        <div className="flex items-center gap-2 text-[10px] text-even-ink-500">
          <span className="w-[68px] shrink-0">Judge</span>
          <span className="flex-1 font-mono normal-case">qwen2.5:14b</span>
          <span className="font-mono tabular-nums">{fmtMs(j.latency_ms)}</span>
          {j.error && (
            <span className="font-mono text-even-pink-700" title={j.error}>
              ⚠ judge
            </span>
          )}
        </div>
      </div>

      {/* Judge reasoning */}
      {j.reasoning && (
        <p className="mt-2 italic leading-snug text-even-ink-700">
          &ldquo;{j.reasoning}&rdquo;
        </p>
      )}

      {/* Download row */}
      {compare.id && (
        <div className="mt-2 flex items-center gap-3 border-t border-current/10 pt-1.5 text-[10px]">
          <DownloadLink
            engine="deepgram"
            compareId={compare.id}
            disabled={!dg.transcript}
            label="Deepgram .txt"
          />
          <DownloadLink
            engine="whisper"
            compareId={compare.id}
            disabled={!w.transcript}
            label="Whisper .txt"
          />
        </div>
      )}
    </div>
  );
}

function EngineRow({
  name,
  isWinner,
  score,
  latency,
  accent,
  error,
  model,
}: {
  name: string;
  isWinner: boolean;
  score: number | null;
  latency: number;
  accent: 'violet' | 'emerald';
  error: string | null;
  model: string;
}) {
  const filled = score !== null ? Math.max(0, Math.min(10, Math.round(score))) : 0;
  const empty = 10 - filled;
  const barColor =
    accent === 'violet'
      ? isWinner ? 'text-violet-700' : 'text-violet-400'
      : isWinner ? 'text-emerald-700' : 'text-emerald-400';
  const fmtMs = (ms: number) => (ms > 0 ? `${(ms / 1000).toFixed(2)}s` : '–');

  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-[68px] shrink-0 text-[10px] font-semibold ${isWinner ? 'text-even-navy' : 'text-even-ink-500'}`}
        title={model}
      >
        {name}
        {isWinner && <span className="ml-0.5">★</span>}
      </span>
      <span className={`font-mono text-[10px] tabular-nums ${barColor}`}>
        {'▰'.repeat(filled)}
        <span className="text-even-ink-200">{'▱'.repeat(empty)}</span>
      </span>
      <span className="font-mono tabular-nums text-even-ink-700">
        {score !== null ? score.toFixed(1) : '—'}/10
      </span>
      <span className="ml-auto font-mono tabular-nums text-even-ink-500">
        {fmtMs(latency)}
      </span>
      {error && (
        <span
          className="font-mono text-even-pink-700"
          title={error}
        >
          ⚠
        </span>
      )}
    </div>
  );
}

function DownloadLink({
  engine,
  compareId,
  disabled,
  label,
}: {
  engine: 'deepgram' | 'whisper';
  compareId: string;
  disabled: boolean;
  label: string;
}) {
  const href = `/api/transcribe-compare/${compareId}/download/${engine}`;
  if (disabled) {
    return (
      <span
        className="inline-flex items-center gap-1 text-even-ink-300"
        title={`${label} unavailable`}
        aria-disabled
      >
        <span aria-hidden>⬇</span> {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-even-ink-600 hover:text-even-navy"
      title={`Download ${label}`}
      download
    >
      <span aria-hidden>⬇</span> {label}
    </a>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5 12a7 7 0 0 0 14 0M12 19v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
