'use client';

/**
 * src/components/PlanFormShell.tsx
 *
 * v5.0 — generic, declarative form for any plan kind.
 *
 * Driven by FIELDS[kind] metadata from plan-schemas. Adding a new plan
 * kind requires zero changes here — just an entry in FIELDS + SCHEMAS.
 *
 * Field-type → render mapping:
 *   text             → <input type="text">
 *   textarea         → <textarea>
 *   number           → <input type="number">
 *   date             → <input type="date">
 *   date_or_relative → discriminated union picker (date | days from today)
 *   timestamp        → <input type="datetime-local">
 *   boolean          → toggle button
 *   select           → <select> from options[]
 *   multiselect      → chip grid (toggleable)
 *   string_array     → multi-line textarea, split on newline
 *   doctor_picker    → text input for v5.0 (full picker is v5.1)
 *   specialty_picker → <select> from SPECIALTIES_OPTS in plan-schemas
 *
 * Visual style: matches the v4 Section primitive — flat, no card
 * borders, brand-faint focus rings, sentence-case labels.
 */

import { useCallback, useMemo } from 'react';
import { FIELDS, type PlanKind, type FieldMeta } from '@/lib/plan-schemas';

const SPECIALTY_OPTS = [
  { value: 'cardio', label: 'Cardiology' },
  { value: 'pulmo', label: 'Pulmonology' },
  { value: 'nephro', label: 'Nephrology' },
  { value: 'endo', label: 'Endocrinology' },
  { value: 'hema', label: 'Hematology' },
  { value: 'id', label: 'Infectious Disease' },
  { value: 'anesthesia', label: 'Anesthesia' },
  { value: 'gastro', label: 'Gastroenterology' },
  { value: 'neuro', label: 'Neurology' },
  { value: 'ortho', label: 'Orthopaedics' },
  { value: 'gynae', label: 'Gynaecology' },
  { value: 'paeds', label: 'Paediatrics' },
  { value: 'surgery', label: 'General Surgery' },
  { value: 'psych', label: 'Psychiatry' },
  { value: 'derm', label: 'Dermatology' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PlanFormShellProps = {
  kind: PlanKind;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inputClasses(disabled?: boolean): string {
  const base =
    'w-full border-b border-slate-200 bg-transparent py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-violet-500';
  return disabled ? `${base} opacity-60` : base;
}

function labelClasses(): string {
  return 'block text-xs font-medium text-slate-600 mb-1';
}

// ---------------------------------------------------------------------------
// Field renderer
// ---------------------------------------------------------------------------

type FieldProps = {
  field: FieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
};

function FieldRenderer({ field, value, onChange, disabled }: FieldProps) {
  const setVal = useCallback(
    (v: unknown) => onChange(v),
    [onChange],
  );

  switch (field.type) {
    case 'text':
      return (
        <input
          type="text"
          className={inputClasses(disabled)}
          placeholder={field.placeholder}
          value={(value as string) ?? ''}
          onChange={(e) => setVal(e.target.value)}
          disabled={disabled}
        />
      );

    case 'textarea':
      return (
        <textarea
          className={`${inputClasses(disabled)} min-h-[3rem] py-2`}
          placeholder={field.placeholder}
          value={(value as string) ?? ''}
          onChange={(e) => setVal(e.target.value)}
          disabled={disabled}
          rows={3}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          className={inputClasses(disabled)}
          placeholder={field.placeholder}
          value={value == null ? '' : Number(value)}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value);
            setVal(n);
          }}
          disabled={disabled}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          className={inputClasses(disabled)}
          value={(value as string) ?? ''}
          onChange={(e) => setVal(e.target.value || undefined)}
          disabled={disabled}
        />
      );

    case 'date_or_relative':
      return (
        <DateOrRelativeField value={value} onChange={setVal} disabled={disabled} />
      );

    case 'timestamp':
      return (
        <input
          type="datetime-local"
          className={inputClasses(disabled)}
          value={(value as string) ?? ''}
          onChange={(e) => setVal(e.target.value || undefined)}
          disabled={disabled}
        />
      );

    case 'boolean':
      return (
        <button
          type="button"
          onClick={() => setVal(!(value as boolean))}
          disabled={disabled}
          className={`text-xs px-2 py-1 rounded-full border transition ${
            value
              ? 'bg-violet-50 border-violet-300 text-violet-700'
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {value ? 'Yes' : 'No'}
        </button>
      );

    case 'select': {
      const opts = field.options ?? [];
      return (
        <select
          className={inputClasses(disabled)}
          value={(value as string) ?? ''}
          onChange={(e) => setVal(e.target.value || undefined)}
          disabled={disabled}
        >
          <option value="">— select —</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    case 'multiselect': {
      const opts = field.options ?? [];
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) => {
        const next = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
        setVal(next);
      };
      return (
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => {
            const on = arr.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => toggle(o.value)}
                className={`text-xs px-2 py-1 rounded-full border transition ${
                  on
                    ? 'bg-violet-50 border-violet-300 text-violet-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    case 'string_array': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <textarea
          className={`${inputClasses(disabled)} min-h-[3rem] py-2`}
          placeholder={field.placeholder ?? 'One per line'}
          value={arr.join('\n')}
          onChange={(e) =>
            setVal(
              e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            )
          }
          disabled={disabled}
          rows={3}
        />
      );
    }

    case 'doctor_picker':
      // v5.0: stub as plain text input. v5.1 will swap in a real picker
      // that hits /api/doctors and returns a uuid.
      return (
        <input
          type="text"
          className={inputClasses(disabled)}
          placeholder="Doctor name or UUID (picker coming in v5.1)"
          value={(value as string) ?? ''}
          onChange={(e) => setVal(e.target.value || undefined)}
          disabled={disabled}
        />
      );

    case 'specialty_picker':
      return (
        <select
          className={inputClasses(disabled)}
          value={(value as string) ?? ''}
          onChange={(e) => setVal(e.target.value || undefined)}
          disabled={disabled}
        >
          <option value="">— select specialty —</option>
          {SPECIALTY_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );

    default: {
      const _exhaustive: never = field.type;
      return <div className="text-xs text-red-500">Unknown field type: {String(_exhaustive)}</div>;
    }
  }
}

// ---------------------------------------------------------------------------
// date_or_relative — discriminated union picker
// ---------------------------------------------------------------------------

type DateOrRelativeValue =
  | { kind: 'absolute'; date: string }
  | { kind: 'relative'; days: number }
  | undefined;

function DateOrRelativeField({
  value,
  onChange,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const cur = (value as DateOrRelativeValue) ?? undefined;
  const mode = cur?.kind ?? 'relative';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ kind: 'relative', days: cur && cur.kind === 'relative' ? cur.days : 7 })}
          className={`text-xs px-2 py-1 rounded-full border transition ${
            mode === 'relative'
              ? 'bg-violet-50 border-violet-300 text-violet-700'
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
          }`}
        >
          In N days
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ kind: 'absolute', date: cur && cur.kind === 'absolute' ? cur.date : '' })}
          className={`text-xs px-2 py-1 rounded-full border transition ${
            mode === 'absolute'
              ? 'bg-violet-50 border-violet-300 text-violet-700'
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
          }`}
        >
          On a date
        </button>
      </div>

      {mode === 'relative' ? (
        <input
          type="number"
          className={`${inputClasses(disabled)} max-w-[6rem]`}
          min={0}
          value={cur && cur.kind === 'relative' ? cur.days : 7}
          onChange={(e) =>
            onChange({ kind: 'relative', days: Math.max(0, Number(e.target.value || 0)) })
          }
          disabled={disabled}
        />
      ) : (
        <input
          type="date"
          className={inputClasses(disabled)}
          value={cur && cur.kind === 'absolute' ? cur.date : ''}
          onChange={(e) => onChange({ kind: 'absolute', date: e.target.value })}
          disabled={disabled}
        />
      )}
      {mode === 'relative' && <span className="text-xs text-slate-500">days from today</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell — iterates FIELDS[kind] and wires onChange
// ---------------------------------------------------------------------------

export default function PlanFormShell({
  kind,
  value,
  onChange,
  disabled,
}: PlanFormShellProps) {
  const fields = useMemo(() => FIELDS[kind] ?? [], [kind]);

  const setField = useCallback(
    (key: string, v: unknown) => {
      const next = { ...value };
      if (v === undefined || v === null || v === '') {
        delete next[key];
      } else {
        next[key] = v;
      }
      onChange(next);
    },
    [value, onChange],
  );

  if (fields.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic py-2">
        No fields defined for plan kind: {kind}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <label className={labelClasses()}>
            {f.label}
            {f.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <FieldRenderer
            field={f}
            value={value[f.key]}
            onChange={(v) => setField(f.key, v)}
            disabled={disabled}
          />
          {f.help && (
            <p className="text-[11px] text-slate-400 mt-1">{f.help}</p>
          )}
        </div>
      ))}
    </div>
  );
}
