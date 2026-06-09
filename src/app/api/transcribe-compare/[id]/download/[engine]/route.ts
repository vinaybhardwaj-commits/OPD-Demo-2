/**
 * GET /api/transcribe-compare/[id]/download/[engine]
 *
 * Returns the raw transcript text for one engine of a stored comparison,
 * as a text/plain attachment. Used by the ⬇ icons next to the dictation
 * button in the encounter editor.
 *
 * id     — transcription_comparisons.id (UUID)
 * engine — 'deepgram' | 'whisper'
 *
 * Auth: any logged-in doctor who owns the parent encounter.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; engine: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id, engine } = await ctx.params;
  if (engine !== 'deepgram' && engine !== 'whisper') {
    return NextResponse.json({ ok: false, error: 'invalid_engine' }, { status: 400 });
  }

  const col =
    engine === 'deepgram' ? 'deepgram_transcript' : 'whisper_transcript';

  const { rows } = await pool.query<{
    transcript: string | null;
    section: string | null;
    section_dictation_id: string | null;
    created_at: string;
    owns: boolean;
  }>(
    `SELECT
       tc.${col}                AS transcript,
       tc.section               AS section,
       tc.section_dictation_id  AS section_dictation_id,
       tc.created_at::text      AS created_at,
       EXISTS(
         SELECT 1 FROM encounters e
         JOIN doctors d ON d.id = e.doctor_id
         WHERE e.id = tc.encounter_id AND lower(d.email) = $2
       )                        AS owns
     FROM transcription_comparisons tc
     WHERE tc.id = $1`,
    [id, session.email.toLowerCase()],
  );

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (!row.owns) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (!row.transcript) {
    return NextResponse.json(
      { ok: false, error: 'no_transcript_for_engine' },
      { status: 404 },
    );
  }

  const section = row.section ?? 'transcript';
  const stamp = row.created_at.slice(0, 19).replace(/[:T]/g, '-');
  const filename = `${section}-${stamp}.${engine}.txt`;

  return new NextResponse(row.transcript, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
