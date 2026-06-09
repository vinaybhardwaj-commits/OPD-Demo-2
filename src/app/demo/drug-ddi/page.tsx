'use client';

/**
 * /demo/drug-ddi — standalone Qwen drug-interaction demo.
 *
 * No encounter, no sign-in required. Doctor (or anyone) picks 2+
 * drugs via the existing pg_trgm-backed <DrugTypeahead>, optionally
 * provides allergies + active conditions, hits "Check interactions"
 * → POST /api/demo/ddi-check → Qwen returns severity-tiered findings
 * → rendered inline.
 *
 * Lives publicly because there's nothing PHI-sensitive about the demo
 * inputs — the doctor is the one supplying drug names and conditions.
 */
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { DrugTypeahead } from '@/components/DrugTypeahead';
import type { DrugSearchResult } from '@/lib/types';

type DdiFinding = {
  severity: 'low' | 'moderate' | 'high' | 'severe';
  pair: [string, string];
  rationale: string;
  recommendation: string | null;
  scanned_at: string;
};

type ScanState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; findings: DdiFinding[]; latency_ms: number; scanned_at: string }
  | { kind: 'failed'; error: string };

const PRESET_PATIENTS = [
  {
    label: 'Elderly with diabetes + CKD',
    allergies: 'NKDA',
    conditions: 'Type 2 diabetes; CKD stage 3 (eGFR 38); Hypertension',
  },
  {
    label: 'Asthmatic with hypertension',
    allergies: 'Beta blockers (history of bronchospasm)',
    conditions: 'Asthma (moderate persistent); Essential hypertension',
  },
  {
    label: 'Pregnant patient (1st trimester)',
    allergies: 'NKDA',
    conditions: 'Intrauterine pregnancy ~10 weeks; Hyperthyroidism',
  },
  {
    label: 'On warfarin for AF',
    allergies: 'NKDA',
    conditions: 'Atrial fibrillation; On warfarin; Hypertension',
  },
];

export default function DrugDdiDemoPage() {
  const [picks, setPicks] = useState<DrugSearchResult[]>([]);
  const [allergies, setAllergies] = useState('');
  const [conditions, setConditions] = useState('');
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });

  const addPick = useCallback((d: DrugSearchResult) => {
    setPicks((prev) =>
      prev.some((p) => p.item_code === d.item_code) ? prev : [...prev, d],
    );
  }, []);

  const removePick = useCallback((item_code: string) => {
    setPicks((prev) => prev.filter((p) => p.item_code !== item_code));
  }, []);

  const onCheck = useCallback(async () => {
    if (picks.length < 1) return;
    setScan({ kind: 'loading' });
    const drugs = picks.map(
      (p) =>
        `${p.generic_name || p.brand_name}${p.strength ? ' ' + p.strength : ''}`,
    );
    try {
      const res = await fetch('/api/demo/ddi-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drugs, allergies, conditions }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        status?: 'ok' | 'failed';
        findings?: DdiFinding[];
        latency_ms?: number;
        scanned_at?: string;
        error?: string;
      };
      if (j.status === 'failed') {
        setScan({ kind: 'failed', error: j.error ?? 'qwen_failed' });
        return;
      }
      setScan({
        kind: 'ok',
        findings: j.findings ?? [],
        latency_ms: j.latency_ms ?? 0,
        scanned_at: j.scanned_at ?? new Date().toISOString(),
      });
    } catch (e) {
      setScan({
        kind: 'failed',
        error: e instanceof Error ? e.message : 'network_error',
      });
    }
  }, [picks, allergies, conditions]);

  const usePreset = useCallback(
    (p: (typeof PRESET_PATIENTS)[number]) => {
      setAllergies(p.allergies);
      setConditions(p.conditions);
    },
    [],
  );

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-6 px-6 py-4">
          <Link
            href="/auth/login"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Back to sign-in
          </Link>
          <span className="text-[10px] font-mono text-even-ink-400">
            Demo · drug search + Qwen DDI
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-even-navy">
          Drug interactions · Qwen sanity check
        </h1>
        <p className="mt-1 text-sm text-even-ink-600">
          Pick drugs from the formulary, add patient context, and ask Qwen
          to flag interactions and contraindications. No sign-in, no
          encounter — just the same engine that runs inside an encounter
          screen.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* Left column — drug picker + picked list */}
          <section className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                Search the EHRC formulary
              </label>
              <p className="mt-0.5 text-[11px] text-even-ink-500">
                2,174 drugs — typeahead matches brand and generic. Picks
                stack below.
              </p>
              <div className="mt-2">
                <DrugTypeahead
                  clearOnSelect
                  onSelect={addPick}
                  placeholder="Type a drug — e.g. ibuprofen, atorvastatin"
                />
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                Picked drugs · {picks.length}
              </p>
              {picks.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-even-ink-200 bg-white px-3 py-3 text-[11px] text-even-ink-400">
                  No drugs picked yet. Tap the search above.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {picks.map((p) => (
                    <li
                      key={p.item_code}
                      className="flex items-baseline justify-between gap-2 rounded-md border border-even-ink-200 bg-white px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-even-navy">
                          {p.brand_name}
                          {p.strength ? ` ${p.strength}` : ''}
                        </span>
                        <span className="block text-[11px] text-even-ink-500">
                          {p.generic_name}
                          {p.is_high_risk && (
                            <span className="ml-1 rounded-full bg-even-pink-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-even-pink-900">
                              high-risk
                            </span>
                          )}
                          {p.schedule_dc !== 'OTC' && (
                            <span className="ml-1 rounded-full bg-even-ink-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-even-ink-700">
                              Sched {p.schedule_dc}
                            </span>
                          )}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removePick(p.item_code)}
                        className="text-[16px] leading-none text-even-ink-300 hover:text-even-pink-700"
                        aria-label={`Remove ${p.brand_name}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Right column — patient context */}
          <section className="space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                Preset patient
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {PRESET_PATIENTS.map((p) => (
                  <li key={p.label}>
                    <button
                      type="button"
                      onClick={() => usePreset(p)}
                      className="rounded-full border border-even-ink-200 bg-white px-2.5 py-1 text-[11px] text-even-ink-700 transition hover:border-even-blue-300 hover:bg-even-blue-50"
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <label
                htmlFor="ddi-allergies"
                className="block text-[11px] font-semibold uppercase tracking-wider text-even-ink-500"
              >
                Known allergies
              </label>
              <input
                id="ddi-allergies"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="e.g. Penicillin, sulfa drugs"
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-even-ink-200 px-3 py-2 text-sm placeholder:text-even-ink-300 focus:border-even-navy focus:outline-none focus:ring-1 focus:ring-even-navy"
              />
            </div>

            <div>
              <label
                htmlFor="ddi-conditions"
                className="block text-[11px] font-semibold uppercase tracking-wider text-even-ink-500"
              >
                Active conditions
              </label>
              <textarea
                id="ddi-conditions"
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
                placeholder="e.g. Type 2 diabetes; CKD stage 3; Hypertension"
                rows={3}
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-even-ink-200 px-3 py-2 text-sm placeholder:text-even-ink-300 focus:border-even-navy focus:outline-none focus:ring-1 focus:ring-even-navy"
              />
              <p className="mt-1 text-[10px] text-even-ink-400">
                One per line, semicolon, or comma. Helps Qwen catch
                drug-condition risks (NSAID + CKD, BB + asthma, etc.).
              </p>
            </div>

            <button
              type="button"
              onClick={onCheck}
              disabled={picks.length === 0 || scan.kind === 'loading'}
              className="w-full rounded-lg bg-even-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-even-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scan.kind === 'loading'
                ? 'Asking Qwen…'
                : 'Check interactions →'}
            </button>
            <p className="text-[10px] text-even-ink-400">
              First call may take ~30s if Qwen is cold. Warm ~5–10s.
            </p>
          </section>
        </div>

        {/* Results */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-even-navy">
            Qwen findings
          </h2>
          {scan.kind === 'idle' && (
            <p className="mt-2 text-[11px] text-even-ink-500">
              Pick at least one drug and click &quot;Check interactions&quot;.
            </p>
          )}
          {scan.kind === 'loading' && (
            <p className="mt-2 text-[11px] italic text-even-ink-500">
              Scanning {picks.length} drug{picks.length === 1 ? '' : 's'}{' '}
              against active conditions + allergies…
            </p>
          )}
          {scan.kind === 'failed' && (
            <div className="mt-2 rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-[11px] text-even-pink-800">
              DDI scan failed: {scan.error}. Qwen may be cold — wait a few
              seconds and try again.
            </div>
          )}
          {scan.kind === 'ok' && (
            <div className="mt-3">
              {scan.findings.length === 0 ? (
                <p className="rounded-md border border-even-blue-200 bg-even-blue-50/50 px-3 py-2 text-[11px] text-even-blue-900">
                  ✓ No significant interactions flagged by Qwen for these
                  drugs + context.
                </p>
              ) : (
                <ul className="space-y-2">
                  {scan.findings.map((f, idx) => (
                    <Finding key={idx} f={f} />
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] text-even-ink-400">
                Qwen scan · {scan.latency_ms}ms ·{' '}
                {new Date(scan.scanned_at).toLocaleTimeString('en-IN')} ·
                always warn, never block — clinician decides.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function Finding({ f }: { f: DdiFinding }) {
  const isSevere = f.severity === 'severe';
  const isHigh = f.severity === 'high';
  const isModerate = f.severity === 'moderate';
  const tone = isSevere
    ? 'border-even-pink-400 bg-even-pink-50 text-even-pink-900'
    : isHigh
    ? 'border-even-pink-300 bg-even-pink-50/70 text-even-pink-900'
    : isModerate
    ? 'border-amber-300 bg-amber-50 text-amber-900'
    : 'border-even-ink-200 bg-white text-even-ink-700';
  const sevLabel = isSevere
    ? 'SEVERE — do not prescribe together'
    : isHigh
    ? 'HIGH'
    : isModerate
    ? 'MODERATE'
    : 'LOW';

  return (
    <li className={`rounded-md border px-3 py-2 text-[12px] ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {sevLabel}
        </span>
        <span className="font-mono text-[11px] opacity-80">
          {f.pair.join('  ⇄  ')}
        </span>
      </div>
      <p className="mt-1">{f.rationale}</p>
      {f.recommendation && (
        <p className="mt-1.5 italic opacity-90">→ {f.recommendation}</p>
      )}
    </li>
  );
}
