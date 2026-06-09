/**
 * Edge middleware — gates protected pages on session cookie validity
 * AND on role.
 *
 * Important Next.js gotcha (we learned this on EHRC and Even-ELO): the
 * middleware file MUST live at src/middleware.ts in src/-layout projects.
 * A root-level middleware.ts in a src/ project is silently ignored by
 * Next.js and the gate disappears.
 *
 * Edge runtime can't import `next/headers`, so we verify the session JWT
 * inline using `jose` against the cookie value.
 *
 * Role-per-path matrix (v2.0.1):
 *   /dashboard/*    → doctor
 *   /reception/*    → cce
 *   /triage/*       → nurse
 *   /lab/*          → lab_tech
 *   /admin/*        → any signed-in role (existing demo behaviour kept;
 *                     full admin gate lands when /admin/users + /admin/rooms
 *                     ship in v2.0.2 — that's when we tighten to role='admin')
 *   /patients/*     → any signed-in role (longitudinal view is shared)
 *
 * Wrong-role users get bounced to /auth/login with ?error=wrong_role; the
 * login page can render a hint.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify, type JWTPayload } from 'jose';

const SESSION_COOKIE = 'opd_session';

type Role = 'doctor' | 'nurse' | 'cce' | 'lab_tech' | 'admin';
type SessionInfo = { email: string; role: Role } | null;

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return new TextEncoder().encode(s);
}

async function readSession(token: string | undefined): Promise<SessionInfo> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const p = payload as Partial<JWTPayload & { email: string; role: Role; purpose: string }>;
    if (p.purpose !== 'session' || !p.email) return null;
    // v1 tokens lack a role claim; treat as 'doctor'.
    const role: Role = (p.role as Role) ?? 'doctor';
    return { email: p.email, role };
  } catch {
    return null;
  }
}

/**
 * Map pathname prefix → allowed roles. First match wins.
 * 'any' means any signed-in user can access.
 *
 * v2.0.2: 'admin' is a SUPERUSER — granted access to every protected
 * surface regardless of the prefix's allow-list. /admin/* itself is
 * tightened to admin-only.
 */
const ROLE_RULES: Array<{ prefix: string; allow: Role[] | 'any' }> = [
  { prefix: '/dashboard', allow: ['doctor'] },
  { prefix: '/reception', allow: ['cce'] },
  { prefix: '/triage', allow: ['nurse'] },
  { prefix: '/lab', allow: ['lab_tech'] },
  // /admin/demo-controls is the v1 demo-reset helper. Kept open so V's
  // doctor login can still reset the queue between practice runs. The
  // real admin surfaces (/admin/users, /admin/rooms) are admin-only.
  { prefix: '/admin/demo-controls', allow: 'any' },
  { prefix: '/admin', allow: ['admin'] },
  { prefix: '/patients', allow: 'any' },
];

function allowedForPath(pathname: string, role: Role): boolean {
  if (role === 'admin') return true; // superuser
  for (const rule of ROLE_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(rule.prefix + '/')) {
      if (rule.allow === 'any') return true;
      return rule.allow.includes(role);
    }
  }
  return true; // No rule = pass-through (shouldn't happen given the matcher)
}

export async function middleware(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (!allowedForPath(req.nextUrl.pathname, session.role)) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/login';
    url.search = '?error=wrong_role&attempted=' + encodeURIComponent(req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/patients/:path*',
    '/reception/:path*',
    '/triage/:path*',
    '/lab/:path*',
  ],
};
