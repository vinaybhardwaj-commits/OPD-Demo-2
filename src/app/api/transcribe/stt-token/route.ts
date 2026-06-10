/**
 * GET /api/transcribe/stt-token — OPD-Demo-2 P1.4.
 *
 * Mint a short-lived HMAC token for the Mac Mini STT relay (Sarvam
 * streaming WS). Signed with STT_RELAY_SECRET (shared with the relay),
 * 120s TTL. If the relay env is unset, returns 503 and the client keeps
 * the REST refine trace (rolling runs in parallel anyway).
 *
 * Ported from ETA app/[slug]/api/voice/stt-token/route.ts — demo2's
 * opd_session cookie is Path=/ so a bare /api route receives it (the
 * ETA slug-scoping constraint doesn't apply).
 */
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const secret = process.env.STT_RELAY_SECRET;
  const relayUrl = process.env.NEXT_PUBLIC_STT_RELAY_URL || process.env.STT_RELAY_URL || '';
  if (!secret || !relayUrl) {
    return NextResponse.json({ ok: false, error: 'streaming_not_configured' }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const payload = Buffer.from(
    JSON.stringify({ sub: user.email, exp: Math.floor(Date.now() / 1000) + 120 }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return NextResponse.json({ ok: true, token: `${payload}.${sig}`, relay_url: relayUrl });
}
