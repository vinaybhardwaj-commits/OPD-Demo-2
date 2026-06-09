/**
 * Dual-engine transcription comparison.
 *
 * Runs the same audio through:
 *   1. Deepgram nova-3-medical (cloud, existing)   — ./transcribe.ts
 *   2. Whisper large-v3-turbo on the Mac Mini       — ./whisper.ts
 * In parallel. Then asks qwen2.5:14b on the same Mac Mini to judge the
 * two transcripts on a 1-10 quality scale and pick a winner.
 *
 * Returns the full comparison record. Callers persist it to
 * `transcription_comparisons` (migration v36) and decide which
 * transcript to surface as the canonical text for the section.
 *
 * Failure-soft: if one engine errors, the other still runs and is
 * declared the winner (no LLM call needed). If both error, the judge
 * is skipped and the error fields populate.
 */
import { transcribeAudio } from './transcribe';
import { transcribeWithWhisper } from './whisper';
import { qwenJson, QwenError } from './qwen';
import type { ProgressEvent } from './llm-trace/stream';

export type CompareEmit = (ev: ProgressEvent) => void;
const noopEmit: CompareEmit = () => {};

export interface EngineResult {
  transcript: string | null;
  latency_ms: number;
  error: string | null;
  confidence?: number | null;
}

export interface JudgeResult {
  winner: 'deepgram' | 'whisper' | 'tie' | null;
  deepgram_score: number | null;
  whisper_score: number | null;
  delta_score: number | null;
  reasoning: string | null;
  latency_ms: number;
  error: string | null;
}

export interface CompareResult {
  deepgram: EngineResult;
  whisper: EngineResult;
  judge: JudgeResult;
  total_elapsed_ms: number;
  // The chosen transcript to surface in the UI. Always one of the
  // non-empty transcripts; falls back to whichever exists if judge
  // is unavailable.
  winning_transcript: string | null;
}

const JUDGE_SYSTEM = `You are an expert medical transcription quality reviewer for an Indian OPD context (English with frequent Hindi/Kannada code-switching, Indian drug brand names, Indian medical conventions).

You are given two transcripts of the SAME audio clip from a doctor-patient encounter. Score each on 1-10 based on:
- Medical terminology accuracy (drug names, anatomy, diagnoses, procedures, dosages)
- Coherence and readability of the English text
- Capturing every spoken phrase (no dropouts or hallucinations)
- Code-switching handling (Hindi/Kannada words preserved correctly)
- Indian-accent robustness

Output STRICT JSON only — no markdown, no prose around it. All keys present, double-quoted strings, in this exact shape:
{"deepgram_score": <number 1-10>, "whisper_score": <number 1-10>, "winner": "deepgram"|"whisper"|"tie", "reasoning": "<one or two sentences highlighting what each got right or wrong>"}`;

function buildJudgeUserMessage(
  deepgramText: string,
  whisperText: string,
  context?: string,
): string {
  const ctx = context ? `Encounter context: ${context}\n\n` : '';
  return `${ctx}Transcript A — Deepgram nova-3-medical:
"""
${deepgramText}
"""

Transcript B — Whisper large-v3-turbo:
"""
${whisperText}
"""

Output JSON only.`;
}

export async function runTranscriptionCompare(
  audio: Buffer | Uint8Array,
  contentType: string,
  opts: { context?: string; emit?: CompareEmit; signal?: AbortSignal } = {},
): Promise<CompareResult> {
  const t0 = Date.now();
  const emit = opts.emit ?? noopEmit;

  // v6.0 Phase 2B — emit at both engine starts. Promise.all fires them
  // in parallel; the events arrive interleaved by completion order.
  emit({ type: 'progress', stage: 'transcribing' as any, msg: 'Sending audio to Deepgram nova-3-medical' });
  emit({ type: 'progress', stage: 'transcribing' as any, msg: 'Sending audio to Mac Mini Whisper large-v3-turbo (parallel)' });

  // 1. Fire both engines in parallel. Wrap each so we can emit when
  //    each individually completes (Promise.all blocks on the slowest;
  //    we want the doctor to see Deepgram return first).
  const dgP = transcribeAudio(audio, contentType).then((r) => {
    if (r.ok) {
      emit({ type: 'progress', stage: 'expanding' as any, msg: `Deepgram returned in ${(r.latency_ms / 1000).toFixed(1)}s` });
    } else {
      emit({ type: 'progress', stage: 'expanding' as any, msg: `Deepgram failed: ${String(r.error).slice(0, 80)}` });
    }
    return r;
  });
  const wP = transcribeWithWhisper(audio, contentType).then((r) => {
    if (r.ok) {
      emit({ type: 'progress', stage: 'retrieving' as any, msg: `Whisper returned in ${(r.latency_ms / 1000).toFixed(1)}s` });
    } else {
      emit({ type: 'progress', stage: 'retrieving' as any, msg: `Whisper failed: ${String(r.error).slice(0, 80)}` });
    }
    return r;
  });
  const [dgRaw, wRaw] = await Promise.all([dgP, wP]);

  const deepgram: EngineResult = dgRaw.ok
    ? {
        transcript: dgRaw.transcript,
        latency_ms: dgRaw.latency_ms,
        error: null,
        confidence: dgRaw.confidence,
      }
    : {
        transcript: null,
        latency_ms: 0,
        error: dgRaw.error,
        confidence: null,
      };

  const whisper: EngineResult = wRaw.ok
    ? {
        transcript: wRaw.transcript,
        latency_ms: wRaw.latency_ms,
        error: null,
      }
    : {
        transcript: null,
        latency_ms: wRaw.latency_ms,
        error: wRaw.error,
      };

  // 2. Decide if we need to call the judge.
  const dgOk = !!deepgram.transcript;
  const wOk = !!whisper.transcript;

  // Both failed — return early with no judge call.
  if (!dgOk && !wOk) {
    return {
      deepgram,
      whisper,
      judge: {
        winner: null,
        deepgram_score: null,
        whisper_score: null,
        delta_score: null,
        reasoning: null,
        latency_ms: 0,
        error: 'both_transcripts_missing',
      },
      total_elapsed_ms: Date.now() - t0,
      winning_transcript: null,
    };
  }

  // Only one succeeded — declare that engine the winner without LLM call.
  if (!dgOk || !wOk) {
    const winner: 'deepgram' | 'whisper' = dgOk ? 'deepgram' : 'whisper';
    return {
      deepgram,
      whisper,
      judge: {
        winner,
        deepgram_score: dgOk ? 10 : 0,
        whisper_score: wOk ? 10 : 0,
        delta_score: 10,
        reasoning: `${winner === 'deepgram' ? 'Whisper' : 'Deepgram'} failed to produce a transcript; the other engine wins by default.`,
        latency_ms: 0,
        error: null,
      },
      total_elapsed_ms: Date.now() - t0,
      winning_transcript: dgOk ? deepgram.transcript : whisper.transcript,
    };
  }

  // 3. Both succeeded — ask qwen2.5:14b to judge.
  emit({ type: 'progress', stage: 'drafting' as any, msg: 'qwen scoring both transcripts (1-10) and picking a winner' });
  let judge: JudgeResult;
  try {
    const result = await qwenJson<{
      deepgram_score: number;
      whisper_score: number;
      winner: 'deepgram' | 'whisper' | 'tie';
      reasoning: string;
    }>(
      JUDGE_SYSTEM,
      buildJudgeUserMessage(deepgram.transcript!, whisper.transcript!, opts.context),
      { temperature: 0, timeoutMs: 30_000 },
    );
    const j = result.json;
    const dgs =
      typeof j.deepgram_score === 'number'
        ? Math.max(0, Math.min(10, j.deepgram_score))
        : null;
    const ws =
      typeof j.whisper_score === 'number'
        ? Math.max(0, Math.min(10, j.whisper_score))
        : null;
    const delta = dgs !== null && ws !== null ? Math.abs(ws - dgs) : null;
    const winner =
      j.winner === 'deepgram' || j.winner === 'whisper' || j.winner === 'tie'
        ? j.winner
        : null;
    judge = {
      winner,
      deepgram_score: dgs,
      whisper_score: ws,
      delta_score: delta,
      reasoning: j.reasoning ?? null,
      latency_ms: result.latency_ms,
      error: null,
    };
  } catch (e: unknown) {
    const msg =
      e instanceof QwenError
        ? `${e.kind}: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    judge = {
      winner: null,
      deepgram_score: null,
      whisper_score: null,
      delta_score: null,
      reasoning: null,
      latency_ms: 0,
      error: msg.slice(0, 300),
    };
  }

  // 4. Pick winning transcript for surfacing.
  let winning: string | null;
  if (judge.winner === 'deepgram') winning = deepgram.transcript;
  else if (judge.winner === 'whisper') winning = whisper.transcript;
  else if (judge.winner === 'tie') {
    // Tie — prefer Deepgram for now (it's the medically-tuned model).
    // Could be configurable.
    winning = deepgram.transcript;
  } else {
    // Judge failed — fall back to Deepgram if available, else Whisper.
    winning = deepgram.transcript ?? whisper.transcript;
  }

  return {
    deepgram,
    whisper,
    judge,
    total_elapsed_ms: Date.now() - t0,
    winning_transcript: winning,
  };
}
