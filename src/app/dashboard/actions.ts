'use server';

/**
 * Server actions for the dashboard queue.
 *
 * Server actions are POST-on-submit by design — agents/crawlers can't
 * accidentally start an encounter just by following a hover-link, which
 * is the failure mode if we did the same as a GET handler.
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentDoctor } from '@/lib/auth';
import { startEncounterForPatient } from '@/lib/encounters';
import { pool } from '@/lib/db';
import { notifyRoom } from '@/lib/queueNotify';

export async function startEncounter(formData: FormData) {
  const session = await getCurrentDoctor();
  if (!session) redirect('/auth/login');

  const patient_id = String(formData.get('patient_id') ?? '');
  if (!patient_id) throw new Error('missing_patient_id');

  const { encounter_id } = await startEncounterForPatient({
    patient_id,
    doctor_email: session.email,
  });

  revalidatePath('/dashboard');
  redirect(`/dashboard/encounters/${encounter_id}`);
}

/**
 * v2.3 — Claim a pending handoff. Server-action equivalent of the
 * POST /api/encounters/[id]/claim-handoff endpoint. Same logic;
 * preferred for inline form actions on /dashboard so the user goes
 * directly to the encounter screen.
 */
export async function actionClaimHandoff(formData: FormData) {
  const session = await getCurrentDoctor();
  if (!session) redirect('/auth/login');

  const encounter_id = String(formData.get('encounter_id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(encounter_id)) {
    return;
  }

  const { rows: meRows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  const claimerId = meRows[0]?.id;
  if (!claimerId) return;

  const { rows: encRows } = await pool.query<{
    status: string;
    room_id: string | null;
    handoff_note: string | null;
    handoff_ack_by: string | null;
    contributors_json: Array<{ doctor_id: string; joined_at: string; via: string }>;
  }>(
    `SELECT status::text AS status, room_id, handoff_note, handoff_ack_by, contributors_json
     FROM encounters WHERE id = $1 LIMIT 1`,
    [encounter_id],
  );
  const enc = encRows[0];
  if (!enc || enc.status === 'completed' || !enc.handoff_note || enc.handoff_ack_by) {
    return;
  }

  const alreadyIn = enc.contributors_json.some((c) => c.doctor_id === claimerId);
  const nextContributors = alreadyIn
    ? enc.contributors_json
    : [
        ...enc.contributors_json,
        {
          doctor_id: claimerId,
          joined_at: new Date().toISOString(),
          via: 'handoff_claim' as const,
        },
      ];

  await pool.query(
    `UPDATE encounters
     SET doctor_id = $2,
         handoff_ack_by = $2,
         handoff_ack_at = NOW(),
         contributors_json = $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [encounter_id, claimerId, JSON.stringify(nextContributors)],
  );

  await notifyRoom(enc.room_id ?? null, `handoff_claimed:${encounter_id}`);
  revalidatePath('/dashboard');
  redirect(`/dashboard/encounters/${encounter_id}`);
}
