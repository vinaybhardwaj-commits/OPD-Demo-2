/**
 * POST /api/auth/request
 *
 * Body: { email: string }
 *
 * Sends a magic-link to a doctor on the ALLOWED_DOCTOR_EMAILS list.
 *
 * Returns 200 with a generic "check your email" message in BOTH the success
 * case and the not-allowed case — we never confirm or deny that an email is
 * registered. This is the standard pattern for magic-link auth: it prevents
 * the request endpoint from being used as an email-enumeration oracle.
 *
 * Real failures (Resend down, missing config) return 500.
 */
import { NextResponse } from 'next/server';
import { signMagicLink, isAllowedEmail } from '@/lib/auth';
import { sendMagicLinkEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  let email: string;
  try {
    const body = (await req.json()) as { email?: string };
    email = (body.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  }

  // Allowlist gate. Return 200-style generic response either way.
  if (!(await isAllowedEmail(email))) {
    // No email sent; user sees the same UI as a real send.
    return NextResponse.json({ ok: true, sent: true });
  }

  const token = await signMagicLink(email);
  const appUrl = process.env.APP_URL?.replace(/\/$/, '') || '';
  if (!appUrl) {
    return NextResponse.json({ ok: false, error: 'app_url_missing' }, { status: 500 });
  }
  const link = `${appUrl}/api/auth/callback?token=${encodeURIComponent(token)}`;

  const result = await sendMagicLinkEmail({ to: email, link });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'send_failed', detail: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sent: true });
}
