'use client';

/**
 * <CommandPalette /> — v4.0.9
 *
 * ⌘K / Ctrl+K command palette for the encounter page. Lists:
 *   - Jump-to-section actions (scroll smoothly to each numbered section).
 *   - Global actions (submit, save draft, open shortcuts overlay, etc.).
 *   - Navigation (back to queue).
 *
 * Fuzzy substring filter; ↑↓ to move highlight; Enter to execute;
 * Esc to close. Backdrop click closes too. Mounted by EncounterEditor.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export type CommandAction = {
  id: string;
  label: string;
  group: 'Jump to' | 'Action' | 'Navigation';
  hint?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: CommandAction[];
}) {
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Fuzzy substring filter: every character in q must appear in label in
  // order. Case-insensitive. Empty q matches all.
  const filtered = useMemo(() => {
    if (!q.trim()) return commands;
    const needle = q.trim().toLowerCase();
    return commands.filter((c) => {
      const hay = (c.label + ' ' + (c.hint ?? '') + ' ' + c.group).toLowerCase();
      let i = 0;
      for (const ch of needle) {
        const idx = hay.indexOf(ch, i);
        if (idx === -1) return false;
        i = idx + 1;
      }
      return true;
    });
  }, [q, commands]);

  // Group filtered commands for display, preserving original group order.
  const grouped = useMemo(() => {
    const order: CommandAction['group'][] = ['Jump to', 'Action', 'Navigation'];
    const out: { group: CommandAction['group']; items: CommandAction[] }[] = [];
    for (const g of order) {
      const items = filtered.filter((c) => c.group === g);
      if (items.length > 0) out.push({ group: g, items });
    }
    return out;
  }, [filtered]);

  // Flat list (in display order) so ↑↓ stays linear.
  const flatList = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  useEffect(() => {
    // Clamp highlight when filter shrinks the list.
    if (highlight >= flatList.length) setHighlight(Math.max(0, flatList.length - 1));
  }, [flatList.length, highlight]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, flatList.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = flatList[highlight];
        if (target) {
          onClose();
          // Defer so closing animation / focus restoration completes first.
          setTimeout(() => target.run(), 0);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flatList, highlight, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      role="dialog"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-even-ink-100 px-3 py-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to section, run an action…"
            className="w-full bg-transparent text-sm text-even-navy placeholder:text-even-ink-400 focus:outline-none"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {flatList.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs italic text-even-ink-400">
              No matches.
            </p>
          ) : (
            grouped.map((g) => (
              <div key={g.group} className="py-1">
                <p className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-even-ink-400">
                  {g.group}
                </p>
                {g.items.map((cmd) => {
                  const idx = flatList.indexOf(cmd);
                  const active = idx === highlight;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => {
                        onClose();
                        setTimeout(() => cmd.run(), 0);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition ${
                        active
                          ? 'bg-even-blue text-white'
                          : 'text-even-navy hover:bg-even-ink-50'
                      }`}
                    >
                      <span>{cmd.label}</span>
                      {cmd.hint && (
                        <span className={`text-[10px] ${active ? 'text-white/80' : 'text-even-ink-400'}`}>
                          {cmd.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-even-ink-100 bg-even-ink-50/50 px-3 py-1.5 text-[10px] text-even-ink-500">
          <span>
            <kbd className="rounded border border-even-ink-200 bg-white px-1 py-0.5 font-mono text-[9px]">↑↓</kbd>{' '}
            navigate · <kbd className="rounded border border-even-ink-200 bg-white px-1 py-0.5 font-mono text-[9px]">↩</kbd>{' '}
            select · <kbd className="rounded border border-even-ink-200 bg-white px-1 py-0.5 font-mono text-[9px]">Esc</kbd>{' '}
            close
          </span>
          <span>{flatList.length} match{flatList.length === 1 ? '' : 'es'}</span>
        </div>
      </div>
    </div>
  );
}
