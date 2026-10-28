import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { CHANNEL } from '../channels';
import type { Principal } from '../domain/perms';
import { foldBrand, scope } from '../queries';
import { remember } from '../remember';
import { egpMinor } from '../stock/core';
import { marketsFor } from '../stock/views/common';
import { getTargets, monthKey } from '../targets';
import { moneyLeaks } from './leaks';

/**
 * Targets and pacing (Dan, 28 Oct): each brand's month against its target (Imports → brand targets),
 * where it will land at the pace it is selling, what it needs a day to make it, and why it is ahead
 * or behind. Sales are the websites' orders (the console's own, by day, Cairo time), each line after
 * its share of the order's discount, refused and cancelled orders left out; shop sales join when
 * Lucida's do.
 *
 * - Where it lands: what is sold so far, plus the days left at a pace that is half this month's own
 *   and half the last four weeks', so one big day does not decide the month.
 * - Why: the same days last month, split into how many orders and how big they were, plus what
 *   sold-out sizes cost the brand a week (smart/leaks.ts).
 * Amounts are EGP-equivalent minor units; a market's targets are kept in its own money.
 */

export type BrandPace = {
  key: string;
  label: string;
  market: string;
  target: number | null;
  targetUnits: number | null;
  mtd: number;
  units: number;
  orders: number;
  projection: number;
  pace: number | null; // projection ÷ target
  status: 'ahead' | 'on' | 'close' | 'behind' | 'none';
  needPerDay: number | null;
  ratePerDay: number;
  prev: number;
  prevOrders: number;
  why: string;
  soldOut: number; // a week, from sold-out sizes
  daily: number[];
};

const DAY = 86400000;
const statusOf = (pace: number | null): BrandPace['status'] => (pace == null ? 'none' : pace >= 1.05 ? 'ahead' : pace >= 0.97 ? 'on' : pace >= 0.85 ? 'close' : 'behind');

export function pacing(p: Principal, month = monthKey()) {
  return remember(`pacing:${month}:${p.channels.join(',')}:${(p.brands ?? []).join(',')}`, 5 * 60_000, () => compute(p, month));
}

async function compute(p: Principal, month: string) {
  const db = await getDb();
  const [y, mo] = month.split('-').map(Number);
  const start = Date.UTC(y, mo - 1, 1);
  const end = Date.UTC(y, mo, 1);
  const prevStart = Date.UTC(y, mo - 2, 1);
  const daysIn = Math.round((end - start) / DAY);
  const now = Math.min(Date.now(), end);
  const elapsed = Math.max(0, Math.min(daysIn, (now - start) / DAY));
  const remaining = Math.max(0, daysIn - elapsed);
  const s = scope(p, sql`o.channel_id`, sql`o.id`);
  const from = new Date(Math.min(prevStart, now - 28 * DAY));

  // each line after its share of the order's discount
  const rows = await db.execute<{ order_id: string; day: string; at: string; channel_id: string; brand: string | null; qty: number; value: string; currency: string }>(sql`
    select o.id as order_id, to_char((o.placed_at at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD') as day, o.placed_at::text as at, o.channel_id, oi.brand, oi.quantity as qty,
      (oi.unit_price * oi.quantity * case when o.subtotal > 0 then greatest(0, 1 - o.discount::numeric / o.subtotal) else 1 end)::text as value, o.currency
    from order_items oi join orders o on o.id = oi.order_id
    where ${s} and o.source <> 'demo' and o.stage not in ('cancelled', 'rto', 'rto_closed') and o.placed_at >= ${from} and o.placed_at < ${new Date(end)}`);

  const markets = marketsFor(p);
  const targets = new Map((await Promise.all(markets.map(async (m) => [m, await getTargets(m)] as const))).map(([m, t]) => [m, t]));
  const leaks = await moneyLeaks(p);
  const soldOut = leaks.leaks.find((l) => l.key === 'sizes')?.byBrand ?? {};

  type Acc = { label: Map<string, number>; market: string; mtd: number; units: number; orders: Set<string>; last28: number; prev: number; prevOrders: Set<string>; daily: number[] };
  const acc = new Map<string, Acc>();
  const keyOf = (brand: string, market: string) => `${market}:${foldBrand(brand)}`;
  const get = (brand: string, market: string) => {
    const k = keyOf(brand, market);
    let a = acc.get(k);
    if (!a) {
      a = { label: new Map(), market, mtd: 0, units: 0, orders: new Set(), last28: 0, prev: 0, prevOrders: new Set(), daily: Array(daysIn).fill(0) };
      acc.set(k, a);
    }
    a.label.set(brand, (a.label.get(brand) ?? 0) + 1);
    return a;
  };
  const prevCut = prevStart + elapsed * DAY;
  for (const r of rows.rows) {
    const market = CHANNEL[r.channel_id]?.country ?? 'EG';
    if (!markets.includes(market as 'EG' | 'KW')) continue;
    const brand = r.brand?.trim() || 'Unknown brand';
    const a = get(brand, market);
    const v = egpMinor(Number(r.value), r.currency);
    const t = Date.parse(r.at);
    const dayT = Date.parse(`${r.day}T00:00:00Z`);
    if (dayT >= start && dayT < end) {
      a.mtd += v;
      a.units += r.qty;
      a.orders.add(r.order_id);
      const i = Math.floor((dayT - start) / DAY);
      if (i >= 0 && i < daysIn) a.daily[i] += v;
    }
    if (t >= now - 28 * DAY && t < now) a.last28 += v;
    if (dayT >= prevStart && dayT < prevCut) {
      a.prev += v;
      a.prevOrders.add(r.order_id);
    }
  }
  // every brand with a target this month is listed, sold or not
  for (const m of markets)
    for (const [brand, months] of Object.entries(targets.get(m) ?? {}))
      if (months[month]) get(brand, m);

  const own = (m: string) => (m === 'KW' ? 'KWD' : 'EGP');
  const brands: BrandPace[] = [...acc.entries()].map(([k, a]) => {
    const label = [...a.label.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const t = Object.entries(targets.get(a.market as 'EG' | 'KW') ?? {}).find(([b]) => foldBrand(b) === foldBrand(label))?.[1]?.[month] ?? null;
    const target = t?.value != null ? egpMinor(t.value, own(a.market)) : null;
    const own28 = a.last28 / 28;
    const ownMonth = elapsed > 0 ? a.mtd / elapsed : 0;
    const ratePerDay = elapsed >= 3 ? 0.5 * ownMonth + 0.5 * own28 : own28 || ownMonth;
    const projection = Math.round(a.mtd + ratePerDay * remaining);
    const pace = target ? projection / target : null;
    const needPerDay = target != null && remaining > 0 ? Math.max(0, (target - a.mtd) / remaining) : null;
    const lost = soldOut[foldBrand(label)] ?? 0;
    return {
      key: k,
      label,
      market: a.market,
      target,
      targetUnits: t?.units ?? null,
      mtd: Math.round(a.mtd),
      units: a.units,
      orders: a.orders.size,
      projection,
      pace,
      status: statusOf(pace),
      needPerDay: needPerDay == null ? null : Math.round(needPerDay),
      ratePerDay: Math.round(ratePerDay),
      prev: Math.round(a.prev),
      prevOrders: a.prevOrders.size,
      why: whyOf(a.mtd, a.orders.size, a.prev, a.prevOrders.size, lost, pace),
      soldOut: lost,
      daily: a.daily.map(Math.round),
    };
  });
  const order: Record<BrandPace['status'], number> = { behind: 0, close: 1, on: 2, ahead: 3, none: 4 };
  // behind first, by how far short; brands without a target by what they will sell
  brands.sort((a, b) => order[a.status] - order[b.status] || (a.target != null && b.target != null ? b.target - b.projection - (a.target - a.projection) : 0) || b.projection - a.projection);

  // the whole business: the brands with targets against their targets, and everything sold
  const withTarget = brands.filter((b) => b.target != null);
  const daily = Array(daysIn).fill(0) as number[];
  for (const b of brands) b.daily.forEach((v, i) => (daily[i] += v));
  const sum = (xs: BrandPace[], f: (b: BrandPace) => number) => xs.reduce((a, b) => a + f(b), 0);
  const total = {
    target: withTarget.length ? sum(withTarget, (b) => b.target!) : null,
    targetProjection: sum(withTarget, (b) => b.projection),
    targetMtd: sum(withTarget, (b) => b.mtd),
    mtd: sum(brands, (b) => b.mtd),
    projection: sum(brands, (b) => b.projection),
    prev: sum(brands, (b) => b.prev),
    orders: new Set(rows.rows.filter((r) => Date.parse(`${r.day}T00:00:00Z`) >= start).map((r) => r.order_id)).size,
    ratePerDay: sum(brands, (b) => b.ratePerDay),
    needPerDay: withTarget.length && remaining > 0 ? Math.max(0, Math.round((sum(withTarget, (b) => b.target!) - sum(withTarget, (b) => b.mtd)) / remaining)) : null,
    daily,
  };
  return { month, daysIn, elapsed, remaining, brands, total, hasTargets: withTarget.length > 0, behind: brands.filter((b) => b.status === 'behind').length, at: Date.now() };
}

/** Ahead or behind, in a few words: orders or basket size against the same days last month, and sold-out sizes. */
function whyOf(mtd: number, orders: number, prev: number, prevOrders: number, lostWeekly: number, pace: number | null) {
  const out: string[] = [];
  if (prev <= 0 || prevOrders === 0) out.push(mtd > 0 ? 'No sales on the same days last month to compare' : 'No sales yet this month');
  else if (orders === 0) out.push('No sales yet this month, against some on the same days last month');
  else {
    const dOrders = orders / prevOrders - 1;
    const basket = orders ? mtd / orders : 0;
    const prevBasket = prev / prevOrders;
    const dBasket = prevBasket ? basket / prevBasket - 1 : 0;
    const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;
    const total = mtd / prev - 1;
    if (Math.abs(total) < 0.05) out.push('Selling like last month');
    else {
      // the bigger of the two moves explains it; the other is named when it pushes the same way
      const main = Math.abs(dOrders) >= Math.abs(dBasket) ? `${dOrders < 0 ? 'Fewer' : 'More'} orders (${pct(dOrders)})` : `${dBasket < 0 ? 'Smaller' : 'Bigger'} baskets (${pct(dBasket)})`;
      const other = Math.abs(dOrders) >= Math.abs(dBasket) ? dBasket : dOrders;
      const same = Math.sign(other) === Math.sign(total) && Math.abs(other) >= 0.05;
      out.push(`${main}${same ? (Math.abs(dOrders) >= Math.abs(dBasket) ? `, ${dBasket < 0 ? 'smaller' : 'bigger'} baskets (${pct(dBasket)})` : `, ${dOrders < 0 ? 'fewer' : 'more'} orders (${pct(dOrders)})`) : ''} than the same days last month`);
    }
  }
  if (lostWeekly > 0 && (pace == null || pace < 1)) out.push('sold-out sizes are costing sales');
  return out.join('; ');
}

export type Pacing = Awaited<ReturnType<typeof pacing>>;
