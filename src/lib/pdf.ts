/**
 * Prescription PDF generator.
 *
 * pdf-lib is a pure-JS PDF engine that works inside Vercel functions
 * with no native deps. Standard fonts only (Helvetica) so we don't
 * have to bundle a font file.
 *
 * Demo mode adds a "DEMO — NOT A VALID PRESCRIPTION" watermark across
 * the page, per handoff §3 constraints. Pre-pilot, the same generator
 * runs with DEMO_MODE=false to produce real Rx PDFs.
 */
import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage, type PDFFont } from 'pdf-lib';
import { lookupIcd10 } from '@/lib/icd10';
import type { PrescriptionLine } from '@/components/DrugRow';

export type PrescriptionPdfInput = {
  encounter: {
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
  };
  patient: {
    name: string;
    mrn: string;
    age_years: number;
    sex: string;
    phone_e164: string | null;
    known_allergies: string | null;
  };
  doctor: {
    name: string;
    mci_registration_number: string;
  };
  prescription: {
    prescription_number: string;
    generated_at: string;
    lines: PrescriptionLine[];
  };
  demo: boolean;
};

const EVEN_NAVY = rgb(0, 0x20 / 255, 0x54 / 255);
const EVEN_BLUE = rgb(0, 0x55 / 255, 0xFF / 255);
const INK_700 = rgb(0x2E / 255, 0x32 / 255, 0x3B / 255);
const INK_500 = rgb(0x64 / 255, 0x6B / 255, 0x7A / 255);
const INK_300 = rgb(0xB5 / 255, 0xBA / 255, 0xC5 / 255);
const DEMO_PINK = rgb(0xF9 / 255, 0x6E / 255, 0xB1 / 255);

export async function generatePrescriptionPdf(
  input: PrescriptionPdfInput,
): Promise<Uint8Array> {
  // Sanitise every user-text field once at the boundary so downstream
  // drawText calls don't need to remember.
  input = sanitiseInput(input);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.prescription.prescription_number} — ${input.patient.name}`);
  pdf.setAuthor('Even Hospital · OPD Encounter App');
  pdf.setCreator('opd-encounter-app');
  pdf.setProducer('pdf-lib');
  pdf.setCreationDate(new Date());

  const page = pdf.addPage([595.28, 841.89]); // A4
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const M = { l: 50, r: 50, t: 50, b: 60 };
  const W = page.getWidth();
  let y = page.getHeight() - M.t;

  // Header — Even Hospital
  page.drawText('EVEN HOSPITAL · RACE COURSE ROAD', {
    x: M.l, y, size: 13, font: bold, color: EVEN_NAVY,
  });
  y -= 14;
  page.drawText('General Practitioner · OPD', {
    x: M.l, y, size: 9, font: reg, color: INK_500,
  });
  // Right side: Rx number + date
  drawRightText(page, input.prescription.prescription_number, M.l, y + 14, W - M.r, 11, bold, EVEN_BLUE);
  drawRightText(page, fmtDate(input.encounter.encounter_date), M.l, y, W - M.r, 9, reg, INK_500);
  y -= 12;
  page.drawLine({
    start: { x: M.l, y: y - 6 }, end: { x: W - M.r, y: y - 6 },
    thickness: 0.5, color: INK_300,
  });
  y -= 24;

  // Patient block
  y = drawKv(page, reg, bold, M.l, y, 'PATIENT', input.patient.name, 11, EVEN_NAVY);
  y = drawKv(page, reg, bold, M.l, y, 'MRN', input.patient.mrn, 9, INK_700);
  y = drawKv(
    page, reg, bold, M.l, y, 'AGE / SEX',
    `${input.patient.age_years} / ${input.patient.sex}`,
    9, INK_700,
  );
  if (input.patient.phone_e164) {
    y = drawKv(page, reg, bold, M.l, y, 'PHONE', input.patient.phone_e164, 9, INK_700);
  }
  if (input.patient.known_allergies) {
    y -= 4;
    page.drawText(`Allergies: ${input.patient.known_allergies}`, {
      x: M.l, y, size: 9, font: bold, color: DEMO_PINK,
    });
    y -= 14;
  }
  y -= 12;

  // Chief complaint
  if (
    (input.encounter.chief_complaint_chips && input.encounter.chief_complaint_chips.length > 0) ||
    input.encounter.chief_complaint_text
  ) {
    y = drawSectionLabel(page, bold, M.l, y, 'CHIEF COMPLAINT');
    if (input.encounter.chief_complaint_chips && input.encounter.chief_complaint_chips.length > 0) {
      y = drawWrapped(page, reg, M.l, y, W - M.r - M.l, input.encounter.chief_complaint_chips.join(' · '), 9, INK_700);
    }
    if (input.encounter.chief_complaint_text) {
      y = drawWrapped(page, reg, M.l, y, W - M.r - M.l, input.encounter.chief_complaint_text, 9, INK_700);
    }
    y -= 8;
  }

  // Vitals
  if (input.encounter.vitals && Object.keys(input.encounter.vitals).length > 0) {
    y = drawSectionLabel(page, bold, M.l, y, 'VITALS');
    const v = input.encounter.vitals as Record<string, number>;
    const parts: string[] = [];
    if (v.bp_sys != null && v.bp_dia != null) parts.push(`BP ${v.bp_sys}/${v.bp_dia} mmHg`);
    if (v.hr != null) parts.push(`HR ${v.hr} bpm`);
    if (v.rr != null) parts.push(`RR ${v.rr}/min`);
    if (v.temp_c != null) parts.push(`Temp ${v.temp_c}°C`);
    if (v.spo2 != null) parts.push(`SpO2 ${v.spo2}%`);
    y = drawWrapped(page, reg, M.l, y, W - M.r - M.l, parts.join('  ·  '), 9, INK_700);
    y -= 8;
  }

  // Exam findings
  if (input.encounter.exam_findings) {
    y = drawSectionLabel(page, bold, M.l, y, 'EXAM FINDINGS');
    y = drawWrapped(page, reg, M.l, y, W - M.r - M.l, input.encounter.exam_findings, 9, INK_700);
    y -= 8;
  }

  // Assessment
  if (
    (input.encounter.assessment_codes && input.encounter.assessment_codes.length > 0) ||
    input.encounter.assessment_text
  ) {
    y = drawSectionLabel(page, bold, M.l, y, 'ASSESSMENT');
    if (input.encounter.assessment_codes && input.encounter.assessment_codes.length > 0) {
      const lines = input.encounter.assessment_codes.map(
        (c) => `${c} - ${lookupIcd10(c) ?? '-'}`,
      );
      for (const l of lines) {
        y = drawWrapped(page, reg, M.l, y, W - M.r - M.l, l, 9, EVEN_BLUE);
      }
    }
    if (input.encounter.assessment_text) {
      y = drawWrapped(page, reg, M.l, y, W - M.r - M.l, input.encounter.assessment_text, 9, INK_700);
    }
    y -= 8;
  }

  // Prescription
  if (input.prescription.lines.length > 0) {
    y = drawSectionLabel(page, bold, M.l, y, 'Rx');
    let n = 1;
    for (const line of input.prescription.lines) {
      const head = `${n}. ${line.brand_name}${line.strength ? ` ${line.strength}` : ''}`;
      page.drawText(head, { x: M.l, y, size: 10, font: bold, color: EVEN_NAVY });
      y -= 13;
      const subParts: string[] = [];
      subParts.push(line.generic_name);
      if (line.dosage_form) subParts.push(line.dosage_form);
      if (line.frequency) subParts.push(line.frequency);
      if (line.duration_days != null) subParts.push(
        line.duration_days >= 30 ? '1 month' : `${line.duration_days} days`,
      );
      if (line.timing) subParts.push(line.timing.toLowerCase());
      page.drawText(`   ${subParts.join('  ·  ')}`, {
        x: M.l, y, size: 9, font: reg, color: INK_700,
      });
      y -= 12;
      if (line.instructions) {
        page.drawText(`   ${line.instructions}`, {
          x: M.l, y, size: 8.5, font: italic, color: INK_500,
        });
        y -= 11;
      }
      if (line.schedule_dc === 'X') {
        page.drawText('   Schedule X - narcotic / psychotropic. License number on dispense.', {
          x: M.l, y, size: 8, font: bold, color: DEMO_PINK,
        });
        y -= 10;
      }
      if (line.is_high_risk) {
        page.drawText('   High-alert medication (ISMP). Verify dose + route.', {
          x: M.l, y, size: 8, font: bold, color: DEMO_PINK,
        });
        y -= 10;
      }
      y -= 5;
      n++;
    }
  }

  // Disposition
  if (input.encounter.disposition) {
    y -= 4;
    y = drawSectionLabel(page, bold, M.l, y, 'DISPOSITION');
    let disp = input.encounter.disposition.replace('_', ' ');
    if (input.encounter.disposition === 'follow_up' && input.encounter.follow_up_days != null) {
      disp += ` · ${input.encounter.follow_up_days} days`;
    }
    if (input.encounter.disposition === 'refer' && input.encounter.referral_target) {
      disp += ` · ${input.encounter.referral_target}`;
    }
    page.drawText(disp, { x: M.l, y, size: 10, font: bold, color: EVEN_BLUE });
    y -= 14;
  }

  // Doctor signature block (bottom-fixed)
  const sigY = M.b + 70;
  page.drawLine({
    start: { x: M.l, y: sigY + 12 },
    end: { x: M.l + 200, y: sigY + 12 },
    thickness: 0.5,
    color: INK_300,
  });
  page.drawText(input.doctor.name, {
    x: M.l, y: sigY, size: 10, font: bold, color: EVEN_NAVY,
  });
  page.drawText(`MCI: ${input.doctor.mci_registration_number}`, {
    x: M.l, y: sigY - 12, size: 8, font: reg, color: INK_500,
  });

  // Footer line
  page.drawLine({
    start: { x: M.l, y: M.b - 6 },
    end: { x: W - M.r, y: M.b - 6 },
    thickness: 0.5,
    color: INK_300,
  });
  drawRightText(
    page,
    `Generated ${fmtDateTime(input.prescription.generated_at)}`,
    M.l,
    M.b - 18,
    W - M.r,
    7,
    reg,
    INK_300,
  );
  page.drawText('Even Hospital · OPD Encounter App', {
    x: M.l, y: M.b - 18, size: 7, font: reg, color: INK_300,
  });

  // Demo watermark — diagonal pink stamp
  if (input.demo) {
    drawDemoWatermark(page, bold);
  }

  return pdf.save();
}

// --- helpers ---

function drawSectionLabel(page: PDFPage, bold: PDFFont, x: number, y: number, label: string): number {
  page.drawText(label, { x, y, size: 8, font: bold, color: INK_500 });
  return y - 12;
}

function drawKv(
  page: PDFPage,
  reg: PDFFont,
  bold: PDFFont,
  x: number,
  y: number,
  key: string,
  value: string,
  valueSize: number,
  valueColor: ReturnType<typeof rgb>,
): number {
  page.drawText(key, { x, y, size: 7, font: bold, color: INK_500 });
  page.drawText(value, { x: x + 60, y, size: valueSize, font: reg, color: valueColor });
  return y - (valueSize + 4);
}

function drawRightText(
  page: PDFPage,
  text: string,
  leftEdge: number,
  y: number,
  rightEdge: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: Math.max(leftEdge, rightEdge - w), y, size, font, color });
}

/**
 * Word-wraps text to fit `maxWidth` at `size`, drawing each line in
 * sequence. Returns the final y after the last line.
 */
/**
 * Replace Unicode chars not in Helvetica's WinAnsi codepage with ASCII
 * equivalents. Helvetica only encodes Latin-1 (0x20-0xFF + a few extras);
 * em dashes, curly quotes, ellipsis, and warning glyphs all fall through.
 * Bundling a Unicode font would also work but adds ~300KB to the function
 * cold-start size, so for v1 we sanitise.
 */
function sanitiseInput(input: PrescriptionPdfInput): PrescriptionPdfInput {
  const s = (v: string | null | undefined) => (v == null ? v : sanitize(v));
  return {
    ...input,
    encounter: {
      ...input.encounter,
      chief_complaint_text: s(input.encounter.chief_complaint_text) ?? null,
      chief_complaint_chips:
        input.encounter.chief_complaint_chips?.map(sanitize) ?? null,
      exam_findings: s(input.encounter.exam_findings) ?? null,
      assessment_text: s(input.encounter.assessment_text) ?? null,
      referral_target: s(input.encounter.referral_target) ?? null,
    },
    patient: {
      ...input.patient,
      name: sanitize(input.patient.name),
      known_allergies: s(input.patient.known_allergies) ?? null,
    },
    doctor: {
      ...input.doctor,
      name: sanitize(input.doctor.name),
    },
    prescription: {
      ...input.prescription,
      lines: input.prescription.lines.map((l) => ({
        ...l,
        brand_name: sanitize(l.brand_name),
        generic_name: sanitize(l.generic_name),
        dosage_form: sanitize(l.dosage_form),
        strength: l.strength ? sanitize(l.strength) : null,
        instructions: sanitize(l.instructions ?? ''),
      })),
    },
  };
}

function sanitize(text: string): string {
  return text
    .replace(/[—–]/g, '-')        // em dash, en dash → hyphen
    .replace(/[‘’]/g, "'")        // curly single quotes
    .replace(/[“”]/g, '"')        // curly double quotes
    .replace(/…/g, '...')              // horizontal ellipsis
    .replace(/[⚠✓✗]/g, '')   // warning, check, ballot
    .replace(/[ ]/g, ' ')              // nbsp
    // Subscript/superscript digits → ASCII digits
    .replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/[²³¹]/g, (c) =>
      ({ '²': '2', '³': '3', '¹': '1' }[c] ?? c));
}

function drawWrapped(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
  maxWidth: number,
  text: string,
  size: number,
  color: ReturnType<typeof rgb>,
): number {
  text = sanitize(text);
  const words = text.split(/\s+/);
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      page.drawText(line, { x, y, size, font, color });
      y -= size + 3;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color });
    y -= size + 3;
  }
  return y;
}

function drawDemoWatermark(page: PDFPage, bold: PDFFont) {
  const W = page.getWidth();
  const H = page.getHeight();
  page.drawText('DEMO — NOT A VALID PRESCRIPTION', {
    x: W / 2 - 250,
    y: H / 2,
    size: 38,
    font: bold,
    color: DEMO_PINK,
    rotate: degrees(25),
    opacity: 0.18,
  });
}

function fmtDate(iso: string): string {
  // iso may be 'YYYY-MM-DD' or full timestamp
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
