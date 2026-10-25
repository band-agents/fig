// Demand and replenishment arithmetic. Every number the planner shows is one of these, so each is
// small, named, and tested. Pure.

export type WeekObs = { week: string; units: number; stockoutDays?: number };

/** What the shelf would have sold had it been full: a week with 3 of 7 days sold out sold 4 days' worth. */
export function unconstrained(o: WeekObs): number | null {
  const out = Math.min(7, Math.max(0, o.stockoutDays ?? 0));
  if (out >= 7) return null; // nothing to learn from a week with nothing to sell
  return (o.units * 7) / (7 - out);
}

/**
 * The underlying weekly rate, with the season taken out. Recent weeks weigh more; weeks with
 * nothing on the shelf are skipped rather than read as no demand.
 */
export function baseRate(obs: WeekObs[], si: (week: string) => number, weeks = 8): { rate: number; sigma: number; n: number } {
  const usable = obs
    .map((o) => ({ o, d: unconstrained(o) }))
    .filter((x): x is { o: WeekObs; d: number } => x.d != null)
    .slice(-weeks);
  if (!usable.length) return { rate: 0, sigma: 0, n: 0 };
  let sw = 0;
  let s = 0;
  const vals: number[] = [];
  usable.forEach(({ o, d }, i) => {
    const idx = Math.max(0.15, si(o.week));
    const v = d / idx;
    const w = 1 + i * 0.15;
    vals.push(v);
    s += v * w;
    sw += w;
  });
  const rate = s / sw;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.length > 1 ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1) : rate;
  // never trust a spread tighter than counting noise: a style selling 4 a week can sell 1 or 7
  const sigma = Math.max(Math.sqrt(variance), Math.sqrt(Math.max(rate, 0.25)));
  return { rate, sigma, n: usable.length };
}

/** Is it picking up or tailing off? Last 6 weeks against the 12 before, season removed, kept modest. */
export function trendFactor(obs: WeekObs[], si: (week: string) => number): number {
  const d = obs
    .map((o) => {
      const u = unconstrained(o);
      return u == null ? null : u / Math.max(0.15, si(o.week));
    })
    .filter((x): x is number => x != null);
  if (d.length < 14) return 1;
  const recent = d.slice(-6);
  const before = d.slice(-18, -6);
  const a = recent.reduce((x, y) => x + y, 0) / recent.length;
  const b = before.reduce((x, y) => x + y, 0) / before.length;
  if (b < 0.5) return 1;
  return Math.min(1.3, Math.max(0.75, Math.sqrt(a / b)));
}

/** Units expected each week ahead. */
export function forecastWeeks(rate: number, trend: number, weeks: string[], si: (week: string) => number, lift: (week: string) => number = () => 1): number[] {
  return weeks.map((w) => Math.max(0, rate * trend * si(w) * lift(w)));
}

/** Service level by how much a style matters: A styles almost never run out, C styles may. */
export const Z: Record<'A' | 'B' | 'C', number> = { A: 1.96, B: 1.65, C: 1.28 };

export const safetyStock = (sigmaWeekly: number, weeks: number, z: number) => z * sigmaWeekly * Math.sqrt(Math.max(0, weeks));

export type Projection = { week: string; start: number; arriving: number; demand: number; end: number; short: number };

/**
 * Walks stock forward a week at a time: what is there, what lands, what sells, what can't be sold
 * because the shelf is empty.
 */
export function project(onHand: number, weeks: string[], demand: number[], arrivals: Record<string, number> = {}): Projection[] {
  let stock = onHand;
  return weeks.map((week, i) => {
    const arriving = arrivals[week] ?? 0;
    const start = stock + arriving;
    const sold = Math.min(start, demand[i]);
    const end = start - sold;
    stock = end;
    return { week, start, arriving, demand: demand[i], end, short: demand[i] - sold };
  });
}

/** The first week the shelf goes empty, or null if it lasts the horizon. */
export function stockoutWeek(p: Projection[]): string | null {
  return p.find((x) => x.short > 0.5)?.week ?? null;
}

/** Weeks the stock lasts at the forecast rate. Infinity when nothing is expected to sell. */
export function weeksOfCover(onHand: number, demand: number[]): number {
  if (onHand <= 0) return 0;
  let left = onHand;
  for (let i = 0; i < demand.length; i++) {
    if (demand[i] >= left) return i + left / Math.max(demand[i], 1e-9);
    left -= demand[i];
  }
  const tail = demand.slice(-4).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(4, demand.length));
  return tail > 0.01 ? demand.length + left / tail : Infinity;
}

/**
 * How many to order: enough to cover the lead time and the review period at forecast, plus safety
 * stock, less what is on hand and already on order. Rounded up to the case pack, never under the
 * supplier's minimum. Zero when the position already covers it.
 */
export function reorderQty(i: { position: number; demandCover: number; safety: number; moq: number; pack: number }): number {
  const need = i.demandCover + i.safety - i.position;
  if (need < 0.5) return 0;
  const pack = Math.max(1, i.pack);
  const qty = Math.max(Math.ceil(need), i.moq);
  return Math.ceil(qty / pack) * pack;
}

/**
 * Splits a quantity across sizes by the size curve, largest remainder first, so the split always
 * adds up and a size with any demand gets at least one when there is room.
 */
export function splitSizes(qty: number, sizes: string[], mix: Record<string, number>): Record<string, number> {
  if (!sizes.length) return {};
  const total = sizes.reduce((s, z) => s + (mix[z] ?? 0), 0);
  const shares = sizes.map((z) => (total > 0 ? (mix[z] ?? 0) / total : 1 / sizes.length));
  const raw = shares.map((s) => s * qty);
  const out = raw.map(Math.floor);
  let left = qty - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return Object.fromEntries(sizes.map((z, i) => [z, out[i]]));
}

/** Sold ÷ (sold + still here): how much of what was available has gone. */
export const sellThrough = (sold: number, onHand: number) => (sold + onHand > 0 ? sold / (sold + onHand) : 0);
