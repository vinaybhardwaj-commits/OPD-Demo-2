'use client';

/**
 * src/components/llm-trace/BackgroundTraceToaster.tsx
 *
 * v6.0 Phase 4 — polling-based background toaster. Replaces the v6.0
 * Phase 1 in-memory registry approach which only surfaced client-
 * initiated traces. The polling version also surfaces SERVER-SIDE
 * background fires (recomputePatientSummary, post-encounter-submit
 * cascade jobs) — which is the whole point of the toaster per
 * decision Q4.
 *
 * Behaviour:
 *   - Polls /api/encounters/[id]/traces (or /api/patients/[id]/traces)
 *     every 3 seconds while the doctor is on the page.
 *   - For each trace with status='in_progress' or status='errored',
 *     renders a small bottom-right pill.
 *   - 'in_progress' pills update their elapsed time on every poll.
 *   - 'errored' pills are sticky — they stay visible until the doctor
 *     dismisses them (per decision Q4: errored summaries surface so
 *     the doctor knows something's stale).
 *   - 'completed' pills are not shown — the trace finished, no need to
 *     interrupt the doctor.
 *   - Clicking a pill opens /llm/trace/[id] in a new tab.
 *
 * The polling cadence (3s) is light: each poll is a single indexed
 * SELECT on llm_traces with LIMIT 200, p50 <50ms.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, ExternalLink, X } from 'lucide-react';
import { formatDuration } from '@/lib/llm-trace/format-duration';

type TraceRow = {
  id: string;
  surface: string;
  status: 'in_progress' | 'completed' | 'errored' | 'aborted';
  total_ms: number | null;
  started_at: string;
};

const SURFACE_LABEL: Record<string, string> = {
  ddx: 'Differential',
  'transcribe-compare': 'Voice transcription',
  'suggest-orders': 'Suggested orders',
  'icd10-suggest': 'ICD-10 suggestion',
  'rx-coherence': 'Rx coherence',
  'ddi-scan': 'Drug interaction scan',
  'comorbidity-history': 'Comorbidities from history',
  'comorbidity-context': 'Comorbidities from context',
  'comorbidity-states': 'Comorbidity state',
  'voice-query': 'Ask-the-chart',
  'patient-summary': 'Patient summary',
  'predict-plans': 'Plan prediction',
  'diagnostics-interpret': 'Diagnostics interpretation',
  'comorbidities-interpret': 'Comorbidities interpret',
  'icd10-interpret': 'ICD-10 interpret',
};

export type BackgroundTraceToasterProps =
  | { encounterId: string; patientId?: undefined }
  | { encounterId?: undefined; patientId: string };

const POLL_INTERVAL_MS = 3_000;
const STALE_DISMISS_KEY = 'llm-trace:dismissed-trace-ids';

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(STALE_DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STALE_DISMISS_KEY, JSON.stringify([...ids]));
  } catch {}
}

export default function BackgroundTraceToaster(props: BackgroundTraceToasterProps) {
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());

  const url = useMemo(
    () =>
      props.encounterId
        ? `/api/encounters/${encodeURIComponent(props.encounterId)}/traces`
        : `/api/patients/${encodeURIComponent(props.patientId!)}/traces`,
    [props.encounterId, props.patientId],
  );

  // Poll the traces endpoint every 3s. Skip when the tab isn't visible
  // to avoid noisy polling for backgrounded tabs.
  useEffect(() => {
    let cancelled = false;
    async function pollOnce() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) return;
        const body = await r.json();
        if (!cancelled && body.ok && Array.isArray(body.traces)) {
          setTraces(body.traces as TraceRow[]);
        }
      } catch {}
    }
    void pollOnce();
    const handle = window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [url]);

  // Ticker for in-progress elapsed display.
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  function dismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(next);
  }

  // Filter: only show in-progress + errored, drop dismissed.
  const visible = traces.filter(
    (t) =>
      (t.status === 'in_progress' || t.status === 'errored') && !dismissed.has(t.id),
  );

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[280px] flex-col gap-2">
      {visible.map((t) => {
        const label = SURFACE_LABEL[t.surface] ?? t.surface;
        const startedMs = new Date(t.started_at).getTime();
        const elapsed = Math.max(0, now - startedMs);
        const isError = t.status === 'errored';
        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border shadow-lg ${
              isError ? 'border-rose-200 bg-rose-50' : 'border-even-blue-200 bg-white'
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-2 text-xs">
              {isError ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-even-blue" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-even-navy">{label}</div>
                <div className="text-[10.5px] text-even-ink-500">
                  {isError ? 'failed' : `${formatDuration(elapsed)} running`}
                </div>
              </div>
              <a
                href={`/llm/trace/${t.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-even-blue hover:text-even-blue-700"
                title="View trace"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
              {isError && (
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="text-even-ink-400 hover:text-even-ink-600"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {!isError && (
              <div className="h-0.5 w-full overflow-hidden bg-even-blue-50">
                <div className="h-full w-full origin-left animate-pulse bg-even-blue" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
