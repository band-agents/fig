import { createHmac, timingSafeEqual } from 'node:crypto';
import { CHANNEL } from './channels';

/* The signed link to one order's tracking page, as it goes in the shipping email. No database here,
   so the write-back and the tests can use it without the server. */

const secret = () => process.env.RELAY_TRACK_SECRET || process.env.RELAY_CRON_SECRET || '';

/** A short signature for one order's tracking link. Empty when the server has no secret. */
export function trackToken(orderId: string): string {
  const s = secret();
  if (!s) return '';
  return createHmac('sha256', s).update(`track:${orderId}`).digest('base64url').slice(0, 24);
}

export function trackTokenOk(orderId: string, token: string): boolean {
  const want = trackToken(orderId);
  if (!want || !token) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(String(token).trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where a storefront's own tracking page lives: RELAY_TRACK_PAGE_<PREFIX>, else the console's /track. */
function pageFor(channelId: string): string | null {
  const c = CHANNEL[channelId];
  const own = c ? process.env[`RELAY_TRACK_PAGE_${c.envPrefix}`]?.trim() : '';
  if (own) return own;
  const base = process.env.RELAY_PUBLIC_URL?.replace(/\/$/, '');
  return base ? `${base}/track?store=${encodeURIComponent(channelId)}` : null;
}

/** The link that goes in the shipping email. Null when the server cannot sign one. */
export function trackLink(o: { id: string; channelId: string }): string | null {
  const t = trackToken(o.id);
  const page = pageFor(o.channelId);
  if (!t || !page) return null;
  const u = new URL(page);
  u.searchParams.set('o', o.id);
  u.searchParams.set('t', t);
  return u.toString();
}

