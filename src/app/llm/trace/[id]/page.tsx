/**
 * /app/llm/trace/[id]/page.tsx
 *
 * v6.0 — Forensic detail page for a single LLM pipeline run.
 *
 * Decision Q6: surface-agnostic URL `/llm/trace/[id]`. Page header shows
 * the surface name. Body lists every event with timestamps + ms +
 * msg, then the request input, then the result summary, then the
 * model_calls audit, then the row metadata footer.
 *
 * Auth: doctor must be logged in. Cross-doctor traces ARE viewable
 * (audit value: any doctor can review what AI told another doctor on
 * a shared patient) — gated only by signed-in status, not by ownership.
 * Admin sees everything regardless.
 */

import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getTrace } from '@/lib/llm-trace/log';
import { formatDuration } from '@/lib/llm-trace/format-duration';
import { sanitizeModelNames } from '@/lib/llm-trace/model-labels';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const SURFACE_LABEL: Record<string, string> = {
  ddx: 'Differential',
  'transcribe-compare': 'Voice transcription compare',
  'suggest-orders': 'Suggest diagnostic orders',
  'icd10-suggest': 'ICD-10 suggestion',
  'rx-coherence': 'Rx coherence check',
  'ddi-scan': 'Drug-interaction scan',
  'comorbidity-history': 'Comorbidities from history',
  'comorbidity-context': 'Comorbidities from context',
  'comorbidity-states': 'Comorbidity-state suggestion',
  'voice-query': 'Ask-the-chart',
  'patient-summary': 'Patient summary',
  'predict-plans': 'Plan prediction',
  'diagnostics-interpret': 'Diagnostics interpretation',
  'comorbidities-interpret': 'Comorbidities interpret',
  'icd10-interpret': 'ICD-10 interpret',
};

type Props = { params: Promise<{ id: string }> };

export default async function TraceDetailPage({ params }: Props) {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const { id } = await params;
  const trace = await getTrace(id);
  if (!trace) return notFound();

  const surfaceLabel = SURFACE_LABEL[trace.surface] ?? trace.surface;
  const eventsArr = trace.events ?? [];
  const startedAt = new Date(trace.started_at);
  const completedAt = trace.completed_at ? new Date(trace.completed_at) : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <Link href="/dashboard" className="text-xs text-even-blue hover:underline">
          ← Dashboard
        </Link>
      </div>

      <header className="mb-6 border-b border-even-ink-100 pb-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold text-even-navy">
            {surfaceLabel}
          </h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              trace.status === 'completed'
                ? 'bg-emerald-50 text-emerald-700'
                : trace.status === 'errored'
                  ? 'bg-rose-50 text-rose-700'
                  : trace.status === 'aborted'
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-amber-50 text-amber-700'
            }`}
          >
            {trace.status}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-even-ink-500">
          <div>
            <span className="text-even-ink-400">Trace ID</span>{' '}
            <code className="font-mono text-even-ink-700">{trace.id}</code>
          </div>
          <div>
            <span className="text-even-ink-400">Total time</span>{' '}
            <span className="text-even-ink-700">{formatDuration(trace.total_ms)}</span>
          </div>
          <div>
            <span className="text-even-ink-400">Started</span>{' '}
            <span className="text-even-ink-700">{startedAt.toLocaleString()}</span>
          </div>
          {completedAt && (
            <div>
              <span className="text-even-ink-400">Completed</span>{' '}
              <span className="text-even-ink-700">{completedAt.toLocaleString()}</span>
            </div>
          )}
          {trace.doctor_email && (
            <div>
              <span className="text-even-ink-400">Doctor</span>{' '}
              <span className="text-even-ink-700">{trace.doctor_email}</span>
            </div>
          )}
          {trace.encounter_id && (
            <div>
              <span className="text-even-ink-400">Encounter</span>{' '}
              <Link
                href={`/dashboard/encounters/${trace.encounter_id}`}
                className="text-even-blue hover:underline"
              >
                {trace.encounter_id.slice(0, 8)}…
              </Link>
            </div>
          )}
          {trace.patient_id && (
            <div>
              <span className="text-even-ink-400">Patient</span>{' '}
              <Link
                href={`/dashboard/patients/${trace.patient_id}`}
                className="text-even-blue hover:underline"
              >
                {trace.patient_id.slice(0, 8)}…
              </Link>
            </div>
          )}
        </div>
      </header>

      {trace.error_message && (
        <section className="mb-6 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <div className="font-medium">Error</div>
          <pre className="mt-1 whitespace-pre-wrap text-xs">{trace.error_message}</pre>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-even-navy">
          Pipeline events ({eventsArr.length})
        </h2>
        <ol className="space-y-1.5 rounded-md border border-even-ink-100 bg-white px-3 py-3 text-xs">
          {eventsArr.length === 0 && (
            <li className="italic text-even-ink-400">No events recorded.</li>
          )}
          {eventsArr.map((e, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-12 shrink-0 font-mono text-even-ink-400">
                {e.ms != null ? `+${Math.round(e.ms / 100) / 10}s` : ''}
              </span>
              <span className="w-24 shrink-0 font-medium text-even-navy">
                {e.stage}
              </span>
              <span className={`flex-1 ${e.error ? 'text-rose-700' : 'text-even-ink-700'}`}>
                {sanitizeModelNames(e.msg)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {trace.request_input != null && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-even-navy">Request input</h2>
          <pre className="overflow-x-auto rounded-md border border-even-ink-100 bg-slate-50 px-3 py-2 text-[11px] text-even-ink-700">
            {JSON.stringify(trace.request_input, null, 2)}
          </pre>
        </section>
      )}

      {trace.result_summary != null && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-even-navy">Result summary</h2>
          <pre className="overflow-x-auto rounded-md border border-even-ink-100 bg-slate-50 px-3 py-2 text-[11px] text-even-ink-700">
            {JSON.stringify(trace.result_summary, null, 2)}
          </pre>
        </section>
      )}

      {trace.model_calls != null && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-even-navy">Model calls</h2>
          <pre className="overflow-x-auto rounded-md border border-even-ink-100 bg-slate-50 px-3 py-2 text-[11px] text-even-ink-700">
            {JSON.stringify(trace.model_calls, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}
