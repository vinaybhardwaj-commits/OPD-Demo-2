/**
 * POST /api/auth/logout — clears session cookie, redirects to /auth/login
 *
 * POST (not GET) so the link cannot be triggered by image src etc. The
 * logout button in /dashboard submits a form to this route.
 */
import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  await clearSessionCookie();
  const origin = new URL(req.url).origin;
  return NextResponse.redirect(`${origin}/auth/login?signed_out=1`, { status: 303 });
}
