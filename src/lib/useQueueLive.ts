/**
 * useQueueLive(channel) — sub-second cross-screen sync.
 *
 * Opens an EventSource to /api/queue/stream?channel=<channel> and calls
 * router.refresh() on every notification. The Server Component above
 * re-renders fresh data with the same render tree, so the user just
 * sees the UI update — no flash, no re-mount.
 *
 * Failure modes:
 *   - EventSource auto-reconnects on transport drops; we don't
 *     intervene.
 *   - If the connection is in error state for >30s, the hook falls
 *     back to interval polling via router.refresh() every 30s so the
 *     UI stays accurate.
 *
 * Use as:
 *   useQueueLive(`queue:room:${roomId}`)
 * inside any client component that needs to react to queue changes.
 * The page wrapper / layout typically mounts a 1-line <QueueLive />
 * helper component.
 */
'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export function useQueueLive(channel: string | null) {
  const router = useRouter();
  const fallbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEventRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!channel) return;
    let es: EventSource | null = null;
    let closed = false;

    function startPollingFallback() {
      if (fallbackTimer.current) return;
      fallbackTimer.current = setInterval(() => {
        // Only refresh if we haven't seen a real event recently.
        if (Date.now() - lastEventRef.current > 25_000) {
          router.refresh();
        }
      }, 30_000);
    }

    try {
      es = new EventSource(`/api/queue/stream?channel=${encodeURIComponent(channel)}`);

      es.addEventListener('notify', () => {
        lastEventRef.current = Date.now();
        router.refresh();
      });
      es.addEventListener('hello', () => {
        lastEventRef.current = Date.now();
      });

      es.onerror = () => {
        // The browser auto-retries EventSource; we just make sure
        // the polling fallback is running in the meantime.
        startPollingFallback();
      };
    } catch {
      startPollingFallback();
    }

    return () => {
      closed = true;
      if (es) es.close();
      if (fallbackTimer.current) {
        clearInterval(fallbackTimer.current);
        fallbackTimer.current = null;
      }
      void closed; // satisfy strict
    };
  }, [channel, router]);
}
