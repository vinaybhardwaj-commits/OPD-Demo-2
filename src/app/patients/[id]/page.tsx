/**
 * /patients/[id] — longitudinal patient view (PH.2).
 *
 * Server component. Read-only in PH.2 — editing flows ship in PH.5.
 *
 * Layout (PRD §5.1):
 *   1. Patient banner (name, age/sex, MRN, phone, allergy pill)
 *   2. Qwen summary card (AI dot, summary_text, computed-at, Recompute)
 *   3. Problem list (table) — PH.2.2
 *   4. Medication history (table) — PH.2.2
 *   5. Allergy + risk profile strip — PH.2.2
 *   6. Encounter timeline (reverse-chronological cards) — PH.2.2
 *
 * Auth: middleware (matcher extended to /patients/:path*) redirects
 * unauthenticated requests to /auth/login.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { actionRecompute, actionSaveOverride } from './actions';
import AiActivityList from '@/components/llm-trace/AiActivityList';

export const dynamic = 'force-dynamic';
// Recompute server action calls Qwen (~5-47s warm/cold). 300s is the
// page-segment ceiling on Vercel Pro, well above any single call.
export const maxDuration = 300;

type Patient = {
  id: string;
  mrn: string;
  name: string;
  age_years: number;
  sex: 'M' | 'F' | 'O' | null;
  phone_e164: string | null;
  known_allergies: string | null;
};

type SummaryRow = {
  summary: ValidatedSummary | Record<string, unknown> | null;
  status: string;
  computed_at: string | null;
  qwen_model: string | null;
  qwen_latency_ms: number | null;
  source_encounter_count: number | null;
  source_window_start: string | null;
  source_window_end: string | null;
  fail_reason: string | null;
};

// Match the validator output, but accept partial fields so a stale row
// with a missing key doesn't crash the page.
type ValidatedSummary = {
  summary_text?: string;
  problem_list?: ProblemListEntry[];
  medication_history?: MedicationHistoryEntry[];
  allergy_aggregation?: AllergyAggregationEntry[];
  cc_chip_rankings?: string[];
  cc_chip_additions?: string[];
  disposition_recommendation?: string;
  disposition_additions?: string[];
  red_flags?: { kind?: string; text?: string; severity?: string }[];
};

type ProblemListEntry = {
  label?: string;
  since?: string | null;
  status?: string;
  current_meds?: string[];
  last_managed_at?: string | null;
  source_encounters?: string[];
};

type MedicationHistoryEntry = {
  generic?: string;
  active?: boolean;
  first_prescribed?: string | null;
  last_prescribed?: string | null;
  frequency_normal?: string;
};

type AllergyAggregationEntry = {
  allergen?: string;
  source?: string;
  confidence?: string;
};

type PrescriptionLineLite = {
  brand?: string;
  generic?: string;
  strength?: string;
  form?: string;
  frequency?: string;
  duration_days?: number | null;
  duration?: string;
  timing?: string;
  instructions?: string;
};

type EncounterCardRow = {
  id: string;
  encounter_number: string;
  encounter_date: string;
  status: string;
  chief_complaint_chips: string[] | null;
  chief_complaint_text: string | null;
  assessment_codes: string[] | null;
  assessment_text: string | null;
  disposition: string | null;
  follow_up_days: number | null;
  referral_target: string | null;
  prescription_number: string | null;
  prescription_lines: PrescriptionLineLite[] | null;
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'never';
  const diffMs = Date.now() - t;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default async function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  // Load patient + cached summary + doctor overrides + encounter timeline in parallel.
  const [patientRows, summaryRows, overrideRows, encounterRows] = await Promise.all([
    pool.query<Patient>(
      `SELECT id, mrn, name, age_years, sex, phone_e164, known_allergies
         FROM patients WHERE id = $1 LIMIT 1`,
      [id],
    ),
    pool.query<SummaryRow>(
      `SELECT summary, status,
              computed_at::text AS computed_at,
              qwen_model, qwen_latency_ms,
              source_encounter_count,
              source_window_start::text AS source_window_start,
              source_window_end::text AS source_window_end,
              fail_reason
         FROM patient_summaries
        WHERE patient_id = $1 LIMIT 1`,
      [id],
    ),
    pool.query<{
      target_kind: string;
      target_key: string;
      action: string;
      payload: Record<string, unknown> | null;
      created_at: string;
    }>(
      `SELECT target_kind, target_key, action, payload,
              created_at::text AS created_at
         FROM doctor_overrides
        WHERE patient_id = $1
        ORDER BY created_at DESC`,
      [id],
    ),
    pool.query<EncounterCardRow>(
      `SELECT e.id, e.encounter_number,
              e.encounter_date::text AS encounter_date,
              e.status::text AS status,
              e.chief_complaint_chips,
              e.chief_complaint_text,
              e.assessment_codes,
              e.assessment_text,
              e.disposition::text AS disposition,
              e.follow_up_days,
              e.referral_target,
              p.prescription_number,
              p.lines AS prescription_lines
         FROM encounters e
         LEFT JOIN prescriptions p ON p.encounter_id = e.id
        WHERE e.patient_id = $1
          AND e.status = 'completed'
        ORDER BY e.encounter_date DESC, e.completed_at DESC NULLS LAST
        LIMIT 20`,
      [id],
    ),
  ]);

  const patient = patientRows.rows[0];
  if (!patient) notFound();
  const summaryRow = summaryRows.rows[0] ?? null;
  const summary = (summaryRow?.summary ?? null) as ValidatedSummary | null;
  const encounters = encounterRows.rows;
  const overrides = overrideRows.rows;

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Back to queue
          </Link>
          <span className="text-[10px] font-mono text-even-ink-400">
            patient · longitudinal view
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
        {/* 1. Patient banner */}
        <div className="mb-6 rounded-xl border border-even-ink-200 bg-white p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-even-navy">
                {patient.name}
              </h1>
              <p className="mt-1 text-sm text-even-ink-600">
                {patient.age_years} y / {patient.sex ?? '—'}
                {' · '}
                <span className="font-mono">{patient.mrn}</span>
                {patient.phone_e164 ? (
                  <>
                    {' · '}
                    <span className="font-mono text-even-ink-500">
                      {patient.phone_e164}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          {patient.known_allergies && patient.known_allergies !== 'None' && (
            <div className="inline-flex items-center gap-2 rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-1.5 text-xs font-medium text-even-pink-800">
              <span aria-hidden>⚠</span>
              <span>Allergies on file: {patient.known_allergies}</span>
            </div>
          )}
        </div>

        {/* 2. Qwen summary card */}
        <SummaryCard
          patientId={patient.id}
          summary={summary}
          summaryRow={summaryRow}
        />

        {/* 3. Problem list */}
        <ProblemListSection
          patientId={patient.id}
          problems={summary?.problem_list ?? []}
          overrides={overrides}
        />

        {/* 4. Medication history */}
        <MedicationHistorySection meds={summary?.medication_history ?? []} />

        {/* 5. Allergy + risk profile strip */}
        <AllergiesSection
          patientId={patient.id}
          ownerAllergies={patient.known_allergies}
          aggregations={summary?.allergy_aggregation ?? []}
          redFlags={summary?.red_flags ?? []}
          overrides={overrides}
        />

        {/* 6. Encounter timeline */}
        <EncounterTimelineSection encounters={encounters} />

        {/* 7. AI activity (Phase 4 decision Q7) */}
        <AiActivityList patientId={patient.id} />
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function SummaryCard({
  patientId,
  summary,
  summaryRow,
}: {
  patientId: string;
  summary: ValidatedSummary | null;
  summaryRow: SummaryRow | null;
}) {
  const status = summaryRow?.status ?? 'missing';

  return (
    <div className="rounded-xl border border-even-ink-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-label="AI-derived"
            className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500"
          />
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-violet-800">
            AI summary
          </span>
          <StatusPill status={status} />
        </div>
        <form action={actionRecompute}>
          <input type="hidden" name="patient_id" value={patientId} />
          <button
            type="submit"
            className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 transition hover:border-violet-400 hover:bg-violet-100"
          >
            Recompute
          </button>
        </form>
      </div>

      {status === 'missing' && (
        <p className="text-sm text-even-ink-600">
          No summary yet. Tap Recompute to generate one — Qwen takes
          5-15s warm, up to ~50s cold.
        </p>
      )}

      {status === 'computing' && (
        <p className="text-sm text-even-ink-600">
          Computing… refresh in a few seconds.
        </p>
      )}

      {status === 'failed' && (
        <div className="rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-xs text-even-pink-800">
          Last attempt failed
          {summaryRow?.fail_reason ? (
            <>: <span className="font-mono">{summaryRow.fail_reason}</span></>
          ) : null}
          . Tap Recompute to retry.
        </div>
      )}

      {(status === 'fresh' || status === 'stale') && summary?.summary_text && (
        <p className="text-sm leading-relaxed text-even-navy">
          {summary.summary_text}
        </p>
      )}

      {summaryRow?.computed_at && (
        <p className="mt-3 text-[10px] uppercase tracking-wider text-even-ink-400">
          Computed {timeAgo(summaryRow.computed_at)}
          {summaryRow.qwen_model ? (
            <> · <span className="font-mono">{summaryRow.qwen_model}</span></>
          ) : null}
          {summaryRow.qwen_latency_ms ? (
            <> · {Math.round(summaryRow.qwen_latency_ms / 100) / 10}s</>
          ) : null}
          {summaryRow.source_encounter_count != null ? (
            <>
              {' · '}
              {summaryRow.source_encounter_count} encounter
              {summaryRow.source_encounter_count === 1 ? '' : 's'} in window
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const variants: Record<string, string> = {
    fresh: 'border-even-blue-200 bg-even-blue-50 text-even-blue-800',
    computing: 'border-even-ink-200 bg-even-ink-50 text-even-ink-700',
    failed: 'border-even-pink-200 bg-even-pink-50 text-even-pink-800',
    stale: 'border-amber-300 bg-amber-50 text-amber-800',
    missing: 'border-even-ink-200 bg-white text-even-ink-500',
  };
  const cls = variants[status] ?? variants.missing;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Problem list
// ---------------------------------------------------------------------------

type OverrideRow = {
  target_kind: string;
  target_key: string;
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

function ProblemListSection({
  patientId,
  problems,
  overrides,
}: {
  patientId: string;
  problems: ProblemListEntry[];
  overrides: OverrideRow[];
}) {
  // Apply problem overrides: dismiss → hide; edit → rename label / change status.
  const problemOverrides = overrides.filter((o) => o.target_kind === 'problem');
  const dismissed = new Set(
    problemOverrides.filter((o) => o.action === 'dismiss').map((o) => o.target_key.toLowerCase()),
  );
  const editsByKey = new Map<string, Record<string, unknown>>();
  for (const o of problemOverrides) {
    if (o.action === 'edit' && o.payload) {
      editsByKey.set(o.target_key.toLowerCase(), o.payload);
    }
  }
  const customAdded = problemOverrides
    .filter((o) => o.action === 'add')
    .map((o) => ({
      label: String(o.payload?.label ?? o.target_key),
      status: String(o.payload?.status ?? 'active'),
      note: typeof o.payload?.note === 'string' ? o.payload!.note : null,
      from_doctor: true as const,
    }));

  const rendered = problems
    .filter((p) => !dismissed.has((p.label ?? '').toLowerCase()))
    .map((p) => {
      const edit = editsByKey.get((p.label ?? '').toLowerCase());
      if (!edit) return { ...p, from_doctor: false as const, note: null as string | null };
      return {
        ...p,
        label: typeof edit.label === 'string' ? edit.label : p.label,
        status: typeof edit.status === 'string' ? edit.status : p.status,
        note: typeof edit.note === 'string' ? edit.note : null,
        from_doctor: false as const,
      };
    })
    .concat(customAdded as never[]);

  return (
    <div className="mt-6 rounded-xl border border-even-ink-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            Problem list
          </h2>
          <span className="rounded-full border border-even-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-ink-500">
            {rendered.length}
          </span>
        </div>
        <AddProblemControl patientId={patientId} />
      </div>

      {rendered.length === 0 ? (
        <p className="text-sm text-even-ink-500">No problems on file yet.</p>
      ) : (
        <ul className="divide-y divide-even-ink-100">
          {rendered.map((p, i) => {
            const label = (p.label ?? '—') as string;
            return (
              <li key={`${label}-${i}`} className="py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        aria-label={p.from_doctor ? 'Doctor-added' : 'AI-derived'}
                        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                          p.from_doctor ? 'bg-even-navy' : 'bg-violet-500'
                        }`}
                      />
                      <div className="text-sm font-medium text-even-navy">{label}</div>
                      <ProblemStatusPill status={(p.status as string) ?? 'active'} />
                    </div>
                    <div className="ml-3.5 mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-even-ink-500">
                      {p.since ? <span>since {p.since}</span> : null}
                      {(p.current_meds?.length ?? 0) > 0 ? (
                        <span>meds: {(p.current_meds ?? []).join(', ')}</span>
                      ) : null}
                      {p.last_managed_at ? <span>last: {p.last_managed_at}</span> : null}
                    </div>
                    {p.note ? (
                      <div className="ml-3.5 mt-1 rounded-md border border-even-ink-100 bg-even-ink-50 px-2 py-1 text-[11px] text-even-ink-600">
                        Note: {p.note}
                      </div>
                    ) : null}
                  </div>
                  <ProblemRowControls patientId={patientId} label={label} status={(p.status as string) ?? 'active'} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProblemRowControls({
  patientId,
  label,
  status,
}: {
  patientId: string;
  label: string;
  status: string;
}) {
  return (
    <details className="shrink-0">
      <summary className="cursor-pointer list-none rounded-md border border-even-ink-200 bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-even-ink-600 hover:border-even-ink-300 hover:text-even-navy">
        Edit
      </summary>
      <div className="absolute z-10 mt-1 w-72 rounded-lg border border-even-ink-200 bg-white p-3 shadow-lg">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
          Edit problem
        </p>
        <form action={actionSaveOverride} className="space-y-2">
          <input type="hidden" name="patient_id" value={patientId} />
          <input type="hidden" name="target_kind" value="problem" />
          <input type="hidden" name="target_key" value={label} />
          <input type="hidden" name="action" value="edit" />
          <label className="block text-xs text-even-ink-600">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">Label</span>
            <input
              name="label"
              defaultValue={label}
              className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs focus:border-even-blue focus:outline-none focus:ring-1 focus:ring-even-blue-100"
            />
          </label>
          <label className="block text-xs text-even-ink-600">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">Status</span>
            <select
              name="status"
              defaultValue={status}
              className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs"
            >
              <option value="active">active</option>
              <option value="controlled">controlled</option>
              <option value="resolved">resolved</option>
            </select>
          </label>
          <label className="block text-xs text-even-ink-600">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">Doctor note</span>
            <textarea
              name="note"
              rows={2}
              placeholder="optional"
              className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-even-blue px-2 py-1.5 text-xs font-semibold text-white hover:bg-even-blue-700"
          >
            Save override
          </button>
        </form>
        <form action={actionSaveOverride} className="mt-2">
          <input type="hidden" name="patient_id" value={patientId} />
          <input type="hidden" name="target_kind" value="problem" />
          <input type="hidden" name="target_key" value={label} />
          <input type="hidden" name="action" value="dismiss" />
          <button
            type="submit"
            className="w-full rounded-md border border-even-pink-200 bg-even-pink-50 px-2 py-1.5 text-xs font-semibold text-even-pink-800 hover:bg-even-pink-100"
          >
            Dismiss (not a problem)
          </button>
        </form>
      </div>
    </details>
  );
}

function AddProblemControl({ patientId }: { patientId: string }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-even-blue-300 bg-even-blue-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-even-blue-700 hover:bg-even-blue-100">
        + Add problem
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-even-ink-200 bg-white p-3 shadow-lg">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
          Add a custom problem
        </p>
        <form action={actionSaveOverride} className="space-y-2">
          <input type="hidden" name="patient_id" value={patientId} />
          <input type="hidden" name="target_kind" value="problem" />
          <input type="hidden" name="action" value="add" />
          <input
            type="hidden"
            name="target_key"
            value="__doctor_added__"
          />
          <label className="block text-xs">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">Label</span>
            <input
              name="label"
              required
              placeholder="e.g., GERD"
              className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">Status</span>
            <select
              name="status"
              defaultValue="active"
              className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs"
            >
              <option value="active">active</option>
              <option value="controlled">controlled</option>
              <option value="resolved">resolved</option>
            </select>
          </label>
          <label className="block text-xs">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-even-ink-500">Note</span>
            <textarea
              name="note"
              rows={2}
              placeholder="optional"
              className="w-full rounded-md border border-even-ink-200 bg-white px-2 py-1 text-xs"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-even-blue px-2 py-1.5 text-xs font-semibold text-white hover:bg-even-blue-700"
          >
            Add problem
          </button>
        </form>
      </div>
    </details>
  );
}

function ProblemStatusPill({ status }: { status: string }) {
  const variants: Record<string, string> = {
    active: 'border-even-pink-200 bg-even-pink-50 text-even-pink-800',
    controlled: 'border-even-blue-200 bg-even-blue-50 text-even-blue-800',
    resolved: 'border-even-ink-200 bg-white text-even-ink-500',
  };
  const cls = variants[status] ?? variants.active;
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Medication history
// ---------------------------------------------------------------------------

function MedicationHistorySection({
  meds,
}: {
  meds: MedicationHistoryEntry[];
}) {
  const sorted = [...meds].sort((a, b) => {
    const al = a.last_prescribed ?? '';
    const bl = b.last_prescribed ?? '';
    return bl.localeCompare(al);
  });

  return (
    <div className="mt-6 rounded-xl border border-even-ink-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            Medication history
          </h2>
          <span className="rounded-full border border-even-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-ink-500">
            {sorted.length}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-even-ink-400">
          most recent first
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-even-ink-500">No prescriptions on file.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-even-ink-100 text-left text-[10px] uppercase tracking-wider text-even-ink-500">
              <th className="py-2 pr-3 font-medium">Generic</th>
              <th className="py-2 pr-3 font-medium">Frequency</th>
              <th className="py-2 pr-3 font-medium">First</th>
              <th className="py-2 pr-3 font-medium">Last</th>
              <th className="py-2 pr-3 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => (
              <tr
                key={`${m.generic ?? 'x'}-${i}`}
                className="border-b border-even-ink-100/50 last:border-b-0"
              >
                <td className="py-2 pr-3 align-top">
                  <div className="flex items-center gap-2">
                    <span
                      aria-label="AI-derived"
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
                    />
                    <div className="text-sm font-medium text-even-navy">
                      {m.generic ?? '—'}
                    </div>
                  </div>
                </td>
                <td className="py-2 pr-3 align-top text-xs text-even-ink-600">
                  {m.frequency_normal ?? '—'}
                </td>
                <td className="py-2 pr-3 align-top text-xs text-even-ink-500">
                  {m.first_prescribed ?? '—'}
                </td>
                <td className="py-2 pr-3 align-top text-xs text-even-ink-500">
                  {m.last_prescribed ?? '—'}
                </td>
                <td className="py-2 pr-3 align-top">
                  {m.active === false ? (
                    <span className="inline-block rounded-full border border-even-ink-200 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-ink-500">
                      stopped
                    </span>
                  ) : (
                    <span className="inline-block rounded-full border border-even-blue-200 bg-even-blue-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-blue-800">
                      active
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Allergy + risk profile strip
// ---------------------------------------------------------------------------

function AllergiesSection({
  patientId,
  ownerAllergies,
  aggregations,
  redFlags,
  overrides,
}: {
  patientId: string;
  ownerAllergies: string | null;
  aggregations: AllergyAggregationEntry[];
  redFlags: { kind?: string; text?: string; severity?: string }[];
  overrides: OverrideRow[];
}) {
  // Apply allergy dismissals — drop entries the doctor marked false_positive.
  const dismissed = new Set(
    overrides
      .filter((o) => o.target_kind === 'allergy' && o.action === 'dismiss')
      .map((o) => o.target_key.toLowerCase()),
  );
  // Merge: doctor-entered free text (patients.known_allergies) +
  // AI-aggregated entries + red-flag rows with kind='allergy'.
  // Dedupe loosely on lowercased allergen string.
  const seen = new Set<string>();
  const items: Array<{
    allergen: string;
    source: string;
    confidence?: string;
    fromOwner?: boolean;
  }> = [];

  if (ownerAllergies && ownerAllergies.trim() && ownerAllergies !== 'None') {
    for (const piece of ownerAllergies.split(/[,;]/)) {
      const a = piece.trim();
      if (!a) continue;
      const k = a.toLowerCase();
      if (seen.has(k) || dismissed.has(k)) continue;
      seen.add(k);
      items.push({
        allergen: a,
        source: 'On file (intake)',
        fromOwner: true,
      });
    }
  }

  for (const a of aggregations) {
    if (!a.allergen) continue;
    const k = a.allergen.toLowerCase();
    if (seen.has(k) || dismissed.has(k)) continue;
    seen.add(k);
    items.push({
      allergen: a.allergen,
      source: a.source ?? '—',
      confidence: a.confidence,
    });
  }

  const allergyFlags = redFlags.filter((f) => f.kind === 'allergy' && f.text);
  for (const f of allergyFlags) {
    const k = (f.text ?? '').toLowerCase();
    if (!k || seen.has(k) || dismissed.has(k)) continue;
    seen.add(k);
    items.push({
      allergen: f.text ?? '—',
      source: 'AI red flag',
      confidence: f.severity,
    });
  }

  const nonAllergyFlags = redFlags.filter(
    (f) => f.kind !== 'allergy' && f.text,
  );

  return (
    <div className="mt-6 rounded-xl border border-even-pink-200 bg-even-pink-50/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-even-pink-900">
          Allergies & risk
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-even-pink-700">
          flagged for the doctor
        </span>
      </div>

      {items.length === 0 && nonAllergyFlags.length === 0 ? (
        <p className="text-sm text-even-pink-800">
          No allergies or risk flags recorded.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li
              key={`a-${i}`}
              className="flex items-start justify-between gap-3 rounded-md border border-even-pink-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {!it.fromOwner && (
                    <span
                      aria-label="AI-derived"
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
                    />
                  )}
                  <span className="text-sm font-medium text-even-pink-900">
                    {it.allergen}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-even-pink-700">
                  {it.source}
                  {it.confidence ? <> · {it.confidence} confidence</> : null}
                </div>
              </div>
              <form action={actionSaveOverride}>
                <input type="hidden" name="patient_id" value={patientId} />
                <input type="hidden" name="target_kind" value="allergy" />
                <input type="hidden" name="target_key" value={it.allergen} />
                <input type="hidden" name="action" value="dismiss" />
                <button
                  type="submit"
                  aria-label={`Dismiss ${it.allergen}`}
                  className="ml-2 rounded-md border border-even-pink-200 bg-white px-2 py-1 text-[10px] font-medium text-even-pink-700 hover:border-even-pink-300 hover:bg-even-pink-50"
                >
                  Dismiss
                </button>
              </form>
            </li>
          ))}
          {nonAllergyFlags.map((f, i) => (
            <li
              key={`f-${i}`}
              className="flex items-start justify-between gap-3 rounded-md border border-even-pink-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    aria-label="AI-derived"
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
                  />
                  <span className="text-sm font-medium text-even-pink-900">
                    {f.text}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-even-pink-700">
                  {f.kind ?? 'flag'}
                  {f.severity ? <> · {f.severity}</> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Encounter timeline
// ---------------------------------------------------------------------------

function EncounterTimelineSection({
  encounters,
}: {
  encounters: EncounterCardRow[];
}) {
  return (
    <div className="mt-6 rounded-xl border border-even-ink-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            Encounter timeline
          </h2>
          <span className="rounded-full border border-even-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-ink-500">
            {encounters.length}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-even-ink-400">
          newest first
        </span>
      </div>

      {encounters.length === 0 ? (
        <p className="text-sm text-even-ink-500">
          No completed encounters yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {encounters.map((e) => (
            <EncounterCard key={e.id} encounter={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

function EncounterCard({ encounter: e }: { encounter: EncounterCardRow }) {
  const rxLines = Array.isArray(e.prescription_lines)
    ? e.prescription_lines
    : [];
  const rxSummary = rxLines
    .map((l) => {
      const brand = l.brand ?? l.generic ?? '';
      const strength = l.strength ?? '';
      return [brand, strength].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  const moreCount = rxLines.length > 3 ? rxLines.length - 3 : 0;
  const primaryCode = (e.assessment_codes ?? [])[0] ?? null;

  return (
    <li className="rounded-lg border border-even-ink-100 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-even-ink-500">
            {e.encounter_date}
          </span>
          <span className="font-mono text-[10px] text-even-ink-400">
            {e.encounter_number}
          </span>
        </div>
        <Link
          href={`/dashboard/encounters/${e.id}`}
          className="text-[10px] font-medium uppercase tracking-wider text-even-blue-700 hover:text-even-blue-800 hover:underline"
        >
          Open →
        </Link>
      </div>

      {(e.chief_complaint_chips?.length ?? 0) > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(e.chief_complaint_chips ?? []).map((chip) => (
            <span
              key={chip}
              className="inline-block rounded-full border border-even-ink-200 bg-white px-2 py-0.5 text-[10px] text-even-ink-700"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      {(primaryCode || e.assessment_text) && (
        <p className="mb-1.5 text-xs text-even-ink-700">
          {primaryCode ? (
            <span className="font-mono text-even-blue-700">{primaryCode}</span>
          ) : null}
          {primaryCode && e.assessment_text ? ' · ' : ''}
          {e.assessment_text ?? ''}
        </p>
      )}

      {rxSummary && (
        <p className="mb-1.5 text-xs text-even-ink-600">
          <span className="font-medium text-even-ink-500">Rx:</span> {rxSummary}
          {moreCount > 0 ? (
            <span className="text-even-ink-400"> +{moreCount} more</span>
          ) : null}
        </p>
      )}

      {e.disposition && (
        <p className="text-[10px] uppercase tracking-wider text-even-ink-500">
          {e.disposition.replace(/_/g, ' ')}
          {e.follow_up_days ? <> · in {e.follow_up_days}d</> : null}
          {e.referral_target ? <> · {e.referral_target}</> : null}
        </p>
      )}
    </li>
  );
}
