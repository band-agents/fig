import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { CHANNEL, channelConfigured } from './channels';
import type { Principal } from './domain/perms';
import { egpMinor } from './stock/core';
import { factsFor, getFacts } from './stock/facts';
import { brandMatch, scope } from './queries';
import { shippingFor } from './shipping';
import { addWeeks, weekOf } from './domain/stock/calendar';
import { marketsFor, poOfBrands } from './stock/views/common';

/**
 * Finance & analysis: one reading of the money for a period and the markets a person covers.
 * Sales, cost and margin come from the weekly sales table (websites and shops alike, at the style's
 * cost price); orders add discounts, shipping and refusals; returns add refunds; courier
 * settlements and open purchase orders give the cash still to come in and to go out. Every amount
 * is EGP-equivalent minor units, so markets add up; the page shows it in the market's currency.
 */
export type Period = 'mtd' | 'last' | '30' | '90' | 'ytd';
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'mtd', label: 'This month' },
  { key: 'last', label: 'Last month' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'ytd', label: 'This year' },
];

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));

function window(period: Period, now: Date) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let from: Date;
  let to = now;
  let prevFrom: Date;
  let prevTo: Date;
  if (period === 'mtd') {
    from = monthStart(y, m);
    prevFrom = monthStart(y, m - 1);
    prevTo = new Date(prevFrom.getTime() + (now.getTime() - from.getTime()));
  } else if (period === 'last') {
    from = monthStart(y, m - 1);
    to = monthStart(y, m);
    prevFrom = monthStart(y, m - 2);
    prevTo = from;
  } else if (period === 'ytd') {
    from = monthStart(y, 0);
    prevFrom = monthStart(y - 1, 0);
    prevTo = new Date(Date.UTC(y - 1, m, now.getUTCDate()));
  } else {
    const n = Number(period);
    from = new Date(now.getTime() - n * DAY);
    prevFrom = new Date(from.getTime() - n * DAY);
    prevTo = from;
  }
  return { from, to, prevFrom, prevTo, lyFrom: new Date(Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth(), from.getUTCDate())), lyTo: new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate())) };
}

const n = (v: unknown) => Number(v ?? 0);
const sumEgp = (rows: { currency: string; v: unknown }[]) => rows.reduce((a, r) => a + egpMinor(n(r.v), r.currency), 0);

export async function financials(p: Principal, opts: { period?: string; market?: string }) {
  const period: Period = (PERIODS.find((x) => x.key === opts.period)?.key ?? 'mtd') as Period;
  const allowed = marketsFor(p);
  const markets = opts.market && allowed.includes(opts.market as 'EG' | 'KW') ? [opts.market as 'EG' | 'KW'] : allowed;
  const currency = markets.length === 1 && markets[0] === 'KW' ? 'KWD' : 'EGP';
  const w = window(period, new Date());
  const mk = sql.join(markets.map((m) => sql`${m}`), sql`, `);
  // online orders: the channels in these markets that this person covers
  // a market with a connected store counts only its connected stores, so live numbers are never mixed with sample orders
  const inScope = Object.values(CHANNEL).filter((c) => !c.parked && markets.includes(c.country as 'EG' | 'KW') && (!p.channels.length || p.channels.includes(c.id)));
  const channels = inScope.filter((c) => !inScope.some((x) => x.country === c.country && channelConfigured(x)) || channelConfigured(c)).map((c) => c.id);
  const ch = channels.length ? sql.join(channels.map((c) => sql`${c}`), sql`, `) : sql`'—'`;
  const db = await getDb();
  // someone limited to brands reads their brands' sales, the orders holding their pieces, their suppliers
  const pb = brandMatch(p.brands, sql`p.brand`);
  const ob = scope({ channels: [], brands: p.brands }, sql`channel_id`, sql`orders.id`);
  const rb = scope({ channels: [], brands: p.brands }, sql`o.channel_id`, sql`o.id`);
  const limited = Boolean(p.brands?.length);

  // Sales are kept by week, so they compare whole weeks: the weeks that start inside the period, the
  // week still running left out (unless it is all there is), against as many weeks just before and
  // the same weeks a year earlier.
  let wFrom = weekOf(w.from);
  if (wFrom < iso(w.from)) wFrom = addWeeks(wFrom, 1);
  let wTo = w.to.getTime() >= Date.now() - DAY ? weekOf(new Date()) : weekOf(w.to);
  if (wTo <= wFrom) wTo = addWeeks(wFrom, 1);
  const nWeeks = Math.max(1, Math.round((Date.parse(wTo) - Date.parse(wFrom)) / (7 * DAY)));
  const salesIn = (from: string, to: string) =>
    db.execute<{ brand: string; currency: string; kind: string; loc: string; units: number; revenue: string; cost: string; md: number }>(sql`
      select p.brand, p.currency, l.kind, l.name as loc, sum(sw.units)::int as units, sum(sw.revenue)::text as revenue, sum(sw.cost)::text as cost, sum(sw.markdown_units)::int as md
      from sales_weekly sw join products p on p.id = sw.product_id join locations l on l.id = sw.location_id
      where p.market in (${mk}) and ${pb} and sw.week >= ${from}::date and sw.week < ${to}::date
      group by 1, 2, 3, 4`);

  const monthsFrom = monthStart(new Date().getUTCFullYear() - 1, new Date().getUTCMonth() - 11);
  const [cur, prev, ly, months, orders, prevOrders, refunds, owed, cod, settle, pos, facts] = await Promise.all([
    salesIn(wFrom, wTo),
    salesIn(addWeeks(wFrom, -nWeeks), wFrom),
    salesIn(addWeeks(wFrom, -52), addWeeks(wTo, -52)),
    db.execute<{ m: string; currency: string; revenue: string; cost: string; units: number }>(sql`
      select to_char(date_trunc('month', sw.week), 'YYYY-MM') as m, p.currency, sum(sw.revenue)::text as revenue, sum(sw.cost)::text as cost, sum(sw.units)::int as units
      from sales_weekly sw join products p on p.id = sw.product_id
      where p.market in (${mk}) and ${pb} and sw.week >= ${iso(monthsFrom)}::date
      group by 1, 2`),
    db.execute<{ channel_id: string; currency: string; n: number; subtotal: string; discount: string; shipping: string; total: string; refused: string; paid_online: string }>(sql`
      select channel_id, currency, count(*) filter (where stage <> 'cancelled')::int as n,
        coalesce(sum(subtotal) filter (where stage <> 'cancelled'), 0)::text as subtotal,
        coalesce(sum(discount) filter (where stage <> 'cancelled'), 0)::text as discount,
        coalesce(sum(shipping) filter (where stage <> 'cancelled'), 0)::text as shipping,
        coalesce(sum(total) filter (where stage <> 'cancelled'), 0)::text as total,
        coalesce(sum(total) filter (where stage in ('rto', 'rto_closed')), 0)::text as refused,
        coalesce(sum(total) filter (where payment_method <> 'cod' and payment_status in ('paid', 'partially_refunded', 'refunded')), 0)::text as paid_online
      from orders where channel_id in (${ch}) and ${ob} and placed_at >= ${w.from} and placed_at < ${w.to}
      group by 1, 2`),
    db.execute<{ currency: string; n: number; total: string }>(sql`
      select currency, count(*) filter (where stage <> 'cancelled')::int as n, coalesce(sum(total) filter (where stage <> 'cancelled'), 0)::text as total
      from orders where channel_id in (${ch}) and ${ob} and placed_at >= ${w.prevFrom} and placed_at < ${w.prevTo}
      group by 1`),
    db.execute<{ currency: string; n: number; amount: string }>(sql`
      select r.currency, count(*)::int as n, coalesce(sum(r.amount), 0)::text as amount
      from returns r join orders o on o.id = r.order_id
      where o.channel_id in (${ch}) and ${rb} and r.resolution = 'refund' and r.stage in ('refunded', 'closed') and r.stage_at >= ${w.from} and r.stage_at < ${w.to}
      group by 1`),
    db.execute<{ currency: string; n: number; amount: string }>(sql`
      select r.currency, count(*)::int as n, coalesce(sum(r.amount), 0)::text as amount
      from returns r join orders o on o.id = r.order_id
      where o.channel_id in (${ch}) and ${rb} and r.stage = 'refund_pending'
      group by 1`),
    db.execute<{ currency: string; with_courier: string; to_collect: string; n_with: number; n_to: number }>(sql`
      select currency,
        coalesce(sum(total) filter (where payment_status = 'cod_collected'), 0)::text as with_courier,
        coalesce(sum(total) filter (where payment_status = 'cod_due' and stage in ('packed', 'shipped', 'delivering')), 0)::text as to_collect,
        count(*) filter (where payment_status = 'cod_collected')::int as n_with,
        count(*) filter (where payment_status = 'cod_due' and stage in ('packed', 'shipped', 'delivering'))::int as n_to
      from orders where channel_id in (${ch}) and ${ob}
      group by 1`),
    db.execute<{ id: string; reference: string; courier: string; currency: string; expected: string; remitted: string | null; status: string; period_to: string; order_count: number }>(sql`
      select id, reference, courier, currency, expected::text, remitted::text, status, period_to::text, order_count
      from settlements where not ${limited} and status in ('pending', 'discrepancy') and currency in (${sql.join([...new Set(markets.map((m) => (m === 'KW' ? 'KWD' : 'EGP')))].map((c) => sql`${c}`), sql`, `)})
      order by period_to asc limit 12`),
    db.execute<{ supplier: string; terms: string | null; currency: string; n: number; total: string; next_due: string | null; due30: string }>(sql`
      select s.name as supplier, s.payment_terms as terms, po.currency, count(*)::int as n, sum(po.total)::text as total, min(po.expected_at)::text as next_due,
        coalesce(sum(po.total) filter (where po.expected_at < now() + interval '30 days'), 0)::text as due30
      from purchase_orders po join suppliers s on s.id = po.supplier_id
      where po.market in (${mk}) and ${limited ? poOfBrands(p.brands!, sql`po.id`, sql`po.supplier_id`) : sql`true`} and po.status in ('approved', 'sent', 'confirmed', 'partial')
      group by 1, 2, 3 order by sum(po.total) desc`),
    getFacts().then((f) => factsFor(f, p)),
  ]);
  // the shipping we pay, priced on the couriers' cards, against what customers paid for delivery
  const shipping = await shippingFor({ from: w.from, to: w.to, channels, orderScope: ob, returnScope: rb });
  // which branch the period's orders left from, as the team recorded it
  const fromRows = await db.execute<{ name: string | null; currency: string; n: number; total: string }>(sql`
    select coalesce(ship_from_name, ship_from) as name, currency, count(*)::int as n, coalesce(sum(total), 0)::text as total
    from orders where channel_id in (${ch}) and ${ob} and stage <> 'cancelled' and placed_at >= ${w.from} and placed_at < ${w.to}
    group by 1, 2`);
  const fromMap = new Map<string, { label: string; orders: number; total: number; unset: boolean }>();
  for (const r of fromRows.rows) {
    const label = r.name ?? 'Not recorded';
    const x = fromMap.get(label) ?? { label, orders: 0, total: 0, unset: !r.name };
    x.orders += r.n;
    x.total += egpMinor(n(r.total), r.currency);
    fromMap.set(label, x);
  }
  const shipFrom = [...fromMap.values()].sort((a, b) => Number(a.unset) - Number(b.unset) || b.orders - a.orders);

  // ── sales, cost, margin ──
  const roll = (rows: typeof cur.rows) => {
    let revenue = 0;
    let cost = 0;
    let units = 0;
    let md = 0;
    for (const r of rows) {
      revenue += egpMinor(n(r.revenue), r.currency);
      cost += egpMinor(n(r.cost), r.currency);
      units += r.units;
      md += r.md;
    }
    return { revenue, cost, margin: revenue - cost, marginPct: revenue > 0 ? (revenue - cost) / revenue : null, units, mdShare: units > 0 ? md / units : null };
  };
  const now = roll(cur.rows);
  const before = roll(prev.rows);
  const lastYear = roll(ly.rows);

  const brands = new Map<string, { brand: string; revenue: number; cost: number; units: number; md: number }>();
  const places = new Map<string, { label: string; revenue: number; units: number }>();
  for (const r of cur.rows) {
    const b = brands.get(r.brand) ?? { brand: r.brand, revenue: 0, cost: 0, units: 0, md: 0 };
    b.revenue += egpMinor(n(r.revenue), r.currency);
    b.cost += egpMinor(n(r.cost), r.currency);
    b.units += r.units;
    b.md += r.md;
    brands.set(r.brand, b);
    const label = r.kind === 'warehouse' ? 'Websites & apps' : r.loc;
    const pl = places.get(label) ?? { label, revenue: 0, units: 0 };
    pl.revenue += egpMinor(n(r.revenue), r.currency);
    pl.units += r.units;
    places.set(label, pl);
  }
  const brandRows = [...brands.values()]
    .map((b) => ({ ...b, margin: b.revenue - b.cost, marginPct: b.revenue > 0 ? (b.revenue - b.cost) / b.revenue : null, share: now.revenue > 0 ? b.revenue / now.revenue : 0, mdShare: b.units > 0 ? b.md / b.units : null }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── twelve months, this year against last ──
  const byMonth = new Map<string, { revenue: number; cost: number; units: number }>();
  for (const r of months.rows) {
    const x = byMonth.get(r.m) ?? { revenue: 0, cost: 0, units: 0 };
    x.revenue += egpMinor(n(r.revenue), r.currency);
    x.cost += egpMinor(n(r.cost), r.currency);
    x.units += r.units;
    byMonth.set(r.m, x);
  }
  const today = new Date();
  const monthBars = Array.from({ length: 12 }, (_, i) => {
    const d = monthStart(today.getUTCFullYear(), today.getUTCMonth() - 11 + i);
    const key = d.toISOString().slice(0, 7);
    const lyKey = `${d.getUTCFullYear() - 1}${key.slice(4)}`;
    return {
      label: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(d) + (d.getUTCMonth() === 0 ? ` ’${String(d.getUTCFullYear()).slice(2)}` : ''),
      thisYear: byMonth.get(key)?.revenue ?? null,
      lastYear: byMonth.get(lyKey)?.revenue ?? null,
      highlight: i === 11,
      // the same months in pieces, for the Value | Pieces switch
      unitsThisYear: byMonth.get(key)?.units ?? null,
      unitsLastYear: byMonth.get(lyKey)?.units ?? null,
    };
  });

  // ── online orders ──
  const o = { count: 0, subtotal: 0, discount: 0, shipping: 0, total: 0, refused: 0, paidOnline: 0 };
  const byChannel = new Map<string, { label: string; count: number; total: number }>();
  for (const r of orders.rows) {
    o.count += r.n;
    o.subtotal += egpMinor(n(r.subtotal), r.currency);
    o.discount += egpMinor(n(r.discount), r.currency);
    o.shipping += egpMinor(n(r.shipping), r.currency);
    o.total += egpMinor(n(r.total), r.currency);
    o.refused += egpMinor(n(r.refused), r.currency);
    o.paidOnline += egpMinor(n(r.paid_online), r.currency);
    const c = CHANNEL[r.channel_id];
    const label = c ? `${c.name}${c.surface === 'App' ? ' App' : ''}` : r.channel_id;
    const x = byChannel.get(label) ?? { label, count: 0, total: 0 };
    x.count += r.n;
    x.total += egpMinor(n(r.total), r.currency);
    byChannel.set(label, x);
  }
  const prevCount = prevOrders.rows.reduce((a, r) => a + r.n, 0);
  const prevTotal = sumEgp(prevOrders.rows.map((r) => ({ currency: r.currency, v: r.total })));

  // ── cash position, today ──
  const withCourier = sumEgp(cod.rows.map((r) => ({ currency: r.currency, v: r.with_courier })));
  const toCollect = sumEgp(cod.rows.map((r) => ({ currency: r.currency, v: r.to_collect })));
  const refundsOwed = sumEgp(owed.rows.map((r) => ({ currency: r.currency, v: r.amount })));
  const refunded = sumEgp(refunds.rows.map((r) => ({ currency: r.currency, v: r.amount })));
  const settlements = settle.rows.map((s) => ({
    id: s.id,
    reference: s.reference,
    courier: s.courier,
    status: s.status,
    periodTo: s.period_to,
    orders: s.order_count,
    expected: egpMinor(n(s.expected), s.currency),
    gap: s.remitted == null ? null : egpMinor(n(s.expected) - n(s.remitted), s.currency),
  }));
  const payables = pos.rows.map((r) => ({ supplier: r.supplier, terms: r.terms, orders: r.n, total: egpMinor(n(r.total), r.currency), due30: egpMinor(n(r.due30), r.currency), nextDue: r.next_due }));
  const stock = facts.products.filter((x) => markets.includes(x.market)).reduce((a, x) => ({ cost: a.cost + x.valueCostEgp, retail: a.retail + x.valueRetailEgp }), { cost: 0, retail: 0 });

  const change = (a: number, b: number) => (b > 0 ? (a - b) / b : null);
  return {
    period,
    markets,
    allowed,
    currency,
    range: { from: w.from, to: w.to },
    weeks: { from: wFrom, to: addWeeks(wTo, -1), count: nWeeks },
    kpi: {
      netSales: now.revenue,
      netSalesChange: change(now.revenue, before.revenue),
      netSalesVsLy: change(now.revenue, lastYear.revenue),
      grossMargin: now.margin,
      marginPct: now.marginPct,
      marginPctBefore: before.marginPct,
      cogs: now.cost,
      units: now.units,
      unitsChange: change(now.units, before.units),
      mdShare: now.mdShare,
      orders: o.count,
      ordersChange: change(o.count, prevCount),
      aov: o.count ? o.total / o.count : null,
      aovBefore: prevCount ? prevTotal / prevCount : null,
      discounts: o.discount,
      shipping: o.shipping,
      refused: o.refused,
      paidOnline: o.paidOnline,
      refunded,
      refundsCount: refunds.rows.reduce((a, r) => a + r.n, 0),
    },
    cash: {
      withCourier,
      withCourierCount: cod.rows.reduce((a, r) => a + r.n_with, 0),
      toCollect,
      toCollectCount: cod.rows.reduce((a, r) => a + r.n_to, 0),
      refundsOwed,
      refundsOwedCount: owed.rows.reduce((a, r) => a + r.n, 0),
      supplierOpen: payables.reduce((a, x) => a + x.total, 0),
      supplierDue30: payables.reduce((a, x) => a + x.due30, 0),
      stockCost: stock.cost,
      stockRetail: stock.retail,
    },
    brands: brandRows,
    places: [...places.values()].sort((a, b) => b.revenue - a.revenue),
    channels: [...byChannel.values()].sort((a, b) => b.total - a.total),
    months: monthBars,
    settlements,
    payables,
    shipping,
    shipFrom,
  };
}

export type Financials = Awaited<ReturnType<typeof financials>>;
