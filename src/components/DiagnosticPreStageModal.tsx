'use client';

/**
 * <DiagnosticPreStageModal /> — v3.2b
 *
 * CCE-facing modal for pre-staging diagnostic tests (lab + imaging +
 * cardiology + procedure) on an encounter row from /reception, before
 * the doctor starts the consult.
 *
 * Mirrors the doctor's <DiagnosticOrderModal> shape so the CCE sees
 * the same primitives (DiagnosticSearch, BundlePickerChips) but with
 * CCE framing copy and the CCE-only POST endpoint.
 *
 * Encounter must be in registered | at_triage | waiting_for_doctor.
 * Server enforces; modal shows the error if violated.
 */
import { useCallback, useEffect, useState } from 'react';
import { DiagnosticSearch, type CatalogRow } from './DiagnosticSearch';
import { BundlePickerChips } from './BundlePickerChips';

type CartItem = {
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: CatalogRow['modality'];
};

const MODALITY_TONE: Record<CatalogRow['modality'], string> = {
  lab: 'bg-blue-50 text-blue-700 ring-blue-200',
  imaging: 'bg-violet-50 text-violet-700 ring-violet-200',
  cardiology: 'bg-rose-50 text-rose-700 ring-rose-200',
  procedure: 'bg-amber-50 text-amber-700 ring-amber-200',
};

export type DiagnosticPreStageModalProps = {
  encounterId: string;
  patientName: string;
  open: boolean;
  onClose: () => void;
};

export function DiagnosticPreStageModal({
  encounterId,
  patientName,
  open,
  onClose,
}: DiagnosticPreStageModalProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCart([]); setErr(null); setSaved(null);
    }
  }, [open]);

  const codes = new Set(cart.map((c) => c.service_code));

  const add = useCallback((row: CatalogRow) => {
    if (codes.has(row.service_code)) return;
    setCart((cur) => [...cur, {
      service_code: row.service_code,
      display_name: row.display_name,
      sub_department: row.sub_department,
      modality: row.modality,
    }]);
  }, [codes]);

  const remove = (code: string) => setCart((cur) => cur.filter((c) => c.service_code !== code));

  const confirm = useCallback(async () => {
    if (cart.length === 0) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/diagnostics/prestage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service_codes: cart.map((c) => c.service_code) }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.detail ?? json.error ?? 'save_failed');
        return;
      }
      const stats = json.stats ?? {};
      setSaved(`Pre-staged ${stats.inserted ?? 0} test${(stats.inserted ?? 0) === 1 ? '' : 's'}${(stats.skipped ?? 0) > 0 ? ` · ${stats.skipped} already on encounter` : ''}.`);
      setCart([]);
      setTimeout(() => onClose(), 1100);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }, [cart, encounterId, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40">
      <div className="m-4 flex w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-baseline justify-between border-b border-even-ink-100 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-even-navy">
              Pre-stage diagnostics · {patientName}
            </h3>
            <p className="mt-0.5 text-[11px] text-even-ink-500">
              Add routine tests now; the doctor sees them as &ldquo;CCE pre-staged&rdquo;
              chips and confirms or removes during the consult.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-even-ink-500 hover:bg-even-ink-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-[1.4fr_1fr]">
          {/* LEFT — search + bundles */}
          <div className="space-y-3 overflow-y-auto pr-2">
            <BundlePickerChips onPick={(rows) => rows.forEach((r) => add({ ...r, patient_instructions: null, synonyms: [] } as CatalogRow))} alreadyInCart={codes} />
            <div className="rounded-lg border border-even-ink-100 bg-even-ink-50/30 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                Search all 2,334 tests
              </div>
              <DiagnosticSearch onAdd={add} cartCodes={codes} />
            </div>
          </div>

          {/* RIGHT — cart */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-even-ink-100 bg-white">
            <div className="border-b border-even-ink-100 bg-even-ink-50/40 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-even-navy">
                Pre-stage cart · {cart.length}
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-even-ink-50">
              {cart.length === 0 && (
                <li className="p-4 text-xs italic text-even-ink-500">No tests yet. Add from the left.</li>
              )}
              {cart.map((c) => (
                <li key={c.service_code} className="flex items-baseline justify-between gap-2 px-3 py-2 text-xs">
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className={`shrink-0 rounded px-1.5 py-0 text-[9px] font-semibold uppercase ring-1 ${MODALITY_TONE[c.modality]}`}>
                      {c.modality}
                    </span>
                    <span className="truncate font-medium text-even-navy">{c.display_name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-even-ink-400">{c.service_code}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(c.service_code)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-even-ink-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-even-ink-100 bg-even-ink-50/40 px-5 py-3">
          {saved ? (
            <div className="text-xs text-emerald-700">✓ {saved}</div>
          ) : err ? (
            <div className="text-xs text-rose-700">{err}</div>
          ) : (
            <div className="text-[11px] text-even-ink-500">
              {cart.length > 0 ? `${cart.length} pending` : 'Cart empty'}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-even-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-even-ink-700 hover:bg-even-ink-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={saving || cart.length === 0}
              className="rounded-md bg-even-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-even-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Pre-stage'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
