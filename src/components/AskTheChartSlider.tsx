'use client';

/**
 * AskTheChartSlider — D.7 (V, 10 Jun): the places swap. Patient history
 * now lives naked in the right rail; Ask-the-Chart (KB-grounded queries +
 * the CDMSS context behind it) moves HERE — a left-edge tab that slides
 * out a 420px panel, same mechanics the history panel used. Preference
 * persisted in localStorage.
 */
import * as React from 'react';
import { AskTheChartRail } from './AskTheChartRail';

const LS_KEY = 'd7.ask_open';

export function AskTheChartSlider({
  encounterId,
  readOnly,
}: {
  encounterId: string;
  readOnly?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      setOpen(localStorage.getItem(LS_KEY) === '1');
    } catch { /* intentional: preference only */ }
    setHydrated(true);
  }, []);

  const persist = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(LS_KEY, next ? '1' : '0'); } catch { /* intentional */ }
  };
  const isOpen = hydrated && open;

  return (
    <>
      <button
        type="button"
        aria-label={isOpen ? 'Collapse Ask the Chart' : 'Expand Ask the Chart'}
        aria-expanded={isOpen}
        onClick={() => persist(!isOpen)}
        className="fixed left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-lg border border-l-0 border-violet-200 bg-violet-50 px-1.5 py-3 text-violet-800 shadow-sm transition hover:bg-violet-100"
      >
        <span aria-hidden className="block text-base leading-none">{isOpen ? '◀' : '✨'}</span>
        <span className="mt-1 block text-[8px] font-semibold uppercase tracking-wider">
          {isOpen ? 'Hide' : 'Ask'}
        </span>
      </button>

      {isOpen && (
        <div aria-hidden className="fixed inset-0 z-20 bg-black/10" onClick={() => persist(false)} />
      )}

      <aside
        aria-hidden={!isOpen}
        className={`fixed left-0 top-0 z-20 flex h-screen w-[420px] flex-col border-r border-violet-200 bg-white shadow-lg transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-violet-100 px-4 py-3">
          <h2 className="text-sm font-bold text-even-navy-800">✨ Ask the Chart</h2>
          <button
            type="button"
            onClick={() => persist(false)}
            className="rounded-md bg-even-ink-50 px-2 py-0.5 text-xs font-semibold text-even-ink-600 hover:bg-even-ink-100"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {isOpen && <AskTheChartRail encounterId={encounterId} readOnly={readOnly} />}
        </div>
      </aside>
    </>
  );
}
