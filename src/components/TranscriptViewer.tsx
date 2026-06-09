'use client';

/**
 * <TranscriptViewer /> — collapsible panel below the encounter showing
 * the ambient-recording snippet list with transcripts.
 *
 * Refreshable: the AmbientRecorder calls onSnippetSaved → parent calls
 * refresh() here. Re-fetches /api/encounters/[id]/recordings.
 *
 * Sprint 6 will add a "diagnostics break" marker between snippets so the
 * timeline is legible when an encounter spans paused_diagnostics →
 * ready_to_resume.
 */
import { useCallback, useEffect, useImperativeHandle, useState, forwardRef } from 'react';

type Snippet = {
  id: string;
  snippet_index: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript_status: 'pending' | 'complete' | 'failed';
  transcript_text: string | null;
  chunk_count: number;
};

export type TranscriptViewerHandle = {
  refresh: () => Promise<void>;
};

export const TranscriptViewer = forwardRef<TranscriptViewerHandle, {
  encounterId: string;
  initialSnippets?: Snippet[];
}>(function TranscriptViewer({ encounterId, initialSnippets = [] }, ref) {
  const [snippets, setSnippets] = useState<Snippet[]>(initialSnippets);
  const [open, setOpen] = useState<boolean>(initialSnippets.length > 0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/recordings`);
      const j = (await res.json()) as { ok?: boolean; recordings?: Snippet[] };
      if (j.ok && j.recordings) {
        setSnippets(j.recordings);
        if (j.recordings.length > 0) setOpen(true);
      }
    } finally {
      setLoading(false);
    }
  }, [encounterId]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  // Pull once on mount so refresh stays in lockstep if the initial
  // prop was stale (e.g., another tab recorded a snippet).
  useEffect(() => {
    if (initialSnippets.length === 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (snippets.length === 0 && !loading) {
    return null;
  }

  const total = snippets.reduce((s, x) => s + (x.duration_seconds ?? 0), 0);

  return (
    <div className="rounded-xl border border-even-ink-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            Ambient transcript
          </span>
          <span className="rounded-full bg-even-ink-100 px-2 py-0.5 text-[10px] font-semibold text-even-ink-700">
            {snippets.length} snippet{snippets.length === 1 ? '' : 's'}
            {total > 0 && ` · ${fmtTotal(total)}`}
          </span>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-even-ink-400">
          {open ? 'hide' : 'show'}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-even-ink-100 px-4 py-4">
          {snippets.map((s) => (
            <article key={s.id} className="rounded-lg bg-even-ink-50/40 p-3">
              <header className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-even-navy">
                    Snippet {s.snippet_index + 1}
                  </span>
                  <span className="text-[11px] text-even-ink-500">
                    {fmtTotal(s.duration_seconds ?? 0)}
                  </span>
                </div>
                <StatusChip status={s.transcript_status} />
              </header>
              {s.transcript_status === 'pending' && (
                <p className="mt-2 text-xs italic text-even-ink-500">Transcribing…</p>
              )}
              {s.transcript_status === 'failed' && (
                <p className="mt-2 text-xs text-even-pink-700">
                  Transcription failed. Audio saved; you can re-trigger Sprint 8 retry.
                </p>
              )}
              {s.transcript_status === 'complete' && s.transcript_text && (
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-even-ink-700">
                  {s.transcript_text}
                </p>
              )}
              {s.transcript_status === 'complete' && !s.transcript_text && (
                <p className="mt-2 text-xs italic text-even-ink-400">
                  (Silent — Deepgram returned an empty transcript.)
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
});

function StatusChip({ status }: { status: Snippet['transcript_status'] }) {
  if (status === 'pending') {
    return (
      <span className="rounded-full bg-even-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-even-ink-700">
        Pending
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="rounded-full bg-even-pink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-even-pink-800">
        Failed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-even-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-even-blue-800">
      Complete
    </span>
  );
}

function fmtTotal(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
