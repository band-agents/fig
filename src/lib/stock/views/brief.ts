import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import type { Principal } from '../../domain/perms';
import { addWeeks, eventsBetween, MONTHS, weekOf, type Market } from '../../domain/stock/calendar';
import { CATEGORIES, CATEGORY_LABEL, type Category } from '../../domain/stock/categories';
import { VELOCITY_LABEL, type Velocity } from '../../domain/stock/classify';
import { moneyIn, num, pct } from '../../format';
import { egpMinor } from '../core';
import { factsFor, getFacts, type ProductFacts } from '../facts';
import { lastRun } from '../planner';
import { inMarkets, marketsFor, sees, viewCurrency } from './common';
import { openRecs } from './recs';

export type Point = { id: string; title: string; image: string | null; brand: string; cover: number; rate: number; value: number; velocity: Velocity };

const spark = (p: ProductFacts) => p.weekly.slice(-12).map((o) => o.units);
const piece = (p: ProductFacts) => ({ id: p.id, title: p.title, brand: p.brand, image: p.image, market: p.market, category: CATEGORY_LABEL[p.category], onHand: p.onHand, rate: p.rate, cover: p.cover, sellThrough: p.sellThrough8, velocity: p.velocity, value: p.valueRetailEgp, spark: spark(p) });

export async function stockBrief(p: Principal) {
  const db = await getDb();
  const f = factsFor(await getFacts(), p);
  const s = sees(p);
  const markets = marketsFor(p);
  const ps = f.products.filter((x) => markets.includes(x.market));
  const now = Date.now();
  const week = f.week;

  // ── the numbers ──
  const units = ps.reduce((a, x) => a + Math.max(0, x.onHand), 0);
  const weekly = ps.reduce((a, x) => a + x.rate, 0);
  const sold8 = ps.reduce((a, x) => a + x.sold8, 0);
  const retail = ps.reduce((a, x) => a + x.valueRetailEgp, 0);
  const cost = ps.reduce((a, x) => a + x.valueCostEgp, 0);
  const dead = ps.filter((x) => x.velocity === 'dead');
  const deep = ps.filter((x) => x.cover > 26 && x.onHand > 0);

  const [hist, lastYear, inbound, split, pulse, ai] = await Promise.all([
    db.execute<{ week: string; units: number }>(sql`
      select sw.week::text as week, sum(sw.units)::int as units from sales_weekly sw join products p on p.id = sw.product_id
      where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and sw.week >= ${addWeeks(week, -26)} and sw.week < ${week} group by 1 order by 1`),
    db.execute<{ week: string; units: number }>(sql`
      select sw.week::text as week, sum(sw.units)::int as units from sales_weekly sw join products p on p.id = sw.product_id
      where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and sw.week >= ${addWeeks(week, -78)} and sw.week < ${addWeeks(week, -40)} group by 1 order by 1`),
    db.execute<{ currency: string; units: number; value: number; pos: number }>(sql`
      select po.currency, coalesce(sum(l.qty - l.received - l.damaged), 0)::int as units, coalesce(sum((l.qty - l.received - l.damaged) * l.unit_cost), 0)::bigint as value, count(distinct po.id)::int as pos
      from purchase_orders po join po_lines l on l.po_id = po.id
      where ${inMarkets(markets, sql`po.market`, { who: p, po: 'po' })} and po.status in ('sent','confirmed','partial') and po.expected_at < now() + interval '30 days' group by 1`),
    db.execute<{ market: Market; kind: string; units: number; revenue: number; currency: string }>(sql`
      select p.market, l.kind, sum(sw.units)::int as units, sum(sw.revenue)::bigint as revenue, max(p.currency) as currency
      from sales_weekly sw join products p on p.id = sw.product_id join locations l on l.id = sw.location_id
      where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and sw.week >= ${addWeeks(week, -8)} and sw.week < ${week} group by 1, 2`),
    db.execute<{ area: string; open: number; late: number; done_today: number; doing: number; blocked: number }>(sql`
      select area, count(*) filter (where status in ('open','doing','blocked'))::int as open,
        count(*) filter (where status in ('open','doing') and due_at < now())::int as late,
        count(*) filter (where status = 'done' and done_at > date_trunc('day', now() at time zone 'Asia/Kuwait') at time zone 'Asia/Kuwait')::int as done_today,
        count(*) filter (where status = 'doing')::int as doing, count(*) filter (where status = 'blocked')::int as blocked
      from tasks group by 1`),
    db.execute<{ decided: number; accepted: number; hours: number | null }>(sql`
      select count(*) filter (where status in ('accepted','done','dismissed'))::int as decided,
        count(*) filter (where status in ('accepted','done'))::int as accepted,
        avg(extract(epoch from decided_at - created_at) / 3600) filter (where decided_at is not null)::float8 as hours
      from recommendations where created_at > now() - interval '30 days'`),
  ]);

  const recs = await openRecs(p, { limit: 400 });
  const atRisk = recs.filter((r) => r.kind === 'reorder').reduce((a, r) => a + r.impact, 0);
  const byArea = recs.reduce<Record<string, number>>((a, r) => ((a[r.area] = (a[r.area] ?? 0) + 1), a), {});

  // ── the curve: last six months, the next twelve weeks, and the same weeks a year ago ──
  const ahead = f.weeks.slice(0, 12);
  // this week is shown whole: what has sold plus what is still to come reads as one number
  const fc = ahead.map((_, i) => ps.reduce((a, x) => a + x.forecast[i], 0) / (i === 0 ? Math.max(0.15, f.firstWeekLeft) : 1));
  const histMap = new Map(hist.rows.map((r) => [r.week, r.units]));
  const lyMap = new Map(lastYear.rows.map((r) => [r.week, r.units]));
  const pastWeeks = Array.from({ length: 26 }, (_, i) => addWeeks(week, i - 26));
  const curve = [
    ...pastWeeks.map((w) => ({ week: w, actual: histMap.get(w) ?? 0, lastYear: lyMap.get(addWeeks(w, -52)) ?? null, forecast: null as number | null })),
    ...ahead.map((w, i) => ({ week: w, actual: null as number | null, lastYear: lyMap.get(addWeeks(w, -52)) ?? null, forecast: Math.round(fc[i]) })),
  ];

  // ── the range on one map: how fast each style sells against how long its stock lasts ──
  // a big catalogue is thousands of dots: keep every style that sells and the most valuable of the rest
  const points: Point[] = [...ps.filter((x) => x.onHand > 0 && x.weeksLive >= 4)]
    .sort((a, b) => Number(b.rate > 0.05) - Number(a.rate > 0.05) || b.valueRetailEgp - a.valueRetailEgp)
    .slice(0, 900)
    .map((x) => ({ id: x.id, title: x.title, image: x.image, brand: x.brand, cover: Number.isFinite(x.cover) ? Math.min(104, x.cover) : 104, rate: Math.max(0.05, x.rate), value: x.valueRetailEgp, velocity: x.velocity }));

  // ── next month, read from the learned curves ──
  const nm = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1));
  const thisM = new Date(now).getUTCMonth();
  const nextM = nm.getUTCMonth();
  const peaks = markets.flatMap((m) =>
    CATEGORIES.map((c) => ({ market: m, category: c as Category, label: CATEGORY_LABEL[c as Category], x: f.index[m][c as Category][nextM] / Math.max(0.2, f.index[m][c as Category][thisM]), share: ps.filter((x) => x.market === m && x.category === c).reduce((a, x) => a + x.rate, 0) })),
  )
    .filter((x) => x.share > 2)
    .sort((a, b) => b.x - a.x);
  const span = (a: string, z: string) => {
    const f2 = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
    return a.slice(5, 7) === z.slice(5, 7) ? `${Number(a.slice(8))}–${f2(z)}` : `${f2(a)} – ${f2(z)}`;
  };
  const evMap = new Map<string, { id: string; label: string; from: string; to: string; markets: Market[]; span: string }>();
  for (const m of markets)
    for (const e of eventsBetween(m, new Date(now).toISOString().slice(0, 10), new Date(now + 75 * 86_400_000).toISOString().slice(0, 10))) {
      if (e.where === 'store' && e.lift.all && e.lift.all < 1) continue;
      const k = e.id;
      const cur = evMap.get(k) ?? { id: k, label: e.label.replace(/ \d{4}$/, ''), from: e.from, to: e.to, markets: [], span: span(e.from, e.to) };
      cur.markets.push(m);
      evMap.set(k, cur);
    }
  const events = [...evMap.values()].sort((a, b) => a.from.localeCompare(b.from));

  const splitRows = split.rows.map((r) => ({ market: r.market, where: r.kind === 'warehouse' ? 'Websites' : 'Shops', units: r.units, revenue: s.money ? egpMinor(Number(r.revenue), r.currency) : 0 }));
  const inboundUnits = inbound.rows.reduce((a, r) => a + r.units, 0);
  const inboundValue = inbound.rows.reduce((a, r) => a + egpMinor(Number(r.value), r.currency), 0);
  const ai0 = ai.rows[0];
  const run = await lastRun();

  // ── the brief, in sentences, from the same numbers ──
  const urgent = recs.filter((r) => r.kind === 'reorder' && r.priority === 1);
  const md = recs.filter((r) => r.kind === 'markdown');
  const tr = recs.filter((r) => r.kind === 'transfer');
  const merch = recs.filter((r) => r.area === 'merch');
  const exp = recs.filter((r) => r.kind === 'expedite');
  const top = peaks[0];
  const brandsOf = (rs: typeof recs) => [...new Set(rs.map((r) => r.product?.brand).filter(Boolean))].slice(0, 3).join(', ');
  const lines: { tone: 'critical' | 'warn' | 'info' | 'good'; text: string; href?: string }[] = [];
  if (urgent.length) lines.push({ tone: 'critical', text: `${urgent.length} important style${urgent.length > 1 ? 's' : ''} will sell out before a reorder could land${brandsOf(urgent) ? ` (${brandsOf(urgent)})` : ''}. Order today and ask the suppliers about air freight.`, href: '/stock/purchasing' });
  if (exp.length) lines.push({ tone: 'critical', text: `${exp.length} open purchase order${exp.length > 1 ? 's land' : ' lands'} after the shelf runs empty. Ask for a partial shipment of the short lines.`, href: '/stock/purchasing?tab=orders' });
  if (top && top.x > 1.15) lines.push({ tone: 'warn', text: `${MONTHS[nextM]} sells ${CATEGORY_LABEL[top.category].toLowerCase()} at ${top.x.toFixed(1)}× this month's pace${events[0] ? `, and ${events[0].label} falls on ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${events.find((e) => e.label.startsWith('White'))?.to ?? events[0].from}T00:00:00Z`))}` : ''}. Plan the buy now.`, href: '/stock/planning' });
  if (md.length && s.money) lines.push({ tone: 'warn', text: `${moneyIn(md.reduce((a, r) => a + r.impact, 0), viewCurrency(p), { compact: true })} could come back from ${md.length} markdown${md.length > 1 ? 's' : ''} on styles that are out of season or not selling.`, href: '/stock/inventory?view=clear' });
  if (tr.length) lines.push({ tone: 'info', text: `${tr.length} transfer${tr.length > 1 ? 's' : ''} would put ${num(tr.reduce((a, r) => a + Number((r.payload.lines as { qty: number }[] | undefined)?.reduce((x, l) => x + l.qty, 0) ?? 0), 0))} pieces where they sell.`, href: '/stock/inventory?view=move' });
  if (merch.length) lines.push({ tone: 'good', text: `${merch.length} slow style${merch.length > 1 ? 's are' : ' is'} ready to be pushed on the websites as cross-sells, upgrades and pop-ups.`, href: '/stock/merch' });
  const wh = pulse.rows.find((r) => r.area === 'warehouse');
  if (wh?.late) lines.push({ tone: 'warn', text: `${wh.late} warehouse task${wh.late > 1 ? 's are' : ' is'} past due. The team board shows who is carrying them.`, href: '/stock/team' });

  return {
    week,
    run,
    markets,
    seesMoney: s.money,
    seesCost: s.cost,
    kpi: {
      retail: s.money ? retail : null,
      cost: s.cost ? cost : null,
      units,
      styles: ps.filter((x) => x.onHand > 0).length,
      cover: weekly > 0 ? units / weekly : null,
      sellThrough: sold8 + units > 0 ? sold8 / (sold8 + units) : null,
      atRisk: s.money ? atRisk : null,
      deadValue: s.money ? dead.reduce((a, x) => a + x.valueRetailEgp, 0) : null,
      deadStyles: dead.length,
      deepValue: s.money ? deep.reduce((a, x) => a + x.valueRetailEgp, 0) : null,
      inboundUnits,
      inboundValue: s.cost ? inboundValue : null,
      inboundPos: inbound.rows.reduce((a, r) => a + r.pos, 0),
      acceptance: ai0?.decided ? ai0.accepted / ai0.decided : null,
      decisionHours: ai0?.hours ?? null,
    },
    lines,
    recs,
    byArea,
    curve,
    points,
    // a young store may have no fast movers yet: its best sellers stand in
    fast: (ps.some((x) => x.velocity === 'fast') ? ps.filter((x) => x.velocity === 'fast') : ps.filter((x) => x.rate > 0)).sort((a, b) => b.rate - a.rate).slice(0, 7).map(piece),
    slow: ps.filter((x) => x.velocity === 'slow' || x.velocity === 'dead').sort((a, b) => b.valueRetailEgp - a.valueRetailEgp).slice(0, 7).map(piece),
    velocityMix: (['fast', 'steady', 'slow', 'dead', 'new'] as Velocity[]).map((v) => ({ v, label: VELOCITY_LABEL[v], styles: ps.filter((x) => x.velocity === v).length, value: ps.filter((x) => x.velocity === v).reduce((a, x) => a + x.valueRetailEgp, 0) })),
    nextMonth: { name: MONTHS[nextM], peaks: peaks.slice(0, 5), events: events.slice(0, 4) },
    split: splitRows,
    pulse: pulse.rows,
    fmt: { thisWeek: weekOf(now), pctSell: sold8 + units > 0 ? pct(sold8 / (sold8 + units)) : '—' },
  };
}

export type StockBrief = Awaited<ReturnType<typeof stockBrief>>;
