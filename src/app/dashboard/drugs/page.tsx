'use client';

/**
 * /dashboard/drugs — typeahead + DrugRow playground.
 *
 * Sprint 1 used this page to demo `<DrugTypeahead>` against an in-memory
 * picks list. Sprint 4's M4.1 upgrades it to the full Rx compose feel:
 * each pick instantiates a `<DrugRow>` with smart defaults pre-applied.
 * M4.2 will move the same surface inside the encounter screen with
 * persistence; this page stays as a fast playground for tweaking the
 * row component without touching real encounter data.
 */
import { useState } from 'react';
import Link from 'next/link';
import { DrugTypeahead } from '@/components/DrugTypeahead';
import { DrugRow, lineFromDrug, type PrescriptionLine } from '@/components/DrugRow';
import { findSmartDefaults } from '@/lib/drug-defaults';
import type { DrugSearchResult } from '@/lib/types';

export default function DrugsPage() {
  const [lines, setLines] = useState<PrescriptionLine[]>([]);

  function add(drug: DrugSearchResult) {
    const defaults = findSmartDefaults(drug.generic_name);
    setLines((cur) => [lineFromDrug(drug, defaults), ...cur]);
  }

  function update(idx: number, next: PrescriptionLine) {
    setLines((cur) => cur.map((l, i) => (i === idx ? next : l)));
  }

  function removeAt(idx: number) {
    setLines((cur) => cur.filter((_, i) => i !== idx));
  }

  function clearAll() {
    setLines([]);
  }

  const withDefaults = lines.filter((l) => l.frequency).length;

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div
              aria-hidden
              className="h-7 w-7 rounded-full bg-even-blue ring-4 ring-even-blue-100"
            />
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-even-navy">
              Even OPD
            </span>
          </Link>
          <Link
            href="/dashboard"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-10">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-even-blue-700">
          Sprint 4 · M4.1
        </p>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-even-navy">
          Drug row playground
        </h1>
        <p className="mb-8 text-sm text-even-ink-600">
          Type a drug, press Enter, watch the row materialise with smart
          defaults already applied. Tap any chip to override. M4.2 wires
          this into the encounter screen with real persistence.
        </p>

        <DrugTypeahead onSelect={add} autoFocus />

        <div className="mt-10 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-even-ink-500">
            Prescription · {lines.length} {lines.length === 1 ? 'drug' : 'drugs'}
            {withDefaults > 0 && (
              <span className="ml-2 text-[11px] normal-case tracking-normal text-even-ink-400">
                ({withDefaults} with defaults applied)
              </span>
            )}
          </h2>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium uppercase tracking-wider text-even-ink-400 hover:text-even-pink-700"
            >
              Clear all
            </button>
          )}
        </div>

        {lines.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-even-ink-200 bg-white p-6 text-center text-xs text-even-ink-400">
            Try <span className="font-mono text-even-navy">para</span>,{' '}
            <span className="font-mono text-even-navy">amoxi</span>, or{' '}
            <span className="font-mono text-even-navy">omez</span> — they
            come back with frequency / duration / timing already filled in.
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {lines.map((line, idx) => (
              <DrugRow
                key={`${line.item_code}-${idx}`}
                line={line}
                onChange={(next) => update(idx, next)}
                onRemove={() => removeAt(idx)}
              />
            ))}
          </div>
        )}

        <p className="mt-12 text-[11px] text-even-ink-400">
          Sprint 4 ships this inside the encounter screen with persistence
          (M4.2) and LASA / Schedule X safety gates (M4.3).
        </p>
      </section>
    </main>
  );
}
