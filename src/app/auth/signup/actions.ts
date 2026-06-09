'use server';

/**
 * Accept-invite server action. Public — no session required (this IS
 * the path that creates the session).
 *
 * Flow:
 *   1. Look up token; validate not-accepted + not-expired
 *   2. Upsert doctors row (email unique, role from invite, name from
 *      invite or "—")
 *   3. Mark token accepted (with accepted_user_id pointing at the new row)
 *   4. signSession() + setSessionCookie() so the user is logged in
 *   5. redirect() to role-appropriate home
 *
 * Idempotent: if the token has already been accepted, this no-ops and
 * redirects to /auth/login (which the signup page also surfaces).
 */
import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { signSession, setSessionCookie } from '@/lib/auth';

const HOME_FOR_ROLE: Record<string, string> = {
  doctor: '/dashboard',
  cce: '/reception',
  nurse: '/triage',
  lab_tech: '/lab',
  admin: '/admin',
};

export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  if (!token) redirect('/auth/login');

  // 1. Validate the token.
  const { rows } = await pool.query<{
    id: string; email: string; name: string | null; role: string;
    accepted_at: string | null; expires_at: string;
  }>(
    `SELECT id, email, name, role,
            accepted_at::text AS accepted_at,
            expires_at::text AS expires_at
       FROM invite_tokens WHERE token = $1 LIMIT 1`,
    [token],
  );
  const row = rows[0];
  if (!row) redirect('/auth/login?error=invalid_invite');
  if (row.accepted_at) redirect('/auth/login?signed_out=1');
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
    redirect('/auth/login?error=invalid_invite');
  }

  // 2. Upsert the doctors row. For non-doctor roles the
  //    mci_registration_number is a generic employee number; the schema
  //    requires NOT NULL so we generate a deterministic stub.
  const stubId = `INVITE-${row.id.slice(0, 8).toUpperCase()}`;
  const name = row.name ?? row.email.split('@')[0];
  const { rows: created } = await pool.query<{ id: string }>(
    `INSERT INTO doctors (email, name, mci_registration_number, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET
       name = COALESCE(doctors.name, EXCLUDED.name),
       role = EXCLUDED.role
     RETURNING id`,
    [row.email, name, stubId, row.role],
  );
  const userId = created[0].id;

  // 3. Mark token accepted.
  await pool.query(
    `UPDATE invite_tokens
        SET accepted_at = NOW(), accepted_user_id = $2
      WHERE id = $1`,
    [row.id, userId],
  );

  // 4. Sign session.
  const sessionToken = await signSession(row.email);
  await setSessionCookie(sessionToken);

  // 5. Redirect to the right home for the role.
  redirect(HOME_FOR_ROLE[row.role] ?? '/dashboard');
}
