/**
 * src/lib/llm-trace/heartbeat.ts
 *
 * Wraps a long-running async operation (typically a qwen call) with a
 * periodic "still working" heartbeat emit. Without this, the TracePanel
 * shows the start event, then dead air for 20-50s while qwen grinds,
 * then a single end event. With this, the client sees a ticking line
 * every 5s and pushTrace collapses consecutive heartbeats into one
 * live counter — so the event list reads "Drafting (12s on this phase)"
 * and updates in place.
 *
 * Port note: the message shape `<stage> (Ns on this phase)` is matched
 * by a regex in ndjson-client.ts's pushTrace to identify heartbeats.
 * Don't change the format.
 */

import type { ProgressEvent, Stage } from './stream';

export type Emit = (ev: ProgressEvent) => void;

/**
 * Runs `fn()` and, while it's pending, emits a progress event every
 * `intervalMs` containing the elapsed time on this phase.
 *
 * The emitted event has the shape:
 *   { type: 'progress', stage, msg: `${label} (Ns on this phase)` }
 *
 * Always clears the interval in a finally block. Never throws on its
 * own — surfaces whatever `fn()` throws.
 */
export async function withHeartbeat<T>(
  emit: Emit,
  stage: Stage,
  label: string,
  fn: () => Promise<T>,
  opts: { intervalMs?: number } = {},
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 5_000;
  const startedAt = Date.now();
  const tick = () => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    emit({
      type: 'progress',
      stage,
      msg: `${label} (${seconds}s on this phase)`,
    });
  };
  const handle = setInterval(tick, intervalMs);
  try {
    return await fn();
  } finally {
    clearInterval(handle);
  }
}
