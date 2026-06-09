/**
 * Tiny pg_notify wrapper for v2.0.6 SSE producers.
 *
 * Channel naming convention:
 *   queue:global           — everything (catch-all, used by /reception,
 *                            /triage, /admin)
 *   queue:room:<room_id>   — events scoped to a single OPD room
 *   queue:user:<user_id>   — targeted at a specific doctor/nurse/CCE
 *
 * Payload is short — the listener just calls router.refresh() to
 * re-fetch the server-rendered queue, so we don't need rich data.
 *
 * Never throws — notify failures shouldn't break the primary write
 * path. Worst case the doctor's screen lags until the next polling
 * tick (30s).
 */
import { pool } from '@/lib/db';

export async function notifyQueue(
  channels: string | string[],
  payload?: string,
): Promise<void> {
  const list = Array.isArray(channels) ? channels : [channels];
  for (const ch of list) {
    if (!ch || !/^[A-Za-z0-9_:-]{1,128}$/.test(ch)) continue;
    try {
      // pg_notify(channel, payload) — uses the HTTP-pooled client which
      // is fine for one-shot calls.
      await pool.query('SELECT pg_notify($1, $2)', [ch, payload ?? '']);
    } catch {
      /* swallow */
    }
  }
}

/**
 * Convenience: notify both global + per-room. Most state changes touch
 * one room's queue; sending to global too lets multi-room watchers
 * (e.g. /reception) refresh without subscribing per-room.
 */
export async function notifyRoom(
  roomId: string | null | undefined,
  payload?: string,
): Promise<void> {
  const channels = ['queue:global'];
  if (roomId) channels.push(`queue:room:${roomId}`);
  await notifyQueue(channels, payload);
}
