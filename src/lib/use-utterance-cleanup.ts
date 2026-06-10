"use client";

import * as React from "react";

/**
 * Per-utterance cleanup queue.
 *
 * Caller enqueues final utterances with a stable id; we POST them to
 * /transcribe/cleanup with bounded concurrency, then expose the
 * resulting cleaned text via the cleanedById map. The UI reads
 * cleanedById[id] ?? rawText so cleaned versions silently replace raw
 * ones as they arrive (no flicker — the cleaned string is usually
 * within a few characters of the raw).
 *
 * Concurrency cap protects the Mac Mini llama3.1:8b from queueing too
 * deeply during a fast-talking phase.
 */

type QueueItem = { id: string; raw: string };

type Options = {
  enabled: boolean;
  concurrency?: number;
};

export function useUtteranceCleanup(opts: Options) {
  const concurrency = opts.concurrency ?? 2;
  const [cleanedById, setCleanedById] = React.useState<Record<string, string>>(
    {},
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const queueRef = React.useRef<QueueItem[]>([]);
  const inFlightRef = React.useRef(0);
  const optsRef = React.useRef(opts);
  React.useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const pump = React.useCallback(async () => {
    while (
      optsRef.current.enabled &&
      inFlightRef.current < concurrency &&
      queueRef.current.length > 0
    ) {
      const item = queueRef.current.shift();
      if (!item) break;
      inFlightRef.current += 1;
      (async () => {
        try {
          const res = await fetch(
            "/api/transcribe/cleanup",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ utterance_id: item.id, raw: item.raw }),
              cache: "no-store",
            },
          );
          if (!res.ok) {
            setErrors((prev) => ({ ...prev, [item.id]: `http_${res.status}` }));
            return;
          }
          const json = (await res.json()) as {
            cleaned?: string;
            fallback?: boolean;
            error?: string;
          };
          // Always set cleaned text — fallback returns raw; either way we
          // overwrite raw with the canonical "what to display" version.
          const text = (json.cleaned ?? item.raw).trim();
          if (text.length > 0) {
            setCleanedById((prev) => ({ ...prev, [item.id]: text }));
          }
          if (json.fallback && json.error) {
            setErrors((prev) => ({ ...prev, [item.id]: json.error! }));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setErrors((prev) => ({ ...prev, [item.id]: msg.slice(0, 120) }));
        } finally {
          inFlightRef.current -= 1;
          void pump();
        }
      })();
    }
  }, [concurrency]);

  const enqueue = React.useCallback(
    (id: string, raw: string) => {
      if (!optsRef.current.enabled) return;
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      queueRef.current.push({ id, raw: trimmed });
      void pump();
    },
    [pump],
  );

  return { cleanedById, errors, enqueue };
}
