'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMediaRecorder } from '@/lib/use-media-recorder';

/**
 * VoiceEnrollClient — voice-enrollment wizard, ported from ETA
 * components/recording/VoiceEnrollClient.tsx (V2.SD.1 + recording-evidence).
 * Six English sentences recorded one at a time; each is a standalone webm
 * clip. On finish all clips POST to `enrollUrl` → Mac Mini /enroll ×N →
 * centroid → voice_print.
 *
 * Two contexts via props:
 *  - doctor self-serve (/enroll/voice): enrollUrl=/api/voice/enroll
 *  - admin kiosk (/admin/voiceprints/[id]): enrollUrl=/api/admin/doctors/[id]/voice-enroll
 *
 * Recording evidence (P1.6 lock: meter + live transcript): AnalyserNode level
 * meter + elapsed timer + pulsing red dot + the sentence transcribed live via
 * `transcribeUrl` (demo2 wires the Sarvam codemix window route).
 *
 * OPD-Demo-2 adaptations: plain Tailwind buttons (no ETA Button component),
 * demo2 theme tokens, sessionStorage keys opd2:*.
 */

const SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'She sells seashells by the seashore.',
  'How razorback-jumping frogs can level six piqued gymnasts.',
  'The patient reports intermittent chest discomfort for two weeks.',
  'Heart sounds are normal with no audible murmurs or gallops.',
  'Please follow up in one week with the results of the lab tests.',
];

type Props = {
  doctorName: string;
  enrollUrl: string;
  doneUrl: string;
  context: 'doctor' | 'admin';
  cancelUrl?: string;
  transcribeUrl?: string;
};

const btn = 'rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const btnLg = `${btn} px-6 py-3 text-sm`;
const btnSm = `${btn} px-3 py-1.5 text-xs`;

export function VoiceEnrollClient({ doctorName, enrollUrl, doneUrl, context, cancelUrl, transcribeUrl }: Props) {
  const router = useRouter();
  const [idx, setIdx] = React.useState(0);
  const [clips, setClips] = React.useState<(Blob | null)[]>(() => Array(SENTENCES.length).fill(null));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showSkip, setShowSkip] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const [liveText, setLiveText] = React.useState('');
  const chunksRef = React.useRef<Blob[]>([]);
  const mimeRef = React.useRef<string>('audio/webm');

  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const onStream = React.useCallback((stream: MediaStream | null) => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (audioCtxRef.current) { void audioCtxRef.current.close().catch(() => { /* intentional */ }); audioCtxRef.current = null; }
    setLevel(0);
    if (!stream) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 3.2));
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch { /* intentional: meter is best-effort */ }
  }, []);

  const rec = useMediaRecorder({
    chunkMs: 1000,
    onStream,
    onChunk: (chunk) => {
      if (chunk && chunk.size > 0) {
        chunksRef.current.push(chunk);
        if (chunk.type) mimeRef.current = chunk.type;
      }
    },
  });

  const recording = rec.state === 'recording';
  const recordedCount = clips.filter(Boolean).length;
  const allDone = recordedCount === SENTENCES.length;

  React.useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const t0 = Date.now();
    const h = setInterval(() => setElapsed((Date.now() - t0) / 1000), 200);
    return () => clearInterval(h);
  }, [recording]);

  // Live "it heard me" evidence — POST the growing window to the transcribe
  // route every 1.6s (demo2: the Sarvam codemix route accepts the same shape).
  const sendingRef = React.useRef(false);
  React.useEffect(() => {
    if (!recording || !transcribeUrl) return;
    const h = setInterval(async () => {
      if (sendingRef.current || chunksRef.current.length === 0) return;
      sendingRef.current = true;
      try {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        const fd = new FormData();
        fd.append('audio', blob, 'win.webm');
        const r = await fetch(transcribeUrl, { method: 'POST', body: fd });
        const j = (await r.json().catch(() => ({}))) as { data?: { text?: string }; text?: string };
        const text = j?.data?.text ?? j?.text ?? '';
        if (text) setLiveText(text);
      } catch { /* intentional: best-effort */ } finally { sendingRef.current = false; }
    }, 1600);
    return () => clearInterval(h);
  }, [recording, transcribeUrl]);

  React.useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (audioCtxRef.current) void audioCtxRef.current.close().catch(() => { /* intentional */ });
  }, []);

  const startRec = React.useCallback(() => {
    chunksRef.current = [];
    setError(null);
    setLiveText('');
    void rec.start();
  }, [rec]);

  const stopRec = React.useCallback(async () => {
    await rec.stop();
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    chunksRef.current = [];
    if (blob.size === 0) { setError('Nothing recorded — try again.'); return; }
    setClips((prev) => { const next = [...prev]; next[idx] = blob; return next; });
  }, [rec, idx]);

  const finish = React.useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      clips.forEach((c, i) => { if (c) form.append(`clip_${i}`, c, `clip_${i}.webm`); });
      const res = await fetch(enrollUrl, { method: 'POST', body: form });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) { setError(json?.error || `Enrollment failed (${res.status})`); setSubmitting(false); return; }
      if (context === 'doctor') { try { sessionStorage.setItem('opd2:voice_enrolled', '1'); } catch { /* noop */ } }
      router.push(doneUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }, [clips, enrollUrl, doneUrl, context, router]);

  const skip = React.useCallback(() => {
    if (context === 'doctor') { try { sessionStorage.setItem('opd2:voice_enroll_skipped', '1'); } catch { /* noop */ } }
    router.push(cancelUrl ?? doneUrl);
  }, [context, cancelUrl, doneUrl, router]);

  const backLabel = context === 'admin' ? 'Back to voiceprints' : 'Skip for now';

  return (
    <main className="flex min-h-screen flex-col bg-even-white-cream">
      <header className="flex items-center justify-between border-b border-even-ink-200 bg-white px-4 py-3">
        <span className="text-sm font-semibold text-even-navy-800">Voice setup · Dr {doctorName}</span>
        <button
          type="button"
          onClick={() => (context === 'admin' ? skip() : setShowSkip(true))}
          className="text-xs text-even-ink-400 hover:text-even-ink-600"
        >
          {backLabel}
        </button>
      </header>

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center gap-6 px-6 py-8">
        <div>
          <h1 className="text-center text-2xl font-bold text-even-navy-800">Set up voice recognition</h1>
          <p className="mt-2 text-center text-xs text-even-ink-500">
            {context === 'admin'
              ? `Have Dr ${doctorName} read ${SENTENCES.length} short sentences aloud (~90 seconds) at this mic. This lets the app label them in recordings. English only for now.`
              : `Read ${SENTENCES.length} short sentences aloud (~90 seconds). This lets the app label you in recordings. English only for now.`}
          </p>
        </div>

        <div className="flex items-center gap-2" aria-label={`Sentence ${idx + 1} of ${SENTENCES.length}`}>
          {SENTENCES.map((_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-full ${clips[i] ? 'bg-emerald-500' : i === idx ? 'bg-even-blue-600' : 'bg-even-ink-200'}`} />
          ))}
        </div>

        <div className="w-full rounded-xl border border-even-ink-200 bg-white p-6 text-center">
          <p className="mb-2 text-xs text-even-ink-400">
            Sentence {idx + 1} of {SENTENCES.length}
            {idx >= 3 ? ' · clinical' : ''}
          </p>
          <p className="text-[22px] leading-relaxed text-even-navy-800" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
            {'“'}{SENTENCES[idx]}{'”'}
          </p>
        </div>

        {recording ? (
          <div className="flex w-full flex-col gap-3 rounded-xl border border-red-200 bg-red-50/60 p-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
              </span>
              <span className="text-sm font-semibold text-red-700">Recording</span>
              <span className="ml-auto text-xs tabular-nums text-even-ink-600">{elapsed.toFixed(1)}s</span>
            </div>
            <div className="flex h-8 items-end gap-[3px]" aria-hidden>
              {Array.from({ length: 28 }).map((_, i) => {
                const center = Math.abs(i - 13.5) / 13.5;
                const gain = level * (1.1 - center * 0.6);
                const hPct = Math.max(6, Math.min(100, gain * 140));
                const lit = level > 0.04 + center * 0.12;
                return (
                  <span
                    key={i}
                    className="flex-1 rounded-sm transition-all duration-75"
                    style={{ height: `${hPct}%`, backgroundColor: lit ? '#EF4444' : '#FCA5A5', opacity: lit ? 1 : 0.5 }}
                  />
                );
              })}
            </div>
            {transcribeUrl ? (
              <p className="min-h-[1.2em] text-xs text-even-ink-600">
                {liveText ? liveText : <span className="text-even-ink-400">Listening…</span>}
              </p>
            ) : null}
          </div>
        ) : null}

        {!recording ? (
          <button onClick={startRec} disabled={submitting} className={`${btnLg} w-full max-w-xs bg-even-blue-600 text-white hover:bg-even-blue-700`}>
            {clips[idx] ? 'Re-record this sentence' : 'Tap to record'}
          </button>
        ) : (
          <button onClick={() => void stopRec()} className={`${btnLg} w-full max-w-xs bg-red-600 text-white hover:bg-red-700`}>
            Stop
          </button>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0 || recording || submitting}
            className={`${btnSm} bg-even-ink-100 text-even-ink-700 hover:bg-even-ink-200`}
          >
            ‹ Previous
          </button>
          <button
            onClick={() => setIdx((i) => Math.min(SENTENCES.length - 1, i + 1))}
            disabled={idx >= SENTENCES.length - 1 || recording || submitting}
            className={`${btnSm} ${clips[idx] ? 'bg-even-blue-600 text-white hover:bg-even-blue-700' : 'bg-even-ink-100 text-even-ink-700 hover:bg-even-ink-200'}`}
          >
            Next sentence ›
          </button>
        </div>

        {allDone ? (
          <button onClick={() => void finish()} disabled={submitting} className={`${btnLg} w-full max-w-xs bg-emerald-600 text-white hover:bg-emerald-700`}>
            {submitting ? 'Enrolling…' : 'Finish enrollment'}
          </button>
        ) : (
          <p className="text-xs text-even-ink-400">{recordedCount} of {SENTENCES.length} recorded</p>
        )}

        {rec.state === 'permission_denied' ? (
          <p className="max-w-sm text-center text-xs text-red-700">Microphone access denied. Allow mic for this site and reload.</p>
        ) : null}
        {error ? <p className="max-w-sm text-center text-xs text-red-700">{error}</p> : null}
      </section>

      {showSkip ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl bg-white p-5">
            <p className="mb-2 text-sm font-semibold text-even-navy-800">Skip voice setup?</p>
            <p className="mb-4 text-xs text-even-ink-500">
              Your voice won&apos;t be identified by name in recordings until you enroll. You can set this up later.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSkip(false)} className={`${btnSm} bg-even-ink-100 text-even-ink-700`}>Keep setting up</button>
              <button onClick={skip} className={`${btnSm} bg-even-blue-600 text-white`}>Skip for now</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
