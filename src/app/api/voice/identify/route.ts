/**
 * POST /api/voice/identify — P2.2 live clinician identification for the
 * Room's speaker pill (ported from ETA [slug]/api/voice/identify, V2.SD.2).
 *
 * The browser sends a short recent audio window (header chunk + ~9s tail);
 * we embed it via the Mac Mini /enroll (same ECAPA model /diarize uses),
 * compute cosine vs the signed-in doctor's stored voice_print centroid, and
 * return whether the clinician is currently identified (>= 0.78 live
 * threshold — looser than the 0.82 passive-capture include gate, which
 * stays strict). Light + stateless.
 *
 * Returns: { ok, enrolled, name, confidence, identified }
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { runEnroll, cosineSimilarity } from '@/lib/enroll';

export const runtime = 'nodejs';
export const maxDuration = 30;

const LIVE_THRESHOLD = 0.78;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { rows } = await pool.query<{ centroid_b64: string | null; name: string }>(
    `SELECT encode(vp.centroid, 'base64') AS centroid_b64, d.name
       FROM doctors d
       LEFT JOIN voice_print vp ON vp.doctor_id = d.id
      WHERE lower(d.email) = lower($1)
      LIMIT 1`,
    [user.email],
  );
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_doctor_row' }, { status: 403 });
  }
  if (!rows[0].centroid_b64) {
    return NextResponse.json({ ok: true, enrolled: false, identified: false, confidence: null, name: null });
  }
  const name = rows[0].name.replace(/^Dr\.?\s+/i, '');

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected_multipart' }, { status: 400 });
  }
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ ok: false, error: 'audio_missing' }, { status: 400 });
  }

  const buf = Buffer.from(await audio.arrayBuffer());
  const emb = await runEnroll(buf, audio.type || 'audio/webm');
  if (!emb.ok) {
    // Soft: the pill just keeps its last state; never an error banner.
    return NextResponse.json({ ok: true, enrolled: true, identified: false, confidence: null, name, error: emb.error });
  }

  const conf = cosineSimilarity(rows[0].centroid_b64, emb.embeddingBase64);
  return NextResponse.json({
    ok: true,
    enrolled: true,
    name,
    confidence: conf,
    identified: conf != null && conf >= LIVE_THRESHOLD,
  });
}
