// Website merchandising: which slow pieces to put in front of which shoppers, and what that is
// likely to do. Benchmarks are deliberately conservative; the live placements replace them with
// their own numbers as they run. Pure.

import { COMPLEMENTS, type Category } from './categories';

export type MerchKind = 'cross_sell' | 'upsell' | 'popup' | 'bundle';

export const MERCH_LABEL: Record<MerchKind, string> = {
  cross_sell: 'Complete the look',
  upsell: 'Upgrade',
  popup: 'Pop-up',
  bundle: 'Bundle',
};

export const MERCH_WHERE: Record<MerchKind, string> = {
  cross_sell: 'Product page, under the add-to-bag button',
  upsell: 'Product page and cart, as a step up',
  popup: 'Pop-up for returning visitors, once a session',
  bundle: 'Product page, as a set with its pair',
};

export type Piece = {
  id: string;
  category: Category;
  price: number;
  margin: number; // 0–1 at full price
  rate: number; // units a week
  onHand: number;
  cover: number; // weeks
  channels: string[];
};

/** Product-page views per order, and how a widget converts: a click, an add, a sale. */
export const BENCH = { viewsPerOrder: 34, ctr: 0.045, addRate: 0.24, buyRate: 0.48, popupSeen: 0.3, popupCtr: 0.035, popupBuy: 0.07, sessionsPerOrder: 42 };

/** Extra units a week a cross-sell on these anchor pages should sell. */
export function crossSellUplift(anchorRates: number[]): number {
  const views = anchorRates.reduce((s, r) => s + r, 0) * BENCH.viewsPerOrder;
  return views * BENCH.ctr * BENCH.addRate * BENCH.buyRate;
}

/** Extra units a week from a pop-up on a site taking `ordersPerWeek` orders. */
export function popupUplift(ordersPerWeek: number): number {
  return ordersPerWeek * BENCH.sessionsPerOrder * BENCH.popupSeen * BENCH.popupCtr * BENCH.popupBuy;
}

/**
 * The best pages to show a slow piece on: fast sellers it is worn with, sold on the same websites,
 * where it is an easy add-on rather than a second big purchase.
 */
export function anchorsFor(item: Piece, candidates: Piece[], max = 4): Piece[] {
  const fits = COMPLEMENTS[item.category] ?? [];
  return candidates
    .filter((a) => a.id !== item.id && fits.includes(a.category) && a.channels.some((c) => item.channels.includes(c)))
    .filter((a) => item.price <= a.price * 1.25 && item.price >= a.price * 0.12)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, max);
}

/**
 * A step up: same category, a bit dearer, overstocked, and with margin to spare. Shown on the
 * pages of the cheaper style that sells.
 */
export function upsellFor(anchor: Piece, candidates: Piece[]): Piece | null {
  return (
    candidates
      .filter((c) => c.id !== anchor.id && c.category === anchor.category && c.price >= anchor.price * 1.15 && c.price <= anchor.price * 1.9)
      .filter((c) => c.cover > 14 && c.margin >= 0.5 && c.channels.some((x) => anchor.channels.includes(x)))
      .sort((a, b) => b.cover - a.cover)[0] ?? null
  );
}

/** Should this piece be pushed at all: plenty left, slow to go, and not a loss to sell. */
export const worthPushing = (p: Piece) => p.onHand >= 12 && p.cover > 16 && p.margin > 0.35;
