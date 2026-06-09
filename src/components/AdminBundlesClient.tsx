'use client';

/**
 * <AdminBundlesClient> — bundle CRUD UI.
 *
 * Top-of-page: "+ New bundle" button + table of bundles with n_items + delete.
 * Click a row → drawer that loads full items + lets you edit metadata
 * + add/remove items via the shared DiagnosticSearch primitive.
 */
import { useEffect, useState } from 'react';
import { DiagnosticSearch, type CatalogRow } from './DiagnosticSearch';

export type BundleRow = {
  id: string;
  name: string;
  description: string | null;
  specialty_tag: string | null;
  is_active: boolean;
  n_items: number;
  created_at: string;
};

type BundleItem = {
  service_code: string;
  display_name: string;
  sub_department: string;
  modality: CatalogRow['modality'];
  order_n: number;
  is_optional: boolean;
};

const MODALITY_BADGE: Record<CatalogRow['modality'], string> = {
  lab: 'bg-blue-50 text-blue-700 border-blue-200',
  imaging: 'bg-violet-50 text-violet-700 border-violet-200',
  cardiology: 'bg-rose-50 text-rose-700 border-rose-200',
  procedure: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function AdminBundlesClient({ initialBundles }: { initialBundles: BundleRow[] }) {
  const [bundles, setBundles] = useState<BundleRow[]>(initialBundles);
  const [editing, setEditing] = useState<BundleRow | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    const res = await fetch('/api/admin/bundles');
    const json = await res.json();
    if (json.ok) setBundles(json.bundles);
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Soft-delete bundle "${name}"? (sets is_active=false)`)) return;
    const res = await fetch(`/api/admin/bundles/${id}`, { method: 'DELETE' });
    if (res.ok) await refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md bg-even-blue px-3 py-2 text-sm font-medium text-white hover:bg-even-blue-700"
        >
          + New bundle
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-even-ink-100 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-even-ink-100 bg-even-ink-50 text-[10px] uppercase tracking-wider text-even-ink-500">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Specialty</th>
              <th className="px-3 py-2 text-left">Tests</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {bundles.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-even-ink-400">
                No bundles yet. Tap &quot;+ New bundle&quot; to create the first.
              </td></tr>
            )}
            {bundles.map((b) => (
              <tr
                key={b.id}
                onClick={() => setEditing(b)}
                className="cursor-pointer border-b border-even-ink-50 hover:bg-even-blue-50/40"
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-even-navy">{b.name}</div>
                  {b.description && <div className="text-[11px] text-even-ink-500">{b.description}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-even-ink-600">
                  {b.specialty_tag ?? <span className="text-even-ink-300">—</span>}
                </td>
                <td className="px-3 py-2 text-xs text-even-ink-600">
                  {b.n_items} test{b.n_items === 1 ? '' : 's'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); remove(b.id, b.name); }}
                    className="rounded-md px-2 py-1 text-xs text-even-ink-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <BundleDrawer
          bundle={editing}
          isCreating={creating}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { await refresh(); setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

function BundleDrawer({
  bundle,
  isCreating,
  onClose,
  onSaved,
}: {
  bundle: BundleRow | null;
  isCreating: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(bundle?.name ?? '');
  const [description, setDescription] = useState(bundle?.description ?? '');
  const [specialty, setSpecialty] = useState(bundle?.specialty_tag ?? '');
  const [items, setItems] = useState<BundleItem[]>([]);
  const [loading, setLoading] = useState(!isCreating);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load existing items for edit
  useEffect(() => {
    if (isCreating || !bundle) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/bundles/${bundle.id}`);
      const json = await res.json();
      if (!cancelled && json.ok) setItems(json.items);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bundle, isCreating]);

  const cartCodes = new Set(items.map((i) => i.service_code));

  const addItem = (row: CatalogRow) => {
    if (cartCodes.has(row.service_code)) return;
    setItems((cur) => [
      ...cur,
      {
        service_code: row.service_code,
        display_name: row.display_name,
        sub_department: row.sub_department,
        modality: row.modality,
        order_n: cur.length,
        is_optional: false,
      },
    ]);
  };

  const removeItem = (code: string) =>
    setItems((cur) => cur.filter((i) => i.service_code !== code).map((i, idx) => ({ ...i, order_n: idx })));

  const toggleOptional = (code: string) =>
    setItems((cur) => cur.map((i) => i.service_code === code ? { ...i, is_optional: !i.is_optional } : i));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        specialty_tag: specialty.trim() || null,
        items: items.map((i, idx) => ({
          service_code: i.service_code,
          order_n: idx,
          is_optional: i.is_optional,
        })),
      };
      const url = isCreating ? '/api/admin/bundles' : `/api/admin/bundles/${bundle!.id}`;
      const method = isCreating ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error === 'name_taken' ? 'A bundle with this name already exists.' : (json.error ?? 'save_failed'));
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/30" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-y-auto border-l border-even-ink-100 bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 text-xs font-mono text-even-ink-400">
          {isCreating ? 'NEW BUNDLE' : `BUNDLE · ${bundle?.id.slice(0, 8)}`}
        </div>
        <h2 className="mb-6 text-lg font-semibold text-even-navy">
          {isCreating ? 'Create bundle' : `Edit "${bundle?.name}"`}
        </h2>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Diabetic follow-up"
              className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What the bundle covers — surfaces in tooltip on the picker chip."
              className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">Specialty tag (optional)</span>
            <input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="e.g. endocrinology, cardiology, general_medicine"
              className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <div>
            <div className="mb-2 text-[10px] uppercase tracking-wider text-even-ink-500">
              Tests in bundle · {items.length}
            </div>
            {loading ? (
              <div className="text-[11px] italic text-even-ink-400">Loading items…</div>
            ) : items.length === 0 ? (
              <div className="rounded-md border border-dashed border-even-ink-200 bg-even-ink-50/40 px-3 py-3 text-center text-xs text-even-ink-400">
                No tests in bundle yet. Search below to add.
              </div>
            ) : (
              <ul className="overflow-hidden rounded-md border border-even-ink-100">
                {items.map((i, idx) => (
                  <li key={i.service_code} className="flex items-center justify-between gap-3 border-b border-even-ink-50 px-3 py-2 text-sm last:border-b-0">
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="w-5 text-[10px] text-even-ink-400">{idx + 1}.</span>
                      <span className="font-medium text-even-navy">{i.display_name}</span>
                      <span className={`shrink-0 rounded-full border px-1.5 py-0 text-[10px] ${MODALITY_BADGE[i.modality]}`}>
                        {i.modality}
                      </span>
                      {i.is_optional && (
                        <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700">
                          optional
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleOptional(i.service_code)}
                      className="rounded-md px-2 py-1 text-[10px] text-even-ink-500 hover:bg-even-ink-50"
                    >
                      {i.is_optional ? 'mark required' : 'mark optional'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(i.service_code)}
                      className="rounded-md px-2 py-1 text-xs text-even-ink-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      × Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border border-even-blue-100 bg-even-blue-50/30 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-even-blue-700">Add tests</div>
            <DiagnosticSearch
              onAdd={addItem}
              cartCodes={cartCodes}
              placeholder="Search the catalog — e.g. CBC, HbA1c, urine routine"
            />
          </div>

          {err && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{err}</div>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || name.trim().length === 0}
              className="rounded-md bg-even-blue px-4 py-2 text-sm font-medium text-white hover:bg-even-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : isCreating ? 'Create bundle' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-even-ink-200 bg-white px-4 py-2 text-sm hover:bg-even-ink-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
