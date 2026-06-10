/** POST /api/admin/doctors/[id]/voice-retrain — recompute the centroid from retained samples (P1.6). */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { recomputeCentroid } from '@/lib/voice-samples';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE id = $1 LIMIT 1',
    [id],
  );
  if (!rows[0]) return NextResponse.json({ ok: false, error: 'doctor_not_found' }, { status: 404 });
  const { sampleCount } = await recomputeCentroid(id);
  return NextResponse.json({ ok: true, sample_count: sampleCount });
}
