/**
 * POST /api/encounters/[id]/sessions — P4.2. Opens a recording session row
 * OUTSIDE the Room lifecycle — used by the final-counselling capture on the
 * Review surface (phase 'final_disposition': faithfully transcribed in the
 * background, appended with NO review gate, never enters note-gen/stitch).
 * Body: { phase?: 'final_disposition' } (only this phase is allowed here —
 * primary/followup sessions stay owned by the Room's lifecycle choreography).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { phase?: string };
  const phase = body.phase ?? 'final_disposition';
  if (phase !== 'final_disposition') {
    return NextResponse.json({ ok: false, error: 'phase_not_allowed_here' }, { status: 400 });
  }

  const { rows: enc } = await pool.query<{ id: string }>(
    'SELECT id FROM encounters WHERE id = $1',
    [id],
  );
  if (enc.length === 0) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const { rows } = await pool.query<{ id: string; seq: number }>(
    `INSERT INTO encounter_sessions (encounter_id, seq, phase, status, started_at)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, 'final_disposition', 'recording', NOW()
       FROM encounter_sessions WHERE encounter_id = $1
     RETURNING id, seq`,
    [id],
  );
  return NextResponse.json({ ok: true, session_id: rows[0].id, seq: rows[0].seq });
}
