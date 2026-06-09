'use client';

/**
 * <DiagnosticsQuickAddStrip /> — inline diagnostics ordering section
 * for the EncounterEditor (PRD §4.7).
 *
 * v3.3 expanded — workflow merge with CCE pre-stage:
 *   - On mount, fetches existing diagnostic_orders for the encounter
 *     (pre_staged / pending / in_progress / cancelled). Pre-staged rows
 *     pre-populate the cart with a "CCE pre-staged" chip.
 *   - Doctor can remove any cart item. Pre-staged items captured in a
 *     pending-cancel set with an optional reason input. New items dropped
 *     locally.
 *   - Confirm sends the unified intended state to POST: keep list +
 *     cancel list + new inserts. Server promotes/cancels/inserts atomically.
 *
 * v3.2a — Add-a-drug-style: collapsed by default, expand → free-text strip.
 * v3.5a (later): passive Qwen context chips.
 * v3.5b (later): active free-text Qwen NLP via /api/diagnostics/interpret.
 */
import { useEffect, useState } from 'react';
import { DiagnosticSearch, type CatalogRow } from './DiagnosticSearch';
import { BundlePickerChips } from './BundlePickerChips';
import { SuggestedOrderChips } from './SuggestedOrderChips';
import { CollapsedSuggestions } from './CollapsedSuggestions';

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
  // v3.6 — imaging-only fields captured inline (modal lives in v3.2b)
  clinical_indication?: string;
  body_area?: string;
  laterality?: string;
};

const MODALITY_BADGE: Record<CatalogRow['modality'], string> = {
  lab: 'bg-blue-50 text-blue-700 border-blue-200',
  imaging: 'bg-violet-50 text-violet-700 border-violet-200',
  cardiology: 'bg-rose-50 text-rose-700 border-rose-200',
  procedure: 'bg-amber-50 text-amber-700 border-amber-200',
};

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function DiagnosticsQuickAddStrip({
  encounterId,
  onConfirmed,
  readOnly,
}: {
  encounterId: string;
  onConfirmed?: (orderIds: string[]) => void;
  readOnly?: boolean;
}) {
  // v5.0.4 — `expanded` state removed; search is always visible.
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pendingCancel, setPendingCancel] = useState<Map<string, string>>(new Map()); // existing_id → reason
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmedMessage, setConfirmedMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load existing orders on mount (pre_staged / pending / etc.) so the
  // doctor sees what CCE has already lined up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/encounters/${encounterId}/diagnostics`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          const orders = (json.orders as ExistingOrder[])
            // Only include the "still actionable" set in the cart. Cancelled
            // and completed are visible in the encounter timeline separately.
            .filter((o) => o.status === 'pre_staged' || o.status === 'pending' || o.status === 'in_progress');
          const initialCart: CartItem[] = orders.map((o) => ({
            existing_id: o.id,
            service_code: o.service_code,
            display_name: o.display_name,
            sub_department: o.sub_department,
            modality: o.modality,
            source: o.ordering_actor === 'cce_prestage' ? 'cce_prestage' : 'manual',
            pre_staged_by_name: o.pre_staged_by_name,
            pre_staged_at: o.pre_staged_at,
          }));
          setCart(initialCart);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [encounterId]);

  const cartCodes = new Set(cart.map((c) => c.service_code));
  const dirty = pendingCancel.size > 0 || cart.some((c) => !c.existing_id);

  const add = (row: CatalogRow) => {
    if (cartCodes.has(row.service_code)) return;
    setCart((cur) => [...cur, {
      service_code: row.service_code,
      display_name: row.display_name,
      sub_department: row.sub_department,
      modality: row.modality,
      source: 'manual',
    }]);
  };

  const updateItem = (code: string, patch: Partial<CartItem>) => {
    setCart((cur) => cur.map((c) => c.service_code === code ? { ...c, ...patch } : c));
  };

  const remove = (item: CartItem) => {
    if (item.existing_id) {
      // Existing → pending cancel (reason captured below)
      setPendingCancel((cur) => {
        const next = new Map(cur);
        next.set(item.existing_id!, '');
        return next;
      });
      setCart((cur) => cur.filter((c) => c.service_code !== item.service_code));
    } else {
      // New → just drop from local cart
      setCart((cur) => cur.filter((c) => c.service_code !== item.service_code));
    }
  };

  const updateCancelReason = (existingId: string, reason: string) => {
    setPendingCancel((cur) => {
      const next = new Map(cur);
      next.set(existingId, reason);
      return next;
    });
  };

  const confirm = async () => {
    if (cart.length === 0 && pendingCancel.size === 0) return;
    setConfirming(true); setErr(null);
    try {
      // Send full intended state: cart (keep + new) + cancel_existing_ids
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
      if (json.inserted_ids.length > 0) msgs.push(`${json.inserted_ids.length} new`);
      if (json.promoted_ids.length > 0) msgs.push(`${json.promoted_ids.length} confirmed`);
      if (json.cancelled_ids.length > 0) msgs.push(`${json.cancelled_ids.length} cancelled`);
      setConfirmedMessage(`Saved. ${msgs.join(' · ')}. ${json.open_count} open order${json.open_count === 1 ? '' : 's'}.`);
      setPendingCancel(new Map());
      if (onConfirmed) onConfirmed([...json.inserted_ids, ...json.promoted_ids]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setConfirming(false); }
  };

  if (readOnly) return null;

  const cceCount = cart.filter((c) => c.source === 'cce_prestage').length;

  return (
    // v4.0.5 — outer chrome lifted to <Section n=4>; this is just the body.
    <div>
      {cceCount > 0 && (
        <p className="mb-2 text-[11px] text-violet-700">
          {cceCount} CCE pre-staged · review + confirm.
        </p>
      )}

      <div className="space-y-3">
        {confirmedMessage && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            ✓ {confirmedMessage}
          </div>
        )}

        {loading && (
          <div className="text-[11px] italic text-even-ink-400">Loading existing orders…</div>
        )}

        {/* v5.0.4 — Always-visible primary CTA: search.
            Bundle picker + AI suggestion chips are tucked behind a
            secondary "Show suggestions" link via CollapsedSuggestions —
            inverse of the broken v4.1.6 wrap which collapsed the entire
            section behind a single link and stranded the doctor.

            The legacy `expanded` state is still bound to the "+ Add a
            test" affordance in the cart header (so an already-populated
            cart still gets a fast path to add more), but it no longer
            gates the search input itself. */}
        {!loading && (
          <div className="space-y-3">
            <DiagnosticSearch
              onAdd={add}
              cartCodes={cartCodes}
              encounterId={encounterId}
            />
            <CollapsedSuggestions label="Show suggested + bundle tests">
              <div className="space-y-3 rounded-md border border-even-blue-100 bg-even-blue-50/30 p-3">
                <SuggestedOrderChips
                  encounterId={encounterId}
                  alreadyInCart={cartCodes}
                  onAdd={(row) => {
                    setCart((cur) => {
                      if (cur.some((c) => c.service_code === row.service_code)) return cur;
                      return [
                        ...cur,
                        {
                          service_code: row.service_code,
                          display_name: row.display_name,
                          sub_department: row.sub_department,
                          modality: row.modality,
                          source: 'context_chip',
                        },
                      ];
                    });
                  }}
                />
                <BundlePickerChips
                  alreadyInCart={cartCodes}
                  onPick={(items) => {
                    setCart((cur) => {
                      const existing = new Set(cur.map((c) => c.service_code));
                      const next = [...cur];
                      for (const it of items) {
                        if (existing.has(it.service_code)) continue;
                        next.push({
                          service_code: it.service_code,
                          display_name: it.display_name,
                          sub_department: it.sub_department,
                          modality: it.modality,
                          source: 'bundle',
                        });
                      }
                      return next;
                    });
                  }}
                />
              </div>
            </CollapsedSuggestions>
            {cart.length === 0 && pendingCancel.size === 0 && !confirmedMessage && (
              <p className="text-[11px] text-even-ink-500">
                Type a test name to search the EHRC catalog, or expand suggestions above.
              </p>
            )}
          </div>
        )}

        {(cart.length > 0 || pendingCancel.size > 0) && (
          <div className="rounded-md border border-even-ink-100 bg-white">
            <div className="flex items-baseline justify-between border-b border-even-ink-50 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-even-ink-500">
                Cart · {cart.length} kept{pendingCancel.size > 0 && ` · ${pendingCancel.size} to cancel`}
              </span>
              {/* v5.0.4 — search is always visible above, no need for re-expand */}
            </div>

            <ul className="divide-y divide-even-ink-50">
              {cart.map((c) => (
                <li key={c.service_code} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-even-navy">{c.display_name}</span>
                      <span className={`shrink-0 rounded-full border px-1.5 py-0 text-[10px] ${MODALITY_BADGE[c.modality]}`}>
                        {c.modality}
                      </span>
                      {c.source === 'cce_prestage' ? (
                        <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700 ring-1 ring-amber-200">
                          🧪 CCE pre-staged
                          {c.pre_staged_by_name && ` · ${c.pre_staged_by_name}`}
                          {c.pre_staged_at && ` · ${fmtTime(c.pre_staged_at)}`}
                        </span>
                      ) : c.existing_id ? (
                        <span className="shrink-0 rounded-full bg-even-ink-100 px-1.5 py-0 text-[10px] text-even-ink-600">
                          existing
                        </span>
                      ) : c.source === 'bundle' ? (
                        <span className="shrink-0 rounded-full bg-even-blue-50 px-1.5 py-0 text-[10px] text-even-blue-700 ring-1 ring-even-blue-200">
                          via bundle
                        </span>
                      ) : c.source === 'context_chip' ? (
                        <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0 text-[10px] text-violet-700 ring-1 ring-violet-200">
                          via AI
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-even-ink-100 px-1.5 py-0 text-[10px] text-even-ink-600">
                          manual
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-even-ink-500">{c.sub_department}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    aria-label={`Remove ${c.display_name}`}
                    className="rounded-md px-2 py-1 text-xs text-even-ink-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    × Remove
                  </button>
                  </div>
                  {/* v3.6 — imaging-specific inline detail fields */}
                  {c.modality === 'imaging' && (
                    <div className="mt-1.5 flex gap-2 pl-5">
                      <input
                        type="text"
                        value={c.clinical_indication ?? ''}
                        onChange={(e) => updateItem(c.service_code, { clinical_indication: e.target.value })}
                        placeholder='Clinical indication — e.g. "rule out gallstones"'
                        className="flex-1 rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px]"
                      />
                      <input
                        type="text"
                        value={c.body_area ?? ''}
                        onChange={(e) => updateItem(c.service_code, { body_area: e.target.value })}
                        placeholder='Body area'
                        className="w-24 rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px]"
                      />
                      <select
                        value={c.laterality ?? ''}
                        onChange={(e) => updateItem(c.service_code, { laterality: e.target.value || undefined })}
                        className="w-20 rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px]"
                      >
                        <option value="">—</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="bilateral">Both</option>
                      </select>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {pendingCancel.size > 0 && (
              <div className="border-t border-rose-100 bg-rose-50/40 px-3 py-2">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-rose-700">
                  Will be cancelled
                </div>
                <ul className="space-y-1.5">
                  {Array.from(pendingCancel.entries()).map(([id, reason]) => (
                    <li key={id} className="flex items-center gap-2 text-xs">
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => updateCancelReason(id, e.target.value)}
                        placeholder="Reason (optional, e.g. 'patient declined')"
                        className="flex-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-xs"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-even-ink-50 px-3 py-2">
              <div className="text-[11px] text-even-ink-500">
                Confirm flips encounter to <span className="font-mono">paused_diagnostics</span> (if any open).
              </div>
              <button
                type="button"
                onClick={confirm}
                disabled={confirming || (!dirty && cart.filter((c) => c.source === 'cce_prestage' && c.existing_id).length === 0)}
                className="rounded-md bg-even-blue px-3 py-1 text-xs font-medium text-white hover:bg-even-blue-700 disabled:opacity-50"
              >
                {confirming
                  ? 'Saving…'
                  : pendingCancel.size > 0
                    ? `Confirm ${cart.length} & cancel ${pendingCancel.size}`
                    : `Confirm ${cart.length} order${cart.length === 1 ? '' : 's'}`}
              </button>
            </div>
            {err && (
              <div className="border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {err}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

