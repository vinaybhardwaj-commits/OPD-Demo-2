/**
 * /lab — Lab Tech workstation (v2.1.2).
 *
 * Layout per PRD L.4 lock — single inbox + status tabs.
 *
 * Tabs (URL-state-bearing via ?tab=…):
 *   pending          → status = 'pending' (date scope: today + unresolved earlier)
 *   in_progress      → status = 'in_progress' (split: mine / others)
 *   awaiting_confirm → status = 'awaiting_confirmation' (post-Qwen, pre-confirm)
 *   posted_today     → status = 'resulted' AND resulted_at::date = today
 *
 * Each row shows:
 *   - Patient name + MRN suffix
 *   - Ordering doctor (or "🧪 Pre-staged then confirmed by …")
 *   - Raw test name (free text)
 *   - Ordered Xm ago
 *   - Status badge
 *   - Claim / Release / Open button(s) per role+state
 *
 * Date scope (v2.1.2 lock L.x): default tabs show today's orders + any
 * pending/in_progress orders from prior days so nothing gets lost.
 * 'Posted today' is strictly today's resulted rows.
 *
 * SSE channel: queue:lab (separate from queue:global to avoid waking
 * /lab on every encounter PATCH). Producers: claim, release, doctor
 * order (added in v2.1.1), upload + extract (v2.1.3), confirm (v2.1.4).
 *
 * Role gate is in middleware (lab_tech | admin) — page itself just
 * trusts the session.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { QueueLive } from '@/components/QueueLive';
import { actionClaimOrder, actionReleaseOrder } from './actions';

export const dynamic = 'force-dynamic';

type Tab = 'pending' | 'in_progress' | 'awaiting_confirm' | 'posted_today';
const TAB_LABELS: Record<Tab, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  awaiting_confirm: 'Awaiting confirmation',
  posted_today: 'Posted today',
};
const TAB_ORDER: Tab[] = ['pending', 'in_progress', 'awaiting_confirm', 'posted_today'];

type OrderRow = {
  id: string;
  status: string;
  raw_text: string;
  display_name: string | null;
  ordered_at: string;
  resulted_at: string | null;
  ordered_date_iso: string | null;
  ordering_doctor_name: string | null;
  pre_staged_by_cce_name: string | null;
  claimed_by_lab_tech_id: string | null;
  claimed_by_lab_tech_name: string | null;
  claimed_at: string | null;
  patient_id: string;
  patient_name: string;
  patient_mrn: string;
  patient_age_years: number;
  patient_sex: 'M' | 'F' | 'O';
  encounter_number: string;
  extraction_confidence: number | null;
  auto_posted: boolean;
};

type Counts = {
  pending: number;
  in_progress: number;
  in_progress_mine: number;
  awaiting_confirm: number;
  posted_today: number;
};

export default async function LabPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; category?: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const sp = await searchParams;
  const tab: Tab = (TAB_ORDER as string[]).includes(sp.tab ?? '')
    ? (sp.tab as Tab)
    : 'pending';
  // v3.7 — optional sub_department filter chips per tab
  const category = (sp.category ?? '').trim() || null;

  // Resolve current tech's doctors-row id for "mine" filters.
  const { rows: meRows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const me = meRows[0];
  const myId = me?.id ?? null;

  // Header counts. Single query with FILTER.
  const { rows: countRows } = await pool.query<{
    pending: string;
    in_progress: string;
    in_progress_mine: string;
    awaiting_confirm: string;
    posted_today: string;
  }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE status = 'pending'
           AND (ordered_at::date = CURRENT_DATE OR ordered_at::date < CURRENT_DATE)
       )::text AS pending,
       COUNT(*) FILTER (WHERE status = 'in_progress')::text AS in_progress,
       COUNT(*) FILTER (WHERE status = 'in_progress' AND claimed_by_lab_tech_id = $1)::text AS in_progress_mine,
       COUNT(*) FILTER (WHERE status = 'awaiting_confirmation')::text AS awaiting_confirm,
       COUNT(*) FILTER (WHERE status = 'resulted' AND resulted_at::date = CURRENT_DATE)::text AS posted_today
     FROM lab_orders`,
    [myId],
  );
  const counts: Counts = {
    pending: Number(countRows[0]?.pending ?? 0),
    in_progress: Number(countRows[0]?.in_progress ?? 0),
    in_progress_mine: Number(countRows[0]?.in_progress_mine ?? 0),
    awaiting_confirm: Number(countRows[0]?.awaiting_confirm ?? 0),
    posted_today: Number(countRows[0]?.posted_today ?? 0),
  };

  // The actual row list for the selected tab — optionally narrowed to a sub_department.
  const orders = await loadOrdersForTab(tab, category);
  // v3.7 — per-tab sub_department counts for the chip filter row.
  const categoryCounts = await loadCategoryCountsForTab(tab);

  return (
    <main className="min-h-screen bg-even-white-DEFAULT">
      <QueueLive channel="queue:lab" />
      <header className="border-b border-even-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="h-7 w-7 rounded-full bg-even-pink ring-4 ring-even-pink-100"
            />
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-even-navy">
              Even OPD · Lab
            </span>
          </div>
          <div className="text-xs text-even-ink-500">
            {me?.name ?? session.email}
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-xs font-medium uppercase tracking-wider text-even-ink-500 hover:text-even-navy"
            >
              Sign out
            </button>
          </form>
        </div>
        <div className="mx-auto max-w-6xl px-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-even-navy">
            Lab inbox
          </h1>
          <p className="text-xs text-even-ink-500">
            {counts.pending} pending · {counts.in_progress} in progress (
            {counts.in_progress_mine} yours) · {counts.awaiting_confirm} awaiting
            confirmation · {counts.posted_today} posted today
          </p>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-6 pb-1">
          {TAB_ORDER.map((t) => {
            const isActive = t === tab;
            const count = countForTab(t, counts);
            return (
              <Link
                key={t}
                href={`/lab?tab=${t}`}
                className={`rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                  isActive
                    ? 'border-even-pink-500 text-even-pink-800'
                    : 'border-transparent text-even-ink-500 hover:border-even-ink-200 hover:text-even-navy'
                }`}
              >
                {TAB_LABELS[t]}
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                    isActive
                      ? 'bg-even-pink-100 text-even-pink-900'
                      : 'bg-even-ink-100 text-even-ink-600'
                  }`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </nav>
      </header>

      {/* v3.7 — sub_department filter chips (per tab) */}
      {categoryCounts.length > 1 && (
        <div className="mx-auto max-w-6xl px-6 pt-3">
          <div className="flex flex-wrap gap-1.5">
            <Link
              href={`/lab?tab=${tab}`}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                category === null
                  ? 'border-even-pink-300 bg-even-pink-50 text-even-pink-800'
                  : 'border-even-ink-200 bg-white text-even-ink-600 hover:bg-even-ink-50'
              }`}
            >
              All · {categoryCounts.reduce((s, c) => s + c.n, 0)}
            </Link>
            {categoryCounts.map((c) => (
              <Link
                key={c.sub_department}
                href={`/lab?tab=${tab}&category=${encodeURIComponent(c.sub_department)}`}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  category === c.sub_department
                    ? 'border-even-pink-300 bg-even-pink-50 text-even-pink-800'
                    : 'border-even-ink-200 bg-white text-even-ink-600 hover:bg-even-ink-50'
                }`}
              >
                {c.sub_department} · {c.n}
              </Link>
            ))}
          </div>
        </div>
      )}

      <section className="mx-auto max-w-6xl px-6 py-6">
        {orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-even-ink-200 bg-white p-8 text-center text-sm text-even-ink-400">
            Nothing in {TAB_LABELS[tab].toLowerCase()} right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} myId={myId} tab={tab} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tab loaders
// ---------------------------------------------------------------------------

async function loadOrdersForTab(tab: Tab, category: string | null): Promise<OrderRow[]> {
  const whereByTab: Record<Tab, string> = {
    // Date scope lock L.x — today + any unresolved earlier
    pending: `lo.status = 'pending'`,
    in_progress: `lo.status = 'in_progress'`,
    awaiting_confirm: `lo.status = 'awaiting_confirmation'`,
    posted_today: `lo.status = 'resulted' AND lo.resulted_at::date = CURRENT_DATE`,
  };

  const orderByByTab: Record<Tab, string> = {
    pending: 'lo.ordered_at ASC',
    in_progress: 'lo.claimed_at DESC NULLS LAST, lo.ordered_at ASC',
    awaiting_confirm: 'lo.ordered_at ASC',
    posted_today: 'lo.resulted_at DESC',
  };

  const params: unknown[] = [];
  let categoryWhere = '';
  if (category) {
    params.push(category);
    categoryWhere = ` AND dc.sub_department = $${params.length}`;
  }
  const sql = `
    SELECT
      lo.id, lo.status, lo.raw_text, lo.display_name,
      lo.ordered_at::text AS ordered_at,
      lo.resulted_at::text AS resulted_at,
      to_char(lo.ordered_at, 'YYYY-MM-DD') AS ordered_date_iso,
      doc.name AS ordering_doctor_name,
      cce.name AS pre_staged_by_cce_name,
      lo.claimed_by_lab_tech_id,
      tech.name AS claimed_by_lab_tech_name,
      lo.claimed_at::text AS claimed_at,
      lo.extraction_confidence,
      lo.auto_posted,
      p.id AS patient_id,
      p.name AS patient_name,
      p.mrn AS patient_mrn,
      p.age_years AS patient_age_years,
      p.sex AS patient_sex,
      e.encounter_number
    FROM lab_orders lo
    JOIN patients p ON p.id = lo.patient_id
    JOIN encounters e ON e.id = lo.encounter_id
    LEFT JOIN doctors doc ON doc.id = lo.ordering_doctor_id
    LEFT JOIN doctors cce ON cce.id = lo.pre_staged_by_cce_id
    LEFT JOIN doctors tech ON tech.id = lo.claimed_by_lab_tech_id
    -- v3.7: join through diagnostic_orders → diagnostic_catalog for sub_department filter
    LEFT JOIN diagnostic_orders do2 ON do2.id = lo.id
    LEFT JOIN diagnostic_catalog dc ON dc.service_code = do2.service_code
    WHERE ${whereByTab[tab]}${categoryWhere}
    ORDER BY ${orderByByTab[tab]}
    LIMIT 100
  `;
  const { rows } = await pool.query<OrderRow>(sql, params);
  return rows;
}

// v3.7 — count orders by sub_department for the current tab, so the chip row
// can show 'Biochemistry · 5 · Hematology · 3 · ...'.
async function loadCategoryCountsForTab(tab: Tab): Promise<{ sub_department: string; n: number }[]> {
  const whereByTab: Record<Tab, string> = {
    pending: `lo.status = 'pending'`,
    in_progress: `lo.status = 'in_progress'`,
    awaiting_confirm: `lo.status = 'awaiting_confirmation'`,
    posted_today: `lo.status = 'resulted' AND lo.resulted_at::date = CURRENT_DATE`,
  };
  const sql = `
    SELECT dc.sub_department, COUNT(*)::int AS n
    FROM lab_orders lo
    LEFT JOIN diagnostic_orders do2 ON do2.id = lo.id
    LEFT JOIN diagnostic_catalog dc ON dc.service_code = do2.service_code
    WHERE ${whereByTab[tab]} AND dc.sub_department IS NOT NULL
    GROUP BY dc.sub_department
    ORDER BY n DESC, dc.sub_department ASC
    LIMIT 10
  `;
  const { rows } = await pool.query<{ sub_department: string; n: number }>(sql);
  return rows;
}

function countForTab(t: Tab, c: Counts): number {
  if (t === 'pending') return c.pending;
  if (t === 'in_progress') return c.in_progress;
  if (t === 'awaiting_confirm') return c.awaiting_confirm;
  return c.posted_today;
}

// ---------------------------------------------------------------------------
// OrderCard — server component with inline POST forms for claim/release.
// ---------------------------------------------------------------------------

function OrderCard({
  order,
  myId,
  tab,
}: {
  order: OrderRow;
  myId: string | null;
  tab: Tab;
}) {
  const isMine = order.claimed_by_lab_tech_id === myId;
  const orderedAgo = relativeAge(order.ordered_at);
  const claimedAgo = order.claimed_at ? relativeAge(order.claimed_at) : null;
  const isStale =
    order.ordered_date_iso !== todayIso() &&
    (order.status === 'pending' || order.status === 'in_progress');
  // Polish #2 — flag claims older than 7m so the tech notices BEFORE
  // the 10m auto-release sweep fires.
  const claimedMin = order.claimed_at
    ? Math.floor((Date.now() - new Date(order.claimed_at).getTime()) / 60000)
    : 0;
  const claimNearAutoRelease =
    order.status === 'in_progress' && claimedMin >= 7;

  return (
    <li
      className={`rounded-xl border bg-white p-4 transition ${
        isMine
          ? 'border-even-pink-300 ring-2 ring-even-pink-100'
          : 'border-even-ink-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-even-navy">
              {order.raw_text}
            </span>
            <StatusBadge status={order.status} />
            {isStale && (
              <span className="rounded-full bg-even-pink-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-pink-800">
                ↺ from {order.ordered_date_iso}
              </span>
            )}
            {order.auto_posted && (
              <span className="rounded-full bg-even-blue-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-even-blue-800">
                Auto-posted
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-even-ink-600">
            <span className="font-medium text-even-navy">{order.patient_name}</span>
            <span className="ml-1 text-[11px] text-even-ink-400">
              {order.patient_age_years}
              {order.patient_sex} · {order.patient_mrn}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-even-ink-500">
            Ordered {orderedAgo}
            {order.ordering_doctor_name && (
              <> · by {firstName(order.ordering_doctor_name)}</>
            )}
            {order.pre_staged_by_cce_name &&
              ` · pre-staged by ${firstName(order.pre_staged_by_cce_name)}`}
            {order.encounter_number && ` · ${order.encounter_number}`}
          </p>
          {order.claimed_by_lab_tech_name && order.status === 'in_progress' && (
            <p
              className={`mt-1 text-[11px] ${
                isMine ? 'text-even-pink-800' : 'text-even-blue-700'
              }`}
            >
              {isMine ? '✓ You claimed this' : `Claimed by ${firstName(order.claimed_by_lab_tech_name)}`}
              {claimedAgo && ` · ${claimedAgo}`}
              {claimNearAutoRelease && (
                <span className="ml-2 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-900">
                  Stale · auto-release in {Math.max(0, 10 - claimedMin)}m
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {tab === 'pending' && (
            <form action={actionClaimOrder}>
              <input type="hidden" name="order_id" value={order.id} />
              <button
                type="submit"
                className="min-h-[44px] rounded-lg bg-even-pink-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-even-pink-800"
              >
                Claim
              </button>
            </form>
          )}
          {tab === 'in_progress' && !isMine && (
            <form action={actionClaimOrder}>
              <input type="hidden" name="order_id" value={order.id} />
              <button
                type="submit"
                className="min-h-[44px] rounded-lg border border-even-pink-300 bg-white px-4 py-2 text-xs font-semibold text-even-pink-800 transition hover:bg-even-pink-50"
                title="Take over from the current tech"
              >
                Take over
              </button>
            </form>
          )}
          {tab === 'in_progress' && isMine && (
            <form action={actionReleaseOrder}>
              <input type="hidden" name="order_id" value={order.id} />
              <button
                type="submit"
                className="rounded-lg border border-even-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-even-ink-600 transition hover:border-even-pink-300 hover:text-even-pink-800"
              >
                Release
              </button>
            </form>
          )}
          <Link
            href={`/lab/${order.id}`}
            className="min-h-[44px] rounded-lg bg-even-navy px-4 py-2 text-xs font-semibold text-white transition hover:bg-even-navy-700"
          >
            Open
          </Link>
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'pending'
      ? 'bg-even-ink-100 text-even-ink-700'
      : status === 'in_progress'
      ? 'bg-even-pink-100 text-even-pink-900'
      : status === 'awaiting_confirmation'
      ? 'bg-amber-100 text-amber-900'
      : status === 'resulted'
      ? 'bg-even-blue-100 text-even-blue-900'
      : 'bg-even-ink-100 text-even-ink-600';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function relativeAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m - h * 60}m ago`;
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

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
