/**
 * POST /api/encounters/[id]/dispatch
 *
 * Orchestrates the post-submit fanout:
 *   1. Load encounter + patient + prescription + doctor
 *   2. Generate PDF (pdf-lib, DEMO watermark if demo mode)
 *   3. Upload PDF to private Vercel Blob → store on prescriptions.pdf_blob_url
 *   4. Twilio WhatsApp (or DEMO_MODE log) for patient + pharmacy
 *   5. Stamp patient_sent_at + pharmacy_sent_at on the prescription
 *
 * Returns the dispatch outcome per recipient + the PDF URL. The
 * encounter must already be completed — this is post-submit, not
 * pre-submit. The /complete endpoint flips the status; /dispatch
 * runs immediately after.
 *
 * DEMO_MODE defaults to true. Set DEMO_MODE=false on Vercel only after
 * Twilio + Meta templates are wired (Sprint 7 ships demo only).
 *
 * Idempotency: if pdf_blob_url + both _sent_at are already set, we
 * return the cached values without re-generating.
 */
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { pool } from '@/lib/db';
import { getCurrentDoctor } from '@/lib/auth';
import { generatePrescriptionPdf } from '@/lib/pdf';
import { sendWhatsAppPdf } from '@/lib/twilio';
import { notifyRoom } from '@/lib/queueNotify';
import type { PrescriptionLine } from '@/components/DrugRow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Pharmacy number is hardcoded for demo. Production should pull from a
// hospital-config table.
const PHARMACY_WHATSAPP = process.env.EHRC_PHARMACY_WHATSAPP ?? '+919999999999';

type EncounterRow = {
  id: string;
  status: string;
  room_id: string | null;
  encounter_number: string;
  encounter_date: string;
  chief_complaint_chips: string[] | null;
  chief_complaint_text: string | null;
  exam_findings: string | null;
  vitals: Record<string, unknown> | null;
  assessment_codes: string[] | null;
  assessment_text: string | null;
  disposition: string | null;
  follow_up_days: number | null;
  referral_target: string | null;
  patient_name: string;
  patient_mrn: string;
  patient_age_years: number;
  patient_sex: string;
  patient_phone_e164: string | null;
  patient_known_allergies: string | null;
  doctor_name: string;
  doctor_mci: string;
};

type PrescriptionRow = {
  id: string;
  prescription_number: string;
  generated_at: string;
  pdf_blob_url: string | null;
  lines: PrescriptionLine[];
  patient_sent_at: string | null;
  pharmacy_sent_at: string | null;
};

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentDoctor();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  // Load everything we need in one round trip
  const { rows: encRows } = await pool.query<EncounterRow>(
    `SELECT e.id, e.status::text AS status, e.room_id, e.encounter_number,
            e.encounter_date::text AS encounter_date,
            e.chief_complaint_chips, e.chief_complaint_text,
            e.exam_findings, e.vitals,
            e.assessment_codes, e.assessment_text,
            e.disposition::text AS disposition,
            e.follow_up_days, e.referral_target,
            p.name AS patient_name, p.mrn AS patient_mrn,
            p.age_years AS patient_age_years, p.sex AS patient_sex,
            p.phone_e164 AS patient_phone_e164,
            p.known_allergies AS patient_known_allergies,
            d.name AS doctor_name,
            d.mci_registration_number AS doctor_mci
     FROM encounters e
     JOIN patients p ON p.id = e.patient_id
     JOIN doctors d ON d.id = e.doctor_id
     WHERE e.id = $1 AND lower(d.email) = $2
     LIMIT 1`,
    [id, session.email.toLowerCase()],
  );
  const enc = encRows[0];
  if (!enc) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  if (enc.status !== 'completed') {
    return NextResponse.json(
      { ok: false, error: 'encounter_not_completed', detail: 'Submit & finish first.' },
      { status: 409 },
    );
  }

  const { rows: rxRows } = await pool.query<PrescriptionRow>(
    `SELECT id, prescription_number, generated_at, pdf_blob_url, lines,
            patient_sent_at, pharmacy_sent_at
     FROM prescriptions
     WHERE encounter_id = $1
     LIMIT 1`,
    [id],
  );
  let rx = rxRows[0];
  if (!rx) {
    // No prescription drafted — create an empty one so the doctor can
    // still issue a PDF for the encounter (advice-only visits do
    // happen). prescription_number mirrors ENC- prefix.
    const rxNumber = enc.encounter_number.replace(/^ENC-/, 'RX-');
    const ins = await pool.query<PrescriptionRow>(
      `INSERT INTO prescriptions (encounter_id, prescription_number, lines)
       VALUES ($1, $2, '[]'::jsonb)
       RETURNING id, prescription_number, generated_at, pdf_blob_url, lines,
                 patient_sent_at, pharmacy_sent_at`,
      [id, rxNumber],
    );
    rx = ins.rows[0];
  }

  // Idempotency — return cached if already fully dispatched
  if (rx.pdf_blob_url && rx.patient_sent_at && rx.pharmacy_sent_at) {
    await notifyRoom(enc.room_id ?? null, `dispatched:${id}`);
    return NextResponse.json({
      ok: true,
      already_dispatched: true,
      pdf_blob_url: rx.pdf_blob_url,
      patient_sent_at: rx.patient_sent_at,
      pharmacy_sent_at: rx.pharmacy_sent_at,
    });
  }

  // 1. Generate PDF
  const demo = process.env.DEMO_MODE !== 'false';
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generatePrescriptionPdf({
      encounter: {
        encounter_number: enc.encounter_number,
        encounter_date: enc.encounter_date,
        chief_complaint_chips: enc.chief_complaint_chips,
        chief_complaint_text: enc.chief_complaint_text,
        exam_findings: enc.exam_findings,
        vitals: enc.vitals,
        assessment_codes: enc.assessment_codes,
        assessment_text: enc.assessment_text,
        disposition: enc.disposition,
        follow_up_days: enc.follow_up_days,
        referral_target: enc.referral_target,
      },
      patient: {
        name: enc.patient_name,
        mrn: enc.patient_mrn,
        age_years: enc.patient_age_years,
        sex: enc.patient_sex,
        phone_e164: enc.patient_phone_e164,
        known_allergies: enc.patient_known_allergies,
      },
      doctor: {
        name: enc.doctor_name,
        mci_registration_number: enc.doctor_mci,
      },
      prescription: {
        prescription_number: rx.prescription_number,
        generated_at: rx.generated_at,
        lines: rx.lines ?? [],
      },
      demo,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'pdf_generation_failed', detail: msg.slice(0, 300) },
      { status: 500 },
    );
  }

  // 2. Upload PDF to private Blob
  let pdfUrl: string;
  try {
    const uploaded = await put(
      `prescriptions/${id}/${rx.prescription_number}.pdf`,
      Buffer.from(pdfBytes),
      {
        access: 'private',
        contentType: 'application/pdf',
        addRandomSuffix: true,
      },
    );
    pdfUrl = uploaded.url;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'pdf_upload_failed', detail: msg.slice(0, 300) },
      { status: 500 },
    );
  }

  // 3. Twilio sends (or DEMO log)
  const sends = await Promise.all([
    enc.patient_phone_e164
      ? sendWhatsAppPdf({
          role: 'patient',
          to: enc.patient_phone_e164,
          pdf_url: pdfUrl,
          encounter_number: enc.encounter_number,
          prescription_number: rx.prescription_number,
          patient_name: enc.patient_name,
        })
      : Promise.resolve({
          ok: false as const,
          error: 'patient_phone_missing',
          mode: 'demo' as const,
        }),
    sendWhatsAppPdf({
      role: 'pharmacy',
      to: PHARMACY_WHATSAPP,
      pdf_url: pdfUrl,
      encounter_number: enc.encounter_number,
      prescription_number: rx.prescription_number,
      patient_name: enc.patient_name,
    }),
  ]);
  const [patientSend, pharmacySend] = sends;

  // 4. Stamp timestamps on the prescription
  const patientSentAt = patientSend.ok ? patientSend.sent_at : null;
  const pharmacySentAt = pharmacySend.ok ? pharmacySend.sent_at : null;
  await pool.query(
    `UPDATE prescriptions
     SET pdf_blob_url = $2,
         patient_sent_at = COALESCE($3::timestamptz, patient_sent_at),
         pharmacy_sent_at = COALESCE($4::timestamptz, pharmacy_sent_at)
     WHERE id = $1`,
    [rx.id, pdfUrl, patientSentAt, pharmacySentAt],
  );

  await notifyRoom(enc.room_id ?? null, `dispatched:${id}`);

  return NextResponse.json({
    ok: true,
    pdf_blob_url: pdfUrl,
    patient: patientSend,
    pharmacy: pharmacySend,
    mode: demo ? 'demo' : 'live',
  });
}
