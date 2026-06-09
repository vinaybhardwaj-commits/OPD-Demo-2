'use client';

/**
 * src/components/PlanSection.tsx
 *
 * v5.0 — section orchestrator for the Plan step in the encounter.
 *
 * Replaces the legacy "Disposition" section. Responsibilities:
 *   1. Render ✨ SuggestedPlans (v5.1) at the top — soft-fails to nothing.
 *   2. List currently added plans for this encounter, each with its
 *      PlanFormShell (collapsed by default after first save).
 *   3. Render the manual chip wall — 13 kind buttons. Click → add a
 *      blank plan of that kind.
 *   4. Wire submit: POST /api/encounters/[id]/plans/submit closes the
 *      encounter with the right status.
 *
 * Multi-plan from day one: an encounter can have any number of plans of
 * any kinds. Removing the legacy 1-disposition constraint.
 *
 * Visual style: matches v4 — flat, no card borders, brand-faint accents.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Section } from './encounter/Section';
import PlanFormShell from './PlanFormShell';
import SuggestedPlans from './SuggestedPlans';
import {
  PLAN_KINDS,
  PLAN_META,
  PLAN_DEFAULTS,
  type PlanKind,
} from '@/lib/plan-schemas';

// ---------------------------------------------------------------------------
// Local types — mirror server PlanRow without coupling to server file
// ---------------------------------------------------------------------------

type PlanRow = {
  id: string;
  encounter_id: string;
  kind: PlanKind;
  payload: Record<string, unknown>;
  predicted: boolean;
  prediction_confidence: number | null;
  source: string;
  position: number;
  refused_plan_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PlanSectionProps = {
  encounterId: string;
  /** Section number (e.g. 7) — passed to Section's `n` prop. */
  n?: number;
  /** Encounter status — controls whether plans are editable. */
  encounterStatus?: string;
  /** Bumped by the editor whenever the encounter mutates in a way that
   *  should trigger a re-prediction. Forwarded to SuggestedPlans. */
  predictionTrigger?: number;
  /** Called after a successful submit so the parent can transition the
   *  encounter UI (e.g. show the print-prescription screen). */
  onSubmitted?: (newStatus: string) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlanSection({
  encounterId,
  n,
  encounterStatus,
  predictionTrigger = 0,
  onSubmitted,
}: PlanSectionProps) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  const isReadOnly = encounterStatus === 'completed';

  // -------------------------------------------------------------------------
  // Initial load + reload helper
  // -------------------------------------------------------------------------

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/encounters/${encodeURIComponent(encounterId)}/plans`,
        { cache: 'no-store' },
      );
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? 'load_failed');
        return;
      }
      setPlans(body.plans as PlanRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [encounterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // -------------------------------------------------------------------------
  // Add a new plan — used by both the manual chip wall + SuggestedPlans
  // -------------------------------------------------------------------------

  const addPlan = useCallback(
    async (
      kind: PlanKind,
      prefill: Record<string, unknown>,
      source: 'doctor' | 'ai_predicted' = 'doctor',
      predictionConfidence?: number,
    ) => {
      try {
        const res = await fetch(
          `/api/encounters/${encodeURIComponent(encounterId)}/plans`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind,
              payload: prefill,
              source,
              predicted: source === 'ai_predicted',
              prediction_confidence: predictionConfidence,
            }),
          },
        );
        const body = await res.json();
        if (!body.ok) {
          setError(body.error ?? 'add_failed');
          return;
        }
        const created = body.plan as PlanRow;
        setPlans((cur) => [...cur, created]);
        setExpandedPlanId(created.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'add_failed');
      }
    },
    [encounterId],
  );

  // -------------------------------------------------------------------------
  // Patch a plan's payload (debounced inside PlanFormShell would be nice;
  // for v5.0 we patch on blur via flush())
  // -------------------------------------------------------------------------

  const patchPlanPayload = useCallback(
    async (planId: string, payload: Record<string, unknown>) => {
      try {
        const res = await fetch(
          `/api/encounters/${encodeURIComponent(encounterId)}/plans/${planId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload }),
          },
        );
        const body = await res.json();
        if (!body.ok) {
          setError(body.error ?? 'update_failed');
          return;
        }
        const updated = body.plan as PlanRow;
        setPlans((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'update_failed');
      }
    },
    [encounterId],
  );

  // -------------------------------------------------------------------------
  // Remove a plan
  // -------------------------------------------------------------------------

  const removePlan = useCallback(
    async (planId: string) => {
      const ok = window.confirm('Remove this plan?');
      if (!ok) return;
      try {
        const res = await fetch(
          `/api/encounters/${encodeURIComponent(encounterId)}/plans/${planId}`,
          { method: 'DELETE' },
        );
        const body = await res.json();
        if (!body.ok) {
          setError(body.error ?? 'remove_failed');
          return;
        }
        setPlans((cur) => cur.filter((p) => p.id !== planId));
        if (expandedPlanId === planId) setExpandedPlanId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'remove_failed');
      }
    },
    [encounterId, expandedPlanId],
  );

  // -------------------------------------------------------------------------
  // Submit all plans + close the encounter
  // -------------------------------------------------------------------------

  const submit = useCallback(async () => {
    if (plans.length === 0) {
      setError('Add at least one plan before submitting.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/encounters/${encodeURIComponent(encounterId)}/plans/submit`,
        { method: 'POST' },
      );
      const body = await res.json();
      if (!body.ok) {
        // v5.0.2 — when the server rejects a submit because of plan
        // validation, prefer the human-readable detail over the bare
        // error code.
        const msg = body.detail ?? body.error ?? 'submit_failed';
        setError(msg);
        return;
      }
      setPlans(body.submittedPlans as PlanRow[]);
      onSubmitted?.(body.encounter_status as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'submit_failed');
    } finally {
      setSubmitting(false);
    }
  }, [encounterId, plans.length, onSubmitted]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const planCountSummary = useMemo(() => {
    if (plans.length === 0) return undefined;
    return `${plans.length} plan${plans.length === 1 ? '' : 's'}`;
  }, [plans.length]);

  const submittedCount = plans.filter((p) => p.submitted_at !== null).length;

  return (
    <Section
      label="Plan"
      n={n}
      id="plan"
      required
      collapsible
      defaultCollapsed={false}
      encounterId={encounterId}
      sectionKey="plan"
      summary={planCountSummary}
    >
      <div className="space-y-5">
        {/* ✨ Suggestions — only when not read-only and no plans added yet */}
        {!isReadOnly && plans.length === 0 && (
          <SuggestedPlans
            encounterId={encounterId}
            predictionTrigger={predictionTrigger}
            disabled={isReadOnly}
            onAdd={(kind, prefill, suggestion) =>
              void addPlan(kind, prefill, 'ai_predicted', suggestion.confidence)
            }
          />
        )}

        {/* Existing plans */}
        {loading ? (
          <div className="text-xs text-slate-400 italic">loading plans…</div>
        ) : plans.length === 0 ? (
          <div className="text-xs text-slate-500">
            No plans added yet. Pick one below, or accept a suggestion above.
          </div>
        ) : (
          <ol className="space-y-3">
            {plans.map((p) => {
              const meta = PLAN_META[p.kind];
              const expanded = expandedPlanId === p.id;
              return (
                <li
                  key={p.id}
                  className="border-l-2 border-violet-200 pl-3"
                >
                  <div className="flex items-baseline gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedPlanId(expanded ? null : p.id)}
                      className="text-sm font-medium text-slate-800 hover:text-violet-700 text-left"
                    >
                      {meta?.icon} {meta?.label ?? p.kind}
                    </button>
                    {p.predicted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700">
                        ✨ predicted
                      </span>
                    )}
                    {p.submitted_at && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        submitted
                      </span>
                    )}
                    {!isReadOnly && !p.submitted_at && (
                      <button
                        type="button"
                        onClick={() => void removePlan(p.id)}
                        className="ml-auto text-[11px] text-slate-400 hover:text-red-600"
                      >
                        remove
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div className="mt-2 pl-1">
                      <PlanFormShell
                        kind={p.kind}
                        value={p.payload}
                        disabled={isReadOnly || !!p.submitted_at}
                        onChange={(next) => {
                          // Optimistic local update + debounced persist.
                          setPlans((cur) =>
                            cur.map((x) =>
                              x.id === p.id ? { ...x, payload: next } : x,
                            ),
                          );
                          void patchPlanPayload(p.id, next);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {/* Manual chip wall — pick a kind */}
        {!isReadOnly && submittedCount === 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
              Or pick manually
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PLAN_KINDS.map((k) => {
                const meta = PLAN_META[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => void addPlan(k, { ...(PLAN_DEFAULTS[k] ?? {}) }, 'doctor')}
                    className="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 transition"
                    title={meta?.shortDesc}
                  >
                    {meta?.icon} {meta?.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Errors */}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded-md px-2 py-1">
            {error}
          </div>
        )}

        {/* Submit row */}
        {!isReadOnly && plans.length > 0 && submittedCount === 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white text-sm px-4 py-1.5 rounded-md transition"
            >
              {submitting ? 'Submitting…' : `Submit ${plans.length} plan${plans.length === 1 ? '' : 's'}`}
            </button>
            <span className="text-xs text-slate-500">
              This will close the encounter.
            </span>
          </div>
        )}
      </div>
    </Section>
  );
}
