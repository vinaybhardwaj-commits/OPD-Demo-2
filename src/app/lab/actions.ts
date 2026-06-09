'use server';

/**
 * Server actions for /lab — claim + release wrappers.
 *
 * Why server actions in addition to /api/lab-orders/[id]/claim+release?
 *   - The page renders inline <form> buttons per row. Pointing those
 *     forms at API routes would surface the raw JSON to the browser on
 *     submit. Server actions let us do the write and revalidate the
 *     page in the same round-trip with no JSON detour.
 *   - The API routes still exist for the v2.1.3 detail page's
 *     upload/extract flow which submits via fetch from a client modal.
 *
 * Both paths share the same notify channel ('queue:lab') so a tech on
 * the inbox + a tech on the detail page see the same realtime updates.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { notifyQueue } from '@/lib/queueNotify';

async function requireLabTech(): Promise<{ techId: string; isAdmin: boolean }> {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');
  if (session.role !== 'lab_tech' && session.role !== 'admin') {
    // Middleware should have caught this, but defence-in-depth.
    redirect('/auth/login?error=wrong_role');
  }
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const techId = rows[0]?.id;
  if (!techId) {
    // Shouldn't happen — seed has every signed-in user wired to a doctors row.
    throw new Error('tech_not_seeded');
  }
  return { techId, isAdmin: session.role === 'admin' };
}

export async function actionClaimOrder(formData: FormData) {
  const { techId } = await requireLabTech();
  const orderId = String(formData.get('order_id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return;

  const { rows } = await pool.query<{ status: string; claimed_by_lab_tech_id: string | null }>(
    `SELECT status, claimed_by_lab_tech_id FROM lab_orders WHERE id = $1 LIMIT 1`,
    [orderId],
  );
  const o = rows[0];
  if (!o) return;
  if (o.status === 'resulted' || o.status === 'cancelled' || o.status === 'pre_staged') return;
  if (o.status === 'in_progress' && o.claimed_by_lab_tech_id === techId) {
    // No-op
    return;
  }

  await pool.query(
    `UPDATE lab_orders
     SET status = 'in_progress',
         claimed_by_lab_tech_id = $2,
         claimed_at = NOW()
     WHERE id = $1`,
    [orderId, techId],
  );
  await notifyQueue('queue:lab', `claimed:${orderId}`);
  revalidatePath('/lab');
}

export async function actionReleaseOrder(formData: FormData) {
  const { techId, isAdmin } = await requireLabTech();
  const orderId = String(formData.get('order_id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return;

  const { rows } = await pool.query<{ status: string; claimed_by_lab_tech_id: string | null }>(
    `SELECT status, claimed_by_lab_tech_id FROM lab_orders WHERE id = $1 LIMIT 1`,
    [orderId],
  );
  const o = rows[0];
  if (!o) return;
  if (o.status !== 'in_progress') return;
  if (!isAdmin && o.claimed_by_lab_tech_id !== techId) return;

  await pool.query(
    `UPDATE lab_orders
     SET status = 'pending',
         claimed_by_lab_tech_id = NULL,
         claimed_at = NULL
     WHERE id = $1`,
    [orderId],
  );
  await notifyQueue('queue:lab', `released:${orderId}`);
  revalidatePath('/lab');
}
