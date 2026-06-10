/**
 * GET /api/cron/process-sweep — OPD-Demo-2 P2.1 (hourly Vercel cron).
 *
 * Backstop for the client fire-and-forget trigger: transcribes any
 * encounters with uploaded-but-unprocessed sessions (bounded batch),
 * and reaps rows wedged in transcribing/generating past the stale
 * window. Auth: Vercel's un-spoofable x-vercel-cron header, or
 * x-migration-secret for manual runs.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  processEncounter,
  findUnprocessedEncounters,
  reapStuckProcessing,
} from '@/lib/process-pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BATCH = 3;

export async function GET(req: NextRequest) {
  const fromCron = req.headers.get('x-vercel-cron') !== null;
  const secretOk =
    !!process.env.MIGRATION_SECRET &&
    req.headers.get('x-migration-secret') === process.env.MIGRATION_SECRET;
  if (!fromCron && !secretOk) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const reaped = await reapStuckProcessing();
  const ids = await findUnprocessedEncounters(BATCH);
  const results = [];
  for (const id of ids) {
    results.push(await processEncounter(id));
  }
  return NextResponse.json({ ok: true, reaped, swept: ids.length, results });
}
