'use client';

/**
 * <SubmitConfirmModal /> per design doc §4.6 — the "digestible 2-3-second
 * preview" before the prescription is dispatched.
 *
 * Sequence on confirm:
 *   1. POST /api/encounters/[id]/complete   (flips status → completed,
 *      requires disposition; existing endpoint)
 *   2. POST /api/encounters/[id]/dispatch   (PDF + Twilio mock/real)
 *   3. Show success state for ~2s
 *   4. router.push('/dashboard')
 *
 * The doctor only sees one confirmation. If either step fails the modal
 * surfaces the error and stays open so the doctor can retry.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lookupIcd10 } from '@/lib/icd10';
import type { PrescriptionLine } from './DrugRow';

type DdxFinding = {
  condition: string;
  likelihood: 'high' | 'medium' | 'low';
  rationale: string;
  source_encounter_ids: string[];
};

type DdxState =
  | { kind: 'loading' }
  | { kind: 'ok'; findings: DdxFinding[] }
  | { kind: 'failed'; error: string }
  | { kind: 'empty' };

export type SubmitConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  encounterId: string;
  patient: {
    name: string;
    age_years: number;
    sex: string;
    mrn: string;
    phone_e164: string | null;
  };
  assessment: {
    text: string | null;
    codes: string[];
  };
  disposition: string | null;
  follow_up_days: number | null;
  referral_target: string | null;
};

type Phase = 'preview' | 'sending' | 'success' | 'error';

export function SubmitConfirmModal({
  open,
  onClose,
  encounterId,
  patient,
  assessment,
  disposition,
  follow_up_days,
  referral_target,
}: SubmitConfirmModalProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('preview');
  const [error, setError] = useState<string | null>(null);
  const [dispatchInfo, setDispatchInfo] = useState<{
    pdf_blob_url: string;
    mode: string;
  } | null>(null);
  const [prescription_lines, setPrescriptionLines] = useState<PrescriptionLine[]>([]);
  const [loadingRx, setLoadingRx] = useState(false);
  const [ddx, setDdx] = useState<DdxState>({ kind: 'loading' });

  // Fetch the live prescription state every time the modal opens.
  // The PrescriptionCompose's debounced auto-save has usually flushed
  // by now, but reading from the server guarantees the preview matches
  // what /dispatch will actually serialize into the PDF.
  useEffect(() => {
    if (!open) return;
    setLoadingRx(true);
    setPhase('preview');
    setError(null);
    setDispatchInfo(null);
    setDdx({ kind: 'loading' });
    fetch(`/api/encounters/${encounterId}/prescription`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; prescription?: { lines?: PrescriptionLine[] } | null }) => {
        if (j.ok) setPrescriptionLines(j.prescription?.lines ?? []);
      })
      .catch(() => {
        /* fall back to empty; the dispatch endpoint will still find DB-side lines */
      })
      .finally(() => setLoadingRx(false));

    // v2.2.2 — Fire the DDx scan in parallel. Renders inline.
    fetch(`/api/encounters/${encounterId}/ddx`, { method: 'POST' })
      .then((r) => r.json())
      .then(
        (j: {
          ok?: boolean;
          status?: 'ok' | 'failed';
          findings?: DdxFinding[];
          error?: string;
        }) => {
          if (j.status === 'failed') {
            setDdx({ kind: 'failed', error: j.error ?? 'ddx_failed' });
          } else if (j.status === 'ok' && j.findings && j.findings.length > 0) {
            setDdx({ kind: 'ok', findings: j.findings });
          } else {
            setDdx({ kind: 'empty' });
          }
        },
      )
      .catch((e) =>
        setDdx({
          kind: 'failed',
          error: e instanceof Error ? e.message : 'network_error',
        }),
      );
  }, [open, encounterId]);

  if (!open) return null;

  async function onConfirm() {
    setPhase('sending');
    setError(null);
    try {
      // 1. Complete (flips encounter to 'completed')
      const completeRes = await fetch(`/api/encounters/${encounterId}/complete`, {
        method: 'POST',
      });
      const completeJson = (await completeRes.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!completeRes.ok || !completeJson.ok) {
        // 409 already_completed is fine — proceed to dispatch
        if (completeJson.error !== 'already_completed') {
          setPhase('error');
          setError(completeJson.detail ?? completeJson.error ?? 'Could not finish encounter.');
          return;
        }
      }

      // 2. Dispatch
      const dispatchRes = await fetch(`/api/encounters/${encounterId}/dispatch`, {
        method: 'POST',
      });
      const dispatchJson = (await dispatchRes.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        pdf_blob_url?: string;
        mode?: string;
      };
      if (!dispatchRes.ok || !dispatchJson.ok) {
        setPhase('error');
        setError(dispatchJson.detail ?? dispatchJson.error ?? 'Could not dispatch.');
        return;
      }

      setDispatchInfo({
        pdf_blob_url: dispatchJson.pdf_blob_url ?? '',
        mode: dispatchJson.mode ?? 'demo',
      });
      setPhase('success');

      // Auto-redirect after a beat so doctor sees the success state
      setTimeout(() => {
        router.push('/dashboard');
        router.refresh();
      }, 2500);
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-even-navy/40 px-4 py-6 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase === 'preview') onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm and send prescription"
        className="w-full max-w-xl rounded-2xl border border-even-ink-100 bg-white shadow-2xl"
      >
        {phase === 'success' ? (
          <SuccessView patient={patient} mode={dispatchInfo?.mode ?? 'demo'} />
        ) : (
          <>
            <header className="border-b border-even-ink-100 px-5 py-4">
              <h2 className="text-base font-semibold text-even-navy">
                Confirm &amp; send
              </h2>
              <p className="mt-0.5 text-xs text-even-ink-500">
                Quick check, then we&apos;ll fire the prescription off to the
                patient and the pharmacy.
              </p>
            </header>

            <div className="space-y-4 px-5 py-4 text-sm">
              {/* Patient + recipient line */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                  Patient
                </p>
                <p className="mt-1 text-even-navy">
                  <span className="font-semibold">{patient.name}</span>{' '}
                  <span className="text-even-ink-500">
                    · {patient.age_years}{patient.sex}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-even-ink-400">
                    {patient.mrn}
                  </span>
                </p>
                <p className="mt-1 text-xs text-even-ink-500">
                  WhatsApp →{' '}
                  <span className="font-mono">
                    {patient.phone_e164 ?? '— no number on file —'}
                  </span>
                </p>
              </div>

              {/* Diagnosis */}
              {(assessment.codes.length > 0 || assessment.text) && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                    Diagnosis
                  </p>
                  {assessment.codes.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {assessment.codes.map((c) => (
                        <span
                          key={c}
                          className="inline-flex items-center gap-1.5 rounded-full bg-even-blue-50 px-2 py-0.5 text-[11px] font-medium text-even-blue-800 ring-1 ring-even-blue-200"
                        >
                          <span className="font-mono font-semibold">{c}</span>
                          <span className="hidden sm:inline">
                            {lookupIcd10(c) ?? ''}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {assessment.text && (
                    <p className="mt-1 text-xs text-even-ink-600">{assessment.text}</p>
                  )}
                </div>
              )}

              {/* v2.2.2 — Did you consider? */}
              <DdxSection state={ddx} />

              {/* Prescription summary */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                  Prescription · {prescription_lines.length}{' '}
                  {prescription_lines.length === 1 ? 'drug' : 'drugs'}
                </p>
                {loadingRx ? (
                  <p className="mt-1 text-xs italic text-even-ink-400">
                    Loading…
                  </p>
                ) : prescription_lines.length === 0 ? (
                  <p className="mt-1 text-xs italic text-even-ink-500">
                    No drugs on the prescription — advice-only PDF.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-even-ink-700">
                    {prescription_lines.map((l, i) => (
                      <li key={`${l.item_code}-${i}`}>
                        <span className="font-medium text-even-navy">
                          {l.brand_name}
                          {l.strength ? ` ${l.strength}` : ''}
                        </span>
                        <span className="text-even-ink-500">
                          {' · '}
                          {[l.frequency, l.duration_days && `${l.duration_days}d`, l.timing]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Disposition */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                  Disposition
                </p>
                <p className="mt-1 text-sm font-medium text-even-blue-700">
                  {disposition?.replace('_', ' ') ?? '—'}
                  {disposition === 'follow_up' && follow_up_days
                    ? ` · ${follow_up_days} days`
                    : ''}
                  {disposition === 'refer' && referral_target
                    ? ` · ${referral_target}`
                    : ''}
                </p>
              </div>

              {/* Recipients banner */}
              <div className="rounded-lg border border-even-blue-100 bg-even-blue-50 px-3 py-2 text-xs text-even-navy">
                Will WhatsApp the PDF to:
                <ul className="mt-1 list-inside list-disc text-even-ink-700">
                  <li>
                    Patient{' '}
                    <span className="font-mono text-even-ink-500">
                      {patient.phone_e164 ?? '(no number)'}
                    </span>
                  </li>
                  <li>EHRC Pharmacy</li>
                </ul>
              </div>

              {error && (
                <div className="rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-xs text-even-pink-800">
                  {error}
                </div>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-even-ink-100 px-5 py-3">
              <button
                type="button"
                disabled={phase === 'sending'}
                onClick={onClose}
                className="rounded-lg border border-even-ink-200 bg-white px-4 py-2 text-sm font-semibold text-even-navy transition hover:border-even-ink-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={phase === 'sending'}
                onClick={onConfirm}
                className="rounded-lg bg-even-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-even-blue-700 disabled:opacity-50"
              >
                {phase === 'sending' ? 'Sending…' : 'Confirm & send'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function DdxSection({ state }: { state: DdxState }) {
  if (state.kind === 'empty') return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
        Did you consider?{' '}
        <span className="font-normal text-even-ink-400">· ✨ DDx</span>
      </p>
      {state.kind === 'loading' && (
        <p className="mt-1 text-xs italic text-even-ink-400">
          Running differential…
        </p>
      )}
      {state.kind === 'failed' && (
        <p className="mt-1 rounded-md bg-even-ink-50 px-2 py-1 text-[11px] text-even-ink-500">
          DDx unavailable — AI failed ({state.error}). Submit isn&apos;t
          blocked.
        </p>
      )}
      {state.kind === 'ok' && (
        <ul className="mt-1 space-y-1.5">
          {state.findings.map((f, idx) => (
            <li
              key={idx}
              className={`rounded-md border px-3 py-2 text-[11px] ${
                f.likelihood === 'high'
                  ? 'border-even-pink-200 bg-even-pink-50/60'
                  : f.likelihood === 'medium'
                  ? 'border-amber-200 bg-amber-50/60'
                  : 'border-even-ink-200 bg-white'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-even-navy">
                  {f.condition}
                </span>
                <span className="text-[9px] font-medium uppercase tracking-wider text-even-ink-500">
                  {f.likelihood} likelihood
                </span>
              </div>
              <p className="mt-0.5 text-even-ink-700">{f.rationale}</p>
              {f.source_encounter_ids.length > 0 && (
                <p className="mt-1 font-mono text-[9px] text-even-ink-400">
                  Based on{' '}
                  {f.source_encounter_ids.length === 1 ? 'encounter' : 'encounters'}{' '}
                  {f.source_encounter_ids
                    .map((id) => id.slice(0, 8))
                    .join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SuccessView({
  patient,
  mode,
}: {
  patient: { name: string; phone_e164: string | null };
  mode: string;
}) {
  return (
    <div className="px-8 py-10 text-center">
      <div
        aria-hidden
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-even-blue-50 ring-4 ring-even-blue-100"
      >
        <span className="text-2xl text-even-blue">✓</span>
      </div>
      <h2 className="text-lg font-semibold text-even-navy">Sent</h2>
      <p className="mt-1 text-sm text-even-ink-600">
        Prescription dispatched to{' '}
        <span className="font-semibold text-even-navy">{patient.name}</span>
        {patient.phone_e164 && (
          <>
            {' '}at <span className="font-mono">{patient.phone_e164}</span>
          </>
        )}{' '}
        and the EHRC pharmacy.
      </p>
      {mode === 'demo' && (
        <p className="mt-3 inline-block rounded-full bg-even-pink-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-even-pink-800">
          Demo mode — Twilio sends are logged, not delivered
        </p>
      )}
      <p className="mt-4 text-xs text-even-ink-400">Back to queue…</p>
    </div>
  );
}
