'use client';

/**
 * CounsellingGate — D.1 (V, 10 Jun): the final-counselling capture belongs
 * INSIDE the disposition beat, not floating at the top of the page. It
 * appears at the bottom of section 7 ONLY once a TERMINAL-kind plan exists
 * (discharge / follow-up / refer / admit / … — anything whose submit
 * completes the encounter; diagnostics/imaging don't trigger it), i.e. the
 * "you've decided — now counsel the patient" moment, right above
 * Submit & finish. Polls the plans list lightly so adding a terminal plan
 * reveals the card without a reload. Also shown whenever counselling
 * transcripts already exist (review/complete states).
 */
import * as React from 'react';
import { CounsellingCapture } from '@/components/CounsellingCapture';
import { PLAN_META, type PlanKind } from '@/lib/plan-schemas';

export type CounsellingTranscript = {
  seq: number;
  transcript_en: string | null;
  transcribe_error: string | null;
};

function isTerminalKind(kind: string): boolean {
  const meta = PLAN_META[kind as PlanKind];
  return !!meta && meta.statusOnSubmit === 'completed';
}

export function CounsellingGate({
  encounterId,
  initialEligible,
  transcripts,
}: {
  encounterId: string;
  initialEligible: boolean;
  transcripts: CounsellingTranscript[];
}) {
  const [eligible, setEligible] = React.useState(initialEligible || transcripts.length > 0);

  React.useEffect(() => {
    if (eligible) return; // latched — terminal plans aren't un-chosen mid-flow
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/encounters/${encounterId}/plans`, { cache: 'no-store' });
        const j = (await res.json()) as { ok?: boolean; plans?: Array<{ kind: string }> };
        if (!stop && j.ok && (j.plans ?? []).some((p) => isTerminalKind(p.kind))) setEligible(true);
      } catch {
        /* intentional: gate is cosmetic — next poll retries */
      }
    };
    void poll();
    const t = window.setInterval(poll, 6_000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [eligible, encounterId]);

  if (!eligible) return null;

  return (
    <div className="mt-4 space-y-2">
      <CounsellingCapture encounterId={encounterId} />
      {transcripts.map((c) =>
        c.transcript_en ? (
          <div key={c.seq} className="rounded-xl border border-even-ink-200 bg-even-ink-50/40 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-even-ink-500">
              Final counselling — faithful transcript (session #{c.seq})
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-even-ink-800">{c.transcript_en}</p>
          </div>
        ) : c.transcribe_error ? (
          <p key={c.seq} className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
            Counselling transcript pending retry ({c.transcribe_error.slice(0, 50)}…) — the hourly sweep self-heals.
          </p>
        ) : (
          <p key={c.seq} className="rounded-xl border border-even-ink-200 bg-white p-2 text-[11px] text-even-ink-500">
            Counselling session #{c.seq} — transcribing in the background…
          </p>
        ),
      )}
    </div>
  );
}
