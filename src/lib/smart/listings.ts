import 'server-only';
import { inArray } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { channelLabel } from '../channels';
import type { Principal } from '../domain/perms';
import type { Reason } from '../domain/web-gap';
import { remember } from '../remember';
import { egpMinor } from '../stock/core';
import { webStylesFor } from '../web-items';
import { moneyLeaks } from './leaks';

/**
 * Listing score (Dan, 28 Oct): every style the websites hold with pieces to sell, scored out of 100 on
 * what a shopper needs to buy it, and ranked by the online sales its gaps put at stake, so the team
 * fixes the listings that matter first. Read from the website comparison (Website vs Lucida):
 *
 *   photo 35 · description 20 · category 15 · price 10 · every size has a barcode 10 · live 10
 *
 * At stake a week: its pieces × price × the pace stock sells online in its market × the share of the
 * score it is missing. Amounts are EGP-equivalent minor units.
 */

export const PARTS: { key: string; label: string; points: number }[] = [
  { key: 'photo', label: 'Photo', points: 35 },
  { key: 'description', label: 'Description', points: 20 },
  { key: 'category', label: 'Category', points: 15 },
  { key: 'price', label: 'Price', points: 10 },
  { key: 'barcode', label: 'Barcodes', points: 10 },
  { key: 'live', label: 'Live', points: 10 },
];

export type Listing = { key: string; title: string; brand: string; store: string; storeId: string; handle: string | null; score: number; grade: 'A' | 'B' | 'C' | 'D'; missing: string[]; units: number; stake: number; image: string | null };

const gradeOf = (s: number): Listing['grade'] => (s >= 90 ? 'A' : s >= 70 ? 'B' : s >= 50 ? 'C' : 'D');

export function listingScores(p: Principal) {
  return remember(`listings:${p.channels.join(',')}:${(p.brands ?? []).join(',')}`, 5 * 60_000, () => compute(p));
}

async function compute(p: Principal) {
  const [styles, leaks] = await Promise.all([webStylesFor(p), moneyLeaks(p)]);
  const out: Listing[] = [];
  for (const st of styles) {
    const units = Math.max(st.webQty, st.lucidaQty ?? 0);
    if (units <= 0 || st.status === 'absent') continue;
    const has = (r: Reason) => st.reasons.includes(r);
    const ok: Record<string, boolean> = { photo: st.hasPhoto, description: !has('no_description'), category: !has('no_category'), price: !has('no_price'), barcode: !has('no_barcode'), live: st.status === 'active' };
    const score = PARTS.reduce((a, x) => a + (ok[x.key] ? x.points : 0), 0);
    const price = st.price ?? st.lucidaPrice ?? 0;
    const potential = egpMinor(units * price * (leaks.pace[st.market] ?? 0), st.currency);
    out.push({
      key: `${st.channelId}:${st.key}`,
      title: st.title,
      brand: st.brand ?? 'Brand unknown',
      store: channelLabel(st.channelId),
      storeId: st.channelId,
      handle: st.handle,
      score,
      grade: gradeOf(score),
      missing: PARTS.filter((x) => !ok[x.key]).map((x) => x.label),
      units,
      stake: Math.round((potential * (100 - score)) / 100),
      image: null,
    });
  }
  out.sort((a, b) => b.stake - a.stake || a.score - b.score || b.units - a.units);

  // photos for the ones on screen, from the console's catalogue
  const shown = out.slice(0, 80).filter((x) => x.handle);
  if (shown.length) {
    const db = await getDb();
    const pics = await db.select({ handle: schema.products.handle, image: schema.products.image }).from(schema.products).where(inArray(schema.products.handle, shown.map((x) => x.handle!)));
    const img = new Map(pics.filter((x) => x.image).map((x) => [x.handle, x.image]));
    for (const x of shown) x.image = img.get(x.handle) ?? null;
  }

  const brands = new Map<string, { brand: string; styles: number; score: number; weak: number; stake: number }>();
  for (const x of out) {
    const b = brands.get(x.brand) ?? { brand: x.brand, styles: 0, score: 0, weak: 0, stake: 0 };
    b.styles += 1;
    b.score += x.score;
    if (x.score < 70) b.weak += 1;
    b.stake += x.stake;
    brands.set(x.brand, b);
  }
  const grades = { A: 0, B: 0, C: 0, D: 0 } as Record<Listing['grade'], number>;
  for (const x of out) grades[x.grade] += 1;
  const missingCount = Object.fromEntries(PARTS.map((x) => [x.label, out.filter((l) => l.missing.includes(x.label)).length]));
  return {
    listings: out,
    average: out.length ? Math.round(out.reduce((a, x) => a + x.score, 0) / out.length) : null,
    grades,
    missingCount,
    stake: out.reduce((a, x) => a + x.stake, 0),
    weak: out.filter((x) => x.score < 70).length,
    brands: [...brands.values()].map((b) => ({ ...b, score: Math.round(b.score / b.styles) })).sort((a, b) => b.stake - a.stake),
  };
}

export type ListingScores = Awaited<ReturnType<typeof listingScores>>;
