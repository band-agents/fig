import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { canSee, seesBrand, type Principal } from './domain/perms';
import { addWeeks, weekOf, weekRange, type Market } from './domain/stock/calendar';
import { CATEGORY_LABEL, type Category } from './domain/stock/categories';
import { VELOCITY_LABEL, type Velocity } from './domain/stock/classify';
import { brandMatch, scope } from './queries';
import { remember } from './remember';
import { egpMinor } from './stock/core';
import { factsFor, getFacts, type ProductFacts } from './stock/facts';
import { inMarkets, marketsFor, sees, viewCurrency } from './stock/views/common';
import { getTargets, monthKey, targetFor } from './targets';

/**
 * Brands, for the people who run them (Dan, 24 Oct): what each brand sells by value and by pieces, how
 * fast its styles move, whether the high-priced or the low-priced brands sell more, what stock and
 * website gaps hold it back. Numbers only, no prose. One reading feeds the brand list, each brand's
 * page, the movers list and the price tiers, so they always agree.
 *
 * Sales are what the weekly table holds: today the websites' orders, rolled up (the shops' tills are in
 * Lucida and not read here yet). Money is EGP-equivalent minor units, shown in the view's currency.
 */

export const PERIODS = [4, 8, 13, 26, 52] as const;
export type Period = (typeof PERIODS)[number];
export const periodOf = (s?: string | null): Period => ((PERIODS as readonly number[]).includes(Number(s)) ? (Number(s) as Period) : 13);
export const PERIOD_LABEL: Record<Period, string> = { 4: '4 weeks', 8: '8 weeks', 13: '13 weeks', 26: '26 weeks', 52: '52 weeks' };

export type Tier = 'high' | 'mid' | 'low';
export const TIER_LABEL: Record<Tier, string> = { high: 'High price', mid: 'Mid price', low: 'Low price' };
export const TIERS: Tier[] = ['high', 'mid', 'low'];

type Sale = { units: number; value: number; cost: number; md: number };
const zero = (): Sale => ({ units: 0, value: 0, cost: 0, md: 0 });

export type StyleRow = {
  id: string;
  title: string;
  styleCode: string;
  brand: string;
  category: string;
  season: string;
  image: string | null;
  price: number; // EGP-equivalent minor, full price
  units: number;
  value: number;
  prevUnits: number;
  perWeek: number; // pieces a week over the period
  onHand: number;
  cover: number | null; // weeks the stock lasts at the period's pace
  sellThrough: number | null;
  weeksSinceSale: number | null;
  velocity: Velocity;
  stockValue: number; // at retail
  status: string;
  market: Market;
};

export type BrandRow = {
  brand: string;
  markets: Market[];
  styles: number;
  live: number;
  units: number;
  value: number;
  prevUnits: number;
  prevValue: number;
  shareUnits: number;
  shareValue: number;
  asp: number | null; // average selling price, per piece
  fullPrice: number; // median full price of the live range
  tier: Tier;
  onHand: number;
  stockValue: number;
  cover: number | null;
  sellThrough: number | null;
  fast: number;
  slow: number;
  dead: number;
  newIn: number;
  markdownShare: number | null; // pieces sold on markdown
  returnRate: number | null;
  web: { live: number; soldOutLive: number; stockNotLive: number; noPhoto: number } | null;
};

export type TierRow = { tier: Tier; brands: string[]; units: number; value: number; shareUnits: number; shareValue: number; asp: number | null; onHand: number; stockShare: number; sellThrough: number | null };
export type BandRow = { label: string; units: number; value: number; styles: number; onHand: number; shareUnits: number; shareValue: number; sellThrough: number | null };

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

// full-price bands, in each market's own money
const BANDS: Record<Market, { upTo: number; label: string }[]> = {
  KW: [
    { upTo: 5_000, label: 'Under 5 KWD' },
    { upTo: 10_000, label: '5 – 10 KWD' },
    { upTo: 15_000, label: '10 – 15 KWD' },
    { upTo: 25_000, label: '15 – 25 KWD' },
    { upTo: Infinity, label: '25 KWD and up' },
  ],
  EG: [
    { upTo: 50_000, label: 'Under 500 EGP' },
    { upTo: 100_000, label: '500 – 1,000 EGP' },
    { upTo: 150_000, label: '1,000 – 1,500 EGP' },
    { upTo: 250_000, label: '1,500 – 2,500 EGP' },
    { upTo: Infinity, label: '2,500 EGP and up' },
  ],
};

const keyOf = (p: Principal, what: string, extra: unknown[] = []) => `brands:${what}:${JSON.stringify([p.channels, p.brands ?? [], sees(p).money, sees(p).cost, canSee(p, 'webItems'), ...extra])}`;

/** The reading behind every brand report, for one person's access and one period: shared by the brand list,
 * every brand's page and the movers, so opening a second brand does not read the sales again. */
const read = (p: Principal, weeks: Period) => remember(keyOf(p, 'read', [weeks]), 2 * 60_000, () => readNow(p, weeks));

async function readNow(p: Principal, weeks: Period) {
  const db = await getDb();
  const s = sees(p);
  const markets = marketsFor(p) as Market[];
  const facts = factsFor(await getFacts(), p);
  const ps = facts.products.filter((x) => markets.includes(x.market));
  const now = weekOf(Date.now());
  const from = addWeeks(now, -(weeks - 1));
  const prevFrom = addWeeks(from, -weeks);
  const prevTo = addWeeks(from, -1);
  const where = inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` });
  // the listing's gaps are work for whoever keeps the websites' listings, not reading for a brand manager
  const website = canSee(p, 'webItems');

  const [cur, prev, weekly, rets, web] = await Promise.all([
    db.execute<{ id: string; currency: string; units: number; revenue: number; cost: number; md: number }>(sql`
      select sw.product_id as id, max(p.currency) as currency, sum(sw.units)::int as units, sum(sw.revenue)::bigint as revenue, sum(sw.cost)::bigint as cost, sum(sw.markdown_units)::int as md
      from sales_weekly sw join products p on p.id = sw.product_id
      where ${where} and sw.week >= ${from}::date and sw.week <= ${now}::date group by 1`),
    db.execute<{ id: string; currency: string; units: number; revenue: number }>(sql`
      select sw.product_id as id, max(p.currency) as currency, sum(sw.units)::int as units, sum(sw.revenue)::bigint as revenue
      from sales_weekly sw join products p on p.id = sw.product_id
      where ${where} and sw.week >= ${prevFrom}::date and sw.week <= ${prevTo}::date group by 1`),
    db.execute<{ week: string; brand: string; price: number; currency: string; market: Market; units: number; revenue: number }>(sql`
      select sw.week::text as week, p.brand, coalesce(p.compare_at, p.price) as price, p.currency, p.market, sum(sw.units)::int as units, sum(sw.revenue)::bigint as revenue
      from sales_weekly sw join products p on p.id = sw.product_id
      where ${where} and sw.week >= ${from}::date and sw.week <= ${now}::date group by 1, 2, 3, 4, 5`),
    // returns by brand, on orders placed in the period
    db.execute<{ brand: string; sold: number; returned: number }>(sql`
      select oi.brand, sum(oi.quantity)::int as sold, coalesce(sum(ri.q), 0)::int as returned
      from order_items oi join orders o on o.id = oi.order_id
      left join (select order_item_id, sum(quantity) as q from return_items group by 1) ri on ri.order_item_id = oi.id
      where ${scope(p, sql`o.channel_id`, sql`o.id`)} and ${brandMatch(p.brands, sql`oi.brand`)} and o.placed_at >= ${from}::date and o.stage <> 'cancelled' and oi.brand is not null
      group by 1`),
    // the website side, per brand: the store's own listing (Website vs Lucida keeps it)
    db.execute<{ brand: string; live: number; sold_out_live: number; stock_not_live: number; no_photo: number }>(website ? sql`
      select coalesce(w.brand, '') as brand,
        count(distinct w.handle) filter (where w.status = 'active')::int as live,
        count(distinct w.handle) filter (where w.status = 'active' and coalesce(w.web_qty, 0) <= 0)::int as sold_out_live,
        count(distinct coalesce(w.handle, w.barcode)) filter (where w.status <> 'active' and greatest(coalesce(w.web_qty, 0), coalesce(w.lucida_qty, 0)) > 0)::int as stock_not_live,
        count(distinct w.handle) filter (where w.status = 'active' and w.has_photo is false)::int as no_photo
      from web_items w
      where ${p.channels.length ? sql`w.channel_id in (${sql.join(p.channels.map((c) => sql`${c}`), sql`, `)})` : sql`true`} and ${brandMatch(p.brands, sql`w.brand`)}
      group by 1` : sql`select null as brand where false`),
  ]);

  const sale = new Map<string, Sale>();
  for (const r of cur.rows) sale.set(r.id, { units: r.units, value: s.money ? egpMinor(Number(r.revenue), r.currency) : 0, cost: s.cost ? egpMinor(Number(r.cost), r.currency) : 0, md: r.md });
  const before = new Map<string, Sale>();
  for (const r of prev.rows) before.set(r.id, { ...zero(), units: r.units, value: s.money ? egpMinor(Number(r.revenue), r.currency) : 0 });

  // pace, against the other styles in the same period: today the sales are the websites' only, so the
  // stock engine's own pace (which wants two pieces a week) would call almost nothing fast
  const sold = ps.map((x) => sale.get(x.id)?.units ?? 0).filter((u) => u > 0).sort((a, b) => b - a);
  const fastFrom = Math.max(2, sold[Math.floor(sold.length * 0.2)] ?? 2);
  const paceOf = (x: ProductFacts, units: number, cover: number | null): Velocity => {
    if (x.weeksLive < 6) return 'new';
    if (units >= fastFrom) return 'fast';
    if (x.onHand > 0 && units === 0) return 'dead';
    if (x.onHand > 0 && (cover == null || cover > 26)) return 'slow';
    return 'steady';
  };

  const styles: StyleRow[] = ps.map((x) => {
    const c = sale.get(x.id) ?? zero();
    const perWeek = c.units / weeks;
    const cover = perWeek > 0 ? x.onHand / perWeek : null;
    const full = egpMinor(x.compareAt ?? x.price, x.currency);
    return {
      id: x.id,
      title: x.title,
      styleCode: x.styleCode,
      brand: x.brand,
      category: CATEGORY_LABEL[x.category as Category] ?? x.category,
      season: x.season,
      image: x.image,
      price: s.money ? full : 0,
      units: c.units,
      value: c.value,
      prevUnits: before.get(x.id)?.units ?? 0,
      perWeek,
      onHand: x.onHand,
      cover,
      sellThrough: ratio(c.units, c.units + Math.max(0, x.onHand)),
      weeksSinceSale: x.weeksSinceSale,
      velocity: paceOf(x, c.units, cover),
      stockValue: s.money ? x.valueRetailEgp : 0,
      status: x.status,
      market: x.market,
    };
  });

  return { s, markets, currency: viewCurrency(p), weeks, from, to: now, ps, styles, sale, before, weekly: weekly.rows, rets: rets.rows, web: web.rows, website };
}

type Reading = Awaited<ReturnType<typeof readNow>>;

/** Brands ranked into high, mid and low price within each market, by the median full price of their live range. */
function tiersOf(rows: { brand: string; markets: Market[]; fullPrice: number }[]): Map<string, Tier> {
  const out = new Map<string, Tier>();
  const byMarket = new Map<Market, { brand: string; fullPrice: number }[]>();
  for (const r of rows) {
    const m = r.markets[0];
    if (!m) continue;
    byMarket.set(m, [...(byMarket.get(m) ?? []), r]);
  }
  for (const list of byMarket.values()) {
    const sorted = [...list].sort((a, b) => b.fullPrice - a.fullPrice);
    const n = sorted.length;
    sorted.forEach((r, i) => out.set(r.brand, n === 1 ? 'mid' : n === 2 ? (i === 0 ? 'high' : 'low') : i < Math.round(n / 3) ? 'high' : i >= n - Math.round(n / 3) ? 'low' : 'mid'));
  }
  return out;
}

function brandRows(r: Reading): BrandRow[] {
  const groups = new Map<string, ProductFacts[]>();
  for (const x of r.ps) groups.set(x.brand, [...(groups.get(x.brand) ?? []), x]);
  const total = r.styles.reduce((a, x) => ({ u: a.u + x.units, v: a.v + x.value }), { u: 0, v: 0 });
  const styleById = new Map(r.styles.map((x) => [x.id, x]));
  const fold = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rows = [...groups.entries()].map(([brand, xs]) => {
    let units = 0;
    let value = 0;
    let prevUnits = 0;
    let prevValue = 0;
    let md = 0;
    for (const x of xs) {
      const c = r.sale.get(x.id);
      const b = r.before.get(x.id);
      units += c?.units ?? 0;
      value += c?.value ?? 0;
      md += c?.md ?? 0;
      prevUnits += b?.units ?? 0;
      prevValue += b?.value ?? 0;
    }
    const live = xs.filter((x) => x.status === 'active');
    const onHand = xs.reduce((a, x) => a + Math.max(0, x.onHand), 0);
    const perWeek = units / r.weeks;
    const ret = r.rets.find((x) => fold(x.brand) === fold(brand));
    const web = r.web.find((x) => fold(x.brand) === fold(brand));
    const count = (v: Velocity) => xs.filter((x) => styleById.get(x.id)?.velocity === v && x.onHand > 0).length;
    return {
      brand,
      markets: [...new Set(xs.map((x) => x.market))],
      styles: xs.length,
      live: live.length,
      units,
      value,
      prevUnits,
      prevValue,
      shareUnits: total.u ? units / total.u : 0,
      shareValue: total.v ? value / total.v : 0,
      asp: r.s.money && units ? Math.round(value / units) : null,
      fullPrice: r.s.money ? median((live.length ? live : xs).map((x) => egpMinor(x.compareAt ?? x.price, x.currency))) : 0,
      tier: 'mid' as Tier,
      onHand,
      stockValue: r.s.money ? xs.reduce((a, x) => a + x.valueRetailEgp, 0) : 0,
      cover: perWeek > 0 ? onHand / perWeek : null,
      sellThrough: ratio(units, units + onHand),
      fast: count('fast'),
      slow: count('slow'),
      dead: count('dead'),
      newIn: count('new'),
      markdownShare: ratio(md, units),
      returnRate: ret && ret.sold ? ret.returned / ret.sold : null,
      web: web ? { live: web.live, soldOutLive: web.sold_out_live, stockNotLive: web.stock_not_live, noPhoto: web.no_photo } : null,
    };
  });
  // tiers need prices; without money access every brand reads as mid (the page then hides tiers)
  const tiers = tiersOf(rows.map((x) => ({ brand: x.brand, markets: x.markets, fullPrice: x.fullPrice || 0 })));
  for (const x of rows) x.tier = r.s.money ? (tiers.get(x.brand) ?? 'mid') : 'mid';
  return rows.sort((a, b) => b.value - a.value || b.units - a.units || b.onHand - a.onHand);
}

function tierRows(rows: BrandRow[]): TierRow[] {
  const total = rows.reduce((a, x) => ({ u: a.u + x.units, v: a.v + x.value, s: a.s + x.onHand }), { u: 0, v: 0, s: 0 });
  return TIERS.map((tier) => {
    const xs = rows.filter((x) => x.tier === tier);
    const units = xs.reduce((a, x) => a + x.units, 0);
    const value = xs.reduce((a, x) => a + x.value, 0);
    const onHand = xs.reduce((a, x) => a + x.onHand, 0);
    return { tier, brands: xs.map((x) => x.brand), units, value, shareUnits: total.u ? units / total.u : 0, shareValue: total.v ? value / total.v : 0, asp: units ? Math.round(value / units) : null, onHand, stockShare: total.s ? onHand / total.s : 0, sellThrough: ratio(units, units + onHand) };
  }).filter((t) => t.brands.length > 0);
}

/** Styles in full-price bands, per market: what sells more, the cheaper pieces or the dearer ones. */
function bandRows(r: Reading, styles: StyleRow[]): { market: Market; rows: BandRow[] }[] {
  return r.markets
    .map((m) => {
      const xs = styles.filter((x) => x.market === m);
      const facts = new Map(r.ps.map((x) => [x.id, x]));
      const total = xs.reduce((a, x) => ({ u: a.u + x.units, v: a.v + x.value }), { u: 0, v: 0 });
      const rows = BANDS[m].map((b, i) => {
        const lo = i ? BANDS[m][i - 1].upTo : 0;
        const inBand = xs.filter((x) => {
          const f = facts.get(x.id);
          const price = f ? (f.compareAt ?? f.price) : 0; // own currency, minor
          return price >= lo && price < b.upTo;
        });
        const units = inBand.reduce((a, x) => a + x.units, 0);
        const value = inBand.reduce((a, x) => a + x.value, 0);
        const onHand = inBand.reduce((a, x) => a + x.onHand, 0);
        return { label: b.label, units, value, styles: inBand.length, onHand, shareUnits: total.u ? units / total.u : 0, shareValue: total.v ? value / total.v : 0, sellThrough: ratio(units, units + onHand) };
      });
      return { market: m, rows };
    })
    .filter((b) => b.rows.some((x) => x.styles > 0));
}


/** The brand list, the price tiers and the price bands, for one period. Kept two minutes per access. */
export function brandsOverview(p: Principal, weeks: Period) {
  return remember(keyOf(p, 'overview', [weeks]), 2 * 60_000, async () => {
    const r = await read(p, weeks);
    const rows = brandRows(r);
    const tiers = new Map(rows.map((x) => [x.brand, x.tier]));
    // weekly sales by price tier, for the "which sells more" chart
    const keys = weekRange(r.from, r.to);
    const trend = TIERS.map((t) => ({
      tier: t,
      units: keys.map((k) => r.weekly.filter((w) => w.week === k && tiers.get(w.brand) === t).reduce((a, w) => a + w.units, 0)),
      value: keys.map((k) => (r.s.money ? r.weekly.filter((w) => w.week === k && tiers.get(w.brand) === t).reduce((a, w) => a + egpMinor(Number(w.revenue), w.currency), 0) : 0)),
    })).filter((t) => rows.some((x) => x.tier === t.tier));
    const totals = rows.reduce((a, x) => ({ units: a.units + x.units, value: a.value + x.value, prevUnits: a.prevUnits + x.prevUnits, prevValue: a.prevValue + x.prevValue, onHand: a.onHand + x.onHand, stockValue: a.stockValue + x.stockValue }), { units: 0, value: 0, prevUnits: 0, prevValue: 0, onHand: 0, stockValue: 0 });
    return { money: r.s.money, website: r.website, currency: r.currency, weeks, from: r.from, to: r.to, markets: r.markets, rows, totals, tiers: tierRows(rows), bands: bandRows(r, r.styles), trend: { weeks: keys, series: trend } };
  });
}

export type BrandsOverview = Awaited<ReturnType<typeof brandsOverview>>;

/** One brand: its row, its weeks, its categories and price bands, and the styles that move and do not. */
export function brandDetail(p: Principal, brand: string, weeks: Period) {
  return remember(keyOf(p, 'brand', [brand, weeks]), 2 * 60_000, async () => {
    const r = await read(p, weeks);
    if (!seesBrand(p, brand)) return null;
    const rows = brandRows(r);
    const fold = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '');
    const row = rows.find((x) => fold(x.brand) === fold(brand));
    if (!row) return null;
    const styles = r.styles.filter((x) => fold(x.brand) === fold(row.brand));
    const keys = weekRange(r.from, r.to);
    const mine = r.weekly.filter((w) => fold(w.brand) === fold(row.brand));
    const weekly = keys.map((k) => {
      const ws = mine.filter((w) => w.week === k);
      return { week: k, units: ws.reduce((a, w) => a + w.units, 0), value: r.s.money ? ws.reduce((a, w) => a + egpMinor(Number(w.revenue), w.currency), 0) : 0 };
    });
    const cats = new Map<string, { label: string; units: number; value: number; styles: number; onHand: number }>();
    for (const x of styles) {
      const c = cats.get(x.category) ?? { label: x.category, units: 0, value: 0, styles: 0, onHand: 0 };
      c.units += x.units;
      c.value += x.value;
      c.styles += 1;
      c.onHand += x.onHand;
      cats.set(x.category, c);
    }
    const inStock = styles.filter((x) => x.onHand > 0);
    // this month so far (the weeks whose Wednesday falls in it) against the brand's target, when one is set
    const month = monthKey();
    const inMonth = weekly.filter((w) => monthKey(new Date(Date.parse(`${w.week}T00:00:00Z`) + 3 * 86_400_000)) === month);
    const market = row.markets[0];
    const target = market ? targetFor(await getTargets(market), row.brand, month) : null;
    const own = market === 'KW' ? 'KWD' : 'EGP';
    const monthTarget = {
      key: month,
      units: inMonth.reduce((a, w) => a + w.units, 0),
      value: inMonth.reduce((a, w) => a + w.value, 0),
      target: target ? { units: target.units ?? null, value: target.value != null && r.s.money ? egpMinor(target.value, own) : null } : null,
    };
    return {
      month: monthTarget,
      money: r.s.money,
      website: r.website,
      currency: r.currency,
      weeks,
      from: r.from,
      to: r.to,
      row,
      rank: rows.indexOf(row) + 1,
      brands: rows.length,
      weekly,
      categories: [...cats.values()].sort((a, b) => b.value - a.value || b.units - a.units),
      bands: bandRows(r, styles),
      // fast: most pieces sold; slow: stock that is not moving, the most money stuck first
      fast: [...styles].filter((x) => x.units > 0).sort((a, b) => b.units - a.units || b.value - a.value),
      slow: inStock.filter((x) => x.velocity === 'slow' || x.velocity === 'dead' || (x.units === 0 && x.velocity !== 'new')).sort((a, b) => b.stockValue - a.stockValue || b.onHand - a.onHand),
      styles,
    };
  });
}

export type BrandDetail = NonNullable<Awaited<ReturnType<typeof brandDetail>>>;

export type MoverFilter = { brand?: string; pace?: string; category?: string; q?: string };

/** Every style with its pace, for the movers list and its export. */
export function moversList(p: Principal, weeks: Period, f: MoverFilter) {
  return remember(keyOf(p, 'movers', [weeks]), 2 * 60_000, async () => {
    const r = await read(p, weeks);
    return { money: r.s.money, currency: r.currency, weeks, from: r.from, to: r.to, styles: r.styles, brands: [...new Set(r.styles.map((x) => x.brand))].sort(), categories: [...new Set(r.styles.map((x) => x.category))].sort() };
  }).then((d) => {
    const q = f.q?.trim().toLowerCase();
    const rows = d.styles
      .filter((x) => !f.brand || x.brand === f.brand)
      .filter((x) => !f.category || x.category === f.category)
      .filter((x) => !f.pace || (f.pace === 'fast' ? x.velocity === 'fast' : f.pace === 'slow' ? (x.velocity === 'slow' || x.velocity === 'dead') && x.onHand > 0 : f.pace === 'dead' ? x.velocity === 'dead' && x.onHand > 0 : f.pace === 'new' ? x.velocity === 'new' : x.velocity === f.pace))
      .filter((x) => !q || `${x.title} ${x.styleCode} ${x.brand}`.toLowerCase().includes(q))
      .sort((a, b) => (f.pace === 'slow' || f.pace === 'dead' ? b.stockValue - a.stockValue || b.onHand - a.onHand : b.units - a.units || b.value - a.value));
    return { ...d, rows };
  });
}

export const PACES: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'fast', label: VELOCITY_LABEL.fast },
  { id: 'steady', label: VELOCITY_LABEL.steady },
  { id: 'slow', label: 'Slow or not selling' },
  { id: 'dead', label: VELOCITY_LABEL.dead },
  { id: 'new', label: VELOCITY_LABEL.new },
];
