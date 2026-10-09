// Small pure helpers the platform mappers share. No env, no network: safe to unit-test.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { toMinor } from '../format';
import type { Address } from '../db/schema';

/** A trimmed string, or null for anything empty. */
export const str = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

/** A number from a number, a numeric string, or Medusa's serialised BigNumber; NaN when unreadable. */
export function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() ? Number(v) : NaN;
  if (v && typeof v === 'object') {
    const o = v as { numeric?: unknown; value?: unknown };
    if (typeof o.numeric === 'number') return o.numeric;
    if (o.value !== undefined) return num(o.value);
  }
  return NaN;
}

/** Major units (any shape) to integer minor units; unreadable amounts become 0. */
export const minor = (major: unknown, currency: string) => {
  const n = num(major);
  return Number.isFinite(n) ? toMinor(n, currency) : 0;
};

/** A Date from an ISO string or epoch ms; null when absent or invalid. */
export function date(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  if (typeof v === 'string' && !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Option names that mean "size" in the catalogues FIG sells from. */
export const SIZE_NAME = /size|talla|taille|مقاس|المقاس/i;

export const fullName = (...parts: unknown[]) =>
  parts
    .map(str)
    .filter((p): p is string => Boolean(p && p !== '-'))
    .join(' ') || null;

/** An Address with only the keys that carry something; null without a first line or a city. */
export function address(a: {
  name?: unknown;
  line1?: unknown;
  line2?: unknown;
  area?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
  phone?: unknown;
}, fallbackCountry: string): Address | null {
  const line1 = str(a.line1);
  const city = str(a.city);
  if (!line1 && !city) return null;
  const out: Address = { line1: line1 ?? '', city: city ?? str(a.region) ?? '', country: (str(a.country) ?? fallbackCountry).toUpperCase() };
  const name = str(a.name);
  const line2 = str(a.line2);
  const area = str(a.area);
  const region = str(a.region);
  const phone = str(a.phone);
  if (name) out.name = name;
  if (line2) out.line2 = line2;
  if (area) out.area = area;
  if (region) out.region = region;
  if (phone) out.phone = phone;
  return out;
}

/** base64(HMAC-SHA256(rawBody, secret)) against a header, in constant time. Shopify and Woo both sign this way. */
export function hmacBase64Matches(rawBody: string | Buffer, header: string | null | undefined, secret: string | null | undefined) {
  if (!secret || !header) return false;
  const digest = createHmac('sha256', secret).update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.trim(), 'base64');
  } catch {
    return false;
  }
  return given.length === digest.length && timingSafeEqual(given, digest);
}
