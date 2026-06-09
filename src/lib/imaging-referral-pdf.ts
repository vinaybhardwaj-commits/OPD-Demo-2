/**
 * Imaging referral PDF generator (v3.6).
 *
 * Builds a single-page referral form for an imaging test order
 * (X-ray, USG, CT, MRI, etc.). Mirrors the pdf.ts pattern used by
 * the v2 prescription generator — pdf-lib + Helvetica standard font.
 *
 * The PDF is what the radiology desk receives via WhatsApp or print.
 * Includes patient identity, encounter id, test details, clinical
 * indication, and a doctor signature line.
 *
 * DEMO_MODE adds a watermark per v2 convention.
 */
import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage, type PDFFont } from 'pdf-lib';

const EVEN_NAVY = rgb(0, 0x20 / 255, 0x54 / 255);
const EVEN_INK_500 = rgb(0.4, 0.4, 0.45);
const EVEN_INK_900 = rgb(0.1, 0.1, 0.12);
const EVEN_BLUE = rgb(0, 0x55 / 255, 1);

export type ImagingReferralPdfInput = {
  encounter: {
    encounter_number: string;
    encounter_date: string;
    chief_complaint_text: string | null;
  };
  patient: {
    name: string;
    mrn: string;
    age_years: number;
    sex: string;
    phone_e164: string | null;
  };
  doctor: {
    name: string;
    mci_registration_number: string | null;
  };
  order: {
    service_code: string;
    display_name: string;
    sub_department: string;
    modality: string;
    body_area: string | null;
    laterality: string | null;
    clinical_indication: string | null;
    ordered_at: string;
  };
  demo: boolean;
};

// Strip non-Latin-1 chars Helvetica can't encode (em dashes, curly quotes, etc.)
function sanitise(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[…]/g, '...')
    .replace(/[^\x00-\xFF]/g, '?');
}

function drawText(page: PDFPage, text: string, x: number, y: number, opts: { font: PDFFont; size?: number; color?: ReturnType<typeof rgb> }) {
  page.drawText(sanitise(text), {
    x, y,
    font: opts.font,
    size: opts.size ?? 11,
    color: opts.color ?? EVEN_INK_900,
  });
}

function drawLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color = EVEN_INK_500) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color });
}

export async function generateImagingReferralPdf(input: ImagingReferralPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait, points
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  let y = 800;

  // Header band
  page.drawRectangle({ x: 0, y: 780, width: 595, height: 62, color: EVEN_NAVY });
  drawText(page, 'EVEN HOSPITAL · EHRC', margin, 815, { font: helvBold, size: 14, color: rgb(1, 1, 1) });
  drawText(page, 'Radiology Referral', margin, 795, { font: helv, size: 10, color: rgb(0.85, 0.9, 1) });
  drawText(page, `Ref no. ${input.encounter.encounter_number}`, 595 - margin - 150, 815, { font: helv, size: 10, color: rgb(0.85, 0.9, 1) });
  drawText(page, `Date: ${input.encounter.encounter_date}`, 595 - margin - 150, 795, { font: helv, size: 10, color: rgb(0.85, 0.9, 1) });

  y = 750;

  // Patient block
  drawText(page, 'PATIENT', margin, y, { font: helvBold, size: 9, color: EVEN_INK_500 });
  y -= 16;
  drawText(page, `${input.patient.name}    (${input.patient.sex}, ${input.patient.age_years}y)`, margin, y, { font: helvBold, size: 12 });
  y -= 14;
  drawText(page, `MRN: ${input.patient.mrn}`, margin, y, { font: helv, size: 10, color: EVEN_INK_500 });
  if (input.patient.phone_e164) {
    drawText(page, `Phone: ${input.patient.phone_e164}`, margin + 200, y, { font: helv, size: 10, color: EVEN_INK_500 });
  }
  y -= 28;
  drawLine(page, margin, y, 595 - margin, y);
  y -= 18;

  // Test block — the main payload
  drawText(page, 'TEST REQUESTED', margin, y, { font: helvBold, size: 9, color: EVEN_INK_500 });
  y -= 18;
  drawText(page, input.order.display_name, margin, y, { font: helvBold, size: 16, color: EVEN_NAVY });
  y -= 16;
  drawText(page, `${input.order.modality} · ${input.order.sub_department}`, margin, y, { font: helv, size: 10, color: EVEN_INK_500 });
  drawText(page, `Code: ${input.order.service_code}`, 595 - margin - 120, y, { font: helv, size: 10, color: EVEN_INK_500 });
  y -= 24;

  // Body area + laterality if present
  if (input.order.body_area || input.order.laterality) {
    drawText(page, 'BODY REGION', margin, y, { font: helvBold, size: 9, color: EVEN_INK_500 });
    y -= 14;
    const parts: string[] = [];
    if (input.order.body_area) parts.push(input.order.body_area);
    if (input.order.laterality) parts.push(input.order.laterality);
    drawText(page, parts.join(' · '), margin, y, { font: helv, size: 12 });
    y -= 22;
  }

  // Clinical indication — full-width block
  drawText(page, 'CLINICAL INDICATION', margin, y, { font: helvBold, size: 9, color: EVEN_INK_500 });
  y -= 14;
  const indicationText = input.order.clinical_indication ?? '(none captured)';
  const indicationLines = wrapText(sanitise(indicationText), helv, 11, 595 - 2 * margin);
  for (const line of indicationLines) {
    drawText(page, line, margin, y, { font: helv, size: 11 });
    y -= 14;
  }
  y -= 18;

  // CC for context
  if (input.encounter.chief_complaint_text) {
    drawText(page, 'CHIEF COMPLAINT (context)', margin, y, { font: helvBold, size: 9, color: EVEN_INK_500 });
    y -= 14;
    const ccLines = wrapText(sanitise(input.encounter.chief_complaint_text), helv, 10, 595 - 2 * margin);
    for (const line of ccLines.slice(0, 3)) {
      drawText(page, line, margin, y, { font: helv, size: 10, color: EVEN_INK_500 });
      y -= 12;
    }
    y -= 12;
  }

  // Signature block at bottom
  const sigY = 180;
  drawLine(page, margin, sigY, margin + 200, sigY);
  drawText(page, input.doctor.name, margin, sigY - 14, { font: helvBold, size: 11 });
  if (input.doctor.mci_registration_number) {
    drawText(page, `MCI Reg: ${input.doctor.mci_registration_number}`, margin, sigY - 28, { font: helv, size: 9, color: EVEN_INK_500 });
  }
  drawText(page, 'Referring physician', margin, sigY - 42, { font: helv, size: 9, color: EVEN_INK_500 });

  // Time-of-order stamp on the right
  drawText(page, `Ordered: ${input.order.ordered_at}`, 595 - margin - 180, sigY - 14, { font: helv, size: 9, color: EVEN_INK_500 });

  // Footer
  drawText(page, 'Please return the report to the encounter folder or send to the referring physician.', margin, 80, { font: helv, size: 9, color: EVEN_INK_500 });
  drawText(page, `Encounter: ${input.encounter.encounter_number}`, margin, 65, { font: helv, size: 8, color: EVEN_INK_500 });
  drawText(page, 'Even Hospital · Race Course Road, Bengaluru', 595 - margin - 220, 65, { font: helv, size: 8, color: EVEN_BLUE });

  // Demo watermark
  if (input.demo) {
    page.drawText('DEMO', {
      x: 220, y: 420,
      font: helvBold, size: 90,
      color: rgb(0.95, 0.85, 0.85),
      opacity: 0.4,
      rotate: degrees(-25),
    });
  }

  const bytes = await pdf.save();
  return bytes;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    const width = font.widthOfTextAtSize(tryLine, size);
    if (width <= maxWidth) {
      cur = tryLine;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
