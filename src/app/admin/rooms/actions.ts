'use server';

/**
 * Server actions for /admin/rooms.
 *
 * actionUpsertRoom — handles both create (no id) and edit (with id).
 *   Inputs: id?, name, floor, specialty, default_doctor_id, active
 *
 * actionToggleActive — flip active boolean.
 *   Inputs: id
 *
 * Auth: any signed-in user for now (admin lockdown lands in v2.0.2.2).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';

async function requireSession(): Promise<void> {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');
}

export async function actionUpsertRoom(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '').trim() || null;
  const name = String(formData.get('name') ?? '').trim();
  const floor = String(formData.get('floor') ?? '').trim() || null;
  const specialty = String(formData.get('specialty') ?? '').trim() || null;
  const defaultDoctorId = String(formData.get('default_doctor_id') ?? '').trim() || null;
  const active = formData.get('active') === 'on' || formData.get('active') === '1';
  if (!name) return;

  if (id) {
    await pool.query(
      `UPDATE opd_rooms SET
         name = $2, floor = $3, specialty = $4,
         default_doctor_id = $5::uuid, active = $6
       WHERE id = $1`,
      [id, name, floor, specialty, defaultDoctorId, active],
    );
  } else {
    await pool.query(
      `INSERT INTO opd_rooms (name, floor, specialty, default_doctor_id, active)
       VALUES ($1, $2, $3, $4::uuid, $5)
       ON CONFLICT (name) DO UPDATE SET
         floor = EXCLUDED.floor,
         specialty = EXCLUDED.specialty,
         default_doctor_id = EXCLUDED.default_doctor_id,
         active = EXCLUDED.active`,
      [name, floor, specialty, defaultDoctorId, active],
    );
  }

  revalidatePath('/admin/rooms');
}

export async function actionToggleActive(formData: FormData) {
  await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await pool.query(`UPDATE opd_rooms SET active = NOT active WHERE id = $1`, [id]);
  revalidatePath('/admin/rooms');
}
