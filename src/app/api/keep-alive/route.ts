/**
 * GET /api/keep-alive
 *
 * Two jobs in one cron (every 15 min during clinic hours):
 *
 *  A. Pre-warm the Qwen tunnel.
 *     EHRC's carryover §10 notes a 47s cold-start when the Mac Mini sleeps.
 *     The cron pings qwen so the first patient encounter of the morning
 *     doesn't wait.
 *
 *  B. Self-heal the demo encounter pool (v4.1.5).
 *     The dedicated demo-replay cron at 23:30 UTC silently never runs
 *     because Vercel's Hobby plan caps cron count at 2 and ours is
 *     the 3rd. Instead of relying on it, we piggy-back the self-heal
 *     on keep-alive: if today (IST) has zero encounters AND we have
 *     a most-recent past pool, roll it forward + reapply the status
 *     distribution. Idempotent: the guard `today_count = 0` ensures
 *     it only fires when needed (once per IST day in practice).
 *
 * Cron schedule (vercel.json):
 *   "0,15,30,45 1-15 * * 1-6"  → every 15min UTC 01:00-15:59
 *                                 = IST 06:30-21:29 Mon-Sat
 *
 * Auth: accepts unauthenticated GETs (matches the previous behaviour —
 * the worst a stray ping can do is warm qwen + maybe replay the pool,
 * both of which are intended outcomes).
 */
import { NextResponse } from 'next/server';
import { qwenPing, QWEN_MODEL } from '@/lib/qwen';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// SQL transaction body — same logic as /api/admin/demo-replay, kept
// here as a self-contained block so this route has zero new import
// surface area. If you change the demo-replay SQL, change it in both
// places (one is the canonical admin endpoint, the other is the
// daily self-heal).
const SELF_HEAL_SQL = `
DO $rollfwd$
DECLARE
  today_count INT;
  max_date DATE;
BEGIN
  SELECT COUNT(*) INTO today_count FROM encounters WHERE encounter_date = CURRENT_DATE;
  IF today_count = 0 THEN
    SELECT MAX(encounter_date) INTO max_date FROM encounters WHERE encounter_date < CURRENT_DATE;
    IF max_date IS NULL THEN
      RAISE NOTICE 'self-heal: no past encounters to roll forward, skipping';
      RETURN;
    END IF;
    UPDATE encounters
      SET encounter_date = CURRENT_DATE, started_at = NOW(), updated_at = NOW()
      WHERE encounter_date = max_date;
    RAISE NOTICE 'self-heal: rolled forward % rows from %', (SELECT COUNT(*) FROM encounters WHERE encounter_date = CURRENT_DATE), max_date;
  END IF;
END
$rollfwd$;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY encounter_number ASC, started_at ASC) AS rn, COUNT(*) OVER () AS total
  FROM encounters WHERE encounter_date = CURRENT_DATE
),
seg AS (
  SELECT id, rn, total,
    CASE
      WHEN rn <= FLOOR(total*0.3) THEN 'registered'
      WHEN rn <= FLOOR(total*0.3) + FLOOR(total*0.2) THEN 'at_triage'
      WHEN rn <= FLOOR(total*0.3) + FLOOR(total*0.4) THEN 'waiting_for_doctor'
      WHEN rn <= FLOOR(total*0.3) + FLOOR(total*0.6) THEN 'paused_diagnostics'
      ELSE 'ready_to_resume'
    END AS new_status
  FROM ranked
)
UPDATE encounters e
SET status = seg.new_status::encounter_status,
    handoff_note = NULL, handoff_ack_by = NULL, handoff_ack_at = NULL,
    section_editors = '{}'::jsonb,
    contributors_json = jsonb_build_array(jsonb_build_object('doctor_id', e.doctor_id, 'joined_at', COALESCE(e.started_at, NOW()), 'via', 'initial')),
    vitals = CASE WHEN seg.new_status IN ('registered','at_triage') THEN NULL ELSE e.vitals END,
    triage_completed_at = CASE WHEN seg.new_status IN ('registered','at_triage') THEN NULL ELSE e.triage_completed_at END,
    triage_nurse_id = CASE WHEN seg.new_status IN ('registered','at_triage') THEN NULL ELSE e.triage_nurse_id END,
    paused_reason = CASE WHEN seg.new_status = 'paused_diagnostics' THEN 'lab_panel: self-heal' ELSE NULL END,
    pending_diagnostic_test = CASE WHEN seg.new_status = 'paused_diagnostics' THEN 'Lab: self-heal panel' ELSE NULL END,
    completed_at = NULL, ddi_findings = NULL, ddx_findings = NULL,
    updated_at = NOW()
FROM seg WHERE e.id = seg.id;

INSERT INTO lab_orders (encounter_id, patient_id, ordering_doctor_id, raw_text, display_name, status, ordered_at)
SELECT e.id, e.patient_id, e.doctor_id, 'CBC (self-heal)', 'CBC (self-heal)', 'pending', NOW()
FROM encounters e
WHERE e.encounter_date = CURRENT_DATE AND e.status = 'paused_diagnostics'
  AND NOT EXISTS (SELECT 1 FROM lab_orders lo WHERE lo.encounter_id = e.id AND lo.status IN ('pre_staged','pending','in_progress','awaiting_confirmation'));

DELETE FROM voice_queries WHERE encounter_id IN (SELECT id FROM encounters WHERE encounter_date = CURRENT_DATE);
`;

async function maybeSelfHeal(): Promise<{
  ran: boolean;
  today_count_before: number;
  today_count_after: number;
  error?: string;
}> {
  try {
    const { rows: pre } = await pool.query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM encounters WHERE encounter_date = CURRENT_DATE',
    );
    const before = parseInt(pre[0]?.c ?? '0', 10);

    if (before > 0) {
      // Today already populated — nothing to heal.
      return { ran: false, today_count_before: before, today_count_after: before };
    }

    // Today is empty — run the self-heal SQL.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(SELF_HEAL_SQL);
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }

    const { rows: post } = await pool.query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM encounters WHERE encounter_date = CURRENT_DATE',
    );
    const after = parseInt(post[0]?.c ?? '0', 10);
    return { ran: true, today_count_before: before, today_count_after: after };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ran: false,
      today_count_before: -1,
      today_count_after: -1,
      error: msg.slice(0, 300),
    };
  }
}

export async function GET() {
  // Fire both jobs concurrently — they don't depend on each other.
  const [pingResult, healResult] = await Promise.all([
    qwenPing(),
    maybeSelfHeal(),
  ]);

  return NextResponse.json({
    ok: pingResult.ok && !healResult.error,
    qwen: {
      ok: pingResult.ok,
      latency_ms: pingResult.latency_ms,
      model: QWEN_MODEL,
      error: pingResult.error,
    },
    self_heal: healResult,
  });
}
