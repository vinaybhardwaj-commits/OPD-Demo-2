/**
 * GET /api/drugs/[generic]/fda-indication
 *
 * v3.10.2 — fast OpenFDA indication lookup for a single drug name.
 * Used by RxCoherencePanel to backfill a citation under each warning
 * chip (V's hybrid lock: static map fires instant, FDA citation reveals
 * async).
 *
 * No LLM call. Direct SQL filter on the shared KB Neon. ~30-100ms typical.
 *
 * Returns { ok: true, indication: KbDrugIndication | null } — null means
 * no FDA chunk matched; the static warning still shows from the caller.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { kbDrugIndication } from '@/lib/kb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ generic: string }> },
) {
  try {
    const session = await getCurrentUser();
    if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const { generic } = await ctx.params;
    const drug = decodeURIComponent(generic).trim();
    if (drug.length < 3) {
      return NextResponse.json({ ok: false, error: 'drug_name_too_short' }, { status: 400 });
    }
    const indication = await kbDrugIndication(drug);
    return NextResponse.json({ ok: true, indication });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
