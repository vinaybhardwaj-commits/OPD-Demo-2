/**
 * Magic-link auth for OPD-Encounter-App.
 *
 * Two JWTs, both HS256 signed with JWT_SECRET:
 *   1. Magic-link token  — 15-minute TTL, embedded in the emailed link.
 *      Validated by /api/auth/callback before issuing a session.
 *   2. Session cookie    — 30-day TTL, httpOnly + secure + sameSite=lax.
 *      Read by middleware.ts to gate protected pages.
 *
 * v2.0.1: session JWT now carries a `role` claim
 * (doctor | nurse | cce | lab_tech | admin). Looked up from the doctors
 * table at signing time. Middleware enforces role-per-path.
 *
 * Migration story:
 *   - v1: only `getCurrentDoctor()` existed. All routes assumed the user
 *     was a doctor.
 *   - v2: `getCurrentUser()` is the new authoritative helper, returning
 *     { email, role, id }. `getCurrentDoctor()` stays as a deprecated
 *     alias that asserts role === 'doctor' and returns null otherwise.
 *     This keeps every existing v1 route correctly gated to doctors
 *     without changing call sites.
 */
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

const SESSION_COOKIE = 'opd_session';
const SESSION_TTL_DAYS = 30;
const MAGIC_LINK_TTL_MIN = 15;

export type UserRole = 'doctor' | 'nurse' | 'cce' | 'lab_tech' | 'admin';

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return new TextEncoder().encode(s);
}

// -------- magic link --------

type MagicPayload = JWTPayload & { email: string; purpose: 'magic_link' };

export async function signMagicLink(email: string): Promise<string> {
  return new SignJWT({ email, purpose: 'magic_link' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${MAGIC_LINK_TTL_MIN}m`)
    .sign(secret());
}

export async function verifyMagicLink(
  token: string,
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const p = payload as MagicPayload;
    if (p.purpose !== 'magic_link' || !p.email) return null;
    return { email: p.email };
  } catch {
    return null;
  }
}

// -------- session --------

export type SessionClaims = JWTPayload & {
  email: string;
  role: UserRole;
  purpose: 'session';
};

/**
 * Sign a session token. Looks up the role from the doctors table at
 * signing time so the JWT carries it. Default 'doctor' if no row (which
 * shouldn't happen in v2 since isAllowedEmail gates upstream).
 */
export async function signSession(email: string): Promise<string> {
  const role = await lookupRole(email);
  return new SignJWT({ email, role, purpose: 'session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secret());
}

export async function verifySession(
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const p = payload as Partial<SessionClaims>;
    if (p.purpose !== 'session' || !p.email) return null;
    // Older v1 tokens didn't carry `role`. Treat as 'doctor' for
    // backwards compat — v1's only role was doctor.
    return {
      ...(p as JWTPayload),
      email: p.email,
      role: (p.role as UserRole) ?? 'doctor',
      purpose: 'session',
    } as SessionClaims;
  } catch {
    return null;
  }
}

// -------- cookie helpers (Next.js cookies()) --------

import { cookies } from 'next/headers';

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export async function setSessionCookie(token: string): Promise<void> {
  const c = await cookies();
  c.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  c.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Get the current signed-in user with their role. Returns null if no
 * valid session cookie. Use this in v2 surfaces that may serve multiple
 * roles (e.g. /patients/[id] is doctor + nurse + cce).
 */
export async function getCurrentUser(): Promise<SessionClaims | null> {
  const c = await cookies();
  return verifySession(c.get(SESSION_COOKIE)?.value);
}

/**
 * @deprecated since v2 — use getCurrentUser() and check role yourself.
 *
 * Kept for backwards compatibility with v1 routes. Returns the session
 * claims ONLY if the role is 'doctor'; returns null for any other role
 * so v1 doctor-only routes (encounter ownership, prescription dispatch)
 * remain correctly gated.
 */
export async function getCurrentDoctor(): Promise<SessionClaims | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  if (u.role !== 'doctor') return null;
  return u;
}

// -------- allowlist + role lookup --------

import { pool } from '@/lib/db';

/**
 * A user is allowed to sign in iff their email is present in the
 * `doctors` table — regardless of role. (The table holds all staff in
 * v2; the name 'doctors' is legacy.)
 *
 * Falls back to false on any DB error (fail-closed).
 */
export async function isAllowedEmail(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  try {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM doctors
        WHERE lower(email) = $1
          AND deactivated_at IS NULL`,
      [e],
    );
    return parseInt(rows[0]?.count ?? '0', 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Look up the user's role by email. Returns 'doctor' as a safe default
 * if the row exists but lacks a role (shouldn't happen post-v9, but
 * keeps the type system honest). Returns 'doctor' if email not found
 * — callers should have run isAllowedEmail first; only signSession
 * uses this path and only after the allowlist check passes.
 */
export async function lookupRole(email: string): Promise<UserRole> {
  const e = email.trim().toLowerCase();
  if (!e) return 'doctor';
  try {
    const { rows } = await pool.query<{ role: string }>(
      'SELECT role FROM doctors WHERE lower(email) = $1 LIMIT 1',
      [e],
    );
    const role = rows[0]?.role;
    if (!role) return 'doctor';
    if (role === 'doctor' || role === 'nurse' || role === 'cce' || role === 'lab_tech' || role === 'admin') {
      return role as UserRole;
    }
    return 'doctor';
  } catch {
    return 'doctor';
  }
}
