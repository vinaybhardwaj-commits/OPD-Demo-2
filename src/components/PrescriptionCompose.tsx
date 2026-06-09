'use client';

/**
 * <PrescriptionCompose /> — the multi-drug compose surface mounted inside
 * the encounter screen. Replaces the M3 placeholder card.
 *
 * Behaviour:
 *   - "Add drug" button reveals an inline DrugTypeahead. Picking creates
 *     a new <DrugRow> with smart defaults pre-applied (M4.1). Typeahead
 *     auto-clears so a second pick is one tap away.
 *   - Each row edit (chip override, instructions text) triggers a
 *     debounced PUT /api/encounters/[id]/prescription that upserts the
 *     full lines[] array.
 *   - Save state indicator mirrors the encounter editor's pattern.
 *   - Read-only when the encounter is completed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DrugTypeahead } from './DrugTypeahead';
import { DrugRow, lineFromDrug, type PrescriptionLine } from './DrugRow';
import { DdiBanner } from './DdiBanner';
import { findSmartDefaults } from '@/lib/drug-defaults';
import type { DrugSearchResult } from '@/lib/types';

/**
 * LASA alternates flow through the typeahead pick — we cache them in a
 * client-side Map<item_code, string[]> so the confirmation strip can
 * render below a freshly-added row without round-tripping them through
 * the persisted lines[] JSONB.
 *
 * lasaAck tracks which item_codes the doctor has confirmed (or
 * intentionally dismissed). Lasts for the lifetime of the page mount.
 */

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type PrescriptionComposeProps = {
  encounterId: string;
  initialLines: PrescriptionLine[];
  readOnly?: boolean;
  /**
   * v2.2.1 — cached DDI scan payload from encounters.ddi_findings. The
   * banner uses it on first mount to avoid an immediate re-scan when
   * the page refreshes without a prescription change.
   */
  initialDdi?: unknown | null;
  /**
   * v3.9.4 — fires whenever the lines[] state changes so the parent
   * (EncounterEditor) can mirror it for the Rx ↔ comorbidity coherence
   * panel + submit-time modal. Not used for persistence — debounced PUT
   * to /prescription handles that.
   */
  onLinesChange?: (lines: PrescriptionLine[]) => void;
};

export function PrescriptionCompose({
  encounterId,
  initialLines,
  readOnly,
  initialDdi,
  onLinesChange,
}: PrescriptionComposeProps) {
  const [lines, setLines] = useState<PrescriptionLine[]>(initialLines);
  const [adderOpen, setAdderOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // LASA + Schedule X state (client-side only — not persisted)
  const [lasaAlternates, setLasaAlternates] = useState<Record<string, string[]>>({});
  const [lasaAck, setLasaAck] = useState<Set<string>>(new Set());
  const [pendingSchedX, setPendingSchedX] = useState<DrugSearchResult | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFirstRef = useRef(true);

  // Debounced PUT
  useEffect(() => {
    if (readOnly) return;
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    setSaveState('dirty');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const res = await fetch(`/api/encounters/${encounterId}/prescription`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [lines, encounterId, readOnly]);

  // v3.9.4 — notify parent of lines mirror for Rx coherence panel
  useEffect(() => {
    onLinesChange?.(lines);
  }, [lines, onLinesChange]);

  const addPickConfirmed = useCallback((drug: DrugSearchResult) => {
    setLines((cur) => {
      if (cur.some((l) => l.item_code === drug.item_code)) return cur;
      const defaults = findSmartDefaults(drug.generic_name);
      return [...cur, lineFromDrug(drug, defaults)];
    });
    if (drug.lasa_alternates && drug.lasa_alternates.length > 0) {
      setLasaAlternates((cur) => ({ ...cur, [drug.item_code]: drug.lasa_alternates }));
    }
  }, []);

  const onTypeaheadPick = useCallback(
    (drug: DrugSearchResult) => {
      // Schedule X (narcotic / psychotropic) requires explicit confirm
      if (drug.schedule_dc === 'X') {
        setPendingSchedX(drug);
        return;
      }
      addPickConfirmed(drug);
    },
    [addPickConfirmed],
  );

  const confirmSchedX = useCallback(() => {
    if (pendingSchedX) addPickConfirmed(pendingSchedX);
    setPendingSchedX(null);
  }, [pendingSchedX, addPickConfirmed]);

  const cancelSchedX = useCallback(() => {
    setPendingSchedX(null);
  }, []);

  const acknowledgeLasa = useCallback((item_code: string) => {
    setLasaAck((cur) => new Set(cur).add(item_code));
  }, []);

  const updateAt = useCallback((idx: number, next: PrescriptionLine) => {
    setLines((cur) => cur.map((l, i) => (i === idx ? next : l)));
  }, []);

  const removeAt = useCallback((idx: number) => {
    setLines((cur) => cur.filter((_, i) => i !== idx));
  }, []);

  const saveLabel =
    saveState === 'dirty' || saveState === 'saving'
      ? 'saving…'
      : saveState === 'error'
      ? 'save failed'
      : saveState === 'saved'
      ? 'saved'
      : '';
  const saveTone =
    saveState === 'error' ? 'text-even-pink-700' : 'text-even-ink-400';

  // v2.2.1 — DDI signature feeds the banner's debounced re-scan trigger.
  // Compose a stable string from the parts that actually matter for DDI
  // (drug identity + dose). Frequency / timing tweaks don't re-scan.
  const ddiSignature = useMemo(
    () =>
      lines
        .map((l) => `${l.generic_name || l.brand_name || ''}|${l.strength ?? ''}`)
        .join('||'),
    [lines],
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-even-ink-500">
          {lines.length === 0
            ? 'No drugs yet. Add the first one to start.'
            : `${lines.length} ${lines.length === 1 ? 'drug' : 'drugs'} on the prescription.`}
        </p>
        {saveLabel && (
          <span className={`text-[11px] tabular-nums ${saveTone}`}>
            · {saveLabel}
          </span>
        )}
      </div>

      {/* v2.2.1 — Qwen DDI scan banner (always warn, never block) */}
      {!readOnly && lines.length > 0 && (
        <div className="mb-4">
          <DdiBanner
            encounterId={encounterId}
            linesSignature={ddiSignature}
            hasLines={lines.length > 0}
            initial={(initialDdi as Parameters<typeof DdiBanner>[0]['initial']) ?? null}
          />
        </div>
      )}

      {!readOnly && (
        <div className="mb-4">
          {adderOpen ? (
            <div>
              <DrugTypeahead autoFocus clearOnSelect onSelect={onTypeaheadPick} />
              <button
                type="button"
                onClick={() => setAdderOpen(false)}
                className="mt-2 text-[11px] uppercase tracking-wider text-even-ink-400 hover:text-even-navy"
              >
                Done adding
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdderOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-even-blue-300 bg-even-blue-50 px-4 py-2 text-sm font-semibold text-even-blue-700 transition hover:border-even-blue-400 hover:bg-even-blue-100"
            >
              <span aria-hidden>+</span>
              {lines.length === 0 ? 'Add a drug' : 'Add another drug'}
            </button>
          )}
        </div>
      )}

      {/* Schedule X double-confirm */}
      {pendingSchedX && (
        <div
          role="alertdialog"
          aria-label="Confirm Schedule X drug"
          className="mb-4 rounded-xl border border-even-pink-300 bg-even-pink-50 p-4 shadow-sm"
        >
          <div className="flex items-center gap-2 text-even-pink-900">
            <span className="rounded-full bg-even-pink-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              Schedule X
            </span>
            <span className="text-sm font-semibold">
              {pendingSchedX.brand_name}
            </span>
          </div>
          <p className="mt-2 text-xs text-even-pink-900">
            This is a Schedule X drug (narcotic / psychotropic). Adding it
            to the prescription requires explicit confirmation per the
            Drugs &amp; Cosmetics Rules. The pharmacy will need a license
            number recorded against this dispense.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelSchedX}
              className="rounded-md border border-even-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-even-navy hover:border-even-ink-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmSchedX}
              className="rounded-md bg-even-pink-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-even-pink-800"
            >
              Confirm &amp; add
            </button>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-even-ink-200 bg-white p-6 text-center text-xs text-even-ink-400">
          Drugs will appear here as you add them. Each row picks up smart
          defaults so the common case is one tap.
        </div>
      ) : (
        <div className="space-y-3">
          {lines.map((line, idx) => {
            const alts = lasaAlternates[line.item_code];
            const showLasa =
              !readOnly && alts && alts.length > 0 && !lasaAck.has(line.item_code);
            return (
              <div key={`${line.item_code}-${idx}`} className="space-y-2">
                <DrugRow
                  line={line}
                  onChange={(next) => updateAt(idx, next)}
                  onRemove={() => removeAt(idx)}
                  readOnly={readOnly}
                />
                {showLasa && (
                  <div className="rounded-lg border border-even-pink-200 bg-even-pink-50/60 p-3">
                    <p className="text-xs text-even-navy">
                      You picked{' '}
                      <span className="font-semibold">{line.brand_name}</span>.
                      Sound-alike alternates:{' '}
                      <span className="font-medium text-even-pink-900">
                        {alts.join(', ')}
                      </span>
                      .
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => acknowledgeLasa(line.item_code)}
                        className="rounded-md border border-even-blue-300 bg-white px-3 py-1 text-[11px] font-semibold text-even-blue-700 hover:bg-even-blue-50"
                      >
                        ✓ Confirm pick
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeAt(idx);
                          acknowledgeLasa(line.item_code);
                          setAdderOpen(true);
                        }}
                        className="rounded-md text-[11px] font-medium text-even-pink-700 hover:underline"
                      >
                        Remove &amp; pick a different drug
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
