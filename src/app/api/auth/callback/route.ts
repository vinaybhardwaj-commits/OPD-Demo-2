/**
 * GET /api/auth/callback?token=<magic-link-jwt>
 *
 * Validates the magic-link JWT, issues a session cookie, redirects to
 * /dashboard. Invalid/expired tokens 302 to /auth/login?error=...
 */
import { NextResponse } from 'next/server';
import {
  verifyMagicLink,
  signSession,
  setSessionCookie,
  isAllowedEmail,
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const origin = url.origin;

  const verified = await verifyMagicLink(token);
  if (!verified) {
    return NextResponse.redirect(`${origin}/auth/login?error=invalid_or_expired`);
  }

  // Re-check allowlist in case it changed between request and callback.
  if (!(await isAllowedEmail(verified.email))) {
    return NextResponse.redirect(`${origin}/auth/login?error=not_authorized`);
  }

  const session = await signSession(verified.email);
  await setSessionCookie(session);

  return NextResponse.redirect(`${origin}/dashboard`);
}
