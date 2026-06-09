/**
 * <HistoryPanel> — in-encounter collapsible left panel (PH.3).
 *
 * Default: 40px rail with a chevron icon glued to the left edge of the
 * viewport. Tap → slides out to 360px with a faint backdrop. Tap the
 * backdrop or the chevron to collapse back. State persisted in
 * localStorage under `ph3.panel_open` so the doctor's preference
 * survives between encounters within a session.
 *
 * Contents (when expanded, per PRD §5.2):
 *   1. Header: patient name + "View full history →" link to /patients/[id]
 *   2. Summary line (first 2 lines of summary_text)
 *   3. Problem list — compact, top 4
 *   4. Allergy strip — only renders when non-empty
 *   5. Last 3-5 encounter cards (date + CC chips + primary diagnosis)
 *
 * Recompute / skeleton / failed states land in PH.3.2.
 */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TierBadge } from './TierBadge';
import type { TierBreakdown } from '@/lib/comorbidity-tier';

// -----------------------------------------------------------------------------
// Types (subset of patient-summary.ts to avoid a server-only import)
// -----------------------------------------------------------------------------

export type HPProblem = {
  label?: string;
  status?: string;
  current_meds?: string[];
  since?: string | null;
};

export type HPAllergy = {
  allergen: string;
  source: string;
  fromOwner?: boolean;
};

export type HPEncounterCard = {
  id: string;
  encounter_date: string;
  encounter_number: string;
  chief_complaint_chips: string[] | null;
  primary_code: string | null;
  disposition: string | null;
};

export type HPSummary = {
  status: string;
  summary_text?: string | null;
  problems: HPProblem[];
  allergies: HPAllergy[];
  computed_at: string | null;
  fail_reason?: string | null;
};

/** Polish #3 — Lab trending. Shape mirrors loadLabTrends() output. */
export type HPLabTrend = {
  canonical_key: string;
  display_name: string;
  points: Array<{
    value_numeric: number | null;
    value_text: string | null;
    unit: string | null;
    abnormal_flag: string | null;
    entered_at: string;
  }>;
};

export type HistoryPanelProps = {
  patientId: string;
  patientName: string;
  summary: HPSummary;
  encounters: HPEncounterCard[];
  /** Polish #3 — series with ≥2 points each, newest-first. */
  labTrends?: HPLabTrend[];
};

const LS_KEY = 'ph3.panel_open';

export function HistoryPanel(props: HistoryPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRecompute() {
    if (recomputing) return;
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/internal/recompute-summary?patient_id=${props.patientId}`,
        { method: 'POST', cache: 'no-store' },
      );
      if (!res.ok) {
        // 5xx or auth issue
        setError(`Recompute failed (${res.status})`);
        return;
      }
      const j = (await res.json()) as { ok?: boolean; reason?: string };
      if (j.ok === false) {
        setError(j.reason ?? 'Recompute failed');
        return;
      }
      // Pull fresh server data into the panel via router refresh.
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setRecomputing(false);
    }
  }

  // Restore preference from localStorage after mount to avoid SSR mismatch.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(LS_KEY);
      setOpen(v === '1');
    } catch {
      /* ignore — SSR-safe default is collapsed */
    }
    setHydrated(true);
  }, []);

  function persist(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(LS_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  // Until hydrated, render the rail closed to match SSR output.
  const isOpen = hydrated && open;

  return (
    <>
      {/* Rail — always visible, at the left edge of viewport */}
      <button
        type="button"
        aria-label={isOpen ? 'Collapse history panel' : 'Expand history panel'}
        aria-expanded={isOpen}
        onClick={() => persist(!isOpen)}
        className="fixed left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-lg border border-l-0 border-violet-200 bg-violet-50 px-1.5 py-3 text-violet-800 shadow-sm transition hover:bg-violet-100"
      >
        <span aria-hidden className="block text-base leading-none">
          {isOpen ? '◀' : '▶'}
        </span>
        <span className="mt-1 block text-[8px] font-semibold uppercase tracking-wider">
          {isOpen ? 'Hide' : 'Hx'}
        </span>
      </button>

      {/* Backdrop — only when open. Click to close. */}
      {isOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-20 bg-black/10"
          onClick={() => persist(false)}
        />
      )}

      {/* Slide-in panel */}
      <aside
        aria-hidden={!isOpen}
        className={`fixed left-0 top-0 z-20 flex h-screen w-[360px] flex-col border-r border-violet-200 bg-white shadow-lg transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <PanelHeader
          patientId={props.patientId}
          patientName={props.patientName}
          onClose={() => persist(false)}
        />
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <SummaryLine
            summary={props.summary}
            recomputing={recomputing}
            error={error}
          />
          {/* v3.9.1 — canonical comorbidities + panel tier (replaces auto-derived <Problems>). */}
          <Comorbidities patientId={props.patientId} />
          <Allergies items={props.summary.allergies} />
          {props.labTrends && props.labTrends.length > 0 && (
            <LabTrends trends={props.labTrends} />
          )}
          <RecentEncounters encounters={props.encounters} />
        </div>
        <PanelFooter
          computedAt={props.summary.computed_at}
          recomputing={recomputing}
          onRecompute={onRecompute}
        />
      </aside>
    </>
  );
}

// -----------------------------------------------------------------------------
// Sub-sections
// -----------------------------------------------------------------------------

function PanelHeader({
  patientId,
  patientName,
  onClose,
}: {
  patientId: string;
  patientName: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-violet-100 bg-violet-50/60 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-even-navy">
          {patientName}
        </p>
        <Link
          href={`/patients/${patientId}`}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-block text-[10px] font-medium uppercase tracking-wider text-violet-800 hover:text-violet-900 hover:underline"
        >
          View full history →
        </Link>
      </div>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="ml-2 rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs text-even-ink-500 hover:border-even-ink-300 hover:text-even-navy"
      >
        ✕
      </button>
    </div>
  );
}

function PanelFooter({
  computedAt,
  recomputing,
  onRecompute,
}: {
  computedAt: string | null;
  recomputing: boolean;
  onRecompute: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-violet-100 bg-violet-50/40 px-4 py-2 text-[10px] uppercase tracking-wider text-violet-800">
      <span>
        AI summary
        {computedAt ? ` · computed ${timeAgo(computedAt)}` : ''}
      </span>
      <button
        type="button"
        onClick={onRecompute}
        disabled={recomputing}
        className="rounded-md border border-violet-300 bg-white px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-violet-800 transition hover:bg-violet-100 disabled:cursor-wait disabled:opacity-60"
      >
        {recomputing ? 'Recomputing…' : 'Recompute'}
      </button>
    </div>
  );
}

function SummaryLine({
  summary,
  recomputing,
  error,
}: {
  summary: HPSummary;
  recomputing: boolean;
  error: string | null;
}) {
  // When the doctor just hit Recompute, render the skeleton even before
  // the server data swaps over to status='computing'.
  if (recomputing) {
    return <Skeleton lines={2} />;
  }
  if (error) {
    return (
      <div className="mb-3 rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-xs text-even-pink-800">
        {error}. Try Recompute again, or check that the LLM tunnel is up.
      </div>
    );
  }
  if (summary.status === 'missing') {
    return (
      <div className="mb-3 rounded-md border border-even-ink-200 bg-white px-3 py-2 text-xs text-even-ink-500">
        No AI summary yet — tap{' '}
        <span className="font-mono">Recompute</span> below.
      </div>
    );
  }
  if (summary.status === 'computing') {
    return <Skeleton lines={2} />;
  }
  if (summary.status === 'failed') {
    return (
      <div className="mb-3 rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-xs text-even-pink-800">
        Last attempt failed
        {summary.fail_reason ? (
          <>: <span className="font-mono">{summary.fail_reason}</span></>
        ) : null}
        . Tap Recompute to retry.
      </div>
    );
  }
  if (!summary.summary_text) {
    return (
      <div className="mb-3 rounded-md border border-even-ink-200 bg-white px-3 py-2 text-xs text-even-ink-500">
        Summary text empty. Tap Recompute.
      </div>
    );
  }
  return (
    <p className="mb-3 text-sm leading-snug text-even-navy">
      {summary.summary_text}
    </p>
  );
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="mb-3 animate-pulse space-y-1.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded bg-violet-100"
          style={{ width: `${100 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

function Comorbidities({ patientId }: { patientId: string }) {
  type ApiComorbidity = {
    id: string;
    code: string;
    label: string;
    is_resolved: boolean;
    onset_date: string | null;
    tier: 'core' | 'extended' | null;
    triggers_extended_capture: boolean;
  };
  const [items, setItems] = useState<ApiComorbidity[]>([]);
  const [tier, setTier] = useState<TierBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/comorbidities`);
        const json = await res.json();
        if (!cancel && json.ok) {
          setItems(json.comorbidities);
          setTier(json.tier);
        }
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [patientId]);

  const active = items.filter((c) => !c.is_resolved);

  if (loading) {
    return (
      <div className="mb-3 rounded-md border border-even-ink-100 bg-white p-3 text-[11px] italic text-even-ink-400">
        Loading comorbidities…
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-even-ink-100 bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
          Comorbidities {active.length > 0 && `(${active.length})`}
        </p>
        {tier && <TierBadge breakdown={tier} size="sm" />}
      </div>
      {active.length === 0 ? (
        <p className="text-[11px] italic text-even-ink-400">No comorbidities recorded. Add via the band at the top of the encounter.</p>
      ) : (
        <ul className="space-y-1">
          {active.slice(0, 6).map((c) => (
            <li key={c.id} className="text-xs">
              <div className="flex items-baseline gap-1.5">
                <span className="shrink-0 font-mono text-[10px] font-semibold text-even-navy">{c.code}</span>
                <span className="truncate text-even-navy">{c.label}</span>
                {c.onset_date && (
                  <span className="shrink-0 text-[9px] text-even-ink-400">· {c.onset_date.slice(0, 4)}</span>
                )}
                {c.triggers_extended_capture && (
                  <span className="shrink-0 text-[9px] text-amber-600" title="Gateways extended catalog">⚡</span>
                )}
              </div>
            </li>
          ))}
          {active.length > 6 && (
            <li className="text-[10px] italic text-even-ink-400">+{active.length - 6} more · expand band above</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Problems({ problems }: { problems: HPProblem[] }) {
  if (problems.length === 0) return null;
  const top = problems.slice(0, 4);
  return (
    <div className="mb-3 rounded-md border border-even-ink-100 bg-white p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
        Active problems
      </p>
      <ul className="space-y-1.5">
        {top.map((p, i) => (
          <li key={`${p.label}-${i}`} className="text-xs">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
              />
              <span className="font-medium text-even-navy">{p.label ?? '—'}</span>
              {p.status && (
                <span className="text-[9px] uppercase tracking-wider text-even-ink-400">
                  · {p.status}
                </span>
              )}
            </div>
            {(p.current_meds?.length ?? 0) > 0 && (
              <div className="ml-3 text-[11px] text-even-ink-500">
                {(p.current_meds ?? []).join(', ')}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Allergies({ items }: { items: HPAllergy[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-3 rounded-md border border-even-pink-200 bg-even-pink-50 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-even-pink-800">
        ⚠ Allergies
      </p>
      <ul className="space-y-1">
        {items.map((a, i) => (
          <li key={`${a.allergen}-${i}`} className="text-xs">
            <div className="flex items-center gap-1.5">
              {!a.fromOwner && (
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
                />
              )}
              <span className="font-medium text-even-pink-900">{a.allergen}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Polish #3 — Lab trends section. Each canonical_key series shows a
 * compact inline arrow trail: "13.2 → 12.8 → 12.1 g/dL". The most
 * recent value gets a colour tint matching its abnormal_flag so the
 * doctor's eye lands on what's actionable.
 *
 * Click to expand a series and see the full point list with timestamps.
 */
function LabTrends({ trends }: { trends: HPLabTrend[] }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
        Lab trends · {trends.length}
      </p>
      <ul className="space-y-1.5">
        {trends.slice(0, 8).map((s) => (
          <LabTrendRow key={s.canonical_key} series={s} />
        ))}
      </ul>
      {trends.length > 8 && (
        <p className="mt-1 text-[10px] text-even-ink-400">
          + {trends.length - 8} more series available on the patient
          longitudinal view.
        </p>
      )}
    </div>
  );
}

function LabTrendRow({ series }: { series: HPLabTrend }) {
  const [expanded, setExpanded] = useState(false);
  // Show the freshest first 4 points inline; expand to see all.
  const inline = series.points.slice(0, 4);
  const latest = series.points[0];
  const latestTint = flagTextTint(latest?.abnormal_flag ?? null);
  return (
    <li className="rounded-md border border-even-ink-100 bg-white px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-medium text-even-navy">
          {series.display_name}
        </span>
        <span className={`text-[10px] tabular-nums ${latestTint}`}>
          {inline.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="text-even-ink-300"> → </span>}
              <span>
                {p.value_numeric != null ? p.value_numeric : p.value_text ?? '—'}
              </span>
            </span>
          ))}
          {latest?.unit && (
            <span className="ml-1 text-even-ink-400">{latest.unit}</span>
          )}
        </span>
      </button>
      {expanded && (
        <ul className="mt-1.5 space-y-0.5 border-t border-even-ink-100 pt-1.5 text-[10px] text-even-ink-600">
          {series.points.map((p, idx) => (
            <li
              key={idx}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="tabular-nums">
                {p.value_numeric != null ? p.value_numeric : p.value_text ?? '—'}
                {p.unit ? ` ${p.unit}` : ''}
              </span>
              <span
                className={`text-[9px] uppercase tracking-wider ${flagTextTint(p.abnormal_flag)}`}
              >
                {p.abnormal_flag && p.abnormal_flag !== 'unknown'
                  ? p.abnormal_flag.replace(/_/g, ' ')
                  : ''}
              </span>
              <span className="font-mono text-[9px] text-even-ink-400">
                {new Date(p.entered_at).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: '2-digit',
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function flagTextTint(flag: string | null): string {
  if (!flag) return 'text-even-navy';
  if (flag === 'critical_low' || flag === 'critical_high')
    return 'text-even-pink-800 font-semibold';
  if (flag === 'high' || flag === 'low') return 'text-amber-700 font-semibold';
  if (flag === 'normal') return 'text-even-blue-700';
  return 'text-even-navy';
}

function RecentEncounters({
  encounters,
}: {
  encounters: HPEncounterCard[];
}) {
  if (encounters.length === 0) {
    return (
      <div className="mb-3 rounded-md border border-dashed border-even-ink-200 bg-white px-3 py-2 text-xs text-even-ink-500">
        No prior encounters.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-even-ink-100 bg-white p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
        Recent visits
      </p>
      <ol className="space-y-2">
        {encounters.slice(0, 5).map((e) => (
          <li key={e.id} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-even-navy">{e.encounter_date}</span>
              {e.primary_code && (
                <span className="font-mono text-[10px] text-even-blue-700">
                  {e.primary_code}
                </span>
              )}
            </div>
            {(e.chief_complaint_chips?.length ?? 0) > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {(e.chief_complaint_chips ?? []).slice(0, 3).map((chip) => (
                  <span
                    key={chip}
                    className="inline-block rounded-full border border-even-ink-200 bg-white px-1.5 py-0.5 text-[9px] text-even-ink-700"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}
            {e.disposition && (
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-even-ink-400">
                {e.disposition.replace(/_/g, ' ')}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'never';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
