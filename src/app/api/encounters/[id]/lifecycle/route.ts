/**
 * POST /api/encounters/[id]/lifecycle — OPD-Demo-2 P1.1.
 *
 * Drives the clinical track of the two-track lifecycle (migration 40 +
 * lib/lifecycle.ts). One endpoint, action-based, every transition guarded
 * by assertTransition. Also keeps the LEGACY status enum coherent so the
 * classic /dashboard queue keeps working (lossless).
 *
 * Actions:
 *   enter_room        ready|back_ready -> in_room   (+ opens the next encounter_sessions row)
 *   pause_for_workup  in_room -> out_for_workup     (+ closes the open session)
 *   mark_back_ready   out_for_workup -> back_ready  (demo results hook; real lab hook in P1.5)
 *   end_visit         in_room -> processing         (+ closes the open session)
 *   cancel            any non-terminal -> cancelled
 *
 * processing_status stays 'idle' in P1 — the background pipeline lands in P2.
 *
 * GET (P1.5) — both lifecycle tracks + the legacy status, for the Room's
 * desync poll: the classic editor's plans/submit flips ONLY the legacy
 * status to 'paused_diagnostics'; the Room watches for that while
 * clinical_status is still 'in_room', then runs stop→upload→pause_for_workup
 * client-side so the audio uploads BEFORE the transition (upload-first
 * invariant).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import {
  assertTransition,
  LifecycleTransitionError,
  type ClinicalStatus,
} from '@/lib/lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Action = 'enter_room' | 'pause_for_workup' | 'mark_back_ready' | 'end_visit' | 'cancel';

const TARGET: Record<Action, ClinicalStatus> = {
  enter_room: 'in_room',
  pause_for_workup: 'out_for_workup',
  mark_back_ready: 'back_ready',
  end_visit: 'processing',
  cancel: 'cancelled',
};

/** Legacy encounters.status value to keep the classic queue coherent. */
const LEGACY: Partial<Record<ClinicalStatus, string>> = {
  in_room: 'active',
  out_for_workup: 'paused_diagnostics',
  back_ready: 'ready_to_resume',
  processing: 'active',
  complete: 'completed',
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const { rows } = await pool.query<{
    clinical_status: string;
    processing_status: string;
    current_phase: string;
    legacy_status: string;
  }>(
    `SELECT clinical_status, processing_status, current_phase, status::text AS legacy_status
       FROM encounters
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...rows[0] });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: Action };
  const action = body.action;
  if (!action || !(action in TARGET)) {
    return NextResponse.json({ ok: false, error: 'bad_action' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{
      clinical_status: ClinicalStatus;
      current_phase: string;
    }>(
      'SELECT clinical_status, current_phase FROM encounters WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    const from = rows[0].clinical_status;
    const to = TARGET[action];
    try {
      assertTransition(from, to);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof LifecycleTransitionError) {
        return NextResponse.json(
          { ok: false, error: 'invalid_transition', from: e.from, to: e.to },
          { status: 409 },
        );
      }
      throw e;
    }

    let sessionId: string | null = null;
    let sessionSeq: number | null = null;

    if (action === 'enter_room') {
      // Open the next recording session. First session = primary phase;
      // every later one is a follow-up conversation.
      const { rows: s } = await client.query<{ id: string; seq: number; phase: string }>(
        `INSERT INTO encounter_sessions (encounter_id, seq, phase)
         SELECT $1,
                COALESCE(MAX(seq), 0) + 1,
                CASE WHEN COUNT(*) = 0 THEN 'primary' ELSE 'followup' END
         FROM encounter_sessions WHERE encounter_id = $1
         RETURNING id, seq, phase`,
        [id],
      );
      sessionId = s[0].id;
      sessionSeq = s[0].seq;
      await client.query(
        `UPDATE encounters
           SET clinical_status = $2,
               current_phase = CASE WHEN $3::int > 1 THEN 'followup' ELSE 'primary' END,
               status = 'active',
               updated_at = NOW()
         WHERE id = $1`,
        [id, to, sessionSeq],
      );
    } else {
      // Close any open session on pause/end.
      if (action === 'pause_for_workup' || action === 'end_visit') {
        await client.query(
          `UPDATE encounter_sessions
             SET ended_at = NOW()
           WHERE encounter_id = $1 AND ended_at IS NULL`,
          [id],
        );
      }
      const legacy = LEGACY[to];
      await client.query(
        `UPDATE encounters
           SET clinical_status = $2,
               status = COALESCE($3::encounter_status, status),
               updated_at = NOW()
         WHERE id = $1`,
        [id, to, legacy ?? null],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, from, to, session_id: sessionId, session_seq: sessionSeq });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { /* intentional: rollback best-effort */ });
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
