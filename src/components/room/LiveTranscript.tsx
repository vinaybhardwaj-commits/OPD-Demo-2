'use client';

/**
 * LiveTranscript — the Room's center rail. P1.3 Deepgram · P1.4 all-parallel.
 *
 * Locked decisions:
 *   P1.3 (10 Jun): HYBRID rail (rolling text within an utterance block, new
 *     block on Deepgram speech_final) · interims shown muted-italic.
 *   P1.4 (10 Jun): ALL-PARALLEL like ETA — every engine runs on every
 *     recording; the selector only switches which TRACE is displayed ·
 *     NO mid-session switching (selector disabled while a session is live) ·
 *     per-utterance LLM cleanup ported (Deepgram finals, llama3.1:8b,
 *     soft-fail to raw).
 *
 * Engines (all fed from the RoomCapture bus / mic stream):
 *   deepgram — WS, en-IN medical, hybrid blocks (P1.3)
 *   sarvam   — REST rolling refine+commit, codemix, ~2s tail refresh
 *   relay    — Sarvam streaming WS via Mac Mini relay, sub-second; iOS and
 *              (flag-gated) desktop-Safari skip the worklet (B18 lesson)
 */
import * as React from 'react';
import { useDeepgramLive, type LiveUtterance } from '@/lib/use-deepgram-live';
import { useSarvamRolling } from '@/lib/use-sarvam-rolling';
import { useSarvamStreaming } from '@/lib/use-sarvam-streaming';
import { useUtteranceCleanup } from '@/lib/use-utterance-cleanup';
import { useSpeakerIdentify } from '@/lib/use-speaker-identify';
import { useRoomCapture } from '@/components/room/RoomCapture';
import { detectIOS, detectDesktopSafari } from '@/lib/platform';

type Engine = 'deepgram' | 'sarvam' | 'relay';

type Seg = { uid: string; text: string };
type Block = { id: number; segs: Seg[] };

type Props = {
  encounterId: string;
  /** P1.6/P2.2: signed-in doctor's voiceprint enrollment state (drives the live speaker-ID pill). */
  speakerEnrolled?: boolean;
};

const SAFARI_STREAMING_GUARD = process.env.NEXT_PUBLIC_OPD2_SAFARI_STREAMING_GUARD === '1';

const CHIP: Record<string, { label: string; cls: string }> = {
  idle: { label: 'idle', cls: 'bg-even-ink-100 text-even-ink-500' },
  connecting: { label: 'connecting…', cls: 'bg-amber-100 text-amber-800' },
  open: { label: 'live', cls: 'bg-emerald-100 text-emerald-800' },
  live: { label: 'live', cls: 'bg-emerald-100 text-emerald-800' },
  listening: { label: 'listening', cls: 'bg-emerald-100 text-emerald-800' },
  running: { label: 'live', cls: 'bg-emerald-100 text-emerald-800' },
  in_flight: { label: 'live', cls: 'bg-emerald-100 text-emerald-800' },
  closed: { label: 'closed', cls: 'bg-even-ink-100 text-even-ink-500' },
  stopped: { label: 'stopped', cls: 'bg-even-ink-100 text-even-ink-500' },
  error: { label: 'error', cls: 'bg-red-100 text-red-700' },
  unavailable: { label: 'unavailable here', cls: 'bg-even-ink-100 text-even-ink-400' },
};

export function LiveTranscript({ encounterId, speakerEnrolled }: Props) {
  const capture = useRoomCapture();
  const recording = capture?.recording ?? false;
  const stream = capture?.stream ?? null;

  // Which trace is DISPLAYED (all engines run regardless). Locked while a
  // session is live (no mid-session switching).
  const [engine, setEngine] = React.useState<Engine>('deepgram');

  // ---- Deepgram trace: hybrid blocks of cleanable segments -----------------
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [openSegs, setOpenSegs] = React.useState<Seg[]>([]);
  const [interim, setInterim] = React.useState('');
  const blockIdRef = React.useRef(0);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Per-utterance LLM cleanup (llama3.1:8b) — cleaned text silently replaces
  // raw as it arrives; soft-fail keeps raw.
  const cleanup = useUtteranceCleanup({ enabled: true, concurrency: 2 });
  const enqueueCleanup = cleanup.enqueue;

  const onFinal = React.useCallback(
    (u: LiveUtterance) => {
      setInterim('');
      enqueueCleanup(u.id, u.text);
      setOpenSegs((prev) => {
        const next = [...prev, { uid: u.id, text: u.text }];
        if (u.speech_final) {
          blockIdRef.current += 1;
          const id = blockIdRef.current;
          setBlocks((bs) => [...bs, { id, segs: next }]);
          return [];
        }
        return next;
      });
    },
    [enqueueCleanup],
  );

  const onInterim = React.useCallback((u: LiveUtterance) => {
    setInterim(u.text);
  }, []);

  const dg = useDeepgramLive({ enabled: recording, encounterId, onFinal, onInterim });

  // ---- Sarvam rolling trace (REST refine+commit, codemix) ------------------
  const svRoll = useSarvamRolling({ enabled: recording, encounterId, intervalMs: 2_000 });

  // ---- Sarvam streaming trace (relay WS) -----------------------------------
  // iOS: the worklet starves MediaRecorder (no_audio_chunks); desktop Safari
  // shares the dual-consumer risk behind a flag. Resolved post-mount so SSR
  // and hydration stay consistent.
  const RELAY_URL = process.env.NEXT_PUBLIC_STT_RELAY_URL || null;
  const [blockStreaming, setBlockStreaming] = React.useState(false);
  React.useEffect(() => {
    setBlockStreaming(detectIOS() || (SAFARI_STREAMING_GUARD && detectDesktopSafari()));
  }, []);
  const streamingAvailable = !!RELAY_URL && !blockStreaming;
  const svStream = useSarvamStreaming({
    enabled: recording && streamingAvailable,
    stream,
    relayUrl: RELAY_URL,
  });

  // ---- P2.2 live speaker ID — the pill goes real ---------------------------
  // Every 8s a recent audio window is embedded (Mac Mini /enroll) and cosine-
  // compared to the doctor's voice_print centroid. Only runs when enrolled.
  const spk = useSpeakerIdentify({ enabled: recording && speakerEnrolled === true });

  // Pipe recorder chunks to the chunk-fed engines (relay taps the raw stream).
  const dgSend = dg.sendChunk;
  const svSend = svRoll.sendChunk;
  const spkSend = spk.sendChunk;
  React.useEffect(() => {
    if (!capture) return;
    return capture.subscribe((chunk: Blob) => {
      dgSend(chunk);
      svSend(chunk);
      spkSend(chunk);
    });
  }, [capture, dgSend, svSend, spkSend]);

  // Auto-scroll the displayed trace.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [engine, blocks, openSegs, interim, svRoll.text, svStream.text]);

  const segText = (s: Seg) => cleanup.cleanedById[s.uid] ?? s.text;
  const blockText = (b: Block) => b.segs.map(segText).join(' ');
  const openText = openSegs.map(segText).join(' ');

  const states: Record<Engine, string> = {
    deepgram: dg.state,
    sarvam: svRoll.state,
    relay: streamingAvailable ? svStream.state : 'unavailable',
  };
  const errors: Record<Engine, string | null> = {
    deepgram: dg.state === 'error' ? dg.error : null,
    sarvam: svRoll.state === 'error' ? svRoll.error : null,
    relay: streamingAvailable && svStream.state === 'error' ? svStream.error : null,
  };
  const chip = CHIP[states[engine]] ?? CHIP.idle;
  const language = engine === 'sarvam' ? svRoll.language : engine === 'relay' ? svStream.language : null;

  // P2.1: publish the detected language so RoomControls can pass it to the
  // background pipeline at pause/end (relay's lock wins over rolling).
  const detected = svStream.language ?? svRoll.language ?? null;
  React.useEffect(() => {
    if (capture) capture.languageRef.current = detected;
  }, [capture, detected]);

  const dgEmpty = blocks.length === 0 && !openText && !interim;
  const tabBase = 'rounded-md px-2 py-0.5 transition-colors';

  return (
    <section className="flex max-h-[75vh] flex-col rounded-xl border border-even-ink-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-even-ink-600">
          Live transcript
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.cls}`}>
          {chip.label}
        </span>
        {language ? (
          <span className="rounded-full bg-even-blue-50 px-2 py-0.5 font-mono text-[10px] text-even-blue-700">
            {language}
          </span>
        ) : null}
        {/* P2.2 speaker pill — REAL: live windows vs the doctor's voiceprint */}
        {speakerEnrolled === true ? (
          recording ? (
            spk.current ? (
              spk.current.isClinician ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800" title={`Live voice match ${(spk.current.confidence * 100).toFixed(0)}% (best ${spk.confidence != null ? (spk.confidence * 100).toFixed(0) + '%' : '—'})`}>
                  🎙 {spk.name ?? 'You'} ✓ {(spk.current.confidence * 100).toFixed(0)}%
                </span>
              ) : (
                <span className="rounded-full bg-even-blue-50 px-2 py-0.5 text-[10px] text-even-blue-700" title={spk.identified ? 'Another voice has the floor — you were identified earlier in this session' : 'Current window doesn\u2019t match your voiceprint'}>
                  🎙 other voice{spk.identified ? ' · you ✓' : ''}
                </span>
              )
            ) : (
              <span className="rounded-full bg-even-ink-50 px-2 py-0.5 text-[10px] text-even-ink-500" title="Listening for your voice (first window ~8s)">
                🎙 identifying…
              </span>
            )
          ) : (
            <span className="rounded-full bg-even-ink-50 px-2 py-0.5 text-[10px] text-even-ink-500" title="Voiceprint enrolled — live speaker ID runs while recording; processed notes name you">
              🎙 voiceprint ✓
            </span>
          )
        ) : speakerEnrolled === false ? (
          <a href="/enroll/voice" className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 hover:underline" title="Doctor not enrolled — recordings still process, but speakers stay unlabeled (Speaker 1/2). Enroll to be named.">
            🎙 not enrolled — speakers unlabeled · set up
          </a>
        ) : null}
        {/* Display selector — all engines run in parallel; this only switches
            the visible trace. Locked while a session is live. */}
        <div
          className={`ml-auto flex items-center gap-1 rounded-lg bg-even-ink-50 p-0.5 text-[10px] ${recording ? 'opacity-70' : ''}`}
          title={recording ? 'Engine view locked while recording' : 'Switch displayed engine'}
        >
          {(['deepgram', 'sarvam', 'relay'] as Engine[]).map((e) => (
            <button
              key={e}
              onClick={() => setEngine(e)}
              disabled={recording}
              className={`${tabBase} ${
                engine === e
                  ? 'bg-white font-semibold text-even-navy-800 shadow-sm'
                  : 'text-even-ink-400 hover:text-even-ink-600'
              } ${recording ? 'cursor-not-allowed' : ''}`}
            >
              {e === 'deepgram' ? 'Deepgram' : e === 'sarvam' ? 'Sarvam' : 'Relay'}
            </button>
          ))}
        </div>
      </div>

      {errors[engine] ? (
        <p className="mt-2 text-xs text-red-600">
          {engine === 'relay'
            ? `Relay stream unavailable (${errors[engine]}) — the Sarvam trace keeps running in parallel.`
            : `Live transcription unavailable (${errors[engine]}) — recording is unaffected; the full audio still uploads on Pause/End.`}
        </p>
      ) : null}
      {engine === 'relay' && !streamingAvailable ? (
        <p className="mt-2 text-xs text-even-ink-400">
          {RELAY_URL
            ? 'Streaming is skipped on this device (worklet vs MediaRecorder mic contention) — see the Sarvam trace.'
            : 'No relay configured (NEXT_PUBLIC_STT_RELAY_URL) — see the Sarvam trace.'}
        </p>
      ) : null}

      <div ref={scrollRef} className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
        {engine === 'deepgram' ? (
          dgEmpty ? (
            <Empty recording={recording} />
          ) : (
            <>
              {blocks.map((b) => (
                <p
                  key={b.id}
                  className="rounded-lg bg-even-ink-50/60 px-2.5 py-1.5 text-sm leading-relaxed text-even-ink-800"
                >
                  {blockText(b)}
                </p>
              ))}
              {openText || interim ? (
                <p className="rounded-lg border border-dashed border-even-ink-200 px-2.5 py-1.5 text-sm leading-relaxed text-even-ink-800">
                  {openText}
                  {interim ? (
                    <span className="italic text-even-ink-400">
                      {openText ? ' ' : ''}
                      {interim}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </>
          )
        ) : engine === 'sarvam' ? (
          svRoll.text ? (
            <p className="whitespace-pre-wrap rounded-lg bg-even-ink-50/60 px-2.5 py-1.5 text-sm leading-relaxed text-even-ink-800">
              {svRoll.text}
            </p>
          ) : (
            <Empty recording={recording} />
          )
        ) : svStream.text ? (
          <p className="whitespace-pre-wrap rounded-lg bg-even-ink-50/60 px-2.5 py-1.5 text-sm leading-relaxed text-even-ink-800">
            {svStream.text}
          </p>
        ) : (
          <Empty recording={recording} />
        )}
      </div>
    </section>
  );
}

function Empty({ recording }: { recording: boolean }) {
  return (
    <p className="text-xs text-even-ink-400">
      {recording
        ? 'Listening…'
        : 'Start recording to see the live transcript. All engines run in parallel — switch the view above between sessions. Speaker-tagged transcripts appear in Sessions after processing.'}
    </p>
  );
}
