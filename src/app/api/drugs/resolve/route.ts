/**
 * POST /api/drugs/resolve — RX.1 smart drug resolution (see lib/rx-resolve
 * for the core; extracted in P4.1 so CDMSS accept routing shares it).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { resolveDrugText } from '@/lib/rx-resolve';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { q?: string };
  const q = (body.q ?? '').trim();
  if (q.length < 3) return NextResponse.json({ ok: false, error: 'query_too_short' }, { status: 400 });
  const r = await resolveDrugText(q);
  if (!r.ok) return NextResponse.json({ ok: false, error: 'resolve_failed' }, { status: 400 });
  return NextResponse.json(r);
}
