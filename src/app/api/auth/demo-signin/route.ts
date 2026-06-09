/**
 * POST /api/auth/demo-signin
 *
 * One-click sign-in for the demo.
 *
 * Default (no params): signs in as Dr. Vinay (role=doctor) → /dashboard.
 *
 * v2.0.1 extensions for role testing:
 *   ?as=<email>   sign in as a specific user by email (must be in doctors table)
 *   ?role=<role>  sign in as the first user with that role
 *                 ('doctor' | 'nurse' | 'cce' | 'lab_tech' | 'admin')
 *
 * Post-signin redirect picks the right home for the role:
 *   doctor   → /dashboard
 *   cce      → /reception
 *   nurse    → /triage
 *   lab_tech → /lab
 *   admin    → /admin
 *
 * Gated by `DEMO_MODE` env var. Production-harden by setting it to 'false'.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { signSession, setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOME_FOR_ROLE: Record<string, string> = {
  doctor: '/dashboard',
  cce: '/reception',
  nurse: '/triage',
  lab_tech: '/lab',
  admin: '/admin',
};

const ALLOWED_ROLES = new Set(['doctor', 'cce', 'nurse', 'lab_tech', 'admin']);

export async function POST(req: Request) {
  if (process.env.DEMO_MODE === 'false') {
    return NextResponse.json(
      { ok: false, error: 'demo_mode_disabled' },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const asEmail = url.searchParams.get('as');
  const asRole = url.searchParams.get('role');

  let row: { email: string; name: string; role: string } | undefined;

  if (asEmail) {
    const r = await pool.query<{ email: string; name: string; role: string }>(
      `SELECT email, name, role FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
      [asEmail],
    );
    row = r.rows[0];
  } else if (asRole && ALLOWED_ROLES.has(asRole)) {
    const r = await pool.query<{ email: string; name: string; role: string }>(
      `SELECT email, name, role FROM doctors WHERE role = $1 ORDER BY created_at ASC LIMIT 1`,
      [asRole],
    );
    row = r.rows[0];
  } else {
    // Default: V if present, else first seeded.
    const r = await pool.query<{ email: string; name: string; role: string }>(
      `SELECT email, name, role FROM doctors
       ORDER BY (lower(email) = 'vinay.bhardwaj@even.in') DESC, created_at ASC
       LIMIT 1`,
    );
    row = r.rows[0];
  }

  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'no_matching_user' },
      { status: 404 },
    );
  }

  const token = await signSession(row.email);
  await setSessionCookie(token);

  const home = HOME_FOR_ROLE[row.role] ?? '/dashboard';
  const origin = url.origin;
  return NextResponse.redirect(`${origin}${home}`, { status: 303 });
}
