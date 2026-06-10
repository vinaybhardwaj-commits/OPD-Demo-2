/**
 * /admin/voiceprints — enrollment status for every doctor + kiosk links (P1.6).
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  name: string;
  sample_count: number | null;
  enrolled_at: string | null;
  needs_reenrollment: boolean | null;
};

export default async function AdminVoiceprintsPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/auth/login');

  const { rows } = await pool.query<Row>(
    `SELECT d.id, d.name, vp.sample_count, vp.enrolled_at::text AS enrolled_at, vp.needs_reenrollment
       FROM doctors d
       LEFT JOIN voice_print vp ON vp.doctor_id = d.id
      WHERE d.role = 'doctor' AND d.deactivated_at IS NULL
      ORDER BY d.name ASC`,
  );

  return (
    <main className="min-h-screen bg-even-white-cream">
      <header className="border-b border-even-ink-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-bold text-even-navy-800">Voiceprints</h1>
            <p className="text-xs text-even-ink-500">
              ECAPA voice enrollment per doctor — drives speaker labelling (live ID lands with the P2 pipeline).
            </p>
          </div>
          <Link href="/board" className="text-xs font-medium text-even-blue-600 hover:underline">← Board</Link>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-6">
        <ul className="space-y-2">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-xl border border-even-ink-200 bg-white px-4 py-3">
              <div>
                <span className="text-sm font-semibold text-even-navy-800">{d.name}</span>
                <span className="ml-3 text-xs text-even-ink-500">
                  {d.sample_count != null
                    ? `${d.sample_count} samples · enrolled ${d.enrolled_at?.slice(0, 10) ?? ''}${d.needs_reenrollment ? ' · needs re-enrollment' : ''}`
                    : 'not enrolled'}
                </span>
              </div>
              <Link
                href={`/admin/voiceprints/${d.id}`}
                className="rounded-lg bg-even-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-even-blue-700"
              >
                {d.sample_count != null ? 'Add samples' : 'Enroll'}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
