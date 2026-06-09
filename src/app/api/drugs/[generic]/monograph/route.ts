/**
 * GET /api/drugs/[generic]/monograph
 *
 * v3.10.5 — Drug monograph drawer data source. Returns the OpenFDA
 * indication chunks + key warnings/contraindications chunks for a
 * given drug. No LLM in path; direct SQL on the shared KB.
 *
 * Soft-fail. Empty sections render gracefully in the drawer UI.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { kbDrugMonograph } from '@/lib/kb';

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
    const monograph = await kbDrugMonograph(drug);
    return NextResponse.json({ ok: true, monograph });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'server_error', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
