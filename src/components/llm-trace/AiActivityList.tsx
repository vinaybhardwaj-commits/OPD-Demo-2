'use client';

/**
 * src/components/llm-trace/AiActivityList.tsx
 *
 * v6.0 Phase 4 — backs the encounter / patient AI activity tab
 * (decision Q7). Lists every llm_traces row tied to the record,
 * newest first, with a click-through to the forensic /llm/trace/[id]
 * page.
 *
 * Default collapsed under a "AI activity (N)" header — doctors expand
 * when they want retrospective audit, not by default.
 *
 * Pass exactly one of { encounterId, patientId }. The two endpoints
 * differ only in which traces they return (encounter-scoped vs
 * patient-scoped including patient-level fires).
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { formatDuration } from '@/lib/llm-trace/format-duration';

type TraceRow = {
  id: string;
  surface: string;
  status: 'in_progress' | 'completed' | 'errored' | 'aborted';
  total_ms: number | null;
  started_at: string;
  encounter_id?: string | null;
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

export type AiActivityListProps =
  | { encounterId: string; patientId?: undefined }
  | { encounterId?: undefined; patientId: string };

export default function AiActivityList(props: AiActivityListProps) {
  const [open, setOpen] = useState(false);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Only fetch when the section is expanded for the first time — keeps
    // the encounter page render cost low when the doctor never opens it.
    if (!open || loaded) return;
    setLoading(true);
    const url = props.encounterId
      ? `/api/encounters/${encodeURIComponent(props.encounterId)}/traces`
      : `/api/patients/${encodeURIComponent(props.patientId!)}/traces`;
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok && Array.isArray(body.traces)) {
          setTraces(body.traces as TraceRow[]);
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [open, loaded, props.encounterId, props.patientId]);

  return (
    <div className="rounded-lg border border-even-ink-100 bg-white text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-even-ink-700"
      >
        <span className="font-medium">AI activity</span>
        {loaded && (
          <span className="text-even-ink-400">({traces.length})</span>
        )}
        {open ? (
          <ChevronUp className="ml-auto h-3 w-3 text-even-ink-400" />
        ) : (
          <ChevronDown className="ml-auto h-3 w-3 text-even-ink-400" />
        )}
      </button>

      {open && (
        <div className="border-t border-even-ink-100 px-3 py-2">
          {loading && (
            <div className="text-[11px] italic text-even-ink-400">Loading…</div>
          )}
          {!loading && traces.length === 0 && (
            <div className="text-[11px] italic text-even-ink-400">
              No AI activity recorded yet for this {props.encounterId ? 'encounter' : 'patient'}.
            </div>
          )}
          {traces.length > 0 && (
            <ol className="space-y-1">
              {traces.map((t) => {
                const label = SURFACE_LABEL[t.surface] ?? t.surface;
                const at = new Date(t.started_at);
                const timeStr = at.toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <li key={t.id} className="flex items-center gap-2 py-1">
                    <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
                      {t.status === 'errored' ? (
                        <AlertTriangle className="h-3 w-3 text-rose-600" />
                      ) : t.status === 'in_progress' ? (
                        <Loader2 className="h-3 w-3 animate-spin text-even-blue" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      )}
                    </span>
                    <span className="font-medium text-even-navy">{label}</span>
                    <span className="text-even-ink-500">·</span>
                    <span className="text-even-ink-500">{timeStr}</span>
                    {t.total_ms != null && (
                      <>
                        <span className="text-even-ink-500">·</span>
                        <span className="text-even-ink-500">{formatDuration(t.total_ms)}</span>
                      </>
                    )}
                    <a
                      href={`/llm/trace/${t.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-even-blue hover:underline"
                    >
                      View
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
