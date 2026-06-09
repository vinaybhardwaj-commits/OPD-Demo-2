/**
 * POST /api/encounters/[id]/sessions/[seq]/finalize — P1.2.
 * Called after the browser PUTs session audio to R2: verify the object
 * exists, stamp audio_object_key/bytes/duration on the session row, flip
 * its status to "uploaded". (P2 fans the transcription pipeline out from
 * here — Evenscribe's persist-regardless /process model.)
 * Body: { key, duration_seconds?, mime_type? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { headObject } from '@/lib/r2';

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

  const body = (await req.json().catch(() => null)) as {
    key?: string;
    duration_seconds?: number;
  } | null;
  if (!body || typeof body.key !== 'string' || !body.key.startsWith('audio/')) {
    return NextResponse.json({ ok: false, error: 'bad_key' }, { status: 400 });
  }
  // Key must belong to THIS encounter+session (no cross-encounter writes).
  if (!body.key.includes(`/${id}/${seq}.`)) {
    return NextResponse.json({ ok: false, error: 'key_mismatch' }, { status: 400 });
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
      { ok: false, error: `cannot_finalize_in_status_${rows[0].status}`, idempotent: rows[0].status === 'uploaded' },
      { status: 409 },
    );
  }

  const head = await headObject(body.key);
  if (head.size === null) {
    return NextResponse.json({ ok: false, error: `r2_object_missing: ${body.key}` }, { status: 502 });
  }
  if (head.size === 0) {
    return NextResponse.json({ ok: false, error: 'uploaded_object_is_empty' }, { status: 400 });
  }

  const duration =
    typeof body.duration_seconds === 'number' &&
    Number.isFinite(body.duration_seconds) &&
    body.duration_seconds > 0
      ? Math.round(body.duration_seconds)
      : null;

  await pool.query(
    `UPDATE encounter_sessions
        SET audio_object_key = $3,
            audio_bytes = $4,
            duration_seconds = COALESCE($5::numeric, duration_seconds),
            status = 'uploaded',
            ended_at = COALESCE(ended_at, NOW())
      WHERE encounter_id = $1 AND seq = $2`,
    [id, seq, body.key, head.size, duration],
  );

  return NextResponse.json({ ok: true, key: body.key, bytes: head.size, duration_seconds: duration });
}
