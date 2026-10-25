import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Email out of the console (team invitations and logins), through any mail server that speaks SMTP:
 * the company's own mailbox on its mail host, Gmail with an app password, Microsoft 365. Set in
 * relay/.env.local, never in code:
 *
 *   SMTP_HOST     mail.dagher-hinnawi.com · smtp.gmail.com · smtp.office365.com
 *   SMTP_PORT     465 (SSL) or 587 (STARTTLS); 465 when unset
 *   SMTP_USER     the mailbox that sends, e.g. no-reply@dagher-hinnawi.com
 *   SMTP_PASS     its password (for Gmail: an app password)
 *   MAIL_FROM     optional, the sender people see: DH & DCO <no-reply@dagher-hinnawi.com>
 */
export const mailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const port = () => Number(process.env.SMTP_PORT || 465);
export const mailFrom = () => process.env.MAIL_FROM?.trim() || `DH & DCO <${process.env.SMTP_USER}>`;

let transport: Transporter | null = null;
function transporter() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: port(),
      secure: port() === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

export type Mail = { to: string; subject: string; html: string; text: string; replyTo?: string };

/** Sends one email. Never throws: the answer says what happened, for the screen to show. */
export async function sendMail(m: Mail): Promise<{ ok: boolean; note: string }> {
  if (!mailConfigured()) return { ok: false, note: 'Email is not set up yet (SMTP settings in relay/.env.local).' };
  try {
    await transporter().sendMail({ from: mailFrom(), to: m.to, subject: m.subject, html: m.html, text: m.text, replyTo: m.replyTo });
    return { ok: true, note: `sent to ${m.to}` };
  } catch (e) {
    transport = null; // a refused login or a dropped connection: start clean next time
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, note: /auth|535|534|login/i.test(why) ? 'The mail server refused the login (check SMTP_USER and SMTP_PASS).' : `The mail server did not take it: ${why.slice(0, 160)}` };
  }
}

/** For Setup → Channels: can we reach the mail server and sign in, without sending anything. */
export async function checkMail(): Promise<{ ok: boolean; note: string }> {
  if (!mailConfigured()) return { ok: false, note: 'Not set up' };
  try {
    await transporter().verify();
    return { ok: true, note: `Signed in to ${process.env.SMTP_HOST} as ${process.env.SMTP_USER}` };
  } catch (e) {
    transport = null;
    return { ok: false, note: e instanceof Error ? e.message.slice(0, 160) : 'Could not reach the mail server' };
  }
}
