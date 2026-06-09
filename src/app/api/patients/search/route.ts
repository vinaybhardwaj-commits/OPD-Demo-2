/**
 * GET /api/patients/search?q=<query>
 *
 * Autocomplete over patients.name + patients.mrn + patients.phone_e164.
 *
 * Auth: any signed-in user (doctor / nurse / cce / lab_tech / admin).
 * The CCE reception flow needs phone-based lookup to register walk-ins.
 *
 * Returns up to 8 matches ordered by:
 *   1. Exact MRN match
 *   2. Phone exact match (last 7+ digits)
 *   3. Name prefix match (case-insensitive)
 *   4. Anywhere-substring match (name / MRN / phone)
 *
 * Response includes phone + known_allergies so the CCE register modal
 * can prefill the form on existing-patient match.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  mrn: string;
  name: string;
  age_years: number;
  sex: 'M' | 'F' | 'O' | null;
  phone_e164: string | null;
  known_allergies: string | null;
  rank: number;
};

export async function GET(req: Request) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ ok: true, matches: [] });
  }

  const ilikeAny = `%${q}%`.toLowerCase();
  const ilikePrefix = `${q}%`.toLowerCase();
  const lowerQ = q.toLowerCase();
  // For phone search, accept the raw digits — try to match last-N digits.
  const digits = q.replace(/\D/g, '');
  const phoneAny = digits.length >= 4 ? `%${digits}` : '__NO_MATCH__';

  const { rows } = await pool.query<Row>(
    `SELECT id, mrn, name, age_years, sex, phone_e164, known_allergies,
            CASE
              WHEN lower(mrn) = $3 THEN 0
              WHEN phone_e164 LIKE $4 THEN 1
              WHEN lower(name) LIKE $2 THEN 2
              WHEN lower(name) LIKE $1 OR lower(mrn) LIKE $1 OR phone_e164 LIKE $4 THEN 3
              ELSE 4
            END AS rank
       FROM patients
      WHERE lower(name) LIKE $1
         OR lower(mrn) LIKE $1
         OR phone_e164 LIKE $4
      ORDER BY rank ASC, name ASC
      LIMIT 8`,
    [ilikeAny, ilikePrefix, lowerQ, phoneAny],
  );

  return NextResponse.json({
    ok: true,
    matches: rows.map((r) => ({
      id: r.id,
      mrn: r.mrn,
      name: r.name,
      age_years: r.age_years,
      sex: r.sex,
      phone_e164: r.phone_e164,
      known_allergies: r.known_allergies,
    })),
  });
}
