'use client';

/**
 * src/components/llm-trace/TracePanel.tsx
 *
 * v6.0 — Ported from even-staff-portal `components/cdmss/TracePanel.tsx`
 * (final shape after portal v2.0.3b).
 *
 * Edits vs the portal:
 *   1. `LLMSurface` union expanded to the 15 OPD surfaces (see PRD §5.4)
 *   2. Brand classes swapped: bg-brand → bg-even-blue, text-brand →
 *      text-even-blue, brand-faint → even-blue-50, border-brand →
 *      border-even-blue-300.
 *   3. `askChips` prop dropped (no toggle chips in OPD pipelines today).
 *      computeAskStages/computeDdxStages helpers removed; we use the
 *      simpler Tier A milestone tables exclusively.
 *   4. Per-surface milestone tables (PRD §13) — DDX, transcribe-compare,
 *      suggest-orders, predict-plans, patient-summary use stage-anchored
 *      tables; the rest fall through to time-only behaviour.
 *   5. Friendly model labels (Q10) — header shows a `▮ deep reasoning
 *      model` chip when the stage emit names a model.
 *   6. The /api/ask/stage-medians fetch swapped for /api/llm/stage-medians.
 *
 * Decision Q1: qwenJson stays one-shot — multi-stage emits come from
 * routes that call qwenJson multiple times explicitly.
 *
 * Decision Q3: heartbeats handled in pushTrace (collapse consecutive
 * "<stage> (Ns on this phase)" events into a single ticking line).
 *
 * Decision Q6: "View trace ↗" deep-links to /llm/trace/[id].
 *
 * Decision Q10: model labels via sanitizeModelNames.
 */

import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { formatDuration } from '@/lib/llm-trace/format-duration';
import { getStageExplainer } from '@/lib/llm-trace/stage-explainers';
import { sanitizeModelNames, modelLabel } from '@/lib/llm-trace/model-labels';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMSurface =
  | 'ddx'
  | 'transcribe-compare'
  | 'suggest-orders'
  | 'icd10-suggest'
  | 'rx-coherence'
  | 'ddi-scan'
  | 'comorbidity-history'
  | 'comorbidity-context'
  | 'comorbidity-states'
  | 'voice-query'
  | 'patient-summary'
  | 'predict-plans'
  | 'diagnostics-interpret'
  | 'comorbidities-interpret'
  | 'icd10-interpret';

export type TraceEvent = {
  stage: string;
  msg: string;
  ms?: number;
  done: boolean;
  error?: boolean;
  ts: number;
};

type StageMedians = {
  expanding?: number;
  retrieving?: number;
  drafting: number;
  reviewing?: number;
  revising?: number;
  generating?: number;
  parsing?: number;
  total_p50: number;
  total_p90: number;
};

const STAGE_WEIGHTS_FALLBACK: StageMedians = {
  expanding: 3_000,
  retrieving: 5_000,
  drafting: 15_000,
  reviewing: 8_000,
  revising: 10_000,
  generating: 12_000,
  parsing: 1_500,
  total_p50: 25_000,
  total_p90: 60_000,
};

type Milestone = { match: RegExp; pct: number };

// ---------------------------------------------------------------------------
// Per-surface milestone tables (PRD §13, initial draft)
// ---------------------------------------------------------------------------

const DDX_MILESTONES: Milestone[] = [
  { match: /Building clinical|Building context|Building the clinical/i, pct: 5 },
  { match: /Retrieved \d+ |Pulled \d+ /i,                                pct: 15 },
  { match: /Drafting (with|the differential|differential)/i,             pct: 35 },
  { match: /Auditing (differential|DDx|the DDx)/i,                       pct: 65 },
  { match: /Revising (differential|DDx|the DDx)/i,                       pct: 80 },
  { match: /Reasoning (with|through)/i,                                  pct: 60 }, // single-pass live mode
  { match: /Parsing (differential|DDx)/i,                                pct: 95 },
];

const TRANSCRIBE_MILESTONES: Milestone[] = [
  { match: /Deepgram (returned|complete)/i, pct: 40 },
  { match: /Whisper (returned|complete)/i,  pct: 40 },
  { match: /qwen .* scoring|Comparing the two/i, pct: 60 },
  { match: /Judge (complete|done)/i,        pct: 95 },
];

const SUGGEST_ORDERS_MILESTONES: Milestone[] = [
  { match: /Building (allowed )?catalog/i, pct: 10 },
  { match: /Prompting|Suggesting orders/i, pct: 30 },
  { match: /Parsing (suggestions|orders)/i, pct: 90 },
];

const PREDICT_PLANS_MILESTONES: Milestone[] = [
  { match: /Building (encounter )?snapshot/i, pct: 10 },
  { match: /Prompting|Predicting/i,           pct: 30 },
  { match: /Parsing predictions/i,            pct: 90 },
];

const PATIENT_SUMMARY_MILESTONES: Milestone[] = [
  { match: /Loaded \d+ encounter/i,    pct: 10 },
  { match: /Aggregating/i,             pct: 25 },
  { match: /Prompting|Drafting summary/i, pct: 40 },
  { match: /Validating/i,              pct: 90 },
];

const DDI_SCAN_MILESTONES: Milestone[] = [
  { match: /Pairwise|Retrieved \d+ /i,  pct: 30 },
  { match: /Analyzing pairs/i,          pct: 60 },
  { match: /Deduplicating/i,            pct: 90 },
];

const COMORBIDITY_HISTORY_MILESTONES: Milestone[] = [
  { match: /Loaded \d+ encounter/i,   pct: 20 },
  { match: /Inferring comorbidities/i, pct: 60 },
  { match: /Validating ICD-10/i,      pct: 90 },
];

const SURFACE_MILESTONES: Partial<Record<LLMSurface, Milestone[]>> = {
  ddx: DDX_MILESTONES,
  'transcribe-compare': TRANSCRIBE_MILESTONES,
  'suggest-orders': SUGGEST_ORDERS_MILESTONES,
  'predict-plans': PREDICT_PLANS_MILESTONES,
  'patient-summary': PATIENT_SUMMARY_MILESTONES,
  'ddi-scan': DDI_SCAN_MILESTONES,
  'comorbidity-history': COMORBIDITY_HISTORY_MILESTONES,
};

const ASSUMED_BAND_MS = 30_000; // bands for Tier-A surfaces

function milestoneFor(
  events: TraceEvent[],
  table: Milestone[],
): { current: number; next: number; sinceMs: number } {
  let currentIdx = -1;
  let sinceMs = Date.now();
  for (const e of events) {
    for (let i = 0; i < table.length; i++) {
      if (table[i].match.test(e.msg)) {
        if (i > currentIdx) {
          currentIdx = i;
          sinceMs = e.ts;
        }
      }
    }
  }
  const currentPct = currentIdx >= 0 ? table[currentIdx].pct : 2;
  const nextPct = currentIdx + 1 < table.length ? table[currentIdx + 1].pct : 95;
  return { current: currentPct, next: nextPct, sinceMs };
}

const STAGE_LABEL: Record<string, string> = {
  expanding: 'Building context',
  variants: 'Variants generated',
  retrieving: 'Retrieval',
  reranking: 'Reranking',
  fusing: 'Source-quality fusion',
  generating: 'Generating',
  drafting: 'Drafting',
  reviewing: 'Auditing',
  revising: 'Revising',
  finalizing: 'Finalizing',
  parsing: 'Parsing',
  persisting: 'Saving',
  'cold-start': 'Warming the model',
  'transcribing-deepgram': 'Deepgram',
  'deepgram-complete': 'Deepgram complete',
  'transcribing-whisper': 'Whisper',
  'whisper-complete': 'Whisper complete',
  judging: 'Judging',
  transcribing: 'Transcribing',
  done: 'Done',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type TracePanelProps = {
  events: TraceEvent[];
  totalMs?: number;
  traceId?: string | null;
  surface?: LLMSurface;
  /** Compact mode for the BackgroundTraceToaster — hides the event list. */
  compact?: boolean;
  /**
   * v6.1 — optional callback to fire when the doctor clicks the small
   * cancel button in the header. The caller should abort its in-flight
   * fetch (typically by calling abortController.abort()). The panel
   * renders the cancel button only while !isComplete && !hasError AND
   * onCancel was provided.
   */
  onCancel?: () => void;
};

export default function TracePanel({
  events,
  totalMs,
  traceId,
  surface,
  compact,
  onCancel,
}: TracePanelProps) {
  const [open, setOpen] = useState(!compact);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [medians, setMedians] = useState<StageMedians>(STAGE_WEIGHTS_FALLBACK);
  const [t0] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const q = surface ? `?surface=${encodeURIComponent(surface)}` : '';
    fetch(`/api/llm/stage-medians${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j && typeof j.total_p50 === 'number') setMedians(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [surface]);

  function copyTraceId() {
    if (!traceId) return;
    navigator.clipboard?.writeText(traceId)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  const last = events.length > 0 ? events[events.length - 1] : null;
  const isComplete = events.some((e) => e.stage === 'done') || !!totalMs;
  const hasError = events.some((e) => e.error);

  useEffect(() => {
    if (isComplete || hasError || events.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isComplete, hasError, events.length]);

  if (events.length === 0 || !last) return null;
  const stalled = !isComplete && !hasError && now - last.ts > 45_000;

  // Pull a friendly model label from the last event's msg if it mentions one.
  const lastModelChip = (() => {
    if (isComplete) return null;
    const m = last.msg.match(/qwen[\d.]+:?\d*b|llama[\d.]+:?\d*b|deepgram|whisper/i);
    if (!m) return null;
    return modelLabel(m[0].toLowerCase());
  })();

  return (
    <div
      className={`mb-3 rounded-lg border text-xs ${
        hasError ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {hasError ? (
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
        ) : isComplete ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-even-blue" />
        )}
        <span className="flex-1 font-medium text-slate-700">
          {isComplete
            ? `Pipeline complete · ${formatDuration(totalMs)}`
            : STAGE_LABEL[last.stage] || last.stage}
        </span>
        {lastModelChip && (
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
            ▮ {lastModelChip}
          </span>
        )}
        <span className="text-slate-400">
          {events.length} step{events.length !== 1 ? 's' : ''}
        </span>
        {onCancel && !isComplete && !hasError && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-rose-300 hover:text-rose-700"
            title="Cancel this pipeline"
          >
            cancel
          </button>
        )}
        {open ? (
          <ChevronUp className="h-3 w-3 text-slate-400" />
        ) : (
          <ChevronDown className="h-3 w-3 text-slate-400" />
        )}
      </button>

      {open && !isComplete && !hasError && (() => {
        const elapsed = now - t0;
        const milestoneTable = surface ? SURFACE_MILESTONES[surface] : undefined;

        let pct: number;
        let etaLabel: React.ReactNode;

        if (milestoneTable) {
          // Tier A — stage-anchored bar with band interpolation.
          const ms = milestoneFor(events, milestoneTable);
          const inBandMs = Math.max(0, now - ms.sinceMs);
          const bandProgress = Math.min(0.9, inBandMs / ASSUMED_BAND_MS);
          pct = Math.min(95, Math.max(2, ms.current + (ms.next - ms.current) * bandProgress));
          // ETA on Tier A: show the stage label (no calibrated per-surface ETA yet).
          etaLabel = <span className="text-slate-500">{STAGE_LABEL[last.stage] || last.stage}</span>;
        } else {
          // Tier C — time-only with overdue scaling.
          const overdue = elapsed > medians.total_p50;
          const effectiveTotal = overdue ? Math.max(medians.total_p50, elapsed * 1.15) : medians.total_p50;
          const eta = Math.max(0, effectiveTotal - elapsed);
          pct = Math.min(95, Math.max(2, (elapsed / effectiveTotal) * 100));
          etaLabel = overdue ? (
            <span className="text-amber-700">Longer than usual — still working</span>
          ) : (
            <span>~{formatDuration(eta)} remaining</span>
          );
        }

        const explainer = getStageExplainer(last.stage, surface);
        return (
          <div className="border-t border-slate-200 bg-white/40 px-3 py-2">
            <div className="mb-1 flex items-center justify-between text-[10.5px] text-slate-500">
              <span>{formatDuration(elapsed)} elapsed</span>
              {etaLabel}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200">
              <div
                className="h-full bg-even-blue transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            {!compact && explainer && (
              <div className="mt-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px]">
                <div className="font-medium text-slate-700">{explainer.title}</div>
                {explainer.body && (
                  <div className="mt-0.5 text-slate-600 leading-snug">{explainer.body}</div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {open && stalled && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          ⚠ No progress for {Math.round((now - last.ts) / 1000)}s. The Mac Mini Ollama may be queuing — this can take up to 90s per stage. You can keep working in other sections; this will catch up or fail gracefully.
        </div>
      )}

      {open && traceId && (
        <div className="flex items-center gap-2 border-t border-slate-200 bg-white/60 px-3 py-1.5 text-[11px] text-slate-500">
          <span className="font-mono uppercase tracking-wide text-slate-400">trace</span>
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-700">
            {traceId.slice(0, 8)}…
          </code>
          <a
            href={`/llm/trace/${traceId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded border border-even-blue-300 bg-even-blue-50 px-2 py-0.5 text-[10.5px] font-medium text-even-blue hover:bg-even-blue hover:text-white"
            aria-label="View full trace"
            title="Open the full forensic trace for this query in a new tab"
          >
            View trace
            <ExternalLink className="h-3 w-3" />
          </a>
          <button
            onClick={copyTraceId}
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10.5px] text-slate-500 hover:border-even-blue-300 hover:text-even-blue"
            aria-label="Copy trace ID"
            title="Copy full trace ID"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      )}

      {open && !compact && (
        <ol className="space-y-1 border-t border-slate-200 px-3 py-2">
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex h-3 w-3 shrink-0 items-center justify-center">
                {e.error ? (
                  <AlertTriangle className="h-3 w-3 text-rose-600" />
                ) : e.done ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                )}
              </span>
              <span className="flex-1">
                <span className="font-medium text-slate-700">
                  {STAGE_LABEL[e.stage] || e.stage}
                </span>
                {e.msg && <span className="text-slate-500"> — {sanitizeModelNames(e.msg)}</span>}
              </span>
              {e.ms !== undefined && (
                <span className="shrink-0 text-slate-400">{formatDuration(e.ms)}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
