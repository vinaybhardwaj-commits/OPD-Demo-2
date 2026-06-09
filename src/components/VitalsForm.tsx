/**
 * <VitalsForm> — client-side triage vitals capture (v2.0.4.2).
 *
 * Live behaviour:
 *   - BMI auto-computed from weight + height (kg, cm)
 *   - Red-zone inline highlight per Round 2 thresholds:
 *       BP    sys ≥180 OR dia ≥110
 *       HR    <50 OR >110
 *       Temp  >38.5
 *       SpO₂  <92
 *   - Pain shown as a 0-10 slider with current value
 *   - Submit disabled while pending; useTransition tracks save state
 *
 * Required fields (per Round 2 vitals lock):
 *   BP, HR, Temp, SpO₂, Weight, Height, Pain
 * Optional:
 *   RR, refined chief complaint, free-text notes
 */
'use client';

import { useMemo, useState, useTransition } from 'react';
import { actionSaveVitals } from '@/app/triage/actions';

export type VitalsFormProps = {
  encounterId: string;
  patientName: string;
  patientMrn: string;
  patientAge: number;
  patientSex: 'M' | 'F' | 'O';
  ccePrefilledReason: string | null;
};

function rzBp(sys: number | '', dia: number | ''): boolean {
  if (typeof sys === 'number' && sys >= 180) return true;
  if (typeof dia === 'number' && dia >= 110) return true;
  return false;
}
function rzHr(v: number | ''): boolean {
  return typeof v === 'number' && (v < 50 || v > 110);
}
function rzTemp(v: number | ''): boolean {
  return typeof v === 'number' && v > 38.5;
}
function rzSpo2(v: number | ''): boolean {
  return typeof v === 'number' && v < 92;
}

export function VitalsForm(props: VitalsFormProps) {
  const [bpSys, setBpSys] = useState<number | ''>('');
  const [bpDia, setBpDia] = useState<number | ''>('');
  const [hr, setHr] = useState<number | ''>('');
  const [rr, setRr] = useState<number | ''>('');
  const [temp, setTemp] = useState<number | ''>('');
  const [spo2, setSpo2] = useState<number | ''>('');
  const [weight, setWeight] = useState<number | ''>('');
  const [height, setHeight] = useState<number | ''>('');
  const [pain, setPain] = useState<number>(0);
  const [ccText, setCcText] = useState<string>(props.ccePrefilledReason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bmi = useMemo(() => {
    if (typeof weight !== 'number' || typeof height !== 'number') return null;
    if (height <= 0) return null;
    const m = height / 100;
    const b = weight / (m * m);
    return Math.round(b * 10) / 10;
  }, [weight, height]);

  const bmiBand = useMemo(() => {
    if (bmi == null) return null;
    if (bmi < 18.5) return { label: 'underweight', cls: 'text-amber-700' };
    if (bmi < 25) return { label: 'normal', cls: 'text-green-700' };
    if (bmi < 30) return { label: 'overweight', cls: 'text-amber-700' };
    return { label: 'obese', cls: 'text-even-pink-800' };
  }, [bmi]);

  const flagBp = rzBp(bpSys, bpDia);
  const flagHr = rzHr(hr);
  const flagTemp = rzTemp(temp);
  const flagSpo2 = rzSpo2(spo2);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    // Required: BP, HR, Temp, SpO2, Weight, Height, Pain (pain is always set since default 0).
    if (
      bpSys === '' ||
      bpDia === '' ||
      hr === '' ||
      temp === '' ||
      spo2 === '' ||
      weight === '' ||
      height === ''
    ) {
      setError('All vitals (except RR) are required.');
      return;
    }
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await actionSaveVitals(fd);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed.');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="encounter_id" value={props.encounterId} />

      {/* Vitals grid */}
      <fieldset
        disabled={pending}
        className="grid grid-cols-2 gap-4 rounded-xl border border-even-ink-200 bg-white p-5 sm:grid-cols-3"
      >
        <legend className="px-1 text-[10px] uppercase tracking-wider text-even-ink-500">
          Vitals — required
        </legend>

        <VitalPair label="BP" flag={flagBp} hint="systolic / diastolic · mmHg" warn="≥ 180/110">
          <input
            type="number" required min={50} max={260}
            name="bp_sys"
            value={bpSys}
            onChange={(e) => setBpSys(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="120"
            className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              flagBp
                ? 'border-even-pink-400 bg-even-pink-50 focus:border-even-pink-500 focus:ring-even-pink-100'
                : 'border-even-ink-200 bg-white focus:border-even-blue focus:ring-even-blue-100'
            }`}
          />
          <span className="text-even-ink-400">/</span>
          <input
            type="number" required min={30} max={160}
            name="bp_dia"
            value={bpDia}
            onChange={(e) => setBpDia(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="80"
            className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              flagBp
                ? 'border-even-pink-400 bg-even-pink-50 focus:border-even-pink-500 focus:ring-even-pink-100'
                : 'border-even-ink-200 bg-white focus:border-even-blue focus:ring-even-blue-100'
            }`}
          />
        </VitalPair>

        <VitalSingle label="HR" suffix="bpm" flag={flagHr} warn="< 50 or > 110">
          <input
            type="number" required min={20} max={220}
            name="hr"
            value={hr}
            onChange={(e) => setHr(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="72"
            className={inputCls(flagHr)}
          />
        </VitalSingle>

        <VitalSingle label="RR" suffix="/min" hint="optional" flag={false}>
          <input
            type="number" min={4} max={60}
            name="rr"
            value={rr}
            onChange={(e) => setRr(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="16"
            className={inputCls(false)}
          />
        </VitalSingle>

        <VitalSingle label="Temp" suffix="°C" flag={flagTemp} warn="> 38.5">
          <input
            type="number" required step="0.1" min={32} max={43}
            name="temp_c"
            value={temp}
            onChange={(e) => setTemp(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="36.7"
            className={inputCls(flagTemp)}
          />
        </VitalSingle>

        <VitalSingle label="SpO₂" suffix="%" flag={flagSpo2} warn="< 92">
          <input
            type="number" required min={50} max={100}
            name="spo2"
            value={spo2}
            onChange={(e) => setSpo2(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="98"
            className={inputCls(flagSpo2)}
          />
        </VitalSingle>

        <VitalSingle label="Weight" suffix="kg">
          <input
            type="number" required step="0.1" min={1} max={250}
            name="weight_kg"
            value={weight}
            onChange={(e) => setWeight(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="70"
            className={inputCls(false)}
          />
        </VitalSingle>

        <VitalSingle label="Height" suffix="cm">
          <input
            type="number" required min={30} max={220}
            name="height_cm"
            value={height}
            onChange={(e) => setHeight(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="168"
            className={inputCls(false)}
          />
        </VitalSingle>

        <div className="rounded-md border border-even-ink-100 bg-even-ink-50/40 px-3 py-2">
          <p className="mb-0.5 text-[10px] uppercase tracking-wider text-even-ink-500">
            BMI
          </p>
          {bmi == null ? (
            <p className="text-sm text-even-ink-400">—</p>
          ) : (
            <p className={`text-lg font-semibold ${bmiBand?.cls ?? ''}`}>
              {bmi.toFixed(1)}
              <span className="ml-1 text-[10px] font-medium uppercase tracking-wider">
                {bmiBand?.label}
              </span>
            </p>
          )}
        </div>

        <div className="col-span-2 sm:col-span-3">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
            Pain (0–10)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range" min={0} max={10} step={1}
              name="pain"
              value={pain}
              onChange={(e) => setPain(Number(e.target.value))}
              className="flex-1"
            />
            <span
              className={`tabular-nums text-lg font-semibold ${
                pain >= 7 ? 'text-even-pink-800' : pain >= 4 ? 'text-amber-700' : 'text-even-navy'
              }`}
            >
              {pain}
            </span>
          </div>
        </div>
      </fieldset>

      {/* Refine CC */}
      <div className="rounded-xl border border-even-ink-200 bg-white p-5">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
            Refine chief complaint{' '}
            {props.ccePrefilledReason && (
              <span className="font-normal normal-case tracking-normal text-even-ink-400">
                (CCE wrote: "{props.ccePrefilledReason}")
              </span>
            )}
          </span>
          <textarea
            name="chief_complaint_text"
            value={ccText}
            onChange={(e) => setCcText(e.target.value)}
            rows={3}
            placeholder="Add detail the patient just shared — doctor will see this."
            className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-xs text-even-pink-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <a
          href="/triage"
          className="rounded-lg border border-even-ink-200 bg-white px-4 py-2 text-sm font-medium text-even-ink-600 hover:text-even-navy"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save & mark ready for doctor'}
        </button>
      </div>
    </form>
  );
}

function inputCls(flag: boolean): string {
  return flag
    ? 'w-full rounded-md border border-even-pink-400 bg-even-pink-50 px-3 py-2 text-sm focus:border-even-pink-500 focus:outline-none focus:ring-2 focus:ring-even-pink-100'
    : 'w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100';
}

function VitalSingle({
  label,
  suffix,
  hint,
  flag,
  warn,
  children,
}: {
  label: string;
  suffix?: string;
  hint?: string;
  flag?: boolean;
  warn?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-even-ink-500">
          {label} {suffix && <span className="font-normal text-even-ink-400">· {suffix}</span>}
        </span>
        {hint && <span className="text-[9px] uppercase tracking-wider text-even-ink-400">{hint}</span>}
      </span>
      <div className="flex items-center gap-1.5">{children}</div>
      {flag && warn && (
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-even-pink-800">
          ⚠ red-zone: {warn}
        </p>
      )}
    </label>
  );
}

function VitalPair({
  label,
  hint,
  flag,
  warn,
  children,
}: {
  label: string;
  hint?: string;
  flag?: boolean;
  warn?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-even-ink-500">{label}</span>
        {hint && <span className="text-[9px] uppercase tracking-wider text-even-ink-400">{hint}</span>}
      </span>
      <div className="flex items-center gap-1.5">{children}</div>
      {flag && warn && (
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-even-pink-800">
          ⚠ red-zone: {warn}
        </p>
      )}
    </label>
  );
}
