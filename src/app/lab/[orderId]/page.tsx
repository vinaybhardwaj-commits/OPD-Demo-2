/**
 * /lab/[orderId] — Lab order detail page.
 *
 * v2.1.2 ships the shell: order + patient context + claim banner +
 * release control + back-to-inbox link. The PDF upload + Qwen-VL
 * extraction button is a placeholder for v2.1.3.
 *
 * Per L.x lock — "Lab record + patient context": we show the order
 * details and minimal patient context (name, MRN, age/sex, allergies,
 * ordering doctor). We deliberately do NOT show the encounter's
 * clinical history — the lab tech doesn't need it.
 *
 * Role gate: middleware (lab_tech | admin).
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { QueueLive } from '@/components/QueueLive';
import { PdfUploadAndExtract } from '@/components/PdfUploadAndExtract';
import type { ExtractedLabItem } from '@/lib/qwen-vision';
import { actionClaimOrder, actionReleaseOrder } from '../actions';

export const dynamic = 'force-dynamic';

type Detail = {
  id: string;
  status: string;
  raw_text: string;
  display_name: string | null;
  canonical_key: string | null;
  ordered_at: string;
  resulted_at: string | null;
  claimed_by_lab_tech_id: string | null;
  claimed_by_lab_tech_name: string | null;
  claimed_at: string | null;
  ordering_doctor_id: string | null;
  ordering_doctor_name: string | null;
  pre_staged_by_cce_name: string | null;
  encounter_number: string;
  patient_id: string;
  patient_name: string;
  patient_mrn: string;
  patient_age_years: number;
  patient_sex: 'M' | 'F' | 'O';
  patient_phone_e164: string | null;
  patient_known_allergies: string | null;
  source_pdf_url: string | null;
  extracted_at: string | null;
  extraction_confidence: number | null;
  extraction_raw: { items?: ExtractedLabItem[] } | null;
  auto_posted: boolean;
};

export default async function LabOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();

  const { rows: meRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const myId = meRows[0]?.id ?? null;

  const { rows } = await pool.query<Detail>(
    `SELECT
       lo.id, lo.status, lo.raw_text, lo.display_name, lo.canonical_key,
       lo.ordered_at::text AS ordered_at,
       lo.resulted_at::text AS resulted_at,
       lo.claimed_by_lab_tech_id,
       tech.name AS claimed_by_lab_tech_name,
       lo.claimed_at::text AS claimed_at,
       lo.ordering_doctor_id,
       doc.name AS ordering_doctor_name,
       cce.name AS pre_staged_by_cce_name,
       e.encounter_number,
       p.id AS patient_id,
       p.name AS patient_name,
       p.mrn AS patient_mrn,
       p.age_years AS patient_age_years,
       p.sex AS patient_sex,
       p.phone_e164 AS patient_phone_e164,
       p.known_allergies AS patient_known_allergies,
       lo.source_pdf_url,
       lo.extracted_at::text AS extracted_at,
       lo.extraction_confidence,
       lo.extraction_raw,
       lo.auto_posted
     FROM lab_orders lo
     JOIN patients p ON p.id = lo.patient_id
     JOIN encounters e ON e.id = lo.encounter_id
     LEFT JOIN doctors doc ON doc.id = lo.ordering_doctor_id
     LEFT JOIN doctors cce ON cce.id = lo.pre_staged_by_cce_id
     LEFT JOIN doctors tech ON tech.id = lo.claimed_by_lab_tech_id
     WHERE lo.id = $1
     LIMIT 1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) notFound();

  const isMine = order.claimed_by_lab_tech_id === myId;
  const isClaimedByOther =
    order.status === 'in_progress' && order.claimed_by_lab_tech_id !== myId;

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <QueueLive channel="queue:lab" />
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-6 px-6 py-3">
          <Link
            href="/lab"
            className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
          >
            ← Inbox
          </Link>
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-even-navy">
            Lab order detail
          </span>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mx-auto max-w-4xl space-y-6 px-6 py-6">
        {/* Claim banner */}
        {order.status === 'pending' && (
          <ClaimBanner orderId={order.id} />
        )}
        {isClaimedByOther && (
          <p className="rounded-lg border border-even-blue-200 bg-even-blue-50 px-4 py-2 text-xs text-even-blue-900">
            🛠 Claimed by{' '}
            <span className="font-medium">
              {firstName(order.claimed_by_lab_tech_name ?? 'another tech')}
            </span>
            . You can still upload results if you&apos;re taking over.
          </p>
        )}
        {isMine && order.status === 'in_progress' && (
          <ReleaseBanner orderId={order.id} />
        )}
        {order.status === 'resulted' && order.resulted_at && (
          <p className="rounded-lg border border-even-blue-200 bg-even-blue-50 px-4 py-2 text-xs text-even-blue-900">
            ✓ Posted{order.auto_posted ? ' (auto-posted by Qwen)' : ''} at{' '}
            {new Date(order.resulted_at).toLocaleString('en-IN')}
          </p>
        )}

        {/* Order card */}
        <section className="rounded-2xl border border-even-ink-200 bg-white p-6">
          <h1 className="text-xl font-semibold tracking-tight text-even-navy">
            {order.display_name ?? order.raw_text}
          </h1>
          <p className="mt-1 text-xs uppercase tracking-wider text-even-ink-500">
            {order.encounter_number} · ordered{' '}
            {new Date(order.ordered_at).toLocaleString('en-IN')}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <DefItem
              label="Free text"
              value={order.raw_text}
            />
            <DefItem
              label="Canonical key"
              value={order.canonical_key ?? '—'}
              valueMono
            />
            <DefItem
              label="Ordering doctor"
              value={
                order.ordering_doctor_name
                  ? firstName(order.ordering_doctor_name)
                  : '—'
              }
            />
            <DefItem
              label="Pre-staged by"
              value={
                order.pre_staged_by_cce_name
                  ? firstName(order.pre_staged_by_cce_name)
                  : '—'
              }
            />
            <DefItem label="Status" value={order.status.replace(/_/g, ' ')} />
            <DefItem
              label="Extraction confidence"
              value={
                order.extraction_confidence != null
                  ? Number(order.extraction_confidence).toFixed(2)
                  : '—'
              }
            />
          </dl>
        </section>

        {/* Patient context — minimal */}
        <section className="rounded-2xl border border-even-ink-200 bg-white p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-even-ink-500">
            Patient
          </h2>
          <p className="mt-1 text-lg font-semibold text-even-navy">
            {order.patient_name}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-even-ink-500">
            {order.patient_mrn} · {order.patient_age_years}
            {order.patient_sex}
          </p>
          {order.patient_known_allergies ? (
            <p className="mt-3 rounded-md border border-even-pink-200 bg-even-pink-50 px-3 py-2 text-[12px] text-even-pink-900">
              ⚠ Allergies: {order.patient_known_allergies}
            </p>
          ) : (
            <p className="mt-3 text-[11px] text-even-ink-400">
              No known allergies.
            </p>
          )}
        </section>

        {/* v2.1.3 — real upload + Qwen-VL extract + 10s auto-confirm */}
        {order.status !== 'resulted' && order.status !== 'cancelled' && (
          <PdfUploadAndExtract
            orderId={order.id}
            canUpload={isMine || session.role === 'admin'}
            initialItems={order.extraction_raw?.items ?? null}
            initialConfidence={order.extraction_confidence ?? null}
            initialBlobUrl={order.source_pdf_url ?? null}
          />
        )}
        {order.status === 'resulted' && (
          <section className="rounded-2xl border border-even-blue-200 bg-even-blue-50/50 p-6 text-xs text-even-blue-900">
            ✓ Results posted. The encounter has been notified.
            {order.source_pdf_url && (
              <>
                {' '}
                · <a
                  className="underline"
                  href={order.source_pdf_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Source PDF
                </a>
              </>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function ClaimBanner({ orderId }: { orderId: string }) {
  return (
    <form
      action={actionClaimOrder}
      className="flex items-center justify-between rounded-lg border border-even-pink-300 bg-even-pink-50 px-4 py-3 text-xs text-even-pink-900"
    >
      <input type="hidden" name="order_id" value={orderId} />
      <span>
        🩸 This order is unclaimed. Claiming will mark it In progress for the
        team.
      </span>
      <button
        type="submit"
        className="rounded-lg bg-even-pink-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-even-pink-800"
      >
        Claim
      </button>
    </form>
  );
}

function ReleaseBanner({ orderId }: { orderId: string }) {
  return (
    <form
      action={actionReleaseOrder}
      className="flex items-center justify-between rounded-lg border border-even-blue-200 bg-even-blue-50 px-4 py-3 text-xs text-even-blue-900"
    >
      <input type="hidden" name="order_id" value={orderId} />
      <span>✓ You claimed this order. Release it if you need to step away.</span>
      <button
        type="submit"
        className="rounded-lg border border-even-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-even-blue-900 transition hover:bg-even-blue-100"
      >
        Release
      </button>
    </form>
  );
}

function DefItem({
  label,
  value,
  valueMono,
}: {
  label: string;
  value: string;
  valueMono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-even-ink-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm ${
          valueMono ? 'font-mono text-even-ink-700' : 'text-even-navy'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function firstName(full: string): string {
  // v5.0.3 — strip 'Dr.'/'Dr'/'Nurse' prefix FIRST, then split. The
  // previous order split first and tried to strip a 'Dr.' token that
  // had no trailing whitespace, leaving 'Dr.' as the result.
  const stripped = (full || '').replace(/^(Dr\.?|Nurse)\s*/i, '').trim();
  return stripped.split(/\s+/)[0] || stripped || full;
}
