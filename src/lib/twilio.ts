/**
 * Twilio WhatsApp dispatch.
 *
 * Two flavours: real (production) and DEMO_MODE (just logs the would-be
 * send and returns a synthetic message id). Per handoff §3, demo mode
 * is the only mode until Meta approves the two templates V drafts.
 *
 * Real-mode Twilio call would POST to
 *   https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 * with form body { From, To, ContentSid, ContentVariables, MediaUrl[] }.
 * Sprint 7 stops at the demo flag; production wires the credentials.
 */
export type TwilioRecipient = {
  role: 'patient' | 'pharmacy';
  to: string;          // E.164 phone number
  pdf_url: string;     // Vercel Blob URL of the Rx PDF
  encounter_number: string;
  prescription_number: string;
  patient_name: string;
};

export type TwilioSendResult =
  | { ok: true; sid: string; sent_at: string; mode: 'demo' | 'live' }
  | { ok: false; error: string; mode: 'demo' | 'live' };

export async function sendWhatsAppPdf(
  r: TwilioRecipient,
): Promise<TwilioSendResult> {
  const demo = process.env.DEMO_MODE !== 'false';

  if (demo) {
    // Demo: log what would have shipped, return a synthetic SID.
    // The handoff watermarks PDFs with "DEMO — NOT A VALID PRESCRIPTION"
    // so even if the PDF leaks, it's marked.
    console.log(
      `[demo dispatch] WhatsApp to ${r.role} ${r.to} — Rx ${r.prescription_number} for ${r.patient_name}, PDF ${r.pdf_url}`,
    );
    return {
      ok: true,
      sid: `SM_DEMO_${Date.now()}_${r.role}`,
      sent_at: new Date().toISOString(),
      mode: 'demo',
    };
  }

  // Real path (placeholder — not exercised in Sprint 7)
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_WHATSAPP;
  if (!sid || !token || !from) {
    return { ok: false, error: 'twilio_not_configured', mode: 'live' };
  }
  return { ok: false, error: 'live_mode_not_implemented_in_sprint_7', mode: 'live' };
}
