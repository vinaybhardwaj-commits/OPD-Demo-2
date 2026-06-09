/**
 * POST /api/transcribe/deepgram-token — OPD-Demo-2 P1.3.
 *
 * Mints a 10-minute Deepgram temp key scoped to usage:write so the
 * doctor's browser can open a WebSocket directly to Deepgram for live
 * transcription. Gated by the opd_session cookie (any signed-in staff
 * role — the Room is reachable by doctors today; keep parity with
 * getCurrentUser like the lifecycle route).
 *
 * Ported from ETA app/[slug]/api/transcribe/deepgram-token/route.ts
 * (cookie scheme adapted: doctor-slug JWT → opd_session JWT).
 *
 * Body: { encounter_id?: string }   (used in the key comment for audit)
 * Returns: { ok, key, expires_at, ttl_seconds }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { mintLiveToken } from '@/lib/deepgram-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let encounterId = 'unknown';
  try {
    const body = (await req.json().catch(() => ({}))) as {
      encounter_id?: string;
    };
    if (typeof body.encounter_id === 'string') {
      encounterId = body.encounter_id.slice(0, 40);
    }
  } catch {
    /* intentional: empty body fine */
  }

  try {
    const token = await mintLiveToken(`opd2:${user.email}:${encounterId}`);
    return NextResponse.json({
      ok: true,
      key: token.key,
      expires_at: token.expires_at,
      ttl_seconds: token.ttl_seconds,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `deepgram_token_mint_failed: ${msg.slice(0, 150)}` },
      { status: 502 },
    );
  }
}
