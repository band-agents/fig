import 'server-only';
import type { Mail } from './mail';

/**
 * The team's login emails: a join link (they set their own password) or a temporary password (they
 * choose their own at first sign-in). Table layout and inline styles, so Gmail, Outlook and phone mail
 * apps draw it the same; a plain-text copy rides along.
 */

const site = () => (process.env.RELAY_PUBLIC_URL || 'http://localhost:3400').replace(/\/$/, '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function frame(o: { preview: string; title: string; lines: string[]; facts: [string, string][]; button: { label: string; href: string }; foot: string }) {
  const base = site();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#ebe9e4;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1b19">
<span style="display:none;max-height:0;overflow:hidden">${esc(o.preview)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebe9e4;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:32px">
<tr><td>
  <img src="${base}/brand/dh-full.png" alt="D&amp;H" height="22" style="height:22px;margin-right:14px;vertical-align:middle">
  <img src="${base}/brand/dco-full.png" alt="D&amp;Co" height="22" style="height:22px;vertical-align:middle">
</td></tr>
<tr><td style="padding-top:26px;font-size:21px;font-weight:600;letter-spacing:-0.3px">${esc(o.title)}</td></tr>
${o.lines.map((l) => `<tr><td style="padding-top:10px;font-size:14px;line-height:1.55;color:#4a4843">${esc(l)}</td></tr>`).join('')}
<tr><td style="padding-top:18px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ef;border-radius:14px">
  ${o.facts.map(([k, v]) => `<tr><td style="padding:10px 14px 0;font-size:12px;color:#8a877f">${esc(k)}</td></tr><tr><td style="padding:2px 14px 10px;font-size:15px;font-weight:600;font-family:${/password/i.test(k) ? 'Consolas,Menlo,monospace' : 'inherit'}">${esc(v)}</td></tr>`).join('')}
  </table>
</td></tr>
<tr><td style="padding-top:22px"><a href="${esc(o.button.href)}" style="display:inline-block;background:#151515;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:12px">${esc(o.button.label)}</a></td></tr>
<tr><td style="padding-top:22px;font-size:12px;line-height:1.5;color:#8a877f">${esc(o.foot)}</td></tr>
</table>
<div style="padding-top:14px;font-size:11px;color:#8a877f">DH &amp; DCO operations console</div>
</td></tr></table></body></html>`;
}

export function joinEmail(o: { to: string; name: string; by: string; role: string; joinPath: string }): Mail {
  const link = `${site()}${o.joinPath}`;
  const first = o.name.split(' ')[0] || o.name;
  return {
    to: o.to,
    subject: 'Your DH & DCO console invitation',
    html: frame({
      preview: `${o.by} invited you to the DH & DCO console.`,
      title: `Welcome, ${first}`,
      lines: [`${o.by} invited you to the DH & DCO operations console as ${o.role}.`, 'Open the link below and choose your password to start.'],
      facts: [['Email', o.to]],
      button: { label: 'Choose my password', href: link },
      foot: `The link works once and for 7 days. If the button does not open, paste this into your browser: ${link}`,
    }),
    text: `Welcome, ${first}\n\n${o.by} invited you to the DH & DCO operations console as ${o.role}.\nOpen this link and choose your password to start (it works once, for 7 days):\n${link}\n\nEmail: ${o.to}`,
  };
}

export function tempEmail(o: { to: string; name: string; by: string; role: string; password: string; reset?: boolean }): Mail {
  const link = `${site()}/login`;
  const first = o.name.split(' ')[0] || o.name;
  return {
    to: o.to,
    subject: o.reset ? 'Your new DH & DCO console password' : 'Your DH & DCO console login',
    html: frame({
      preview: o.reset ? 'A new temporary password for the DH & DCO console.' : `${o.by} gave you a login to the DH & DCO console.`,
      title: o.reset ? `A new password, ${first}` : `Welcome, ${first}`,
      lines: o.reset ? [`${o.by} set a new temporary password for you.`, 'Sign in with it, then choose your own.'] : [`${o.by} gave you a login to the DH & DCO operations console as ${o.role}.`, 'Sign in with the temporary password below; the console then asks you to choose your own.'],
      facts: [
        ['Email', o.to],
        ['Temporary password', o.password],
      ],
      button: { label: 'Sign in', href: link },
      foot: `It works until you choose your own password. Keep this email to yourself. Sign in at ${link}`,
    }),
    text: `${o.reset ? `A new password, ${first}` : `Welcome, ${first}`}\n\n${o.reset ? `${o.by} set a new temporary password for you.` : `${o.by} gave you a login to the DH & DCO operations console as ${o.role}.`}\nSign in at ${link}\nEmail: ${o.to}\nTemporary password: ${o.password}\n\nThe console asks you to choose your own password the first time you sign in.`,
  };
}
