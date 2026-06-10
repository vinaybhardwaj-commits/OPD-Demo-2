'use client';

/**
 * Room capture + lifecycle controls — P1.2 (record loop live).
 *
 * Ported from Evenscribe's RecordingScreen, adapted to the Room:
 *   - MediaRecorder 250ms chunks (use-media-recorder, soft-pause model)
 *   - every chunk → IndexedDB (chunk-store) + in-memory failsafe
 *   - "Pause for workup" / "End visit" STOP the recorder, concatenate
 *     chunks into one blob, presigned-PUT it to R2, finalize the session
 *     row, THEN fire the lifecycle transition. Audio is never lost: if
 *     upload fails the chunks stay in IndexedDB and the lifecycle action
 *     is held so the doctor can retry.
 *
 * One continuous recording per session (mic soft-pause excludes audio
 * without fragmenting the blob — ETA's B4/iOS lesson).
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ClinicalStatus } from '@/lib/lifecycle';
import { useMediaRecorder } from '@/lib/use-media-recorder';
import { putChunk, getChunksForEncounter, purgeEncounter, markEncounterSubmitted } from '@/lib/chunk-store';
import { useRoomCapture } from '@/components/room/RoomCapture';

type Props = {
  encounterId: string;
  clinicalStatus: ClinicalStatus;
  openSessionSeq: number | null;
};

type Action = 'enter_room' | 'pause_for_workup' | 'mark_back_ready' | 'end_visit';

function storeKey(encounterId: string, seq: number): string {
  return `${encounterId}:${seq}`;
}

export function RoomControls({ encounterId, clinicalStatus, openSessionSeq }: Props) {
  const router = useRouter();
  // P1.3: mirror chunks + recording state onto the RoomCapture bus so the
  // live transcript rail (LiveTranscript) can stream to Deepgram. Additive —
  // the P1.2 record/durability loop below is unchanged.
  const capture = useRoomCapture();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [chunks, setChunks] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const startedAtRef = React.useRef<number | null>(null);
  const mimeRef = React.useRef<string>('audio/webm');
  // In-memory failsafe (IDB can be unavailable/full — audio must survive).
  const memRef = React.useRef<{ key: string | null; chunks: Blob[] }>({ key: null, chunks: [] });

  const rec = useMediaRecorder({
    chunkMs: 250,
    // P1.4: mirror the live mic stream onto the bus (Sarvam streaming relay
    // taps it via a pcm16 worklet; MediaRecorder keeps sole chunk ownership).
    onStream: (s) => capture?.setStream(s),
    onChunk: (blob, idx) => {
      if (openSessionSeq == null) return;
      const key = storeKey(encounterId, openSessionSeq);
      if (memRef.current.key !== key) memRef.current = { key, chunks: [] };
      memRef.current.chunks.push(blob);
      capture?.emitChunk(blob);
      setChunks((c) => c + 1);
      void putChunk(key, idx, blob, blob.type || 'audio/webm').catch(() => {
        /* intentional: IDB best-effort; mem failsafe holds the audio */
      });
    },
  });

  React.useEffect(() => {
    capture?.setRecording(rec.state === 'recording' || rec.state === 'paused');
  }, [capture, rec.state]);

  React.useEffect(() => {
    if (rec.state !== 'recording' && rec.state !== 'paused') return;
    const t = setInterval(() => {
      if (startedAtRef.current) setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [rec.state]);

  async function lifecycle(action: Action): Promise<boolean> {
    const r = await fetch(`/api/encounters/${encounterId}/lifecycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const j = (await r.json()) as { ok: boolean; error?: string; from?: string };
    if (!j.ok) {
      setError(j.error === 'invalid_transition' ? `Not allowed from "${j.from}"` : j.error ?? 'failed');
      return false;
    }
    return true;
  }

  async function startRecording() {
    setError(null);
    startedAtRef.current = Date.now();
    setElapsed(0);
    setChunks(0);
    await rec.start();
  }

  /** Stop recorder, consolidate chunks, upload to R2, finalize session. */
  async function stopAndUpload(): Promise<boolean> {
    if (openSessionSeq == null) return true;
    const wasRecording = rec.state === 'recording' || rec.state === 'paused';
    if (!wasRecording) return true; // nothing recorded this session — transition only

    setBusy('uploading');
    await rec.stop();

    const key = storeKey(encounterId, openSessionSeq);
    let blobs: Blob[] = memRef.current.key === key ? memRef.current.chunks : [];
    if (blobs.length === 0) {
      try {
        blobs = await getChunksForEncounter(key);
        if (blobs[0]?.type) mimeRef.current = blobs[0].type;
      } catch {
        /* intentional: fall through to empty check */
      }
    } else {
      mimeRef.current = blobs[0]?.type || 'audio/webm';
    }
    if (blobs.length === 0) {
      setError('no audio captured');
      setBusy(null);
      return false;
    }

    const blob = new Blob(blobs, { type: mimeRef.current });
    const durationSeconds = startedAtRef.current
      ? Math.round((Date.now() - startedAtRef.current) / 1000)
      : null;

    try {
      const ur = await fetch(`/api/encounters/${encounterId}/sessions/${openSessionSeq}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: mimeRef.current }),
      });
      const uj = (await ur.json()) as { ok: boolean; url?: string; key?: string; error?: string };
      if (!uj.ok || !uj.url || !uj.key) throw new Error(uj.error ?? 'upload_url_failed');

      const put = await fetch(uj.url, {
        method: 'PUT',
        headers: { 'Content-Type': mimeRef.current },
        body: blob,
      });
      if (!put.ok) throw new Error(`r2_put_${put.status}`);

      const fr = await fetch(`/api/encounters/${encounterId}/sessions/${openSessionSeq}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: uj.key, duration_seconds: durationSeconds }),
      });
      const fj = (await fr.json()) as { ok: boolean; error?: string };
      if (!fj.ok) throw new Error(fj.error ?? 'finalize_failed');

      // Audio is durable in R2 — safe to clear local copies.
      await markEncounterSubmitted(key).catch(() => { /* intentional */ });
      await purgeEncounter(key).catch(() => { /* intentional */ });
      memRef.current = { key: null, chunks: [] };
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'upload failed';
      setError(`${msg} — audio kept locally; you can retry`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function fire(action: Action) {
    setBusy(action);
    setError(null);
    try {
      if (action === 'pause_for_workup' || action === 'end_visit') {
        const uploaded = await stopAndUpload();
        if (!uploaded) return; // hold the transition; doctor can retry
        setBusy(action);
      }
      if (await lifecycle(action)) router.refresh();
    } catch {
      setError('network error');
    } finally {
      setBusy(null);
    }
  }

  const btn = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed';
  const recording = rec.state === 'recording';
  const paused = rec.state === 'paused';
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {clinicalStatus === 'in_room' && openSessionSeq != null && (
        <>
          {!recording && !paused ? (
            <button
              onClick={startRecording}
              disabled={busy !== null || rec.state === 'permission_pending' || rec.state === 'finalizing'}
              className={`${btn} flex items-center gap-2 bg-red-600 text-white hover:bg-red-700`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-white" />
              {rec.state === 'permission_pending' ? 'Mic…' : 'Record'}
            </button>
          ) : (
            <span className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${paused ? 'bg-even-ink-400' : 'animate-pulse bg-red-600'}`} />
              {mm}:{ss}
              <button
                onClick={() => (paused ? rec.resume() : rec.pause())}
                className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-even-ink-600 shadow-sm"
              >
                {paused ? 'Resume mic' : 'Mute'}
              </button>
              <span className="font-mono text-[10px] text-red-400">{chunks}ch</span>
            </span>
          )}
        </>
      )}

      {rec.state === 'permission_denied' && (
        <span className="text-xs text-red-600">Mic permission denied — check browser settings</span>
      )}

      {(clinicalStatus === 'ready' || clinicalStatus === 'back_ready') && (
        <button
          onClick={() => fire('enter_room')}
          disabled={busy !== null}
          className={`${btn} bg-even-blue-600 text-white hover:bg-even-blue-700`}
        >
          {busy === 'enter_room' ? 'Starting…' : clinicalStatus === 'back_ready' ? 'Continue encounter' : 'Start visit'}
        </button>
      )}

      {clinicalStatus === 'in_room' && (
        <>
          <button
            onClick={() => fire('pause_for_workup')}
            disabled={busy !== null}
            className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
          >
            {busy === 'uploading' ? 'Uploading…' : busy === 'pause_for_workup' ? 'Pausing…' : 'Pause for workup'}
          </button>
          <button
            onClick={() => fire('end_visit')}
            disabled={busy !== null}
            className={`${btn} bg-even-navy-800 text-white hover:bg-even-navy-700`}
          >
            {busy === 'end_visit' ? 'Ending…' : 'End visit'}
          </button>
        </>
      )}

      {clinicalStatus === 'out_for_workup' && (
        <button
          onClick={() => fire('mark_back_ready')}
          disabled={busy !== null}
          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          {busy === 'mark_back_ready' ? 'Marking…' : 'Results back (demo)'}
        </button>
      )}

      {error ? <span className="max-w-xs text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
