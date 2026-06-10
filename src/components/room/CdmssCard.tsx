'use client';

/**
 * CdmssCard — P2.4 violet "AI — for your consideration" card (design §12.2).
 * Renders the six cited CDS groups: the two ACTIONABLE ones (what_to_do /
 * what_else_to_ask) with per-item Accept / Ignore wired to
 * encounter_cdmss_items, and the four ADVISORY groups collapsed below.
 * Sources render as numbered citations. Full Review Queue surface = P4
 * (accept there will also instantiate plans; here it records the decision).
 */
import * as React from 'react';

type Cited = { cites?: number[] };
type WhatToDo = Cited & { kind: string; summary: string; reasoning: string };
type WhatElse = Cited & { question: string; rationale: string };
type CitedText = Cited & { text: string };
type CitedDdx = Cited & { dx: string; why: string };
type Source = { index: number; book: string | null; chapter: string | null; section: string | null; excerpt: string };

export type CdmssPayload = {
  what_to_do?: WhatToDo[];
  what_else_to_ask?: WhatElse[];
  differentials_to_consider?: CitedDdx[];
  red_flags?: CitedText[];
  evidence_based_suggestions?: CitedText[];
  follow_up_considerations?: CitedText[];
  sources?: Source[];
};

export type CdmssItemRow = {
  id: string;
  item_group: string;
  payload: Record<string, unknown>;
  status: string;
};

const KIND_CHIP: Record<string, string> = {
  investigation: 'bg-even-blue-50 text-even-blue-700',
  treatment: 'bg-emerald-50 text-emerald-700',
  referral: 'bg-violet-50 text-violet-700',
  follow_up: 'bg-even-ink-50 text-even-ink-600',
  red_flag: 'bg-red-50 text-red-700',
};

function Cites({ cites }: { cites?: number[] }) {
  if (!cites || cites.length === 0) return null;
  return (
    <sup className="ml-0.5 text-[9px] font-semibold text-violet-500">
      [{cites.join(',')}]
    </sup>
  );
}

export function CdmssCard({
  encounterId,
  cdmss,
  items,
}: {
  encounterId: string;
  cdmss: CdmssPayload;
  items: CdmssItemRow[];
}) {
  const [statuses, setStatuses] = React.useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.id, i.status])),
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showAdvisory, setShowAdvisory] = React.useState(false);
  const [showSources, setShowSources] = React.useState(false);

  const act = async (itemId: string, action: 'accept' | 'ignore' | 'reset') => {
    setBusy(itemId);
    try {
      const res = await fetch(`/api/encounters/${encounterId}/cdmss-items/${itemId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = (await res.json()) as { ok?: boolean; status?: string };
      if (j.ok && j.status) setStatuses((s) => ({ ...s, [itemId]: j.status! }));
    } catch {
      /* intentional: leave the row as-is; doctor can retry */
    } finally {
      setBusy(null);
    }
  };

  // Match item rows to payload entries by summary/question text.
  const rowFor = (group: string, key: string): CdmssItemRow | undefined =>
    items.find(
      (i) =>
        i.item_group === group &&
        ((i.payload.summary as string) === key || (i.payload.question as string) === key),
    );

  const ItemActions = ({ row }: { row: CdmssItemRow | undefined }) => {
    if (!row) return null;
    const st = statuses[row.id] ?? row.status;
    if (st === 'accepted')
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700">
          ✓ accepted
          <button onClick={() => act(row.id, 'reset')} disabled={busy === row.id} className="font-normal text-even-ink-400 hover:underline">undo</button>
        </span>
      );
    if (st === 'ignored')
      return (
        <span className="flex items-center gap-1.5 text-[10px] text-even-ink-400">
          ignored
          <button onClick={() => act(row.id, 'reset')} disabled={busy === row.id} className="hover:underline">undo</button>
        </span>
      );
    return (
      <span className="flex items-center gap-1">
        <button
          onClick={() => act(row.id, 'accept')}
          disabled={busy === row.id}
          className="rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Accept
        </button>
        <button
          onClick={() => act(row.id, 'ignore')}
          disabled={busy === row.id}
          className="rounded-md bg-even-ink-50 px-2 py-0.5 text-[10px] text-even-ink-500 hover:bg-even-ink-100 disabled:opacity-50"
        >
          Ignore
        </button>
      </span>
    );
  };

  const todo = cdmss.what_to_do ?? [];
  const toAsk = cdmss.what_else_to_ask ?? [];
  const ddx = cdmss.differentials_to_consider ?? [];
  const flags = cdmss.red_flags ?? [];
  const ebs = cdmss.evidence_based_suggestions ?? [];
  const fu = cdmss.follow_up_considerations ?? [];
  const sources = cdmss.sources ?? [];
  const advisoryCount = ddx.length + flags.length + ebs.length + fu.length;

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-violet-700">
          AI — for your consideration
        </h2>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700">
          KB-grounded · citation-audited
        </span>
        <span className="ml-auto text-[10px] text-even-ink-400">
          advisory — your disposition never waits on this
        </span>
      </div>

      {todo.length > 0 && (
        <div className="mt-3">
          <h3 className="text-[11px] font-bold text-even-navy-800">What to do</h3>
          <ul className="mt-1 space-y-1.5">
            {todo.map((it, i) => (
              <li key={i} className="rounded-lg border border-violet-100 bg-white p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs text-even-ink-800">
                    <span className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${KIND_CHIP[it.kind] ?? KIND_CHIP.follow_up}`}>
                      {it.kind.replace(/_/g, ' ')}
                    </span>
                    <span className="font-medium">{it.summary}</span>
                    <Cites cites={it.cites} />
                    {it.reasoning ? <p className="mt-0.5 text-[11px] text-even-ink-500">{it.reasoning}</p> : null}
                  </div>
                  <ItemActions row={rowFor('what_to_do', it.summary)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toAsk.length > 0 && (
        <div className="mt-3">
          <h3 className="text-[11px] font-bold text-even-navy-800">What else to ask</h3>
          <ul className="mt-1 space-y-1.5">
            {toAsk.map((it, i) => (
              <li key={i} className="rounded-lg border border-violet-100 bg-white p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs text-even-ink-800">
                    <span className="font-medium">{it.question}</span>
                    <Cites cites={it.cites} />
                    {it.rationale ? <p className="mt-0.5 text-[11px] text-even-ink-500">{it.rationale}</p> : null}
                  </div>
                  <ItemActions row={rowFor('what_else', it.question)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {advisoryCount > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowAdvisory((v) => !v)}
            className="text-[11px] font-semibold text-violet-700 hover:underline"
          >
            {showAdvisory ? '▾' : '▸'} Advisory ({advisoryCount}): differentials · red flags · evidence · follow-up
          </button>
          {showAdvisory && (
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              {ddx.length > 0 && (
                <div className="rounded-lg border border-violet-100 bg-white p-2">
                  <h4 className="text-[10px] font-bold uppercase text-even-ink-500">Differentials to consider</h4>
                  <ul className="mt-1 space-y-1 text-[11px] text-even-ink-700">
                    {ddx.map((d, i) => (
                      <li key={i}><span className="font-medium">{d.dx}</span><Cites cites={d.cites} /> — {d.why}</li>
                    ))}
                  </ul>
                </div>
              )}
              {flags.length > 0 && (
                <div className="rounded-lg border border-red-100 bg-white p-2">
                  <h4 className="text-[10px] font-bold uppercase text-red-600">Red flags</h4>
                  <ul className="mt-1 space-y-1 text-[11px] text-even-ink-700">
                    {flags.map((f, i) => (<li key={i}>{f.text}<Cites cites={f.cites} /></li>))}
                  </ul>
                </div>
              )}
              {ebs.length > 0 && (
                <div className="rounded-lg border border-violet-100 bg-white p-2">
                  <h4 className="text-[10px] font-bold uppercase text-even-ink-500">Evidence-based suggestions</h4>
                  <ul className="mt-1 space-y-1 text-[11px] text-even-ink-700">
                    {ebs.map((f, i) => (<li key={i}>{f.text}<Cites cites={f.cites} /></li>))}
                  </ul>
                </div>
              )}
              {fu.length > 0 && (
                <div className="rounded-lg border border-violet-100 bg-white p-2">
                  <h4 className="text-[10px] font-bold uppercase text-even-ink-500">Follow-up considerations</h4>
                  <ul className="mt-1 space-y-1 text-[11px] text-even-ink-700">
                    {fu.map((f, i) => (<li key={i}>{f.text}<Cites cites={f.cites} /></li>))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowSources((v) => !v)} className="text-[11px] text-even-ink-400 hover:underline">
            {showSources ? '▾' : '▸'} Sources ({sources.length})
          </button>
          {showSources && (
            <ol className="mt-1 space-y-1 text-[10px] text-even-ink-500">
              {sources.map((s) => (
                <li key={s.index}>
                  <span className="font-semibold text-violet-600">[{s.index}]</span>{' '}
                  {s.book ?? '—'}{s.chapter ? ` · ${s.chapter}` : ''}{s.section ? ` · ${s.section}` : ''}
                  <span className="text-even-ink-400"> — {s.excerpt.slice(0, 140)}…</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
