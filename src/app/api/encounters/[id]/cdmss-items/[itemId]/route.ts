/**
 * POST /api/encounters/[id]/cdmss-items/[itemId] — P2.4 accept/ignore.
 *
 * Body: { action: 'accept' | 'ignore' | 'reset' }. Flips the proposed
 * CDMSS item's status and stamps acted_by/acted_at (doctor resolved from
 * the session email). 'reset' returns an item to proposed (undo). Design
 * §12.3: decisions are logged, nothing blocks the doctor; full plan
 * instantiation on accept lands with the P4 Review Queue.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

const ACTIONS: Record<string, string> = { accept: 'accepted', ignore: 'ignored', reset: 'proposed' };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id, itemId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const status = ACTIONS[body.action ?? ''];
  if (!status) return NextResponse.json({ ok: false, error: 'bad_action' }, { status: 400 });

  const { rows: docRows } = await pool.query<{ id: string }>(
    'SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1',
    [user.email],
  );
  const doctorId = docRows[0]?.id ?? null;

  const { rows } = await pool.query<{ id: string; status: string }>(
    `UPDATE encounter_cdmss_items
        SET status = $3,
            acted_by = $4,
            acted_at = CASE WHEN $3 = 'proposed' THEN NULL ELSE NOW() END
      WHERE id = $2 AND encounter_id = $1
      RETURNING id, status`,
    [id, itemId, status, status === 'proposed' ? null : doctorId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'item_not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: rows[0].id, status: rows[0].status });
}
