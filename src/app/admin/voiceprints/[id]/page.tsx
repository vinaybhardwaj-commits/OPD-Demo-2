/**
 * /admin/voiceprints/[id] — admin kiosk voice enrollment (P1.6).
 * The chosen doctor reads the sentences at the admin's mic.
 */
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { VoiceEnrollClient } from '@/components/voice/VoiceEnrollClient';

export const dynamic = 'force-dynamic';

export default async function AdminVoiceKioskPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const { id } = await params;
  const { rows } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM doctors WHERE id = $1 AND deactivated_at IS NULL LIMIT 1',
    [id],
  );
  const doctor = rows[0];
  if (!doctor) notFound();

  return (
    <VoiceEnrollClient
      doctorName={doctor.name.replace(/^Dr\.?\s+/i, '')}
      context="admin"
      enrollUrl={`/api/admin/doctors/${id}/voice-enroll`}
      doneUrl="/admin/voiceprints"
      cancelUrl="/admin/voiceprints"
      transcribeUrl="/api/transcribe/sarvam-live"
    />
  );
}
