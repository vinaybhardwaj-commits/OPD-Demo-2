/**
 * /enroll/voice — doctor self-serve voice enrollment (P1.6).
 * Signed-in doctor records 6 sentences; finishing returns to /board.
 */
import { redirect } from 'next/navigation';
import { getCurrentDoctor } from '@/lib/auth';
import { pool } from '@/lib/db';
import { VoiceEnrollClient } from '@/components/voice/VoiceEnrollClient';

export const dynamic = 'force-dynamic';

export default async function EnrollVoicePage() {
  const session = await getCurrentDoctor();
  if (!session) redirect('/auth/login');

  const { rows } = await pool.query<{ name: string }>(
    'SELECT name FROM doctors WHERE lower(email) = lower($1) LIMIT 1',
    [session.email],
  );
  const name = (rows[0]?.name ?? session.email).replace(/^Dr\.?\s+/i, '');

  return (
    <VoiceEnrollClient
      doctorName={name}
      context="doctor"
      enrollUrl="/api/voice/enroll"
      doneUrl="/board"
      cancelUrl="/board"
      transcribeUrl="/api/transcribe/sarvam-live"
    />
  );
}
