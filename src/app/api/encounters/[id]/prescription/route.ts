/**
 * GET /api/encounters/[id]/prescription   — fetch the draft, or null
 * PUT /api/encounters/[id]/prescription   — upsert with body { lines: [...] }
 *
 * One prescription per encounter (schema enforces UNIQUE on encounter_id).
 * `prescription_number` mirrors the encounter's number with an RX- prefix,
 * e.g. ENC-20260518-018 → RX-20260518-018. Makes them visually paired
 * on PDFs + audit reports.
 *
 * 409 on completed encounters: the prescription is immutable once the
 * encounter is closed. Sprint 7 will lift that to allow corrections via
 * a separate "amend" endpoint with audit log.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EncMini = { id: string; status: string; encounter_number: string };
type PrescriptionRow = {
  id: string;
  encounter_id: string;
  prescription_number: string;
  generated_at: string;
  pdf_blob_url: string | null;
  lines: unknown;
  patient_sent_at: string | null;
  pharmacy_sent_at: string | null;
};

async function loadEncounterIfOwned(
  encId: string,
  doctorEmail: string,
): Promise<EncMini | null> {
  const { rows } = await pool.query<EncMini>(
    `SELECT e.id, e.status::text AS status, e.encounter_number
     FROM encounters e
     JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 AND lower(d.email) = $2
     LIMIT 1`,
    [encId, doctorEmail.toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const enc = await loadEncounterIfOwned(id, session.email);
  if (!enc) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const { rows } = await pool.query<PrescriptionRow>(
    `SELECT id, encounter_id, prescription_number, generated_at,
            pdf_blob_url, lines, patient_sent_at, pharmacy_sent_at
     FROM prescriptions
     WHERE encounter_id = $1
     LIMIT 1`,
    [id],
  );
  return NextResponse.json({ ok: true, prescription: rows[0] ?? null });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const enc = await loadEncounterIfOwned(id, session.email);
  if (!enc) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  if (enc.status === 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_completed_immutable' },
      { status: 409 },
    );
  }

  let body: { lines?: unknown };
  try {
    body = (await req.json()) as { lines?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  if (!Array.isArray(body.lines)) {
    return NextResponse.json({ ok: false, error: 'lines_must_be_array' }, { status: 400 });
  }

  // Generate prescription_number from encounter_number: ENC-X → RX-X
  const rxNumber = enc.encounter_number.replace(/^ENC-/, 'RX-');

  // Upsert (no row → INSERT, existing row → UPDATE lines)
  await pool.query(
    `INSERT INTO prescriptions (encounter_id, prescription_number, lines)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (encounter_id) DO UPDATE
       SET lines = EXCLUDED.lines`,
    [id, rxNumber, JSON.stringify(body.lines)],
  );

  const { rows } = await pool.query<PrescriptionRow>(
    `SELECT id, encounter_id, prescription_number, generated_at,
            pdf_blob_url, lines, patient_sent_at, pharmacy_sent_at
     FROM prescriptions
     WHERE encounter_id = $1
     LIMIT 1`,
    [id],
  );
  return NextResponse.json({ ok: true, prescription: rows[0] });
}
