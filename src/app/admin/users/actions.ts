'use server';

/**
 * Server actions for /admin/users.
 *
 * actionCreateInvite — admin types email + name + role → row written to
 * invite_tokens, token returned in the redirect query string so the
 * admin can see/copy it (until we wire Resend to email it directly).
 *
 * actionRevokeInvite — admin clicks "Revoke" on a pending invite → sets
 * accepted_at = NOW() with no accepted_user_id so it can't be used.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';

const ALLOWED_ROLES = new Set(['doctor', 'nurse', 'cce', 'lab_tech', 'admin']);
const INVITE_TTL_DAYS = 7;

async function requireSession(): Promise<{ id: string | null }> {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  return { id: rows[0]?.id ?? null };
}

export async function actionCreateInvite(formData: FormData) {
  const me = await requireSession();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim() || null;
  const role = String(formData.get('role') ?? '').trim();
  if (!email || !email.includes('@')) return;
  if (!ALLOWED_ROLES.has(role)) return;

  // Refuse if a user with that email is already in doctors table.
  const { rows: existing } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = $1 LIMIT 1`, [email]
  );
  if (existing[0]) {
    // Treat as no-op — admin can see the user in the list.
    revalidatePath('/admin/users');
    return;
  }

  const token = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO invite_tokens (token, email, name, role, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${INVITE_TTL_DAYS} days')`,
    [token, email, name, role, me.id],
  );

  revalidatePath('/admin/users');
}

export async function actionRevokeInvite(formData: FormData) {
  await requireSession();
  const tokenId = String(formData.get('id') ?? '');
  if (!tokenId) return;
  await pool.query(
    `UPDATE invite_tokens
        SET accepted_at = NOW()
      WHERE id = $1 AND accepted_at IS NULL`,
    [tokenId],
  );
  revalidatePath('/admin/users');
}

// v2.0.2 additions ─────────────────────────────────────────────────────

export async function actionChangeRole(formData: FormData) {
  await requireSession();
  const userId = String(formData.get('user_id') ?? '');
  const newRole = String(formData.get('role') ?? '');
  if (!userId || !ALLOWED_ROLES.has(newRole)) return;
  await pool.query(`UPDATE doctors SET role = $1 WHERE id = $2`, [newRole, userId]);
  revalidatePath('/admin/users');
}

export async function actionDeactivate(formData: FormData) {
  await requireSession();
  const userId = String(formData.get('user_id') ?? '');
  if (!userId) return;
  // Idempotent — sets deactivated_at to NOW() only if currently NULL.
  await pool.query(
    `UPDATE doctors SET deactivated_at = NOW()
      WHERE id = $1 AND deactivated_at IS NULL`,
    [userId],
  );
  revalidatePath('/admin/users');
}

export async function actionReactivate(formData: FormData) {
  await requireSession();
  const userId = String(formData.get('user_id') ?? '');
  if (!userId) return;
  await pool.query(`UPDATE doctors SET deactivated_at = NULL WHERE id = $1`, [userId]);
  revalidatePath('/admin/users');
}
