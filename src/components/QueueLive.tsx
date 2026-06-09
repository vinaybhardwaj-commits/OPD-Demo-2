/**
 * <QueueLive channel="queue:global" /> — convenience client wrapper
 * around useQueueLive. Renders nothing; just opens the SSE stream and
 * triggers router.refresh() on every notify.
 *
 * Drop this into a server-rendered page (it's a client component so
 * the hook runs in the browser). Pass the channel name appropriate to
 * the surface:
 *   /reception → 'queue:global'
 *   /triage    → 'queue:global' (or per-room if filtered)
 *   /dashboard → 'queue:user:<doctor_id>' (doctor's own events)
 *   /lab       → 'queue:lab' (future)
 */
'use client';

import { useQueueLive } from '@/lib/useQueueLive';

export function QueueLive({ channel }: { channel: string }) {
  useQueueLive(channel);
  return null;
}
