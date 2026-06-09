/**
 * /room/[id] — the Encounter Room (Surface B), P1.1 SHELL.
 *
 * Desktop dual-input capture surface from design §10. This sub-sprint
 * ships the chrome + lifecycle choreography:
 *   top bar (patient identity + vitals + lifecycle controls) ·
 *   left = structured-capture placeholder (classic editor linked) ·
 *   center = LIVE transcript rail (P1.3 — Deepgram, hybrid blocks) ·
 *   right = sessions timeline.
 * The classic /dashboard/encounters/[id] editor remains the typed-capture
 * surface until the dual-input merge (P1.3+). Lossless.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentDoctor } from '@/lib/auth';
import { loadRoomEncounter } from '@/lib/room';
import { RoomControls } from '@/components/room/RoomControls';
import { RoomCaptureProvider } from '@/components/room/RoomCapture';
import { LiveTranscript } from '@/components/room/LiveTranscript';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  ready: 'bg-even-blue-50 text-even-blue-700',
  in_room: 'bg-even-blue-600 text-white',
  out_for_workup: 'bg-amber-100 text-amber-800',
  back_ready: 'bg-emerald-100 text-emerald-800',
  processing: 'bg-violet-100 text-violet-800',
  ready_for_review: 'bg-violet-500 text-white',
  finalizing: 'bg-even-ink-200 text-even-ink-700',
  complete: 'bg-even-ink-100 text-even-ink-500',
  cancelled: 'bg-red-100 text-red-700',
};

function VitalChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md bg-even-ink-50 px-2 py-1 font-mono text-[11px] text-even-ink-700">
      <span className="mr-1 text-even-ink-400">{label}</span>
      {value}
    </span>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentDoctor();
  if (!session) redirect('/auth/login');

  const { id } = await params;
  const enc = await loadRoomEncounter(id);
  if (!enc) notFound();

  const v = (enc.vitals ?? {}) as Record<string, unknown>;
  const vitalChips: Array<[string, string]> = [];
  if (v.bp_sys && v.bp_dia) vitalChips.push(['BP', `${v.bp_sys}/${v.bp_dia}`]);
  if (v.pulse_bpm) vitalChips.push(['HR', `${v.pulse_bpm}`]);
  if (v.temp_c) vitalChips.push(['T', `${v.temp_c}°C`]);
  if (v.spo2_pct) vitalChips.push(['SpO₂', `${v.spo2_pct}%`]);
  if (v.weight_kg) vitalChips.push(['Wt', `${v.weight_kg}kg`]);

  return (
    <RoomCaptureProvider>
    <main className="min-h-screen bg-even-white-cream">
      {/* Top bar */}
      <div className="border-b border-even-ink-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/board" className="text-xs font-medium text-even-blue-600 hover:underline">
            ← Board
          </Link>
          <div className="text-sm font-bold text-even-navy-800">
            {enc.patient_name}
            <span className="ml-1.5 font-normal text-even-ink-500">
              {enc.age_years}
              {enc.sex ?? ''} · {enc.patient_mrn}
            </span>
          </div>
          <span className="font-mono text-[11px] text-even-ink-400">{enc.encounter_number}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[enc.clinical_status] ?? ''}`}
          >
            {enc.clinical_status.replace(/_/g, ' ')}
          </span>
          <span className="rounded-full bg-even-ink-50 px-2 py-0.5 text-[10px] text-even-ink-500">
            pipeline: {enc.processing_status}
          </span>
          <span className="rounded-full bg-even-ink-50 px-2 py-0.5 text-[10px] text-even-ink-500">
            phase: {enc.current_phase}
          </span>
          <div className="ml-auto">
            <RoomControls
              encounterId={enc.id}
              clinicalStatus={enc.clinical_status}
              openSessionSeq={enc.sessions.find((s) => !s.ended_at && s.status === 'recording')?.seq ?? null}
            />
          </div>
        </div>
        {(vitalChips.length > 0 || enc.known_allergies) && (
          <div className="mx-auto mt-2 flex max-w-[1500px] flex-wrap items-center gap-1.5">
            {vitalChips.map(([l, val]) => (
              <VitalChip key={l} label={l} value={val} />
            ))}
            {enc.known_allergies ? (
              <span className="rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
                ⚠ {enc.known_allergies}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Three columns */}
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-3 px-4 py-4 lg:grid-cols-[1fr_380px_300px]">
        {/* Structured capture (placeholder → classic editor) */}
        <section className="rounded-xl border border-even-ink-200 bg-white p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-even-ink-600">
            Structured note
          </h2>
          <p className="mt-2 text-sm text-even-ink-600">
            {enc.chief_complaint || enc.intake_visit_reason || 'No chief complaint captured yet.'}
          </p>
          <p className="mt-4 text-xs text-even-ink-400">
            Typed Sections merge into the Room in P1.3. Until then the classic editor stays the
            typed-capture surface:
          </p>
          <Link
            href={`/dashboard/encounters/${enc.id}`}
            className="mt-2 inline-block rounded-md bg-even-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-even-blue-700"
          >
            Open note editor
          </Link>
        </section>

        {/* Live transcript rail — P1.3 Deepgram live (hybrid blocks) */}
        <LiveTranscript encounterId={enc.id} />

        {/* Sessions timeline */}
        <section className="rounded-xl border border-even-ink-200 bg-white p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-even-ink-600">
            Sessions
          </h2>
          {enc.sessions.length === 0 ? (
            <p className="mt-2 text-xs text-even-ink-400">
              No recordings yet — "Start visit" opens session 1.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {enc.sessions.map((s) => (
                <li key={s.id} className="rounded-lg border border-even-ink-100 p-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-even-navy-800">
                      #{s.seq} · {s.phase.replace(/_/g, ' ')}
                    </span>
                    <span className="rounded-full bg-even-ink-50 px-1.5 text-[10px] text-even-ink-500">
                      {s.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-even-ink-400">
                    {fmtTime(s.started_at)} → {s.ended_at ? fmtTime(s.ended_at) : 'open'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
    </RoomCaptureProvider>
  );
}
