'use client';

/**
 * <PatientContextStrip /> — v4.0.1
 *
 * Replaces the v3 banner cards (Patient header card + Lab orders &
 * results card + Comorbidities & Panel Tier card) with one compact
 * pill-line directly under the top bar.
 *
 *   +91 98765 43214 · last visit 5d ago · 1 lab in progress ↗ · 0 active comorbidities · Tier 0
 *
 * Each pill is clickable → opens a slide-in detail or focuses the
 * relevant section. Allergies render as an even-pink pill when present.
 *
 * v4.0.1 scope: render the strip + wire the existing detail surfaces
 * (lab results panel + comorbidity modal) as click targets. The new
 * slide-in design is v4.0.8 — for now clicks just scroll to the
 * existing inline surface.
 */
import { useCallback, useEffect, useState } from 'react';

type TierData = {
  tier: 0 | 1 | 2 | 3;
  active_count: number;
  uncontrolled_count: number;
};

type LabSummary = {
  total: number;
  in_progress: number;
  completed: number;
  abnormal: number;
};

export function PatientContextStrip({
  patientId,
  phoneE164,
  allergies,
  intakeVisitReason,
  triageNurseName,
  triageCompletedAt,
  lastVisitAgo,
}: {
  patientId: string;
  phoneE164: string | null;
  allergies: string | null;
  intakeVisitReason: string | null;
  triageNurseName: string | null;
  triageCompletedAt: string | null;
  /** e.g. '5d ago' or null if first visit. */
  lastVisitAgo: string | null;
}) {
  const [tier, setTier] = useState<TierData | null>(null);
  const [labs, setLabs] = useState<LabSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Lazy fetch tier + lab summary on mount; soft-fail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tierRes, labRes] = await Promise.all([
          fetch(`/api/patients/${patientId}/comorbidities`),
          fetch(`/api/patients/${patientId}/lab-summary`).catch(() => null),
        ]);
        if (cancelled) return;
        const tierJson = await tierRes.json().catch(() => null);
        if (tierJson?.ok && tierJson.tier) {
          setTier({
            tier: tierJson.tier.tier,
            active_count: (tierJson.comorbidities ?? []).filter((c: { is_resolved: boolean }) => !c.is_resolved).length,
            uncontrolled_count: 0, // tier breakdown already factors this in; we don't need to show it here
          });
        }
        if (labRes) {
          const labJson = await labRes.json().catch(() => null);
          if (labJson?.ok && labJson.summary) setLabs(labJson.summary as LabSummary);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId]);

  const scrollToComorbidity = useCallback(() => {
    document.getElementById('encounter-comorbidity-band')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const scrollToLabs = useCallback(() => {
    document.getElementById('encounter-lab-results')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const tierTone = !tier
    ? 'bg-even-ink-100 text-even-ink-500'
    : tier.tier === 0
    ? 'bg-emerald-50 text-emerald-700'
    : tier.tier === 1
    ? 'bg-blue-50 text-blue-700'
    : tier.tier === 2
    ? 'bg-amber-50 text-amber-800'
    : 'bg-rose-50 text-rose-700';

  return (
    <div className="mx-auto max-w-7xl px-6 pt-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-even-ink-500">
        {/* Phone */}
        {phoneE164 && (
          <Pill tone="ink">
            <span className="font-mono">{phoneE164}</span>
          </Pill>
        )}

        {/* Last visit */}
        {lastVisitAgo && <Pill tone="ink">last visit {lastVisitAgo}</Pill>}

        {/* Labs */}
        {labs && labs.total > 0 && (
          <Pill tone="blue" onClick={scrollToLabs}>
            {labs.in_progress > 0
              ? `${labs.in_progress} lab${labs.in_progress === 1 ? '' : 's'} in progress`
              : `${labs.completed} lab${labs.completed === 1 ? '' : 's'} done`}
            {labs.abnormal > 0 && (
              <span className="ml-1 rounded-full bg-rose-100 px-1 py-0 text-[10px] font-semibold text-rose-700">
                {labs.abnormal} flagged
              </span>
            )}
            <span className="ml-0.5">↗</span>
          </Pill>
        )}

        {/* Comorbidities + tier (single pill, clickable) */}
        <button
          type="button"
          onClick={scrollToComorbidity}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-even-ink-100 transition hover:ring-even-ink-200 ${tierTone}`}
          title="Open comorbidity & tier detail"
        >
          {loading ? (
            <span className="italic">loading…</span>
          ) : (
            <>
              <span className="font-semibold">
                {tier ? `${tier.active_count} active comorbidit${tier.active_count === 1 ? 'y' : 'ies'}` : '0 comorbidities'}
              </span>
              {tier && <span>· Tier {tier.tier}</span>}
            </>
          )}
        </button>

        {/* Allergies (only when present, even-pink) */}
        {allergies && (
          <Pill tone="pink">⚠ Allergies: {allergies}</Pill>
        )}

        {/* Intake reason chip (if captured by CCE) */}
        {intakeVisitReason && (
          <Pill tone="blue">
            Reason: <span className="font-medium">{intakeVisitReason}</span>
          </Pill>
        )}

        {/* Triage attribution (subtle, far right) */}
        {triageNurseName && triageCompletedAt && (
          <span className="ml-auto text-[10px] text-even-ink-400">
            triaged by {triageNurseName.replace(/^Nurse\s+/i, 'Nurse ')}
          </span>
        )}
      </div>
    </div>
  );
}

function Pill({
  children,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  tone: 'ink' | 'blue' | 'pink';
  onClick?: () => void;
}) {
  const cls =
    tone === 'pink'
      ? 'bg-even-pink-50 text-even-pink-800 ring-even-pink-200'
      : tone === 'blue'
      ? 'bg-even-blue-50 text-even-blue-800 ring-even-blue-200'
      : 'bg-white text-even-ink-600 ring-even-ink-100 hover:ring-even-ink-200';
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition ${cls} ${onClick ? 'cursor-pointer' : ''}`}
    >
      {children}
    </Tag>
  );
}
