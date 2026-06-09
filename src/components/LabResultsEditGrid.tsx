'use client';

/**
 * <LabResultsEditGrid /> — v2.1.4 editable lab-results table.
 *
 * Lets the lab tech correct any cell from the Qwen-VL extraction, add
 * missing rows (Qwen misses some on noisy scans), or drop spurious
 * rows (Qwen sometimes pulls patient metadata as a "test").
 *
 * Editable cells per row:
 *   - display_name  (free text, also re-slugs canonical_key)
 *   - value         (one combined input → smart-split into
 *                    value_numeric vs value_text)
 *   - unit          (free text)
 *   - reference_range (free text)
 *   - abnormal_flag (select: low | high | critical_low | critical_high
 *                    | normal | unknown)
 *
 * Row actions: Delete (always), Add row (always at bottom).
 *
 * Validation before post:
 *   - At least one item
 *   - Every item must have display_name (non-empty)
 *   - canonical_key auto-slugged from display_name if missing OR if
 *     display_name was edited after last canonical_key assignment
 *
 * Caller wires up the actual POST /confirm via onConfirm callback.
 *
 * Why not auto-save: lab values are clinical data — explicit "Post"
 * gesture is the audit boundary. v2.1.4 keeps the tech in full control.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExtractedLabItem } from '@/lib/qwen-vision';

export type LabResultsEditGridProps = {
  initialItems: ExtractedLabItem[];
  /** Optional Vercel Blob URL of the source report — shown in side iframe. */
  blobUrl?: string | null;
  busy?: boolean;
  errorText?: string | null;
  /**
   * Called when the tech clicks Post results. autoPosted is `false`
   * for manual edits; the auto-confirm countdown calls onConfirm with
   * the un-edited items directly (separate code path in parent).
   */
  onConfirm: (items: ExtractedLabItem[]) => Promise<void> | void;
};

type EditableRow = ExtractedLabItem & {
  /** raw `value` cell text — split into numeric/text on save */
  value_input: string;
};

const FLAG_OPTIONS: ExtractedLabItem['abnormal_flag'][] = [
  'unknown',
  'normal',
  'low',
  'high',
  'critical_low',
  'critical_high',
];

export function LabResultsEditGrid({
  initialItems,
  blobUrl,
  busy,
  errorText,
  onConfirm,
}: LabResultsEditGridProps) {
  const [rows, setRows] = useState<EditableRow[]>(() =>
    initialItems.map(toEditableRow),
  );

  // Keep rows in sync if parent passes a new initialItems (e.g. after
  // a re-upload). Cheap shallow compare on length+canonical_keys.
  const initialSig = useMemo(
    () => `${initialItems.length}:${initialItems.map((i) => i.canonical_key).join('|')}`,
    [initialItems],
  );
  useEffect(() => {
    setRows(initialItems.map(toEditableRow));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSig]);

  const update = useCallback(
    (idx: number, patch: Partial<EditableRow>) => {
      setRows((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        // Re-slug canonical_key from display_name on edits.
        if (patch.display_name !== undefined) {
          next[idx].canonical_key = slugify(next[idx].display_name);
        }
        return next;
      });
    },
    [],
  );

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        canonical_key: '',
        display_name: '',
        value_numeric: null,
        value_text: null,
        unit: null,
        reference_range: null,
        abnormal_flag: 'unknown',
        confidence: 1.0, // tech entered it — they vouch
        value_input: '',
      },
    ]);
  }, []);

  const deleteRow = useCallback((idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handlePost = useCallback(async () => {
    // Validate
    const cleaned: ExtractedLabItem[] = [];
    for (const r of rows) {
      const name = r.display_name.trim();
      if (!name) continue;
      const { num, text } = splitValueInput(r.value_input);
      cleaned.push({
        canonical_key: r.canonical_key || slugify(name),
        display_name: name,
        value_numeric: num,
        value_text: text,
        unit: r.unit?.trim() || null,
        reference_range: r.reference_range?.trim() || null,
        abnormal_flag: r.abnormal_flag,
        confidence: r.confidence,
      });
    }
    if (cleaned.length === 0) {
      // Don't post nothing.
      return;
    }
    await onConfirm(cleaned);
  }, [rows, onConfirm]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Source preview pane — Polish #6: shorter on mobile so the
          edit grid stays in view below it without long scroll. */}
      <div className="min-h-[280px] overflow-hidden rounded-xl border border-even-ink-200 bg-even-ink-50/40 sm:min-h-[360px] lg:min-h-[420px]">
        {blobUrl ? (
          <iframe
            src={blobUrl}
            className="h-full min-h-[280px] w-full sm:min-h-[360px] lg:min-h-[420px]"
            title="Source report"
          />
        ) : (
          <div className="flex h-full min-h-[280px] items-center justify-center p-6 text-center text-xs text-even-ink-500 sm:min-h-[360px] lg:min-h-[420px]">
            No source preview yet. Upload a PDF/image to see it here.
          </div>
        )}
        {blobUrl && (
          <div className="border-t border-even-ink-200 bg-white px-3 py-1 text-[10px] text-even-ink-500">
            Source ·{' '}
            <a
              href={blobUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-even-navy"
            >
              open in new tab
            </a>
          </div>
        )}
      </div>

      {/* Edit grid pane */}
      <div className="overflow-hidden rounded-xl border border-even-ink-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-even-ink-50 text-even-ink-600">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider">
                  Test
                </th>
                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider">
                  Value
                </th>
                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider">
                  Unit
                </th>
                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider">
                  Ref
                </th>
                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider">
                  Flag
                </th>
                <th className="px-1 py-1.5 text-right">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-even-ink-100">
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-[11px] text-even-ink-400"
                  >
                    No rows yet. Click &quot;Add row&quot; below.
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => (
                <tr key={idx} className={confidenceTint(r.confidence)}>
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      value={r.display_name}
                      onChange={(e) => update(idx, { display_name: e.target.value })}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-even-navy focus:border-even-navy focus:bg-white focus:outline-none"
                      placeholder="e.g. Hemoglobin"
                      disabled={busy}
                    />
                    <div className="mt-0.5 px-1 font-mono text-[9px] text-even-ink-400">
                      {r.canonical_key || '—'}
                    </div>
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      value={r.value_input}
                      onChange={(e) => update(idx, { value_input: e.target.value })}
                      className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-[12px] tabular-nums text-even-navy focus:border-even-navy focus:bg-white focus:outline-none"
                      placeholder="13.2"
                      disabled={busy}
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      value={r.unit ?? ''}
                      onChange={(e) => update(idx, { unit: e.target.value || null })}
                      className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-even-ink-700 focus:border-even-navy focus:bg-white focus:outline-none"
                      placeholder="g/dL"
                      disabled={busy}
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      value={r.reference_range ?? ''}
                      onChange={(e) =>
                        update(idx, { reference_range: e.target.value || null })
                      }
                      className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-even-ink-700 focus:border-even-navy focus:bg-white focus:outline-none"
                      placeholder="13.0-17.0"
                      disabled={busy}
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <select
                      value={r.abnormal_flag}
                      onChange={(e) =>
                        update(idx, {
                          abnormal_flag: e.target
                            .value as ExtractedLabItem['abnormal_flag'],
                        })
                      }
                      className="rounded border border-even-ink-200 bg-white px-1 py-0.5 text-[10px] uppercase tracking-wider text-even-ink-700 focus:border-even-navy focus:outline-none"
                      disabled={busy}
                    >
                      {FLAG_OPTIONS.map((f) => (
                        <option key={f} value={f}>
                          {f.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => deleteRow(idx)}
                      disabled={busy}
                      className="text-[12px] leading-none text-even-ink-300 transition hover:text-even-pink-700 disabled:opacity-50"
                      title="Delete row"
                      aria-label="Delete row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-even-ink-100 bg-even-ink-50/60 px-3 py-2">
          <button
            type="button"
            onClick={addRow}
            disabled={busy}
            className="rounded-md border border-even-ink-200 bg-white px-2.5 py-1 text-[11px] font-medium text-even-ink-700 transition hover:border-even-navy-300 hover:text-even-navy disabled:opacity-50"
          >
            + Add row
          </button>
          <div className="flex items-center gap-2">
            {errorText && (
              <span className="text-[11px] text-even-pink-800">{errorText}</span>
            )}
            <button
              type="button"
              onClick={handlePost}
              disabled={busy || rows.length === 0}
              className="rounded-md bg-even-navy px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-even-navy-700 disabled:opacity-50"
            >
              {busy ? 'Posting…' : `Post ${rows.length} result${rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toEditableRow(it: ExtractedLabItem): EditableRow {
  return {
    ...it,
    value_input:
      it.value_numeric != null
        ? String(it.value_numeric)
        : it.value_text ?? '',
  };
}

function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Split the freeform value cell into numeric vs text. Numeric if the
 * whole input parses as a finite number after stripping commas. Else
 * goes into value_text. Empty stays null/null.
 */
function splitValueInput(input: string): {
  num: number | null;
  text: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) return { num: null, text: null };
  const cleaned = trimmed.replace(/,/g, '');
  const n = Number(cleaned);
  if (Number.isFinite(n) && /^-?\d/.test(cleaned)) {
    return { num: n, text: null };
  }
  return { num: null, text: trimmed };
}

function confidenceTint(conf: number): string {
  if (conf >= 0.9) return '';
  if (conf >= 0.7) return 'bg-amber-50/60';
  return 'bg-even-pink-50/60';
}
