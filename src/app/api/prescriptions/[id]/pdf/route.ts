/**
 * GET /api/prescriptions/[id]/pdf
 *
 * Streams a prescription PDF from the private Vercel Blob store back to
 * an authenticated doctor.
 *
 * Auth chain:
 *   1. Doctor session cookie (jose) — required
 *   2. The doctor must own the encounter that owns this prescription
 *      (`encounters.doctor_id = the signed-in doctor`)
 *
 * Why this exists: Sprint 7's `/dispatch` stored the PDF as private so
 * audio + PDF live behind BLOB_READ_WRITE_TOKEN. Browsers can't fetch
 * private Blob URLs directly. This route is the server-side proxy.
 */
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const { rows } = await pool.query<{
    pdf_blob_url: string | null;
    prescription_number: string;
  }>(
    `SELECT p.pdf_blob_url, p.prescription_number
     FROM prescriptions p
     JOIN encounters e ON e.id = p.encounter_id
     JOIN doctors d ON d.id = e.doctor_id
     WHERE p.id = $1 AND lower(d.email) = $2
     LIMIT 1`,
    [id, session.email.toLowerCase()],
  );
  const rx = rows[0];
  if (!rx) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (!rx.pdf_blob_url) {
    return NextResponse.json(
      { ok: false, error: 'pdf_not_generated', detail: 'Run /dispatch first.' },
      { status: 409 },
    );
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'blob_token_missing' }, { status: 500 });
  }

  try {
    const upstream = await fetch(rx.pdf_blob_url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        {
          ok: false,
          error: 'blob_fetch_failed',
          status: upstream.status,
          detail: text.slice(0, 200),
        },
        { status: 502 },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${rx.prescription_number}.pdf"`,
        // Don't cache — the doctor might re-dispatch with edited Rx
        // and we want the new file served immediately.
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'proxy_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
