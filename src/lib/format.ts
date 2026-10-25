// Money is stored in minor units. KWD and JOD carry three decimals (fils), EGP two (piastres).
export const DECIMALS: Record<string, number> = { EGP: 2, KWD: 3, JOD: 3, BHD: 3, OMR: 3, USD: 2 };
export const decimalsFor = (currency: string) => DECIMALS[currency] ?? 2;

export const toMinor = (major: number | string, currency: string) => Math.round(Number(major) * 10 ** decimalsFor(currency));
export const toMajor = (minor: number, currency: string) => minor / 10 ** decimalsFor(currency);

/** "EGP 1,995" · "KWD 15.250" — whole pounds shown without decimals, fils always shown. */
export function money(minor: number | null | undefined, currency: string, opts: { compact?: boolean; sign?: boolean } = {}) {
  if (minor == null) return '—';
  const major = toMajor(minor, currency);
  const d = decimalsFor(currency);
  if (opts.compact && Math.abs(major) >= 1000) {
    const f = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(major);
    return `${currency} ${f}`;
  }
  const whole = d === 2 && Number.isInteger(major);
  const f = new Intl.NumberFormat('en', { minimumFractionDigits: whole ? 0 : d, maximumFractionDigits: whole ? 0 : d }).format(Math.abs(major));
  return `${opts.sign && major > 0 ? '+' : major < 0 ? '−' : ''}${currency} ${f}`;
}

/** Rough rates to show one combined figure on the command centre. Display only; never used for money movement. */
export const TO_EGP: Record<string, number> = { EGP: 1, KWD: 158, JOD: 68.5 };
export const inEgp = (minor: number, currency: string) => toMajor(minor, currency) * (TO_EGP[currency] ?? 1);

export const num = (n: number) => new Intl.NumberFormat('en').format(n);
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

const TZ = 'Africa/Cairo';

export function when(d: Date | string | null | undefined, tz = TZ) {
  if (!d) return '—';
  const date = new Date(d);
  const now = new Date();
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date) === new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(date);
  if (sameDay) return `Today ${time}`;
  const y = new Date(now.getTime() - 86400000);
  if (new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date) === new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(y)) return `Yesterday ${time}`;
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(date)} ${time}`;
}

export function ago(d: Date | string | null | undefined, now = new Date()) {
  if (!d) return '—';
  const s = Math.round((now.getTime() - new Date(d).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

export function dayKey(d: Date, tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

export function greeting(now = new Date(), tz = TZ) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(now));
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/** An EGP-equivalent amount (minor units) shown in another currency: a Kuwait-only view reads KWD. */
export function moneyIn(egpMinor: number | null | undefined, currency: string, opts: { compact?: boolean; sign?: boolean } = {}) {
  if (egpMinor == null) return '—';
  if (currency === 'EGP') return money(egpMinor, 'EGP', opts);
  const major = egpMinor / 100 / (TO_EGP[currency] ?? 1);
  return money(Math.round(major * 10 ** decimalsFor(currency)), currency, opts);
}
