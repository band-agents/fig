// What can come back, and how. Taken from each store's published policy; Rules can't loosen these,
// but a manager (returns level 3) can override one case with a note, and the override is on the timeline.
import type { Country } from '../channels';

export type ReturnPolicy = { windowDays: number; nonReturnable: RegExp; storeOnly: boolean; label: string };

const INTIMATES = /\b(brief|briefs|panty|panties|knicker|knickers|thong|brazilian|hipster|boxer brief|bikini bottom|swim brief|earring|earrings|perfume|fragrance|cosmetic|lipstick|mascara|socks?)\b/i;
const BRAS_TOO = /\b(bra|bras|bralette|brief|briefs|panty|panties|knicker|knickers|thong|brazilian|hipster|bikini bottom|earring|earrings|perfume|fragrance|cosmetic)\b/i;

export const POLICIES: Record<string, ReturnPolicy> = {
  'FIG:EG': { windowDays: 14, nonReturnable: INTIMATES, storeOnly: false, label: '14 days from delivery; underwear, swim bottoms, earrings and beauty are final sale' },
  "Women'secret:EG": { windowDays: 14, nonReturnable: INTIMATES, storeOnly: false, label: '14 days from delivery; underwear and swim bottoms are final sale' },
  'Labesny:KW': { windowDays: 14, nonReturnable: BRAS_TOO, storeOnly: true, label: '14 days; no returns on bras and panties; returns at brand stores in Kuwait malls' },
  "Women'secret:KW": { windowDays: 14, nonReturnable: BRAS_TOO, storeOnly: true, label: '14 days; no returns on bras and panties; returns at brand stores' },
};

export function policyFor(brand: string, country: Country | string): ReturnPolicy {
  return POLICIES[`${brand}:${country}`] ?? POLICIES['FIG:EG'];
}

export function itemReturnable(policy: ReturnPolicy, item: { title: string; category?: string | null }) {
  return !policy.nonReturnable.test(`${item.title} ${item.category ?? ''}`);
}

export function eligibility(policy: ReturnPolicy, deliveredAt: Date | null, now = new Date()) {
  if (!deliveredAt) return { ok: false, daysLeft: null as number | null, why: 'Not delivered yet' };
  const daysUsed = (now.getTime() - deliveredAt.getTime()) / 86400000;
  const daysLeft = Math.ceil(policy.windowDays - daysUsed);
  if (daysLeft < 0) return { ok: false, daysLeft, why: `Return window closed ${-daysLeft}d ago` };
  return { ok: true, daysLeft, why: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to return` };
}
