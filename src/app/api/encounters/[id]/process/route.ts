/**
 * POST /api/encounters/[id]/process — OPD-Demo-2 P2.1.
 *
 * Runs the background pipeline for one encounter (per-session canonical
 * transcription now; diarize/note-gen/CDS chain in P2.2–P2.4). The Room
 * fires this fire-and-forget right after pause_for_workup / end_visit;
 * the hourly sweep is the backstop. All work persists server-side
 * regardless of the client (ETA /process model). Idempotent: already-
 * transcribed sessions are skipped; an in-flight claim returns
 * skipped:already_in_flight; {force:true} re-runs.
 *
 * Auth: opd_session cookie OR x-migration-secret (ops/sweep tooling).
 * Body: { force?: boolean, detected_language?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { processEncounter } from '@/lib/process-pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const secretOk =
    !!process.env.MIGRATION_SECRET &&
    req.headers.get('x-migration-secret') === process.env.MIGRATION_SECRET;
  if (!secretOk) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    force?: boolean;
    detected_language?: string;
  };

  const out = await processEncounter(id, {
    force: body.force === true,
    detectedLanguage: typeof body.detected_language === 'string' ? body.detected_language : null,
  });
  if (out.error === 'not_found') {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(out);
}
