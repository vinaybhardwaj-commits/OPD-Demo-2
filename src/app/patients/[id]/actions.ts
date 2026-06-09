'use server';

/**
 * Server actions for /patients/[id].
 *
 * The Recompute button reruns the Qwen summarisation pass for the patient,
 * upserts patient_summaries, and writes a qwen_call_audit row. Sits at
 * page.maxDuration (300s, set on the patient page) so the doctor can
 * wait through one cold-start (~47s) without a timeout.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentDoctor } from '@/lib/auth';
import { pool } from '@/lib/db';
import { recomputePatientSummary } from '@/lib/patient-summary';

async function requireDoctor(): Promise<{ email: string; id: string | null }> {
  const session = await getCurrentDoctor();
  if (!session) {
    redirect('/auth/login');
  }
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM doctors WHERE lower(email) = lower($1) LIMIT 1`,
    [session.email],
  );
  return { email: session.email, id: rows[0]?.id ?? null };
}

export async function actionRecompute(formData: FormData) {
  const doc = await requireDoctor();
  const patientId = String(formData.get('patient_id') ?? '');
  if (!patientId) return;
  await recomputePatientSummary({ patientId, doctorId: doc.id });
  revalidatePath(`/patients/${patientId}`);
}

/**
 * PH.5 — write a doctor override row. The next recompute will feed
 * these to Qwen so the model honours the correction.
 *
 * Form payload (all optional except patient_id, target_kind, target_key, action):
 *   patient_id, target_kind ('problem'|'allergy'|'cc_chip'), target_key,
 *   action ('edit'|'dismiss'|'add'), label?, status?, note?
 */
export async function actionSaveOverride(formData: FormData) {
  const doc = await requireDoctor();
  const patientId = String(formData.get('patient_id') ?? '');
  const targetKind = String(formData.get('target_kind') ?? '');
  const targetKey = String(formData.get('target_key') ?? '');
  const action = String(formData.get('action') ?? '');
  if (!patientId || !targetKind || !targetKey || !action) return;

  const payload: Record<string, unknown> = {};
  for (const key of ['label', 'status', 'note'] as const) {
    const v = formData.get(key);
    if (typeof v === 'string' && v.trim() !== '') payload[key] = v.trim();
  }

  await pool.query(
    `INSERT INTO doctor_overrides
       (patient_id, doctor_id, target_kind, target_key, action, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      patientId,
      doc.id,
      targetKind,
      targetKey,
      action,
      Object.keys(payload).length > 0 ? JSON.stringify(payload) : null,
    ],
  );

  revalidatePath(`/patients/${patientId}`);
}
