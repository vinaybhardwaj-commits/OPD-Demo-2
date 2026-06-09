'use client';

/**
 * <BundlePickerChips /> — horizontal row of bundle chips above the
 * DiagnosticsQuickAddStrip's search. Tap a chip → fetches its items
 * and calls onPick(items) so parent can add them to cart.
 *
 * Mounted lazily — only fetches /api/admin/bundles when the strip is
 * actually open (otherwise it'd hit the endpoint on every encounter load).
 */
import { useEffect, useState } from 'react';
import type { CatalogRow } from './DiagnosticSearch';

type BundleSummary = {
  id: string;
  name: string;
  description: string | null;
  specialty_tag: string | null;
  n_items: number;
};

type BundleItem = {
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: CatalogRow['modality'];
  order_n: number;
  is_optional: boolean;
};

export function BundlePickerChips({
  onPick,
  alreadyInCart,
}: {
  onPick: (items: { service_code: string; display_name: string; sub_department: string; modality: CatalogRow['modality']; is_optional: boolean }[]) => void;
  alreadyInCart: Set<string>;
}) {
  const [bundles, setBundles] = useState<BundleSummary[]>([]);
  const [loadingChip, setLoadingChip] = useState<string | null>(null);
  const [loadedList, setLoadedList] = useState(false);

  useEffect(() => {
    if (loadedList) return;
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/admin/bundles');
      const json = await res.json();
      if (!cancelled && json.ok) {
        setBundles((json.bundles as BundleSummary[]).filter((b) => b.n_items > 0));
        setLoadedList(true);
      }
    })();
    return () => { cancelled = true; };
  }, [loadedList]);

  const pick = async (b: BundleSummary) => {
    setLoadingChip(b.id);
    try {
      const res = await fetch(`/api/admin/bundles/${b.id}`);
      const json = await res.json();
      if (json.ok) {
        const items = json.items as BundleItem[];
        // Skip items already in cart — silent dedupe
        const fresh = items.filter((i) => !alreadyInCart.has(i.service_code));
        onPick(fresh.map((i) => ({
          service_code: i.service_code,
          display_name: i.display_name,
          sub_department: i.sub_department,
          modality: i.modality,
          is_optional: i.is_optional,
        })));
      }
    } finally {
      setLoadingChip(null);
    }
  };

  if (bundles.length === 0) {
    return (
      <div className="text-[11px] italic text-even-ink-400">
        No bundles yet. Super-admin can create them at <span className="font-mono">/admin/bundles</span>.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-even-ink-500">Bundles</div>
      <div className="flex flex-wrap gap-1.5">
        {bundles.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => pick(b)}
            disabled={loadingChip === b.id}
            title={b.description ?? undefined}
            className="rounded-full border border-even-blue-200 bg-even-blue-50 px-2.5 py-0.5 text-xs text-even-blue-700 hover:bg-even-blue-100 disabled:opacity-50"
          >
            {loadingChip === b.id ? 'Adding…' : `+ ${b.name}`}
            <span className="ml-1 text-[10px] text-even-blue-500">({b.n_items})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
