/**
 * POST /api/encounters/[id]/sessions/[seq]/upload-url — P1.2.
 * Presigned R2 PUT for one recording session's consolidated audio blob.
 * Ported from Evenscribe's upload-url route, re-keyed to encounter_sessions.
 * Body: { content_type?: string }  default "audio/webm"
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { signPutUrl, sessionAudioKey } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; seq: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id, seq: seqRaw } = await ctx.params;
  const seq = Number.parseInt(seqRaw, 10);
  if (!Number.isFinite(seq) || seq < 1) {
    return NextResponse.json({ ok: false, error: 'bad_seq' }, { status: 400 });
  }

  const { rows } = await pool.query<{ id: string; status: string }>(
    'SELECT id, status FROM encounter_sessions WHERE encounter_id = $1 AND seq = $2',
    [id, seq],
  );
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'session_not_found' }, { status: 404 });
  }
  if (rows[0].status !== 'recording') {
    return NextResponse.json(
      { ok: false, error: `cannot_upload_in_status_${rows[0].status}` },
      { status: 409 },
    );
  }

  let contentType = 'audio/webm';
  const body = (await req.json().catch(() => ({}))) as { content_type?: string };
  if (typeof body.content_type === 'string' && body.content_type.length > 0) {
    contentType = body.content_type.slice(0, 100);
  }
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm';
  const key = sessionAudioKey(id, seq, ext);

  try {
    const url = await signPutUrl({ key, contentType, expiresInSeconds: 600 });
    return NextResponse.json({
      ok: true,
      url,
      key,
      method: 'PUT',
      content_type: contentType,
      expires_in_seconds: 600,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, error: `r2_sign_failed: ${msg}` }, { status: 502 });
  }
}
