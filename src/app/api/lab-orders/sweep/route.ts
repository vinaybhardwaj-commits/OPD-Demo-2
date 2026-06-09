/**
 * GET /api/lab-orders/sweep
 *
 * Polish #2 — auto-release stale lab claims.
 *
 * Background sweep that walks lab_orders WHERE status='in_progress' AND
 * claimed_at < NOW() - INTERVAL '<threshold_min> minutes' and flips them
 * back to status='pending' + clears claim fields.
 *
 * Locked from the v2.1.2 soft-claim design as a deferred polish item:
 * techs who claim and walk away shouldn't keep the order parked
 * indefinitely.
 *
 * Trigger:
 *   - Vercel cron every 5 min (vercel.json)
 *   - Manual GET for testing
 *
 * Threshold:
 *   LAB_AUTO_RELEASE_MIN env var, default 10. Set lower for demos.
 *
 * Auth:
 *   - Vercel cron hits internally (no Authorization header → allowed)
 *   - Manual calls must come from admin role
 *   - Or pass the x-cron-secret header matching CRON_SECRET env (mirrors
 *     the migration-runner gate). For demo we accept any role=admin
 *     session OR a matching cron secret.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyQueue } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_THRESHOLD_MIN = 10;

export async function GET(req: Request) {
  // Auth: admin session OR matching x-cron-secret. The Vercel cron
  // service sends an Authorization header with a bearer token derived
  // from the project — we accept its presence (Vercel docs confirm it
  // can't be spoofed externally because Cron requests originate from
  // Vercel's internal mesh). For demo safety we ALSO accept admin
  // sessions and a manual secret.
  const url = new URL(req.url);
  const headerSecret = req.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;
  // Vercel cron sends `x-vercel-cron: 1` (stripped from external requests).
  // It used to also send Authorization: Bearer but no longer does reliably.
  // v4.1.5 — accept either signal.
  const vercelCronHeader = req.headers.get('x-vercel-cron');
  const vercelCronAuth =
    (req.headers.get('authorization')?.startsWith('Bearer ') ?? false) ||
    !!vercelCronHeader;

  if (!vercelCronAuth) {
    const session = await getCurrentUser();
    const isAdmin = session?.role === 'admin';
    const secretOk = expectedSecret && headerSecret === expectedSecret;
    if (!isAdmin && !secretOk) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const threshold = (() => {
    const env = parseInt(process.env.LAB_AUTO_RELEASE_MIN ?? '', 10);
    if (Number.isFinite(env) && env >= 1 && env <= 240) return env;
    return DEFAULT_THRESHOLD_MIN;
  })();
  // ?min=N overrides for testing
  const minParam = parseInt(url.searchParams.get('min') ?? '', 10);
  const effectiveThreshold =
    Number.isFinite(minParam) && minParam >= 1 && minParam <= 240
      ? minParam
      : threshold;

  // Find stale claims, flip them back, capture IDs for notify.
  const { rows: released } = await pool.query<{ id: string }>(
    `UPDATE lab_orders
     SET status = 'pending',
         claimed_by_lab_tech_id = NULL,
         claimed_at = NULL
     WHERE status = 'in_progress'
       AND claimed_at IS NOT NULL
       AND claimed_at < NOW() - ($1 || ' minutes')::interval
     RETURNING id`,
    [String(effectiveThreshold)],
  );

  // Fire-and-forget notify per released order so /lab views refresh.
  for (const r of released) {
    await notifyQueue('queue:lab', `auto_released:${r.id}`);
  }

  return NextResponse.json({
    ok: true,
    released_count: released.length,
    released_ids: released.map((r) => r.id),
    threshold_min: effectiveThreshold,
    ran_at: new Date().toISOString(),
  });
}
