/** GET /api/admin/doctors/[id]/voice-samples — voiceprint summary + retained samples (P1.6). */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listSamples, voiceprintSummary } from '@/lib/voice-samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const [vp, samples] = await Promise.all([voiceprintSummary(id), listSamples(id)]);
  return NextResponse.json({ ok: true, voiceprint: vp, total_samples: samples.length, samples });
}
