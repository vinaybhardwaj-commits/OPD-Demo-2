'use client';

/**
 * LiveTranscript — the Room's center rail, P1.3 (Deepgram live).
 *
 * Locked decisions (10 Jun 2026):
 *   - HYBRID rail UX: rolling text within an utterance block; a NEW block
 *     starts on a speech pause (Deepgram speech_final). Blocks are the
 *     future anchor for speaker pills (P1.6 voiceprints / P2 diarize).
 *   - Interims SHOWN, styled lighter (muted italic tail, replaced on final).
 *   - Deepgram-only for P1.3; engine selector SHELL visible with Sarvam +
 *     relay greyed out — P1.4 wires them in.
 *
 * Audio comes off the RoomCapture bus (RoomControls owns the recorder).
 * The WS opens when a capture session starts and closes when it ends;
 * it stays open across Mute (KeepAlive in the hook covers idle).
 */
import * as React from 'react';
import { useDeepgramLive, type LiveUtterance } from '@/lib/use-deepgram-live';
import { useRoomCapture } from '@/components/room/RoomCapture';

type Block = {
  id: number;
  text: string;
};

type Props = {
  encounterId: string;
};

const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  idle: { label: 'idle', cls: 'bg-even-ink-100 text-even-ink-500' },
  connecting: { label: 'connecting…', cls: 'bg-amber-100 text-amber-800' },
  open: { label: 'live', cls: 'bg-emerald-100 text-emerald-800' },
  closed: { label: 'closed', cls: 'bg-even-ink-100 text-even-ink-500' },
  error: { label: 'error', cls: 'bg-red-100 text-red-700' },
};

export function LiveTranscript({ encounterId }: Props) {
  const capture = useRoomCapture();
  const recording = capture?.recording ?? false;

  // Closed blocks + the open block's finalized text + the interim tail.
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [openText, setOpenText] = React.useState('');
  const [interim, setInterim] = React.useState('');
  const blockIdRef = React.useRef(0);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const onFinal = React.useCallback((u: LiveUtterance) => {
    setInterim('');
    setOpenText((prev) => {
      const joined = prev ? `${prev} ${u.text}` : u.text;
      if (u.speech_final) {
        // Close the block on the speech pause — hybrid rail UX.
        blockIdRef.current += 1;
        const id = blockIdRef.current;
        setBlocks((bs) => [...bs, { id, text: joined }]);
        return '';
      }
      return joined;
    });
  }, []);

  const onInterim = React.useCallback((u: LiveUtterance) => {
    setInterim(u.text);
  }, []);

  const dg = useDeepgramLive({
    enabled: recording,
    encounterId,
    onFinal,
    onInterim,
  });

  // Pipe recorder chunks into the WS.
  const sendChunk = dg.sendChunk;
  React.useEffect(() => {
    if (!capture) return;
    return capture.subscribe(sendChunk);
  }, [capture, sendChunk]);

  // Auto-scroll to the tail as text arrives.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks, openText, interim]);

  const chip = STATE_CHIP[dg.state] ?? STATE_CHIP.idle;
  const empty = blocks.length === 0 && !openText && !interim;

  return (
    <section className="flex max-h-[75vh] flex-col rounded-xl border border-even-ink-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-even-ink-600">
          Live transcript
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.cls}`}>
          {chip.label}
        </span>
        {/* Engine selector shell — Deepgram live now; Sarvam + relay land in P1.4 */}
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-even-ink-50 p-0.5 text-[10px]">
          <span className="rounded-md bg-white px-2 py-0.5 font-semibold text-even-navy-800 shadow-sm">
            Deepgram
          </span>
          <span className="cursor-not-allowed px-2 py-0.5 text-even-ink-300" title="P1.4">
            Sarvam
          </span>
          <span className="cursor-not-allowed px-2 py-0.5 text-even-ink-300" title="P1.4">
            Relay
          </span>
        </div>
      </div>

      {dg.state === 'error' && dg.error ? (
        <p className="mt-2 text-xs text-red-600">
          Live transcription unavailable ({dg.error}) — recording is unaffected; the full audio
          still uploads on Pause/End.
        </p>
      ) : null}

      <div ref={scrollRef} className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
        {empty ? (
          <p className="text-xs text-even-ink-400">
            {recording
              ? 'Listening…'
              : 'Start recording to see the live transcript. Speaker labels arrive with voiceprints (P1.6).'}
          </p>
        ) : (
          <>
            {blocks.map((b) => (
              <p key={b.id} className="rounded-lg bg-even-ink-50/60 px-2.5 py-1.5 text-sm leading-relaxed text-even-ink-800">
                {b.text}
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
        )}
      </div>
    </section>
  );
}
