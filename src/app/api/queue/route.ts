/**
 * GET /api/queue — JSON wrapper around getQueueForDoctor().
 *
 * The page at /dashboard reads the same lib function directly. This
 * route exists for client-side polling, future native clients, and
 * smoke-testing via curl. See src/lib/queue.ts for the actual SQL.
 */
import { NextResponse } from 'next/server';
import { getCurrentDoctor } from '@/lib/auth';
import { getQueueForDoctor } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const q = await getQueueForDoctor(session.email);
  if (!q) {
    return NextResponse.json({ ok: false, error: 'doctor_not_seeded' }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    doctor: q.doctor,
    counts: {
      ready_to_resume: q.ready_to_resume.length,
      waiting: q.waiting.length,
      at_diagnostics: q.at_diagnostics.length,
      completed: q.completed.length,
      total:
        q.ready_to_resume.length +
        q.waiting.length +
        q.at_diagnostics.length +
        q.completed.length,
    },
    ready_to_resume: q.ready_to_resume,
    waiting: q.waiting,
    at_diagnostics: q.at_diagnostics,
    completed: q.completed,
  });
}
