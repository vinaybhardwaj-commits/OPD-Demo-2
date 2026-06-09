'use client';

/**
 * <DiagnosticOrderModal /> — v3.2b
 *
 * Full-screen modal companion to the inline <DiagnosticsQuickAddStrip>.
 * Same primitives (DiagnosticSearch, BundlePickerChips, SuggestedOrderChips,
 * shared cart) but in a roomier 3-column workspace.
 *
 * Use when:
 *  - Doctor wants a focused ordering surface (lots of tests, deep filtering)
 *  - Doctor wants to see bundles + Qwen suggestions side-by-side without
 *    expanding the inline strip
 *
 * State + POST endpoint are identical to the strip — both share the
 * server-side diagnostic_orders source of truth. Opening this modal
 * after using the strip (or vice versa) shows the latest state.
 *
 * Replaces the v2 lab-only OrderLabModal (retired in v3.2b).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DiagnosticSearch, type CatalogRow } from './DiagnosticSearch';
import { BundlePickerChips } from './BundlePickerChips';
import { SuggestedOrderChips } from './SuggestedOrderChips';

type Source =
  | 'manual'
  | 'qwen_suggestion_accepted'
  | 'bundle'
  | 'context_chip'
  | 'cce_prestage';

type ExistingOrder = {
  id: string;
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: CatalogRow['modality'];
  status: string;
  ordering_actor: string;
  ordered_at: string;
  pre_staged_at: string | null;
  pre_staged_by_name: string | null;
  cancel_reason: string | null;
};

type CartItem = {
  existing_id?: string;
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: CatalogRow['modality'];
  source: Source;
  pre_staged_by_name?: string | null;
  pre_staged_at?: string | null;
  clinical_indication?: string;
  body_area?: string;
  laterality?: string;
};

const MODALITY_TONE: Record<CatalogRow['modality'], string> = {
  lab: 'bg-blue-50 text-blue-700 ring-blue-200',
  imaging: 'bg-violet-50 text-violet-700 ring-violet-200',
  cardiology: 'bg-rose-50 text-rose-700 ring-rose-200',
  procedure: 'bg-amber-50 text-amber-700 ring-amber-200',
};

export type DiagnosticOrderModalProps = {
  encounterId: string;
  patientName: string;
  open: boolean;
  onClose: () => void;
  onConfirmed?: (orderIds: string[]) => void;
};

export function DiagnosticOrderModal({
  encounterId,
  patientName,
  open,
  onClose,
  onConfirmed,
}: DiagnosticOrderModalProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pendingCancel, setPendingCancel] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modalityFilter, setModalityFilter] = useState<'all' | CatalogRow['modality']>('all');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Re-fetch every time the modal opens (server may have changed via strip)
  useEffect(() => {
    if (!open) {
      setCart([]); setPendingCancel(new Map()); setLoading(true);
      setErr(null); setSavedMessage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/encounters/${encounterId}/diagnostics`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          const orders = (json.orders as ExistingOrder[])
            .filter((o) => o.status === 'pre_staged' || o.status === 'pending' || o.status === 'in_progress');
          const initial: CartItem[] = orders.map((o) => ({
            existing_id: o.id,
            service_code: o.service_code,
            display_name: o.display_name,
            sub_department: o.sub_department,
            modality: o.modality,
            source: o.ordering_actor === 'cce_prestage' ? 'cce_prestage' : 'manual',
            pre_staged_by_name: o.pre_staged_by_name,
            pre_staged_at: o.pre_staged_at,
          }));
          setCart(initial);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, encounterId]);

  const cartCodes = useMemo(() => new Set(cart.map((c) => c.service_code)), [cart]);
  const dirty = pendingCancel.size > 0 || cart.some((c) => !c.existing_id);

  const add = useCallback((row: CatalogRow) => {
    if (cartCodes.has(row.service_code)) return;
    setCart((cur) => [...cur, {
      service_code: row.service_code,
      display_name: row.display_name,
      sub_department: row.sub_department,
      modality: row.modality,
      source: 'manual',
    }]);
  }, [cartCodes]);

  const remove = useCallback((item: CartItem) => {
    if (item.existing_id) {
      setPendingCancel((cur) => {
        const next = new Map(cur);
        next.set(item.existing_id!, '');
        return next;
      });
      setCart((cur) => cur.filter((c) => c.service_code !== item.service_code));
    } else {
      setCart((cur) => cur.filter((c) => c.service_code !== item.service_code));
    }
  }, []);

  const updateCancelReason = useCallback((existingId: string, reason: string) => {
    setPendingCancel((cur) => {
      const next = new Map(cur);
      next.set(existingId, reason);
      return next;
    });
  }, []);

  const updateItem = useCallback((code: string, patch: Partial<CartItem>) => {
    setCart((cur) => cur.map((c) => c.service_code === code ? { ...c, ...patch } : c));
  }, []);

  const confirm = useCallback(async () => {
    if (cart.length === 0 && pendingCancel.size === 0) return;
    setConfirming(true); setErr(null);
    try {
      const reasonsList = Array.from(pendingCancel.values()).filter(Boolean);
      const combinedReason = reasonsList.length > 0 ? reasonsList.join(' · ') : undefined;
      const res = await fetch(`/api/encounters/${encounterId}/diagnostics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cart: cart.map((c) => ({
            existing_id: c.existing_id,
            service_code: c.service_code,
            source: c.source,
            clinical_indication: c.modality === 'imaging' ? (c.clinical_indication || null) : undefined,
            body_area: c.modality === 'imaging' ? (c.body_area || null) : undefined,
            laterality: c.modality === 'imaging' ? (c.laterality || null) : undefined,
          })),
          cancel_existing_ids: Array.from(pendingCancel.keys()),
          cancel_reason: combinedReason,
        }),
      });
      const json = await res.json();
      if (!json.ok) { setErr(json.error ?? 'confirm_failed'); return; }
      const msgs: string[] = [];
      if (json.inserted_ids?.length > 0) msgs.push(`${json.inserted_ids.length} new`);
      if (json.promoted_ids?.length > 0) msgs.push(`${json.promoted_ids.length} confirmed`);
      if (json.cancelled_ids?.length > 0) msgs.push(`${json.cancelled_ids.length} cancelled`);
      setSavedMessage(`Saved. ${msgs.join(' · ')}.`);
      setPendingCancel(new Map());
      if (onConfirmed) onConfirmed([...(json.inserted_ids ?? []), ...(json.promoted_ids ?? [])]);
      // Auto-close after a short beat so the strip refresh is visible
      setTimeout(() => onClose(), 700);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setConfirming(false); }
  }, [cart, pendingCancel, encounterId, onConfirmed, onClose]);

  if (!open) return null;

  const filteredCart = modalityFilter === 'all' ? cart : cart.filter((c) => c.modality === modalityFilter);
  const cceCount = cart.filter((c) => c.source === 'cce_prestage').length;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40">
      <div className="m-4 flex w-full max-w-6xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-baseline justify-between border-b border-even-ink-100 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-even-navy">
              Diagnostics workspace · {patientName}
            </h3>
            <p className="mt-0.5 text-[11px] text-even-ink-500">
              All modalities. Edits sync with the inline diagnostics strip.
              {cceCount > 0 && <> CCE pre-staged {cceCount} test{cceCount === 1 ? '' : 's'}.</>}
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

        {/* Body: 3-column */}
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-[1.4fr_1fr]">
          {/* LEFT — search + bundles + Qwen */}
          <div className="space-y-3 overflow-y-auto pr-2">
            <SuggestedOrderChips encounterId={encounterId} onAdd={(r) => add({ ...r, patient_instructions: null, synonyms: [] } as CatalogRow)} alreadyInCart={cartCodes} />
            <BundlePickerChips onPick={(rows) => rows.forEach((r) => add({ ...r, patient_instructions: null, synonyms: [] } as CatalogRow))} alreadyInCart={cartCodes} />
            <div className="rounded-lg border border-even-ink-100 bg-even-ink-50/30 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-even-ink-500">
                Search all 2,334 tests
              </div>
              <DiagnosticSearch
                onAdd={add}
                cartCodes={cartCodes}
                encounterId={encounterId}
              />
            </div>
          </div>

          {/* RIGHT — cart */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-even-ink-100 bg-white">
            <div className="flex items-baseline justify-between border-b border-even-ink-100 bg-even-ink-50/40 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-even-navy">
                Cart · {cart.length}
              </div>
              <div className="flex gap-1">
                {(['all','lab','imaging','cardiology','procedure'] as const).map((m) => {
                  const active = modalityFilter === m;
                  const count = m === 'all' ? cart.length : cart.filter((c) => c.modality === m).length;
                  if (count === 0 && m !== 'all') return null;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModalityFilter(m)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition ${active ? 'bg-even-navy text-white ring-even-navy' : 'bg-white text-even-ink-600 ring-even-ink-200 hover:ring-even-ink-300'}`}
                    >
                      {m} {count > 0 && <span className="opacity-70">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-even-ink-50">
              {loading && <li className="p-4 text-xs italic text-even-ink-500">Loading existing orders…</li>}
              {!loading && filteredCart.length === 0 && (
                <li className="p-4 text-xs italic text-even-ink-500">
                  {modalityFilter === 'all' ? 'No orders yet. Add from the left.' : `No ${modalityFilter} orders.`}
                </li>
              )}
              {filteredCart.map((c) => (
                <li key={c.service_code} className="px-3 py-2 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className={`shrink-0 rounded px-1.5 py-0 text-[9px] font-semibold uppercase ring-1 ${MODALITY_TONE[c.modality]}`}>
                        {c.modality}
                      </span>
                      <span className="truncate font-medium text-even-navy">{c.display_name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-even-ink-400">{c.service_code}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-even-ink-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      Remove
                    </button>
                  </div>
                  {c.source === 'cce_prestage' && (
                    <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0 text-[9px] text-amber-700 ring-1 ring-amber-200">
                      CCE pre-staged{c.pre_staged_by_name && ` · ${c.pre_staged_by_name}`}
                    </div>
                  )}
                  {c.modality === 'imaging' && !c.existing_id && (
                    <div className="mt-1.5 space-y-1">
                      <input
                        type="text"
                        value={c.clinical_indication ?? ''}
                        onChange={(e) => updateItem(c.service_code, { clinical_indication: e.target.value })}
                        placeholder="Clinical indication"
                        className="w-full rounded border border-even-ink-200 px-1.5 py-0.5 text-[11px]"
                      />
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={c.body_area ?? ''}
                          onChange={(e) => updateItem(c.service_code, { body_area: e.target.value })}
                          placeholder="Body area"
                          className="flex-1 rounded border border-even-ink-200 px-1.5 py-0.5 text-[11px]"
                        />
                        <input
                          type="text"
                          value={c.laterality ?? ''}
                          onChange={(e) => updateItem(c.service_code, { laterality: e.target.value })}
                          placeholder="L/R/Bilat"
                          className="w-20 rounded border border-even-ink-200 px-1.5 py-0.5 text-[11px]"
                        />
                      </div>
                    </div>
                  )}
                </li>
              ))}
              {Array.from(pendingCancel.entries()).map(([id, reason]) => {
                const orig = cart.find((c) => c.existing_id === id);
                return (
                  <li key={`cancel-${id}`} className="bg-rose-50/40 px-3 py-2 text-xs">
                    <div className="text-rose-800">
                      <span className="line-through">{orig?.display_name ?? id}</span>
                      <span className="ml-2 text-[10px] uppercase">queued cancel</span>
                    </div>
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => updateCancelReason(id, e.target.value)}
                      placeholder="Cancel reason (optional)"
                      className="mt-1 w-full rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[11px]"
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-even-ink-100 bg-even-ink-50/40 px-5 py-3">
          {savedMessage ? (
            <div className="text-xs text-emerald-700">✓ {savedMessage}</div>
          ) : err ? (
            <div className="text-xs text-rose-700">{err}</div>
          ) : (
            <div className="text-[11px] text-even-ink-500">
              {dirty ? 'Unsaved changes' : 'No changes since opening'}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-even-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-even-ink-700 hover:bg-even-ink-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={confirming || !dirty}
              className="rounded-md bg-even-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-even-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? 'Saving…' : 'Confirm orders'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
