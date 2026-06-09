/**
 * Resend wrapper for magic-link emails.
 *
 * M0.4 uses `onboarding@resend.dev` as the sender — Resend's no-DNS
 * sender that only delivers to the email associated with the Resend
 * account (vinay.bhardwaj@even.in). Sufficient for the dogfood pilot's
 * first login flow. Pre-pilot: complete DNS verification of
 * notifications.even.in in the Resend dashboard and flip
 * RESEND_FROM_EMAIL on Vercel to noreply@notifications.even.in.
 */
import { Resend } from 'resend';

function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  return new Resend(key);
}

export async function sendMagicLinkEmail(opts: {
  to: string;
  link: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  try {
    const res = await resend().emails.send({
      from: `Even OPD <${from}>`,
      to: opts.to,
      subject: 'Your sign-in link for OPD Encounter App',
      html: buildHtml(opts.link),
      text: buildText(opts.link),
    });
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, id: res.data?.id ?? '' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function buildHtml(link: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#FCFCFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#002054;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FCFCFC;padding:48px 0;">
      <tr><td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="480" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #D6D9E0;">
          <tr><td>
            <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#0044CC;margin-bottom:8px;">Even Hospital</div>
            <div style="font-size:22px;font-weight:600;color:#002054;margin-bottom:12px;">Your sign-in link</div>
            <p style="font-size:15px;line-height:1.5;color:#454B58;margin:0 0 24px 0;">
              Click the button below to sign in to the OPD Encounter App. This link expires in 15 minutes and can only be used once.
            </p>
            <a href="${link}" style="display:inline-block;background:#0055FF;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;">Sign in</a>
            <p style="font-size:12px;line-height:1.5;color:#8C93A3;margin:24px 0 0 0;word-break:break-all;">
              Or paste this link into your browser:<br>${link}
            </p>
            <p style="font-size:11px;line-height:1.5;color:#B5BAC5;margin:24px 0 0 0;">
              If you didn't request this, you can safely ignore it.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildText(link: string): string {
  return `Even OPD — sign-in link

Click here to sign in: ${link}

This link expires in 15 minutes and can only be used once.
If you didn't request this, you can safely ignore it.`;
}
