'use server';

/**
 * Server actions for /triage (Triage Nurse workstation).
 *
 * actionStartTriage(encounter_id) — flips registered → at_triage and
 *   redirects the nurse to /triage/[id] to capture vitals. Recording the
 *   transition gives the team telemetry on "who's currently being
 *   worked on" so two nurses don't race for the same patient. Idempotent
 *   on at_triage (no-op + redirect).
 *
 * actionSaveVitals(formData) — the form save. Writes vitals JSON,
 *   triage_nurse_id, triage_completed_at, optionally refines
 *   chief_complaint_text. Flips at_triage → waiting_for_doctor.
 *   Redirects back to /triage so the nurse can pick the next patient.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { notifyRoom } from '@/lib/queueNotify';

async function requireSessionId(): Promise<string | null> {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  return rows[0]?.id ?? null;
}

export async function actionStartTriage(formData: FormData) {
  await requireSessionId();
  const encId = String(formData.get('encounter_id') ?? '');
  if (!encId) return;
  const { rows } = await pool.query<{ room_id: string | null }>(
    `UPDATE encounters
        SET status = 'at_triage'::encounter_status,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('registered','at_triage')
      RETURNING room_id`,
    [encId],
  );
  await notifyRoom(rows[0]?.room_id ?? null, `at_triage:${encId}`);
  revalidatePath('/triage');
  revalidatePath('/reception');
  redirect(`/triage/${encId}`);
}

export type VitalsPayload = {
  bp_sys?: number; bp_dia?: number;
  hr?: number; rr?: number; temp_c?: number; spo2?: number;
  weight_kg?: number; height_cm?: number; pain?: number;
};

function num(formData: FormData, key: string): number | undefined {
  const v = formData.get(key);
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function actionSaveVitals(formData: FormData) {
  const nurseId = await requireSessionId();
  const encId = String(formData.get('encounter_id') ?? '');
  if (!encId) return;

  const vitals: VitalsPayload = {
    bp_sys: num(formData, 'bp_sys'),
    bp_dia: num(formData, 'bp_dia'),
    hr: num(formData, 'hr'),
    rr: num(formData, 'rr'),
    temp_c: num(formData, 'temp_c'),
    spo2: num(formData, 'spo2'),
    weight_kg: num(formData, 'weight_kg'),
    height_cm: num(formData, 'height_cm'),
    pain: num(formData, 'pain'),
  };

  // Strip undefined keys so the JSONB is clean.
  const cleanVitals: VitalsPayload = {};
  (Object.keys(vitals) as Array<keyof VitalsPayload>).forEach((k) => {
    if (vitals[k] !== undefined) cleanVitals[k] = vitals[k];
  });

  const refinedCC = String(formData.get('chief_complaint_text') ?? '').trim() || null;

  const { rows } = await pool.query<{ room_id: string | null }>(
    `UPDATE encounters
        SET vitals = $2::jsonb,
            triage_nurse_id = $3,
            triage_completed_at = NOW(),
            chief_complaint_text = COALESCE($4, chief_complaint_text),
            status = 'waiting_for_doctor'::encounter_status,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('registered','at_triage')
      RETURNING room_id`,
    [encId, JSON.stringify(cleanVitals), nurseId, refinedCC],
  );

  await notifyRoom(rows[0]?.room_id ?? null, `vitals_saved:${encId}`);
  revalidatePath('/triage');
  revalidatePath('/reception');
  revalidatePath('/dashboard');
  redirect('/triage');
}
