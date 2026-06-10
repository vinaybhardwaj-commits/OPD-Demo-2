/**
 * POST /api/voice/enroll — doctor self-serve voice enrollment (P1.6).
 *
 * multipart/form-data with clip_0..clip_N (the wizard's recorded sentences).
 * Each clip is embedded via the Mac Mini /enroll, its raw audio retained in
 * R2, one voice_sample row stored; the voice_print centroid is recomputed
 * from ALL accumulated samples (accumulate, never overwrite). Needs >=3
 * successful embeddings. Ported from ETA [slug]/api/voice/enroll
 * (opd_session auth; clinician resolved from the session email).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { storeEnrollmentSession } from '@/lib/voice-samples';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1',
    [user.email],
  );
  const clinicianId = rows[0]?.id;
  if (!clinicianId) return NextResponse.json({ ok: false, error: 'no_doctor_row' }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected_multipart' }, { status: 400 });
  }
  const clips: { buf: Buffer; contentType: string }[] = [];
  for (const [k, v] of form.entries()) {
    if (k.startsWith('clip_') && v instanceof Blob && v.size > 0) {
      clips.push({ buf: Buffer.from(await v.arrayBuffer()), contentType: v.type || 'audio/webm' });
    }
  }
  if (clips.length === 0) return NextResponse.json({ ok: false, error: 'no_clips' }, { status: 400 });

  const res = await storeEnrollmentSession({ clinicianId, clips, capturedByAdminId: null });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, ...res });
}
