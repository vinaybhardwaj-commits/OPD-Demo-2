/**
 * <EncounterLabResults /> — doctor-side rendering of lab orders + results
 * for an encounter. v2.1.5.
 *
 * Server component. Renders nothing if the encounter has no lab orders.
 *
 * Layout: one card per lab_order, in chronological order. Each card:
 *   - Header: raw_text + status badge + ordered Xm ago + by whom
 *     (Doctor confirmed / pre-staged by CCE etc.)
 *   - If status='resulted': results table with abnormal-flag tint,
 *     posted-by + source-PDF link footer.
 *   - If status='pre_staged': pending doctor confirm (CCE pre-stage)
 *   - If status='pending': awaiting lab tech claim
 *   - If status='in_progress': claimed by tech X
 *   - If status='awaiting_confirmation': extracted, awaiting confirm
 *   - If status='cancelled': dimmed
 *
 * Read-only by design. Editing a posted result needs a clinician
 * override flow which lands in v2.2+.
 */
import { Fragment } from 'react';
import { pool } from '@/lib/db';
import { AnnotateResultButton } from './AnnotateResultButton';

type LabOrder = {
  id: string;
  status: string;
  raw_text: string;
  display_name: string | null;
  ordered_at: string;
  resulted_at: string | null;
  source_pdf_url: string | null;
  auto_posted: boolean;
  extraction_confidence: number | null;
  ordering_doctor_name: string | null;
  pre_staged_by_cce_name: string | null;
  claimed_by_lab_tech_name: string | null;
  posted_by_tech_name: string | null;
};

type LabResult = {
  id: string;
  lab_order_id: string | null;
  canonical_key: string;
  display_name: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  reference_range: string | null;
  abnormal_flag: string | null;
  confidence_score: number | null;
  entered_at: string;
};

type Annotation = {
  id: string;
  lab_result_id: string;
  doctor_name: string;
  note: string;
  created_at: string;
};

export async function EncounterLabResults({
  encounterId,
}: {
  encounterId: string;
}) {
  const { rows: orders } = await pool.query<LabOrder>(
    `SELECT
       lo.id, lo.status, lo.raw_text, lo.display_name,
       lo.ordered_at::text AS ordered_at,
       lo.resulted_at::text AS resulted_at,
       lo.source_pdf_url, lo.auto_posted, lo.extraction_confidence,
       doc.name AS ordering_doctor_name,
       cce.name AS pre_staged_by_cce_name,
       tech.name AS claimed_by_lab_tech_name,
       ext_tech.name AS posted_by_tech_name
     FROM lab_orders lo
     LEFT JOIN doctors doc ON doc.id = lo.ordering_doctor_id
     LEFT JOIN doctors cce ON cce.id = lo.pre_staged_by_cce_id
     LEFT JOIN doctors tech ON tech.id = lo.claimed_by_lab_tech_id
     LEFT JOIN doctors ext_tech ON ext_tech.id = lo.extraction_lab_tech_id
     WHERE lo.encounter_id = $1
     ORDER BY lo.ordered_at ASC`,
    [encounterId],
  );

  if (orders.length === 0) return null;

  const orderIds = orders.map((o) => o.id);
  const { rows: results } = await pool.query<LabResult>(
    `SELECT id, lab_order_id, canonical_key, display_name,
            value_numeric, value_text, unit, reference_range,
            abnormal_flag, confidence_score,
            entered_at::text AS entered_at
     FROM lab_results
     WHERE lab_order_id = ANY($1::uuid[])
     ORDER BY entered_at ASC`,
    [orderIds],
  );
  const byOrder = new Map<string, LabResult[]>();
  for (const r of results) {
    if (!r.lab_order_id) continue;
    if (!byOrder.has(r.lab_order_id)) byOrder.set(r.lab_order_id, []);
    byOrder.get(r.lab_order_id)!.push(r);
  }

  // Polish #4 — Pull annotations for these results. One query, grouped
  // client-side by lab_result_id.
  const resultIds = results.map((r) => r.id);
  let annotationsByResult = new Map<string, Annotation[]>();
  if (resultIds.length > 0) {
    const { rows: annRows } = await pool.query<Annotation>(
      `SELECT a.id, a.lab_result_id, d.name AS doctor_name, a.note,
              a.created_at::text AS created_at
       FROM lab_result_annotations a
       JOIN doctors d ON d.id = a.doctor_id
       WHERE a.lab_result_id = ANY($1::uuid[])
       ORDER BY a.created_at ASC`,
      [resultIds],
    );
    for (const a of annRows) {
      if (!annotationsByResult.has(a.lab_result_id)) {
        annotationsByResult.set(a.lab_result_id, []);
      }
      annotationsByResult.get(a.lab_result_id)!.push(a);
    }
  }

  // Aggregate abnormal flag count for the section header.
  const allResults = results;
  const abnormalCount = allResults.filter(
    (r) => r.abnormal_flag && r.abnormal_flag !== 'normal' && r.abnormal_flag !== 'unknown',
  ).length;
  const criticalCount = allResults.filter(
    (r) =>
      r.abnormal_flag === 'critical_low' || r.abnormal_flag === 'critical_high',
  ).length;

  return (
    <section className="rounded-2xl border border-even-ink-200 bg-white">
      <header className="flex items-baseline justify-between gap-3 border-b border-even-ink-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-even-navy">
            Lab orders &amp; results
          </h2>
          <p className="text-[11px] text-even-ink-500">
            {orders.length} order{orders.length === 1 ? '' : 's'} ·{' '}
            {allResults.length} result{allResults.length === 1 ? '' : 's'}{' '}
            posted
            {abnormalCount > 0 && (
              <>
                {' '}·{' '}
                <span className="font-medium text-amber-700">
                  {abnormalCount} abnormal
                </span>
              </>
            )}
            {criticalCount > 0 && (
              <>
                {' '}·{' '}
                <span className="font-semibold text-even-pink-800">
                  {criticalCount} critical
                </span>
              </>
            )}
          </p>
        </div>
      </header>

      <ul className="divide-y divide-even-ink-100">
        {orders.map((o) => (
          <li key={o.id} className="px-5 py-3">
            <OrderCard
              order={o}
              results={byOrder.get(o.id) ?? []}
              annotationsByResult={annotationsByResult}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

function OrderCard({
  order,
  results,
  annotationsByResult,
}: {
  order: LabOrder;
  results: LabResult[];
  annotationsByResult: Map<string, Annotation[]>;
}) {
  const isCancelled = order.status === 'cancelled';
  return (
    <div className={isCancelled ? 'opacity-50' : ''}>
      {/* Header row */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-even-navy">
            {order.raw_text}
          </span>
          <StatusBadge status={order.status} />
          {order.auto_posted && order.status === 'resulted' && (
            <span className="rounded-full bg-even-blue-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-even-blue-800">
              auto-posted
            </span>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-even-ink-400">
          ordered {relativeAge(order.ordered_at)}
          {order.ordering_doctor_name &&
            ` · by ${firstName(order.ordering_doctor_name)}`}
        </span>
      </div>

      {/* Pre-stage attribution (if any) */}
      {order.pre_staged_by_cce_name && (
        <p className="mt-0.5 text-[10px] text-even-ink-500">
          🧪 Pre-staged by {firstName(order.pre_staged_by_cce_name)}
        </p>
      )}

      {/* Body */}
      <div className="mt-2">
        {order.status === 'resulted' && results.length > 0 && (
          <ResultsTable
            results={results}
            postedByName={order.posted_by_tech_name}
            resultedAt={order.resulted_at}
            sourcePdfUrl={order.source_pdf_url}
            annotationsByResult={annotationsByResult}
          />
        )}
        {order.status === 'resulted' && results.length === 0 && (
          <p className="rounded-md bg-even-ink-50 px-2.5 py-1.5 text-[11px] text-even-ink-500">
            Posted but no structured results — view source PDF for details.
            {order.source_pdf_url && (
              <>
                {' '}
                <a
                  href={order.source_pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-even-navy"
                >
                  Open
                </a>
              </>
            )}
          </p>
        )}
        {order.status === 'pre_staged' && (
          <PendingNote text="Pre-staged by CCE · awaiting your confirmation to send to lab" />
        )}
        {order.status === 'pending' && (
          <PendingNote text="Sent to lab · awaiting tech to claim" />
        )}
        {order.status === 'in_progress' && (
          <PendingNote
            text={`Claimed by ${order.claimed_by_lab_tech_name ? firstName(order.claimed_by_lab_tech_name) : 'lab tech'} · processing`}
          />
        )}
        {order.status === 'awaiting_confirmation' && (
          <PendingNote text="Lab extracted · awaiting tech to confirm" />
        )}
        {order.status === 'cancelled' && (
          <PendingNote text="Cancelled" />
        )}
      </div>
    </div>
  );
}

function ResultsTable({
  results,
  postedByName,
  resultedAt,
  sourcePdfUrl,
  annotationsByResult,
}: {
  results: LabResult[];
  postedByName: string | null;
  resultedAt: string | null;
  sourcePdfUrl: string | null;
  annotationsByResult: Map<string, Annotation[]>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-even-ink-200">
      <table className="w-full text-[11px]">
        <thead className="bg-even-ink-50 text-even-ink-600">
          <tr>
            <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wider">
              Test
            </th>
            <th className="px-2.5 py-1.5 text-right font-semibold uppercase tracking-wider">
              Value
            </th>
            <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wider">
              Unit
            </th>
            <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wider">
              Ref
            </th>
            <th className="px-2.5 py-1.5 text-right font-semibold uppercase tracking-wider">
              Flag
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-even-ink-100">
          {results.map((r) => {
            const anns = annotationsByResult.get(r.id) ?? [];
            return (
              <Fragment key={r.id}>
                <tr className={flagRowTint(r.abnormal_flag)}>
                  <td className="px-2.5 py-1.5 text-even-navy">
                    {r.display_name}
                    <div className="font-mono text-[9px] text-even-ink-400">
                      {r.canonical_key}
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-even-navy">
                    {r.value_numeric != null ? r.value_numeric : r.value_text ?? '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-even-ink-600">
                    {r.unit ?? '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-even-ink-600">
                    {r.reference_range ?? '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <FlagPill flag={r.abnormal_flag ?? 'unknown'} />
                  </td>
                </tr>
                <tr className="bg-white/50">
                  <td colSpan={5} className="px-2.5 pb-2 pt-0">
                    {anns.length > 0 && (
                      <ul className="space-y-0.5 border-l-2 border-amber-300 pl-2">
                        {anns.map((a) => (
                          <li
                            key={a.id}
                            className="text-[10px] text-amber-900"
                          >
                            <span className="font-semibold">
                              {firstName(a.doctor_name)}
                            </span>{' '}
                            <span className="text-amber-700">
                              · {new Date(a.created_at).toLocaleString('en-IN')}
                            </span>
                            <div className="text-even-ink-700">{a.note}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-1">
                      <AnnotateResultButton labResultId={r.id} />
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-even-ink-100 bg-even-ink-50/60 px-2.5 py-1.5 text-[10px] text-even-ink-500">
        <span>
          Posted{postedByName ? ` by ${firstName(postedByName)}` : ''}
          {resultedAt && ` · ${new Date(resultedAt).toLocaleString('en-IN')}`}
        </span>
        {sourcePdfUrl && (
          <a
            href={sourcePdfUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-even-navy"
          >
            Source PDF
          </a>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'resulted'
      ? 'bg-even-blue-100 text-even-blue-900'
      : status === 'awaiting_confirmation'
      ? 'bg-amber-100 text-amber-900'
      : status === 'in_progress'
      ? 'bg-even-pink-100 text-even-pink-900'
      : status === 'pending'
      ? 'bg-even-ink-100 text-even-ink-700'
      : status === 'pre_staged'
      ? 'bg-even-blue-50 text-even-blue-700'
      : 'bg-even-ink-100 text-even-ink-500';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function FlagPill({ flag }: { flag: string }) {
  const tone =
    flag === 'high' || flag === 'low'
      ? 'bg-amber-100 text-amber-900'
      : flag === 'critical_high' || flag === 'critical_low'
      ? 'bg-even-pink-100 text-even-pink-900'
      : flag === 'normal'
      ? 'bg-even-blue-50 text-even-blue-800'
      : 'bg-even-ink-100 text-even-ink-600';
  return (
    <span
      className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {flag.replace(/_/g, ' ')}
    </span>
  );
}

function PendingNote({ text }: { text: string }) {
  return (
    <p className="rounded-md bg-even-ink-50 px-2.5 py-1.5 text-[11px] text-even-ink-600">
      {text}
    </p>
  );
}

function flagRowTint(flag: string | null): string {
  if (!flag) return '';
  if (flag === 'critical_low' || flag === 'critical_high')
    return 'bg-even-pink-50/40';
  if (flag === 'high' || flag === 'low') return 'bg-amber-50/40';
  return '';
}

function relativeAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function firstName(full: string): string {
  // v5.0.3 — strip 'Dr.'/'Dr'/'Nurse' prefix FIRST, then split. The
  // previous order split first and tried to strip a 'Dr.' token that
  // had no trailing whitespace, leaving 'Dr.' as the result.
  const stripped = (full || '').replace(/^(Dr\.?|Nurse)\s*/i, '').trim();
  return stripped.split(/\s+/)[0] || stripped || full;
}
