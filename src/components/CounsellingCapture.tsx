'use client';

/**
 * CounsellingCapture — P4.2 (design §3.3 / principle 4). Optional short
 * final-counselling recording on the Review surface: one-shot MediaRecorder
 * (no live rail, no engines) → session row (phase final_disposition) →
 * presigned R2 upload → finalize → background /process transcribes it
 * FAITHFULLY and appends — no review gate, never enters note-gen/stitch.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'idle' | 'recording' | 'uploading' | 'processing' | 'done' | 'error';

export function CounsellingCapture({ encounterId }: { encounterId: string }) {
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [seconds, setSeconds] = React.useState(0);
  const recRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const router = useRouter();

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '' });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(250);
      recRef.current = rec;
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
      setPhase('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const stopAndUpload = async () => {
    const rec = recRef.current;
    if (!rec) return;
    setPhase('uploading');
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    stopTracks();
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (blob.size === 0) throw new Error('no_audio_captured');

      // 1. open the final_disposition session row
      const sRes = await fetch(`/api/encounters/${encounterId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'final_disposition' }),
      });
      const sj = (await sRes.json()) as { ok?: boolean; seq?: number; error?: string };
      if (!sj.ok || !sj.seq) throw new Error(sj.error || 'session_create_failed');

      // 2. presigned PUT → R2
      const uRes = await fetch(`/api/encounters/${encounterId}/sessions/${sj.seq}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: 'audio/webm' }),
      });
      const uj = (await uRes.json()) as { ok?: boolean; url?: string; key?: string; error?: string };
      if (!uj.ok || !uj.url || !uj.key) throw new Error(uj.error || 'upload_url_failed');
      const put = await fetch(uj.url, { method: 'PUT', headers: { 'Content-Type': 'audio/webm' }, body: blob });
      if (!put.ok) throw new Error(`r2_put_${put.status}`);

      // 3. finalize (headObject verify) then fire the background pipeline
      const fRes = await fetch(`/api/encounters/${encounterId}/sessions/${sj.seq}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: uj.key, duration_seconds: seconds }),
      });
      const fj = (await fRes.json()) as { ok?: boolean; error?: string };
      if (!fj.ok) throw new Error(fj.error || 'finalize_failed');
      void fetch(`/api/encounters/${encounterId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        keepalive: true,
      }).catch(() => { /* intentional: pipeline persists server-side */ });

      setPhase('processing');
      // Light poll: refresh the page periodically so the faithful transcript
      // appears when the background pipeline lands it.
      let polls = 0;
      const pid = window.setInterval(() => {
        polls += 1;
        router.refresh();
        if (polls >= 24) {
          window.clearInterval(pid);
          setPhase('done');
        }
      }, 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  React.useEffect(() => () => stopTracks(), []);

  return (
    <div className="rounded-xl border border-even-ink-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-even-ink-600">
          Final counselling (optional)
        </span>
        <span className="text-[11px] text-even-ink-400">
          faithfully transcribed in the background · appended without review · never edits your note
        </span>
        <span className="ml-auto">
          {phase === 'idle' || phase === 'error' || phase === 'done' ? (
            <button
              onClick={start}
              className="rounded-md bg-even-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-even-blue-700"
            >
              ● Record counselling
            </button>
          ) : phase === 'recording' ? (
            <button
              onClick={stopAndUpload}
              className="animate-pulse rounded-md bg-red-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
            >
              ■ Stop &amp; save ({Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, '0')})
            </button>
          ) : phase === 'uploading' ? (
            <span className="text-[11px] text-even-ink-500">Uploading…</span>
          ) : (
            <span className="text-[11px] text-violet-700">Transcribing in background — the transcript will appear below.</span>
          )}
        </span>
      </div>
      {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
