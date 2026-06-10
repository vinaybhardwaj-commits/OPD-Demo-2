/**
 * POST /api/admin/doctors/[id]/voice-enroll — admin kiosk enrollment (P1.6).
 * Enroll ANY doctor's voice (doctor physically at the admin's mic).
 * Session-gated like the rest of /admin (demo2 has no separate admin auth).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { storeEnrollmentSession } from '@/lib/voice-samples';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE id = $1 AND deactivated_at IS NULL LIMIT 1`,
    [id],
  );
  if (!rows[0]) return NextResponse.json({ ok: false, error: 'doctor_not_found' }, { status: 404 });

  const { rows: adminRows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1',
    [user.email],
  );

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

  const res = await storeEnrollmentSession({
    clinicianId: id,
    clips,
    capturedByAdminId: adminRows[0]?.id ?? null,
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, ...res });
}
