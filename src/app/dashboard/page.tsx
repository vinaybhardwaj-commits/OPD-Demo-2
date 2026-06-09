/**
 * /dashboard — OPD doctor's queue (home state).
 *
 * Design doc §4.1: four lanes ordered by what's actionable.
 *   1. Ready to resume (green)  — diagnostics back, doctor up next
 *   2. Waiting (white)          — patient hasn't been seen yet
 *   3. At diagnostics (amber)   — encounter paused, test pending
 *   4. Completed (dim gray)     — archive view for today
 *
 * Server component — reads `getQueueForDoctor()` directly. Click handlers:
 *   - Waiting card     → POSTs server action `startEncounter` which
 *                        creates the encounter row + redirects
 *   - Other cards      → plain link to /dashboard/encounters/[id]
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentDoctor } from '@/lib/auth';
import { getQueueForDoctor, type QueueCard, type HandoffCard } from '@/lib/queue';
import { loadQueueTiers, type QueueTier } from '@/lib/queue-tier';
import { startEncounter, actionClaimHandoff } from './actions';
import { PatientSearch } from '@/components/PatientSearch';
import { QueueLive } from '@/components/QueueLive';

export const dynamic = 'force-dynamic';

function firstName(full: string): string {
  // v5.0.3 — strip 'Dr.'/'Dr' prefix FIRST, then split. The previous
  // order split first and tried to strip a 'Dr.' token that had no
  // trailing whitespace, leaving 'Dr.' as the result and rendering
  // 'Good day, Dr. Dr.' on the dashboard.
  const stripped = (full || '').replace(/^Dr\.?\s*/i, '').trim();
  return stripped.split(/\s+/)[0] || stripped || full;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export default async function DashboardPage() {
  const session = await getCurrentDoctor();
  if (!session) redirect('/auth/login');

  const q = await getQueueForDoctor(session.email);
  if (!q) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-even-white-DEFAULT px-6">
        <div className="text-sm text-even-ink-500">
          Your doctor record isn&apos;t seeded yet. Ask V to add{' '}
          <span className="font-mono">{session.email}</span> to{' '}
          <span className="font-mono">doctors</span>.
        </div>
      </main>
    );
  }

  const total = q.completed.length + q.ready_to_resume.length + q.at_diagnostics.length + q.waiting.length;

  // v3.9.6 — batched tier per patient across all queue lanes
  const allPatientIds = Array.from(new Set([
    ...q.waiting.map((c) => c.patient_id),
    ...q.ready_to_resume.map((c) => c.patient_id),
    ...q.at_diagnostics.map((c) => c.patient_id),
    ...q.completed.map((c) => c.patient_id),
  ]));
  const tiersByPatient = await loadQueueTiers(allPatientIds);
  const seenSoFar = q.completed.length;
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <QueueLive channel="queue:global" />
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="h-7 w-7 rounded-full bg-even-blue ring-4 ring-even-blue-100"
            />
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-even-navy">
              Even OPD · EHRC
            </span>
          </div>
          <div className="mx-6 flex-1">
            <PatientSearch />
          </div>
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard/drugs"
              className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
            >
              Drug search
            </Link>
            <Link
              href="/admin/demo-controls"
              className="text-xs font-medium uppercase tracking-wider text-even-ink-400 hover:text-even-pink-700"
              title="Demo controls (admin)"
            >
              Demo
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6 pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-even-navy">
                Good day, Dr. {firstName(q.doctor.name)}
              </h1>
              <p className="text-xs text-even-ink-500">
                {today} · {seenSoFar} of {total} seen
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-even-ink-400">
              <Pill color="green" label={`${q.ready_to_resume.length} ready`} />
              <Pill color="navy" label={`${q.waiting.length} waiting`} />
              <Pill color="amber" label={`${q.at_diagnostics.length} diagnostics`} />
              <Pill color="ink" label={`${q.completed.length} done`} />
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {q.needs_review.length > 0 && (
          <HandoffLane cards={q.needs_review} />
        )}
        {q.ready_to_resume.length > 0 && (
          <Lane
            title="Ready to resume"
            subtitle="Diagnostics back. Tap to continue the encounter."
            tone="ready"
            cards={q.ready_to_resume}
            tiersByPatient={tiersByPatient}
          />
        )}

        <Lane
          title="Vitals captured · ready for you"
          subtitle="Triage is done. Tap a card to open the encounter."
          tone="waiting"
          cards={q.waiting}
          startAction={startEncounter}
        />

        {q.at_diagnostics.length > 0 && (
          <Lane
            title="At diagnostics"
            subtitle="Encounter paused, test pending."
            tone="diagnostics"
            cards={q.at_diagnostics}
            tiersByPatient={tiersByPatient}
          />
        )}

        {q.completed.length > 0 && (
          <Lane
            title="Completed today"
            subtitle="Done. Click to review."
            tone="completed"
            cards={q.completed}
            dim
            tiersByPatient={tiersByPatient}
          />
        )}
      </section>
    </main>
  );
}

function Pill({
  color,
  label,
}: {
  color: 'green' | 'navy' | 'amber' | 'ink';
  label: string;
}) {
  // Even has no green; treat "ready" with a confident blue ring instead.
  const tone =
    color === 'green'
      ? 'bg-even-blue-50 text-even-blue-800 ring-1 ring-even-blue-200'
      : color === 'amber'
      ? 'bg-even-pink-50 text-even-pink-800 ring-1 ring-even-pink-200'
      : color === 'navy'
      ? 'bg-even-navy-50 text-even-navy ring-1 ring-even-navy-100'
      : 'bg-even-ink-100 text-even-ink-700 ring-1 ring-even-ink-200';
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

/**
 * v3.9.6 — small T0..T3 pill rendered on each queue card.
 * Tone matches TierBadge so the dashboard and the encounter editor stay
 * visually consistent. Hover title gives the breakdown.
 */
function TierPill({ tier }: { tier: QueueTier }) {
  const label = `T${tier.tier}`;
  const tone = tier.tier === 0
    ? 'bg-blue-50 text-blue-800 ring-blue-200'
    : tier.tier === 1
    ? 'bg-amber-50 text-amber-800 ring-amber-200'
    : tier.tier === 2
    ? 'bg-rose-50 text-rose-800 ring-rose-200'
    : 'bg-red-100 text-red-900 ring-red-300';
  const detail = tier.active_count === 0
    ? 'no comorbidities'
    : `${tier.active_count} condition${tier.active_count === 1 ? '' : 's'}` +
      (tier.uncontrolled_count > 0 ? ` · ${tier.uncontrolled_count} uncontrolled` : '');
  const title = `Panel tier ${label}${tier.override_state ? ' (override)' : ''}\n${detail}\nScore ${tier.score}` +
    (tier.trigger_reasons.length > 0 ? `\n${tier.trigger_reasons.join(' · ')}` : '');
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-semibold ring-1 ${tone}`}
    >
      {label}
      {tier.override_state && <span className="text-[8px]" title="Clinician override">✎</span>}
    </span>
  );
}

function Lane({
  title,
  subtitle,
  tone,
  cards,
  startAction,
  dim,
  tiersByPatient,
}: {
  title: string;
  subtitle: string;
  tone: 'ready' | 'waiting' | 'diagnostics' | 'completed';
  tiersByPatient?: Map<string, QueueTier>;
  cards: QueueCard[];
  startAction?: (formData: FormData) => Promise<void>;
  dim?: boolean;
}) {
  if (cards.length === 0) {
    return (
      <div>
        <LaneHeader title={title} subtitle={subtitle} count={0} tone={tone} />
        <p className="mt-3 rounded-xl border border-dashed border-even-ink-200 bg-white p-4 text-center text-xs text-even-ink-400">
          Nothing here right now.
        </p>
      </div>
    );
  }

  return (
    <div className={dim ? 'opacity-70' : ''}>
      <LaneHeader title={title} subtitle={subtitle} count={cards.length} tone={tone} />
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) =>
          startAction && !c.encounter_id ? (
            <StartCard key={c.patient_id} card={c} action={startAction} tone={tone} tier={tiersByPatient?.get(c.patient_id) ?? null} />
          ) : (
            <ResumeCard key={c.patient_id} card={c} tone={tone} tier={tiersByPatient?.get(c.patient_id) ?? null} />
          ),
        )}
      </ul>
    </div>
  );
}

function LaneHeader({
  title,
  subtitle,
  count,
  tone,
}: {
  title: string;
  subtitle: string;
  count: number;
  tone: 'ready' | 'waiting' | 'diagnostics' | 'completed';
}) {
  const accent =
    tone === 'ready'
      ? 'text-even-blue-700'
      : tone === 'diagnostics'
      ? 'text-even-pink-700'
      : tone === 'completed'
      ? 'text-even-ink-400'
      : 'text-even-navy';
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex items-baseline gap-3">
        <h2 className={`text-sm font-semibold uppercase tracking-[0.14em] ${accent}`}>
          {title}
        </h2>
        <span className="rounded-full bg-even-ink-100 px-2 py-0.5 text-[10px] font-semibold text-even-ink-700">
          {count}
        </span>
      </div>
      <p className="text-xs text-even-ink-500">{subtitle}</p>
    </div>
  );
}

function cardSurface(tone: 'ready' | 'waiting' | 'diagnostics' | 'completed') {
  if (tone === 'ready')
    return 'border-even-blue-300 bg-white shadow-sm ring-2 ring-even-blue-100 hover:border-even-blue-400';
  if (tone === 'diagnostics')
    return 'border-even-pink-200 bg-white hover:border-even-pink-300';
  if (tone === 'completed')
    return 'border-even-ink-100 bg-white hover:border-even-ink-200';
  return 'border-even-ink-200 bg-white hover:border-even-navy-200';
}

function CardBody({ card, tone, tier }: { card: QueueCard; tone: 'ready' | 'waiting' | 'diagnostics' | 'completed'; tier?: QueueTier | null }) {
  return (
    <div className="text-left">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          {tier && <TierPill tier={tier} />}
          <span className="truncate text-sm font-semibold text-even-navy">
            {card.name}
          </span>
        </div>
        <span className="shrink-0 text-[11px] font-mono text-even-ink-400">
          {card.age_years}{card.sex}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-mono text-even-ink-500">{card.mrn}</span>
        {tier && tier.active_count > 0 && (
          <span className="text-[10px] text-even-ink-500">
            {tier.active_count} cond{tier.active_count === 1 ? '' : 's'}
            {tier.uncontrolled_count > 0 && (
              <span className="ml-1 text-rose-600">· {tier.uncontrolled_count} uncontrolled</span>
            )}
          </span>
        )}
      </div>

      {/* v2.0.5 — intake reason chip from CCE */}
      {card.intake_visit_reason && (tone === 'waiting' || tone === 'ready') && (
        <p className="mt-2 inline-block rounded-full border border-even-blue-200 bg-even-blue-50 px-2 py-0.5 text-[10px] font-medium text-even-blue-800">
          {card.intake_visit_reason}
        </p>
      )}

      {/* v2.0.5 — vitals tile (only when triage has captured them) */}
      {tone === 'waiting' && card.vitals && hasVitals(card.vitals) && (
        <VitalsTile vitals={card.vitals} triageNurseName={card.triage_nurse_name} />
      )}

      {card.chief_complaint_text && (
        <p className="mt-2 line-clamp-2 text-xs text-even-ink-600">
          {card.chief_complaint_text}
        </p>
      )}
      {card.pending_diagnostic_test && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-even-pink-100 px-2 py-0.5 text-[10px] font-medium text-even-pink-800">
          {tone === 'ready' ? '✓ ' : '⌛ '}
          {card.pending_diagnostic_test}
        </p>
      )}
      {card.completed_at && (
        <p className="mt-2 text-[10px] uppercase tracking-wider text-even-ink-400">
          Done · {fmtTime(card.completed_at)}
        </p>
      )}
      {card.encounter_number && (
        <p className="mt-2 text-[10px] font-mono text-even-ink-300">
          {card.encounter_number}
        </p>
      )}
    </div>
  );
}

function hasVitals(v: NonNullable<QueueCard['vitals']>): boolean {
  return v.bp_sys != null || v.hr != null || v.temp_c != null || v.spo2 != null;
}

function VitalsTile({
  vitals: v,
  triageNurseName,
}: {
  vitals: NonNullable<QueueCard['vitals']>;
  triageNurseName: string | null;
}) {
  // Red-zone flags (mirror /triage VitalsForm thresholds)
  const flagBp =
    (v.bp_sys != null && v.bp_sys >= 180) ||
    (v.bp_dia != null && v.bp_dia >= 110);
  const flagHr = v.hr != null && (v.hr < 50 || v.hr > 110);
  const flagTemp = v.temp_c != null && v.temp_c > 38.5;
  const flagSpo2 = v.spo2 != null && v.spo2 < 92;
  const anyRedZone = flagBp || flagHr || flagTemp || flagSpo2;

  return (
    <div
      className={`mt-2 grid grid-cols-4 gap-1.5 rounded-md border px-2 py-1.5 text-[10px] ${
        anyRedZone
          ? 'border-even-pink-300 bg-even-pink-50'
          : 'border-even-ink-100 bg-even-ink-50/50'
      }`}
    >
      <VitalCell
        label="BP"
        value={v.bp_sys != null && v.bp_dia != null ? `${v.bp_sys}/${v.bp_dia}` : '—'}
        flag={flagBp}
      />
      <VitalCell label="HR" value={v.hr != null ? String(v.hr) : '—'} flag={flagHr} />
      <VitalCell
        label="Temp"
        value={v.temp_c != null ? `${v.temp_c}°` : '—'}
        flag={flagTemp}
      />
      <VitalCell
        label="SpO₂"
        value={v.spo2 != null ? `${v.spo2}%` : '—'}
        flag={flagSpo2}
      />
      {triageNurseName && (
        <p className="col-span-4 mt-0.5 truncate text-[9px] uppercase tracking-wider text-even-ink-400">
          {triageNurseName.replace(/^Nurse\s+/i, 'Nurse ')} · triage done
        </p>
      )}
    </div>
  );
}

function VitalCell({
  label,
  value,
  flag,
}: {
  label: string;
  value: string;
  flag: boolean;
}) {
  return (
    <div>
      <p className="text-[8px] uppercase tracking-wider text-even-ink-500">{label}</p>
      <p
        className={`text-[11px] font-semibold tabular-nums ${
          flag ? 'text-even-pink-800' : 'text-even-navy'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function StartCard({
  card,
  action,
  tone,
  tier,
}: {
  card: QueueCard;
  action: (formData: FormData) => Promise<void>;
  tone: 'ready' | 'waiting' | 'diagnostics' | 'completed';
  tier?: QueueTier | null;
}) {
  return (
    <li>
      <form action={action}>
        <input type="hidden" name="patient_id" value={card.patient_id} />
        <button
          type="submit"
          className={`block w-full rounded-xl border p-4 text-left transition ${cardSurface(tone)}`}
          aria-label={`Start encounter for ${card.name}`}
        >
          <CardBody card={card} tone={tone} tier={tier} />
        </button>
      </form>
    </li>
  );
}

function ResumeCard({
  card,
  tone,
  tier,
}: {
  card: QueueCard;
  tone: 'ready' | 'waiting' | 'diagnostics' | 'completed';
  tier?: QueueTier | null;
}) {
  return (
    <li>
      <Link
        href={card.encounter_id ? `/dashboard/encounters/${card.encounter_id}` : '/dashboard'}
        className={`block rounded-xl border p-4 transition ${cardSurface(tone)}`}
      >
        <CardBody card={card} tone={tone} tier={tier} />
      </Link>
    </li>
  );
}

/**
 * v2.3 — Network-wide handoff lane. Any doctor signed in sees this
 * regardless of whose encounter it is. Each card has a "Claim handoff"
 * button that POSTs to /claim-handoff and pulls the encounter into
 * the claiming doctor's own queue.
 */
function HandoffLane({ cards }: { cards: HandoffCard[] }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-800">
            Needs review · handoff queue
          </h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
            {cards.length}
          </span>
        </div>
        <p className="text-xs text-even-ink-500">
          Flagged for second opinion. Claim to pull into your queue.
        </p>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <HandoffCardLi key={c.encounter_id} card={c} />
        ))}
      </ul>
    </div>
  );
}

function HandoffCardLi({ card }: { card: HandoffCard }) {
  return (
    <li>
      <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-even-navy">
            {card.patient_name}
          </span>
          <span className="shrink-0 text-[11px] font-mono text-even-ink-400">
            {card.patient_age_years}{card.patient_sex}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-even-ink-500 font-mono">
          {card.patient_mrn}
        </div>
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-200">
          🔁 from {firstName(card.current_doctor_name)}
        </p>
        <p className="mt-2 line-clamp-3 text-xs text-even-ink-700">
          &ldquo;{card.handoff_note}&rdquo;
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-even-ink-400">
            {card.room_name ?? '—'}
          </span>
          <ClaimHandoffButton encounterId={card.encounter_id} />
        </div>
      </div>
    </li>
  );
}

/**
 * Tiny inline form that calls the claim-handoff endpoint via a server
 * action exposed under /dashboard/actions.ts. Reusing the encounter id
 * keeps the URL out of the user's address bar after the action runs.
 */
function ClaimHandoffButton({ encounterId }: { encounterId: string }) {
  return (
    <form action={actionClaimHandoff}>
      <input type="hidden" name="encounter_id" value={encounterId} />
      <button
        type="submit"
        className="rounded-md bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-700"
      >
        Claim handoff →
      </button>
    </form>
  );
}
