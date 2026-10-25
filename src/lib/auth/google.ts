import 'server-only';
import { randomBytes } from 'node:crypto';

/**
 * "Continue with Google" for staff. Standard OAuth 2.0 authorisation-code flow:
 *   /api/auth/google            → Google's account chooser (state cookie against CSRF)
 *   /api/auth/google/callback   → code exchanged server-side, the verified email read from Google,
 *                                 matched to an existing, active teammate, a console session issued
 * There is no self-signup: an email Google vouches for still needs an account an admin created
 * (Team & access, or an invitation).
 *
 * Modes, from the environment:
 *   live — GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set: a Google Cloud OAuth "Web application"
 *          client whose authorised redirect URI is <RELAY_PUBLIC_URL>/api/auth/google/callback;
 *   mock — GOOGLE_MOCK=1 outside production: a local page stands in for Google, for testing;
 *   off  — neither: the button is hidden and password sign-in remains.
 */
export type GoogleMode = 'live' | 'mock' | 'off';

export const STATE_COOKIE = 'relay_google_state';
export const NEXT_COOKIE = 'relay_google_next';

const mockAllowed = () => process.env.GOOGLE_MOCK === '1' && process.env.NODE_ENV !== 'production';

export function googleMode(): GoogleMode {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) return 'live';
  if (mockAllowed()) return 'mock';
  return 'off';
}

/** Where the console is reached: the configured public address, else the address this request came in on. */
export const siteUrl = (reqUrl: string) => process.env.RELAY_PUBLIC_URL?.replace(/\/$/, '') || new URL(reqUrl).origin;
export const callbackUrl = (reqUrl: string) => `${siteUrl(reqUrl)}/api/auth/google/callback`;
export const newState = () => randomBytes(24).toString('base64url');

/** Only a path on this site, so a crafted link cannot bounce a fresh session to another address. */
export const safeNext = (next: string | null | undefined) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

export function authUrl(reqUrl: string, state: string): string {
  if (googleMode() === 'mock') return `${siteUrl(reqUrl)}/api/auth/google/mock?state=${state}`;
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl(reqUrl),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** The Google account behind an authorisation code: its email, only when Google has verified it. */
export async function emailFromCode(reqUrl: string, code: string): Promise<string | null> {
  // Google's own codes never start with "mock:"; the stand-in page hands these out in development only.
  if (code.startsWith('mock:')) return mockAllowed() ? code.slice(5).toLowerCase() : null;
  if (googleMode() !== 'live') return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackUrl(reqUrl),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return null;
  const { access_token } = (await res.json()) as { access_token?: string };
  if (!access_token) return null;
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
  if (!info.ok) return null;
  const { email, email_verified } = (await info.json()) as { email?: string; email_verified?: boolean };
  return email && email_verified ? email.toLowerCase() : null;
}

/** What the sign-in page says when Google worked but the console said no. */
export const GOOGLE_ERRORS: Record<string, string> = {
  google_state: 'That Google sign-in took too long or was opened twice. Try again.',
  google_failed: 'Google did not confirm the account. Try again, or sign in with your password.',
  google_no_account: 'That Google account has no console access yet. Ask an admin to add your email under Team & access.',
  google_inactive: 'That account is switched off. Ask an admin to turn it back on.',
};
