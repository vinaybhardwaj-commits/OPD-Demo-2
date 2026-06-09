'use server';

/**
 * Server actions for /admin/demo-controls.
 *
 * Every action revalidates /dashboard and /admin/demo-controls so the
 * queue + status block reflect changes immediately. Failures don't
 * throw to the client — they return null and the page reads the latest
 * state on revalidation. (Hard failures will surface in the server log.)
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentDoctor } from '@/lib/auth';
import { pool } from '@/lib/db';
import { notifyRoom } from '@/lib/queueNotify';
import { recomputePatientSummary } from '@/lib/patient-summary';
import {
  resetTodaysEncounters,
  addWalkInPatient,
  markDiagnosticReady,
} from '@/lib/seed';

async function requireSession(): Promise<string> {
  const session = await getCurrentDoctor();
  if (!session) {
    redirect('/auth/login');
  }
  return session.email;
}

function bust() {
  revalidatePath('/admin/demo-controls');
  revalidatePath('/dashboard');
}

export async function actionReset() {
  const email = await requireSession();
  await resetTodaysEncounters(email);
  // Broad bus: every watcher refreshes since the entire day was reset.
  await notifyRoom(null, `demo_reset`);
  bust();
}

/**
 * v2 demo replay — rewinds today's encounters network-wide into a varied
 * pristine state for re-running the full CCE → Triage → Doctor → Lab
 * choreography.
 *
 * Mirrors POST /api/admin/demo-replay logic inline so the server action
 * stays self-contained (no fetch-to-self gymnastics with VERCEL_URL).
 *
 * Distribution applied to today's encounter pool:
 *   30% registered · 20% at_triage · 20% waiting_for_doctor
 *   20% paused_diagnostics (with fresh pending CBC injected)
 *   10% ready_to_resume
 *
 * Side effects: handoff + ack + contributors + section_editors reset,
 * vitals cleared for pre-triage states, ddi/ddx_findings cleared,
 * processed lab_orders for paused encounters deleted, voice_queries
 * for today's encounters dropped.
 */
export async function actionReplayDemo() {
  await requireSession();

  const { rows: today } = await pool.query<{
    id: string;
    doctor_id: string;
    started_at: string;
  }>(
    `SELECT id, doctor_id, started_at::text AS started_at
     FROM encounters
     WHERE encounter_date = CURRENT_DATE
     ORDER BY encounter_number ASC, started_at ASC`,
  );
  if (today.length === 0) {
    await notifyRoom(null, `demo_replay_empty`);
    bust();
    return;
  }

  const n = today.length;
  const cuts: Array<[string, number]> = [
    ['registered', Math.floor(n * 0.3)],
    ['at_triage', Math.floor(n * 0.2)],
    ['waiting_for_doctor', Math.floor(n * 0.2)],
    ['paused_diagnostics', Math.floor(n * 0.2)],
  ];
  const segments: Array<{ status: string; ids: string[] }> = [];
  let cursor = 0;
  for (const [status, count] of cuts) {
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const seg of segments) {
      if (seg.ids.length === 0) continue;
      const clearTriage =
        seg.status === 'registered' || seg.status === 'at_triage';
      const isPaused = seg.status === 'paused_diagnostics';
      await client.query(
        `UPDATE encounters
         SET status = $1::encounter_status,
             handoff_note = NULL, handoff_ack_by = NULL, handoff_ack_at = NULL,
             section_editors = '{}'::jsonb,
             contributors_json = jsonb_build_array(
               jsonb_build_object(
                 'doctor_id', doctor_id,
                 'joined_at', COALESCE(started_at, NOW()),
                 'via', 'initial'
               )
             ),
             ${clearTriage ? 'vitals = NULL, triage_completed_at = NULL, triage_nurse_id = NULL,' : ''}
             paused_reason = ${isPaused ? "'lab_panel: replay'" : 'NULL'},
             pending_diagnostic_test = ${isPaused ? "'Lab: replay panel'" : 'NULL'},
             completed_at = NULL,
             ddi_findings = NULL,
             ddx_findings = NULL,
             updated_at = NOW()
         WHERE id = ANY($2::uuid[])`,
        [seg.status, seg.ids],
      );
    }

    // Reset lab orders for paused encounters: drop processed, inject fresh CBC if none in flight.
    const pausedIds =
      segments.find((s) => s.status === 'paused_diagnostics')?.ids ?? [];
    if (pausedIds.length > 0) {
      await client.query(
        `DELETE FROM lab_orders
         WHERE encounter_id = ANY($1::uuid[])
           AND status IN ('resulted','cancelled')`,
        [pausedIds],
      );
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

    // Voice queries for today's encounters: drop so the drawer starts empty.
    await client.query(
      `DELETE FROM voice_queries WHERE encounter_id = ANY($1::uuid[])`,
      [today.map((r) => r.id)],
    );

    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  await notifyRoom(null, `demo_replay`);
  bust();
}

export async function actionAddWalkIn() {
  await requireSession();
  await addWalkInPatient();
  await notifyRoom(null, `demo_walk_in`);
  bust();
}

export async function actionMarkReady(formData: FormData) {
  const email = await requireSession();
  const encId = String(formData.get('encounter_id') ?? '');
  if (!encId) return;
  await markDiagnosticReady(encId, email);
  // Look up room for the targeted notify (markDiagnosticReady doesn't
  // return it). One-shot pg_notify, swallows on failure.
  const { rows } = await pool.query<{ room_id: string | null }>(
    `SELECT room_id FROM encounters WHERE id = $1 LIMIT 1`,
    [encId],
  );
  await notifyRoom(rows[0]?.room_id ?? null, `lab_ready:${encId}`);
  bust();
}

// ---------------------------------------------------------------------------
// PH.1.3 — Backfill Qwen summaries
// ---------------------------------------------------------------------------

/**
 * Find every patient with ≥1 completed encounter that does NOT have a
 * `fresh` summary row and recompute it sequentially. Runs at the
 * route-segment maxDuration (300s on Vercel Pro) so the user can fire
 * one click and walk through the lot. If 300s runs out before the
 * batch finishes, the user clicks again — already-fresh rows are
 * skipped so it's idempotent.
 *
 * Behaviour:
 *   - Cap at BATCH_LIMIT eligible patients per click to keep latency
 *     predictable. The page nags the user to click again until 0 remain.
 *   - Each patient runs through recomputePatientSummary, which writes
 *     its own audit row.
 *   - Returns nothing — the page re-reads counts after revalidation.
 */
const BACKFILL_BATCH_LIMIT = 6; // ~5min worst case at warm-Qwen latencies

export async function actionBackfillSummaries() {
  const email = await requireSession();

  // Grab the doctor row so audit rows are attributed.
  const { rows: docRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  const doctorId = docRows[0]?.id ?? null;

  // Eligible = has ≥1 completed encounter AND no fresh summary.
  const { rows: eligible } = await pool.query<{ id: string }>(
    `SELECT DISTINCT e.patient_id AS id
       FROM encounters e
       LEFT JOIN patient_summaries s ON s.patient_id = e.patient_id
      WHERE e.status = 'completed'
        AND (s.status IS NULL OR s.status <> 'fresh')
      ORDER BY e.patient_id
      LIMIT $1`,
    [BACKFILL_BATCH_LIMIT],
  );

  for (const row of eligible) {
    // Sequential — Qwen on V's Mac Mini is single-instance and parallel
    // calls just queue at the model. No reason to over-fan-out.
    await recomputePatientSummary({ patientId: row.id, doctorId });
  }

  bust();
}
