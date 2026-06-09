/**
 * POST /api/admin/demo-replay
 *
 * Rewind today's encounters into a varied pristine state so the v2
 * demo can be re-walked end-to-end without re-running the heavyweight
 * seed-v2 endpoint (which also recomputes Qwen summaries).
 *
 * Distribution applied to today's encounter pool:
 *   - first 30% → status='registered'         (CCE + Triage demo)
 *   - next 20%  → status='at_triage'           (mid-triage demo)
 *   - next 20%  → status='waiting_for_doctor' (vitals captured, doctor up)
 *   - next 20%  → status='paused_diagnostics' with at least one
 *                 pending lab_order injected so the lab tech has work
 *   - last 10%  → status='ready_to_resume'    (post-lab-result demo)
 *
 * Also clears handoff_note/handoff_ack/contributors_json/section_editors
 * so demo starts from a clean attribution slate (we re-stamp the
 * encounter's owner doctor as the sole 'initial' contributor).
 *
 * Lab orders today: deletes lab_orders whose status was already
 * processed (resulted/cancelled). Keeps pre_staged/pending/in_progress.
 * Injects one fresh pending lab_order per encounter that's being moved
 * to 'paused_diagnostics' (if none exists).
 *
 * Auth: x-migration-secret matching CRON_SECRET/MIGRATION_SECRET env
 * OR role=admin session.
 *
 * Idempotent: re-running just rewinds to the same distribution.
 *
 * Self-heal across days: if today's encounter pool is empty (e.g. demo
 * was seeded N days ago and the day has rolled over), the endpoint
 * UPDATEs the most-recent past date's encounters to encounter_date =
 * CURRENT_DATE first, then applies the distribution. Response includes
 * rolled_forward_from (date) + rolled_forward_count so admin tooling
 * can surface what happened. Only short-circuits with 409 if no
 * encounters exist in ANY date (bare DB — needs seed-v2 first).
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { notifyQueue } from '@/lib/queueNotify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// v3.9.7 — Vercel crons fire GET requests; delegate to POST so the
// same auth/replay logic runs on both verbs.
export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  // Auth — multiple acceptable paths:
  //   1. x-migration-secret header matching MIGRATION_SECRET env (manual curl)
  //   2. Authorization: Bearer <CRON_SECRET> (Vercel cron with secret set)
  //   3. x-vercel-cron header present (Vercel cron, no secret needed —
  //      Vercel strips this header from external requests so spoofing is
  //      not possible)
  //   4. Admin session (logged-in admin user)
  //
  // v3.9.7b — path 3 added because the original v3.9.7 cron silently
  // 401'd every night when CRON_SECRET wasn't set in env. x-vercel-cron
  // is the Vercel-documented default mechanism for cron auth.
  const headerSecret = req.headers.get('x-migration-secret');
  const expectedSecret = process.env.MIGRATION_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization');
  const vercelCronHeader = req.headers.get('x-vercel-cron');
  let authed = !!(expectedSecret && headerSecret === expectedSecret);
  if (!authed && cronSecret && bearer === `Bearer ${cronSecret}`) authed = true;
  if (!authed && vercelCronHeader) authed = true;
  if (!authed) {
    const session = await getCurrentUser();
    if (session?.role === 'admin') authed = true;
  }
  if (!authed) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 1. Today's encounters in stable order (by encounter_number).
  const todayQuery = `SELECT id, doctor_id, started_at::text AS started_at
     FROM encounters
     WHERE encounter_date = CURRENT_DATE
     ORDER BY encounter_number ASC, started_at ASC`;
  let { rows: today } = await pool.query<{
    id: string;
    doctor_id: string;
    started_at: string;
  }>(todayQuery);

  // 1a. Self-heal across days. If today's pool is empty, roll the
  //     most-recent date's encounters forward to CURRENT_DATE so the
  //     demo always has a pool to rewind. Without this, the Replay
  //     button silently no-ops on day N+1 (every actor view stays empty)
  //     unless someone re-runs the heavyweight seed-v2 endpoint.
  let rolled_forward_from: string | null = null;
  let rolled_forward_count = 0;
  if (today.length === 0) {
    const { rows: mostRecent } = await pool.query<{ max_date: string | null }>(
      `SELECT MAX(encounter_date)::text AS max_date
       FROM encounters
       WHERE encounter_date < CURRENT_DATE`,
    );
    const maxDate = mostRecent[0]?.max_date;
    if (!maxDate) {
      return NextResponse.json(
        {
          ok: false,
          error: 'no_encounters_at_all',
          detail:
            "No encounters exist in any date. Run POST /api/admin/seed-v2 to populate first.",
        },
        { status: 409 },
      );
    }
    const { rowCount } = await pool.query(
      `UPDATE encounters
       SET encounter_date = CURRENT_DATE,
           started_at = NOW(),
           updated_at = NOW()
       WHERE encounter_date = $1::date`,
      [maxDate],
    );
    rolled_forward_from = maxDate;
    rolled_forward_count = rowCount ?? 0;
    // Re-query today now that we've rolled forward.
    const reload = await pool.query<{
      id: string;
      doctor_id: string;
      started_at: string;
    }>(todayQuery);
    today = reload.rows;
  }
  if (today.length === 0) {
    // Belt and braces — should be unreachable after roll-forward succeeded.
    return NextResponse.json(
      {
        ok: false,
        error: 'no_today_encounters',
        detail:
          "Today's encounter pool is empty after roll-forward attempt. Run POST /api/admin/seed-v2 to populate first.",
      },
      { status: 409 },
    );
  }

  // 2. Carve out the distribution.
  const n = today.length;
  const cuts = {
    registered: Math.floor(n * 0.3),
    at_triage: Math.floor(n * 0.2),
    waiting_for_doctor: Math.floor(n * 0.2),
    paused_diagnostics: Math.floor(n * 0.2),
    // remainder goes to ready_to_resume
  };
  const segments: Array<{ status: string; ids: string[] }> = [];
  let cursor = 0;
  for (const [status, count] of Object.entries(cuts)) {
    segments.push({
      status,
      ids: today.slice(cursor, cursor + count).map((r) => r.id),
    });
    cursor += count;
  }
  segments.push({
    status: 'ready_to_resume',
    ids: today.slice(cursor).map((r) => r.id),
  });

  // 3. Bulk-update each segment. Clear handoff + contributors + section_editors.
  //    For 'registered' / 'at_triage' status: also clear triage_completed_at
  //    + vitals so the triage nurse demo starts fresh.
  const client = await pool.connect();
  const updateCounts: Record<string, number> = {};
  try {
    await client.query('BEGIN');
    for (const seg of segments) {
      if (seg.ids.length === 0) continue;
      // Status flip + clear handoff/contributors/section_editors.
      // contributors_json gets the original doctor as the sole 'initial'.
      const clearTriage =
        seg.status === 'registered' || seg.status === 'at_triage';
      const sql = `
        UPDATE encounters
        SET status = $1::encounter_status,
            handoff_note = NULL,
            handoff_ack_by = NULL,
            handoff_ack_at = NULL,
            section_editors = '{}'::jsonb,
            contributors_json = jsonb_build_array(
              jsonb_build_object(
                'doctor_id', doctor_id,
                'joined_at', COALESCE(started_at, NOW()),
                'via', 'initial'
              )
            ),
            ${clearTriage ? "vitals = NULL, triage_completed_at = NULL, triage_nurse_id = NULL," : ''}
            ${seg.status === 'registered' || seg.status === 'at_triage' ? '' : ''}
            paused_reason = ${seg.status === 'paused_diagnostics' ? "'lab_panel: replay'" : 'NULL'},
            pending_diagnostic_test = ${seg.status === 'paused_diagnostics' ? "'Lab: replay panel'" : 'NULL'},
            completed_at = NULL,
            ddi_findings = NULL,
            ddx_findings = NULL,
            updated_at = NOW()
        WHERE id = ANY($2::uuid[])
      `;
      const { rowCount } = await client.query(sql, [seg.status, seg.ids]);
      updateCounts[seg.status] = rowCount ?? 0;
    }

    // 4. Lab orders: drop today's resulted/cancelled ones, and add a
    //    fresh pending CBC for any encounter moved to paused_diagnostics
    //    that doesn't already have a pending lab.
    const pausedIds =
      segments.find((s) => s.status === 'paused_diagnostics')?.ids ?? [];
    if (pausedIds.length > 0) {
      // Drop processed labs in this set.
      await client.query(
        `DELETE FROM lab_orders
         WHERE encounter_id = ANY($1::uuid[])
           AND status IN ('resulted', 'cancelled')`,
        [pausedIds],
      );
      // Insert one fresh CBC for any paused encounter that has no pending
      // labs yet.
      await client.query(
        `INSERT INTO lab_orders (
           encounter_id, patient_id, ordering_doctor_id,
           raw_text, display_name, status, ordered_at
         )
         SELECT e.id, e.patient_id, e.doctor_id,
                'CBC (demo replay)', 'CBC (demo replay)', 'pending', NOW()
         FROM encounters e
         WHERE e.id = ANY($1::uuid[])
           AND NOT EXISTS (
             SELECT 1 FROM lab_orders lo
             WHERE lo.encounter_id = e.id
               AND lo.status IN ('pre_staged','pending','in_progress','awaiting_confirmation')
           )`,
        [pausedIds],
      );
    }

    // 5. Voice queries from prior demos: drop them so the drawer starts empty.
    await client.query(
      `DELETE FROM voice_queries
       WHERE encounter_id = ANY($1::uuid[])`,
      [today.map((r) => r.id)],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'db_error', detail: msg.slice(0, 500) },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  // Notify everything so all open browser tabs refresh.
  await notifyQueue('queue:global', 'demo_replay');
  await notifyQueue('queue:lab', 'demo_replay');

  return NextResponse.json({
    ok: true,
    total_today: n,
    distribution: updateCounts,
    rolled_forward_from,
    rolled_forward_count,
    ran_at: new Date().toISOString(),
  });
}
