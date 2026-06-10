'use client';

/**
 * <DrugRow /> — the unit of prescription composition per design doc §4.5.
 *
 * Speed comes from making the common-case row finish in ONE tap (pick a
 * drug → smart defaults pre-fill chips → row is complete). Overrides
 * take 2-3 extra taps: tap a chip group → expand → tap the alternative
 * → collapse. Other chip groups on the row stay collapsed.
 *
 * Row shape (what the parent persists to prescriptions.lines[]):
 *
 *   {
 *     item_code, brand_name, generic_name, dosage_form, strength,
 *     schedule_dc, is_high_risk,
 *     frequency, duration_days, timing, instructions
 *   }
 */
import { useState } from 'react';
import type { DrugSearchResult } from '@/lib/types';
import {
  type DrugDefault,
  type Frequency,
  type Timing,
  FREQUENCY_OPTIONS,
  DURATION_OPTIONS,
  TIMING_OPTIONS,
} from '@/lib/drug-defaults';
import { DrugMonographDrawer } from './DrugMonographDrawer';

export type PrescriptionLine = {
  item_code: string;
  brand_name: string;
  generic_name: string;
  dosage_form: string;
  strength: string | null;
  schedule_dc: DrugSearchResult['schedule_dc'];
  is_high_risk: boolean;
  frequency: Frequency | null;
  duration_days: number | null;
  timing: Timing | null;
  instructions: string;
  /** RX.1: added as written via the AI resolver — not stocked in the EHRC formulary. */
  non_formulary?: boolean;
};

export type DrugRowProps = {
  line: PrescriptionLine;
  onChange: (line: PrescriptionLine) => void;
  onRemove: () => void;
  readOnly?: boolean;
};

export function lineFromDrug(
  drug: DrugSearchResult,
  defaults: DrugDefault | null,
): PrescriptionLine {
  return {
    item_code: drug.item_code,
    brand_name: drug.brand_name,
    generic_name: drug.generic_name,
    dosage_form: drug.dosage_form,
    strength: drug.strength,
    schedule_dc: drug.schedule_dc,
    is_high_risk: drug.is_high_risk,
    frequency: defaults?.frequency ?? null,
    duration_days: defaults?.duration_days ?? null,
    timing: defaults?.timing ?? null,
    instructions: defaults?.instructions ?? '',
  };
}

type Group = 'freq' | 'dur' | 'timing' | 'inst' | null;

export function DrugRow({ line, onChange, onRemove, readOnly }: DrugRowProps) {
  const [expanded, setExpanded] = useState<Group>(null);
  // v3.10.5 — drug monograph drawer (OpenFDA indication + warnings)
  const [monoOpen, setMonoOpen] = useState(false);

  const set = <K extends keyof PrescriptionLine>(k: K, v: PrescriptionLine[K]) => {
    onChange({ ...line, [k]: v });
  };

  function toggle(group: Group) {
    if (readOnly) return;
    setExpanded((cur) => (cur === group ? null : group));
  }

  return (
    <div
      className={`rounded-xl border bg-white p-4 ${
        expanded ? 'border-even-blue-300 ring-2 ring-even-blue-100' : 'border-even-ink-200'
      }`}
    >
      {/* Head */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-even-navy">
              {line.brand_name}
            </span>
            {line.strength && (
              <span className="text-xs text-even-ink-500">{line.strength}</span>
            )}
            <ScheduleChip schedule={line.schedule_dc} />
            {line.is_high_risk && <HighRiskBadge />}
            {line.non_formulary && (
              <span
                className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200"
                title="Added as written — not in the EHRC formulary; pharmacy will source or substitute"
              >
                non-formulary
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-even-ink-600">
            {line.generic_name}
            <span className="text-even-ink-400"> · {line.dosage_form}</span>
          </div>
        </div>
        {/* v3.10.5 — drug monograph 'i' button */}
        <button
          type="button"
          onClick={() => setMonoOpen(true)}
          aria-label={`View FDA monograph for ${line.generic_name || line.brand_name}`}
          title="View FDA monograph"
          className="rounded-full bg-violet-50 px-1.5 py-0 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100"
        >
          i
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${line.brand_name}`}
            className="rounded-full text-even-ink-400 transition hover:text-even-pink-700"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        )}
      </div>

      {/* v3.10.5 — drawer (mounted only when open) */}
      <DrugMonographDrawer
        drugName={line.generic_name || line.brand_name}
        open={monoOpen}
        onClose={() => setMonoOpen(false)}
      />

      {/* Chip groups */}
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-xs">
        <ChipGroup
          label="how often"
          expanded={expanded === 'freq'}
          onToggle={() => toggle('freq')}
          current={line.frequency}
          options={FREQUENCY_OPTIONS}
          onPick={(v) => {
            set('frequency', v as Frequency);
            setExpanded(null);
          }}
          format={(v) => String(v)}
          readOnly={readOnly}
        />
        <ChipGroup
          label="how long"
          expanded={expanded === 'dur'}
          onToggle={() => toggle('dur')}
          current={line.duration_days}
          options={DURATION_OPTIONS}
          onPick={(v) => {
            set('duration_days', Number(v));
            setExpanded(null);
          }}
          format={(v) => (Number(v) >= 30 ? '1mo' : `${v}d`)}
          readOnly={readOnly}
        />
        <ChipGroup
          label="timing"
          expanded={expanded === 'timing'}
          onToggle={() => toggle('timing')}
          current={line.timing}
          options={TIMING_OPTIONS}
          onPick={(v) => {
            set('timing', v as Timing);
            setExpanded(null);
          }}
          format={(v) => String(v)}
          readOnly={readOnly}
        />
      </div>

      {/* Instructions row */}
      <div className="mt-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
            Instructions
          </span>
          <input
            type="text"
            disabled={readOnly}
            value={line.instructions}
            onChange={(e) => set('instructions', e.target.value)}
            placeholder="Optional. e.g., for fever (SOS), 30 min before breakfast"
            className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-1.5 text-xs text-even-navy placeholder-even-ink-300 focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
          />
        </label>
      </div>

      {/* Summary line — the at-rest read of the row */}
      <p className="mt-3 text-[11px] italic text-even-ink-500">
        {summarise(line)}
      </p>
    </div>
  );
}

function summarise(l: PrescriptionLine): string {
  const parts: string[] = [];
  parts.push(`${l.brand_name}${l.strength ? ` ${l.strength}` : ''}`);
  if (l.frequency) parts.push(l.frequency);
  if (l.duration_days != null) {
    parts.push(l.duration_days >= 30 ? '1 month' : `${l.duration_days} days`);
  }
  if (l.timing) parts.push(l.timing.toLowerCase());
  if (l.instructions) parts.push(`(${l.instructions})`);
  return parts.join(' · ');
}

function ChipGroup<T extends string | number>({
  label,
  expanded,
  onToggle,
  current,
  options,
  onPick,
  format,
  readOnly,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  current: T | null;
  options: readonly T[];
  onPick: (v: T) => void;
  format: (v: T) => string;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-even-ink-400">
        {label}
      </span>
      {expanded || current == null ? (
        <>
          {options.map((opt) => {
            const on = current === opt;
            return (
              <button
                key={String(opt)}
                type="button"
                disabled={readOnly}
                onClick={() => onPick(opt)}
                aria-pressed={on}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                  on
                    ? 'bg-even-blue text-white'
                    : 'bg-white text-even-navy ring-1 ring-even-ink-200 hover:ring-even-blue-300'
                }`}
              >
                {format(opt)}
              </button>
            );
          })}
          {current == null && (
            <span className="text-[10px] italic text-even-ink-400">tap to set</span>
          )}
        </>
      ) : (
        <button
          type="button"
          disabled={readOnly}
          onClick={onToggle}
          className="rounded-full bg-even-blue px-2.5 py-0.5 text-[11px] font-medium text-white shadow-sm transition hover:bg-even-blue-700"
        >
          {format(current)}
        </button>
      )}
    </div>
  );
}

function ScheduleChip({ schedule }: { schedule: DrugSearchResult['schedule_dc'] }) {
  const tone =
    schedule === 'X'
      ? 'bg-even-pink-200 text-even-pink-900'
      : schedule === 'H1'
      ? 'bg-even-pink-100 text-even-pink-800'
      : schedule === 'H'
      ? 'bg-even-ink-100 text-even-ink-700'
      : 'bg-even-ink-50 text-even-ink-500';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {schedule}
    </span>
  );
}

function HighRiskBadge() {
  return (
    <span
      title="ISMP high-alert medication"
      className="inline-flex items-center gap-1 rounded-full bg-even-pink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-even-pink-800"
    >
      <span aria-hidden>⚠</span> High risk
    </span>
  );
}
