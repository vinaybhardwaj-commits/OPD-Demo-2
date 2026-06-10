/**
 * Pure helpers for bounding the Sarvam live-transcription window under Vercel's
 * serverless function payload cap. Extracted from useSarvamRolling so the
 * byte-cap (the B22 http_413 fix) is unit-testable without rendering the hook.
 */

// Vercel serverless functions reject request bodies over ~4.5MB
// (FUNCTION_PAYLOAD_TOO_LARGE → http_413). Keep the live window well under that:
// sustained silence/empty tails or iOS Safari emitting large ~1s chunks (instead
// of 250ms) can otherwise grow the uncommitted span past the cap, and because
// the watermark never advanced, every later tick re-sends an even bigger window
// and the live transcript wedges permanently.
export const MAX_WINDOW_BYTES = 3_500_000;

/**
 * Choose the earliest chunk to include in the live window so that the request
 * stays under `maxBytes`. Walks back from the newest chunk, keeping only what
 * fits the budget, and returns the absolute index of the oldest included chunk
 * (>= `start`). Always keeps at least the newest chunk, even if it alone exceeds
 * the budget (degenerate single-huge-chunk case — nothing better to do).
 *
 * @param chunkSizes byte size of each chunk currently buffered, in order
 * @param start      watermark: absolute index where the uncommitted span begins
 * @param base       absolute index of chunkSizes[0] (front-trim offset)
 * @param headerSize bytes of the webm init segment prepended when start > 0 (else 0)
 * @param maxBytes   budget (default MAX_WINDOW_BYTES)
 * @returns effStart — absolute index of the oldest chunk to send (>= start)
 */
export function boundedWindowStart(
  chunkSizes: number[],
  start: number,
  base: number,
  headerSize: number,
  maxBytes: number = MAX_WINDOW_BYTES,
): number {
  const end = base + chunkSizes.length;
  let acc = headerSize;
  let i = end; // exclusive; first iteration always keeps the newest chunk
  for (; i > start; i--) {
    const sz = chunkSizes[i - 1 - base] ?? 0;
    if (i < end && acc + sz > maxBytes) break;
    acc += sz;
  }
  return i;
}
