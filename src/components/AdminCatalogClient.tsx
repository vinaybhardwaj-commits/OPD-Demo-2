'use client';

/**
 * <AdminCatalogClient> — search/filter/edit UI for diagnostic_catalog.
 *
 * - Search box (debounced 250ms) hits GET /api/admin/diagnostic-catalog
 * - Modality chips filter the list
 * - Active toggle (Active only / Inactive only / All)
 * - Table renders display_name + sub_department + modality + synonyms + tags
 * - Click a row → side drawer with editable fields + Save
 * - PATCH /api/admin/diagnostic-catalog/[service_code] persists edits
 */
import { useEffect, useMemo, useState } from 'react';

export type CatalogRow = {
  service_code: string;
  display_name: string;
  department: string;
  sub_department: string;
  service_type: string;
  modality: 'lab' | 'imaging' | 'cardiology' | 'procedure';
  patient_types: string[];
  is_active: boolean;
  is_outsourced: boolean;
  schedulable: boolean;
  multiple_sittings: boolean;
  description: string | null;
  patient_instructions: string | null;
  synonyms: string[];
  standard_codes: Record<string, unknown>;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type ModalityCount = { modality: string; n: number };

const MODALITIES: { key: CatalogRow['modality']; label: string }[] = [
  { key: 'lab', label: 'Labs' },
  { key: 'imaging', label: 'Imaging' },
  { key: 'cardiology', label: 'Cardiology' },
  { key: 'procedure', label: 'Procedures' },
];

const MODALITY_BADGE: Record<CatalogRow['modality'], string> = {
  lab: 'bg-blue-50 text-blue-700 border-blue-200',
  imaging: 'bg-violet-50 text-violet-700 border-violet-200',
  cardiology: 'bg-rose-50 text-rose-700 border-rose-200',
  procedure: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function AdminCatalogClient({
  initialRows,
  counts,
  totalActive,
}: {
  initialRows: CatalogRow[];
  counts: ModalityCount[];
  totalActive: number;
}) {
  const [q, setQ] = useState('');
  const [modality, setModality] = useState<CatalogRow['modality'] | null>(null);
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | 'all'>('true');
  const [rows, setRows] = useState<CatalogRow[]>(initialRows);
  const [total, setTotal] = useState<number>(totalActive);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [took, setTook] = useState<number | null>(null);
  const [editing, setEditing] = useState<CatalogRow | null>(null);

  // Debounced fetch on q / modality / activeFilter / page change
  useEffect(() => {
    const id = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (modality) params.set('modality', modality);
      params.set('active', activeFilter);
      params.set('page', String(page));
      params.set('limit', '50');
      try {
        const res = await fetch(`/api/admin/diagnostic-catalog?${params}`);
        const json = await res.json();
        if (json.ok) {
          setRows(json.rows);
          setTotal(json.total);
          setTook(json.took_ms);
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [q, modality, activeFilter, page]);

  const countByModality = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of counts) m.set(c.modality, c.n);
    return m;
  }, [counts]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-5">
      {/* Search + filters */}
      <div className="rounded-xl border border-even-ink-100 bg-white p-4">
        <div className="mb-3 flex gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder='Search display name, synonym, or sub-department — try "glyco" or "Lipid"'
            className="flex-1 rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm focus:border-even-blue focus:outline-none focus:ring-2 focus:ring-even-blue-100"
            autoFocus
          />
          <select
            value={activeFilter}
            onChange={(e) => { setActiveFilter(e.target.value as 'true' | 'false' | 'all'); setPage(1); }}
            className="rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
          >
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setModality(null); setPage(1); }}
            className={`rounded-full border px-3 py-1 text-xs ${
              modality === null
                ? 'border-even-blue bg-even-blue text-white'
                : 'border-even-ink-200 bg-white text-even-ink-700 hover:bg-even-ink-50'
            }`}
          >
            All · {totalActive}
          </button>
          {MODALITIES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => { setModality(modality === m.key ? null : m.key); setPage(1); }}
              className={`rounded-full border px-3 py-1 text-xs ${
                modality === m.key
                  ? 'border-even-blue bg-even-blue text-white'
                  : 'border-even-ink-200 bg-white text-even-ink-700 hover:bg-even-ink-50'
              }`}
            >
              {m.label} · {countByModality.get(m.key) ?? 0}
            </button>
          ))}
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-xs text-even-ink-500">
        <span>
          {loading ? 'Searching…' : `${total} match${total === 1 ? '' : 'es'}`}
          {took !== null && !loading && ` · ${took}ms`}
        </span>
        <span>
          Page {page} of {totalPages}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-even-ink-100 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-even-ink-100 bg-even-ink-50 text-[10px] uppercase tracking-wider text-even-ink-500">
            <tr>
              <th className="px-3 py-2 text-left">Service code</th>
              <th className="px-3 py-2 text-left">Display name</th>
              <th className="px-3 py-2 text-left">Modality</th>
              <th className="px-3 py-2 text-left">Sub-department</th>
              <th className="px-3 py-2 text-left">Synonyms</th>
              <th className="px-3 py-2 text-left">Tags</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-even-ink-400">No matches.</td></tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.service_code}
                onClick={() => setEditing(r)}
                className="cursor-pointer border-b border-even-ink-50 hover:bg-even-blue-50/40"
              >
                <td className="px-3 py-2 font-mono text-xs text-even-ink-500">{r.service_code}</td>
                <td className="px-3 py-2 font-medium text-even-navy">
                  {r.display_name}
                  {!r.is_active && <span className="ml-2 text-[10px] uppercase text-rose-600">inactive</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${MODALITY_BADGE[r.modality]}`}>
                    {r.modality}
                  </span>
                </td>
                <td className="px-3 py-2 text-even-ink-600">{r.sub_department}</td>
                <td className="px-3 py-2 text-xs text-even-ink-500">
                  {r.synonyms.length === 0
                    ? <span className="text-even-ink-300">—</span>
                    : r.synonyms.slice(0, 3).join(', ') + (r.synonyms.length > 3 ? ` +${r.synonyms.length - 3}` : '')}
                </td>
                <td className="px-3 py-2 text-xs text-even-ink-500">
                  {r.tags.length === 0
                    ? <span className="text-even-ink-300">—</span>
                    : r.tags.join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-even-ink-200 bg-white px-3 py-1 text-xs disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="rounded-md border border-transparent px-3 py-1 text-xs text-even-ink-500">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-md border border-even-ink-200 bg-white px-3 py-1 text-xs disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {/* Edit drawer */}
      {editing && (
        <EditDrawer
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((prev) => prev.map((r) => r.service_code === updated.service_code ? { ...r, ...updated } : r));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditDrawer({
  row,
  onClose,
  onSaved,
}: {
  row: CatalogRow;
  onClose: () => void;
  onSaved: (updated: Partial<CatalogRow> & { service_code: string }) => void;
}) {
  const [displayName, setDisplayName] = useState(row.display_name);
  const [synonyms, setSynonyms] = useState(row.synonyms.join(', '));
  const [tags, setTags] = useState(row.tags.join(', '));
  const [instructions, setInstructions] = useState(row.patient_instructions ?? '');
  const [description, setDescription] = useState(row.description ?? '');
  const [isActive, setIsActive] = useState(row.is_active);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const body = {
        display_name: displayName,
        synonyms: synonyms.split(',').map(s => s.trim()).filter(Boolean),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        patient_instructions: instructions || null,
        description: description || null,
        is_active: isActive,
      };
      const res = await fetch(`/api/admin/diagnostic-catalog/${encodeURIComponent(row.service_code)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) { setErr(json.error ?? 'save_failed'); return; }
      onSaved({ ...body, service_code: row.service_code });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/30" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-y-auto border-l border-even-ink-100 bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 font-mono text-xs text-even-ink-400">{row.service_code}</div>
        <h2 className="mb-1 text-lg font-semibold text-even-navy">{row.display_name}</h2>
        <div className="mb-6 text-xs text-even-ink-500">
          {row.modality} · {row.sub_department} · {row.service_type}
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
              Synonyms (comma-separated — clinician shorthand, e.g. &quot;glyco, sugar test&quot;)
            </span>
            <textarea
              value={synonyms}
              onChange={(e) => setSynonyms(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm font-mono"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">Tags (comma-separated)</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm font-mono"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">
              Patient instructions (pre-test prep — surfaces in the ordering UI)
            </span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder='e.g. "Fasting 8 hours required"'
              className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-even-ink-500">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-even-ink-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Active (orderable)
          </label>

          <div className="mt-2 rounded-md border border-even-ink-100 bg-even-ink-50/60 p-3 text-[11px] text-even-ink-500">
            <div><span className="font-mono">department</span> {row.department}</div>
            <div><span className="font-mono">patient_types</span> {row.patient_types.join(', ')}</div>
            <div><span className="font-mono">updated_at</span> {row.updated_at}</div>
            <div className="mt-1 text-even-ink-400">
              These columns are sourced from the rate-card and overwritten on re-seed. Edit the xlsx and re-run the seed endpoint to change them.
            </div>
          </div>

          {err && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{err}</div>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-even-blue px-4 py-2 text-sm font-medium text-white hover:bg-even-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
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
