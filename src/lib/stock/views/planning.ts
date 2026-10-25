import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import type { Principal } from '../../domain/perms';
import { eventsBetween, lastYearOf, MONTHS, MONTHS_SHORT, type Market } from '../../domain/stock/calendar';
import { CATEGORIES, CATEGORY_LABEL, SEASONAL, type Category } from '../../domain/stock/categories';
import { moneyIn, num, pct } from '../../format';
import { remember } from '../../remember';
import { egpMinor } from '../core';
import { factsFor, getFacts } from '../facts';
import { inMarkets, marketsFor, sees, viewCurrency } from './common';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ym = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;

export type Lesson = { tone: 'critical' | 'warn' | 'info' | 'good'; title: string; body: string; href?: string; action?: string };

/**
 * Two years of weekly sales read about ten ways took ~2.3 s a visit. Last year's months do not move
 * minute to minute, so the page is kept for 10 minutes per month, market and access.
 */
export function planning(p: Principal, o: { month?: number; market?: string }) {
  const s = sees(p);
  const key = `planning:${JSON.stringify([o.month ?? null, o.market ?? null, p.channels, p.brands ?? [], s.money, s.cost])}`;
  return remember(key, 10 * 60_000, () => readPlanning(p, o));
}

async function readPlanning(p: Principal, o: { month?: number; market?: string }) {
  const db = await getDb();
  const facts = factsFor(await getFacts(), p);
  const s = sees(p);
  const markets = (marketsFor(p) as Market[]).filter((m) => !o.market || m === o.market);
  const now = new Date();
  const thisY = now.getUTCFullYear();
  const thisM = now.getUTCMonth();
  const month = o.month ?? (thisM + 1) % 12;
  // the coming one: this year if it is still ahead, next year if it has passed
  const targetY = month >= thisM ? thisY : thisY + 1;
  const lastY = targetY - 1;
  const ps = facts.products.filter((x) => markets.includes(x.market));

  // ── months: units by month, last two years, from the weekly table ──
  const monthly = await db.execute<{ ym: string; units: number; revenue: number; currency: string; market: Market }>(sql`
    select to_char(sw.week + 3, 'YYYY-MM') as ym, p.market, max(p.currency) as currency, sum(sw.units)::int as units, sum(sw.revenue)::bigint as revenue
    from sales_weekly sw join products p on p.id = sw.product_id
    where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} group by 1, 2`);
  const unitsIn = (key: string) => monthly.rows.filter((r) => r.ym === key).reduce((a, r) => a + r.units, 0);
  const revIn = (key: string) => monthly.rows.filter((r) => r.ym === key).reduce((a, r) => a + egpMinor(Number(r.revenue), r.currency), 0);
  // forecast by month: the weekly forecast summed into the month each week's Wednesday falls in
  const fcMonth = new Map<string, number>();
  facts.weeks.forEach((w, i) => {
    const d = new Date(`${w}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 3);
    const k = ym(d.getUTCFullYear(), d.getUTCMonth());
    // this week's figure is what is still to come, so the current month is sold-so-far plus it
    const v = ps.reduce((a, x) => a + x.forecast[i], 0);
    fcMonth.set(k, (fcMonth.get(k) ?? 0) + v);
  });
  const curKey = ym(thisY, thisM);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(thisY, thisM - 7 + i, 1));
    const k = ym(d.getUTCFullYear(), d.getUTCMonth());
    const prev = ym(d.getUTCFullYear() - 1, d.getUTCMonth());
    const future = k > curKey;
    const current = k === curKey;
    const actual = unitsIn(k);
    return {
      label: `${MONTHS_SHORT[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ` ’${String(d.getUTCFullYear()).slice(2)}` : ''}`,
      thisYear: future ? Math.round(fcMonth.get(k) ?? 0) || null : current ? Math.round(actual + (fcMonth.get(k) ?? 0)) : actual,
      lastYear: unitsIn(prev) || null,
      forecast: future,
      highlight: d.getUTCMonth() === month,
    };
  });

  // ── the month last year, in detail ──
  const lyKey = ym(lastY, month);
  const lyStart = `${lyKey}-01`;
  const lyEnd = new Date(Date.UTC(lastY, month + 1, 1)).toISOString().slice(0, 10);
  const [top, outs, cats, md] = await Promise.all([
    db.execute<{ id: string; title: string; brand: string; image: string | null; units: number; season: string; market: Market }>(sql`
      select p.id, p.title, p.brand, p.image, p.season, p.market, sum(sw.units)::int as units from sales_weekly sw join products p on p.id = sw.product_id
      where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and sw.week + 3 >= ${lyStart}::date and sw.week + 3 < ${lyEnd}::date
      group by 1, 2, 3, 4, 5, 6 order by units desc limit 8`),
    db.execute<{ id: string; title: string; image: string | null; category: Category; price: number; currency: string; days: number; weeks: number; before: number }>(sql`
      with w as (
        select sw.product_id, sw.week, sum(sw.stockout_days)::float / count(*) as so from sales_weekly sw join products p on p.id = sw.product_id
        where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and sw.week + 3 >= ${lyStart}::date and sw.week + 3 < ${lyEnd}::date and sw.stockout_days > 0
        group by 1, 2
      ), pre as (
        select sw.product_id, sum(sw.units)::float / 4 as before from sales_weekly sw
        where sw.week >= ${lyStart}::date - 35 and sw.week < ${lyStart}::date - 7 and sw.product_id in (select product_id from w) group by 1
      )
      select p.id, p.title, p.image, p.category, p.price, p.currency, round(sum(w.so))::int as days, count(*)::int as weeks, coalesce(max(pre.before), 0)::float8 as before
      from w join products p on p.id = w.product_id left join pre on pre.product_id = w.product_id
      group by 1, 2, 3, 4, 5, 6 order by days desc limit 12`),
    db.execute<{ category: Category; market: Market; units: number }>(sql`
      select p.category, p.market, sum(sw.units)::int as units from sales_weekly sw join products p on p.id = sw.product_id
      where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and sw.week + 3 >= ${lyStart}::date and sw.week + 3 < ${lyEnd}::date group by 1, 2`),
    db.execute<{ category: Category; units: number; md: number }>(sql`
      select p.category, sum(sw.units)::int as units, sum(sw.markdown_units)::int as md from sales_weekly sw join products p on p.id = sw.product_id
      where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and sw.week + 3 >= ${lyStart}::date and sw.week + 3 < ${lyEnd}::date group by 1`),
  ]);

  // what was bought for each seasonal category last year against what had sold by the month's end
  const leftovers = await db.execute<{ category: Category; season: string; bought: number; sold: number }>(sql`
    with b as (
      select p.category, p.season, sum(l.received)::int as bought from po_lines l join purchase_orders po on po.id = l.po_id join products p on p.id = l.product_id
      where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and p.season ~ ${String(lastY).slice(2)} and po.received_at < ${lyEnd}::date group by 1, 2
    ), s as (
      select p.category, p.season, sum(sw.units)::int as sold from sales_weekly sw join products p on p.id = sw.product_id
      where ${inMarkets(markets, sql`p.market`, { who: p, brand: sql`p.brand` })} and p.season ~ ${String(lastY).slice(2)} and sw.week + 3 < ${lyEnd}::date group by 1, 2
    )
    select b.category, b.season, b.bought, coalesce(s.sold, 0) as sold from b left join s using (category, season) where b.bought > 0 order by b.bought desc`);

  const lyUnits = unitsIn(lyKey);
  const lyRev = revIn(lyKey);
  const prevUnits = unitsIn(ym(lastY - 1, month));
  const targetKey = ym(targetY, month);
  // null when the month is past the forecast horizon (26 weeks)
  const fcTarget = fcMonth.has(targetKey) ? Math.round(fcMonth.get(targetKey)!) : null;

  const lost = outs.rows.map((r) => {
    const lostUnits = Math.round(r.before * (r.days / 7));
    return { ...r, lostUnits, lostValue: egpMinor(Math.round(lostUnits * Number(r.price)), r.currency) };
  });
  const lostUnits = lost.reduce((a, r) => a + r.lostUnits, 0);
  const lostValue = lost.reduce((a, r) => a + r.lostValue, 0);
  const outCats = [...new Set(lost.map((r) => r.category))];

  // ── lessons: what last year says about this one ──
  const lessons: Lesson[] = [];
  if (lost.length) {
    const nowCover = ps.filter((x) => outCats.includes(x.category));
    const weeks = nowCover.reduce((a, x) => a + x.onHand, 0) / Math.max(0.1, nowCover.reduce((a, x) => a + x.rate, 0));
    const inPlan = await db.execute<{ n: number }>(sql`select count(*)::int as n from recommendations r join products p on p.id = r.product_id where r.status = 'open' and r.kind = 'reorder' and p.category in (${sql.join(outCats.map((c) => sql`${c}`), sql`, `)})`);
    lessons.push({
      tone: 'critical',
      title: `Last ${MONTHS[month]}, ${lost.length} style${lost.length > 1 ? 's' : ''} sold out`,
      body: `${cap(outCats.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(' and '))} ran empty for ${Math.round(lost.reduce((a, r) => a + r.days, 0) / Math.max(1, lost.length))} days on average, costing about ${num(lostUnits)} pieces${s.money ? ` and ${moneyIn(lostValue, viewCurrency(p), { compact: true })} of sales` : ''}. Going into this ${MONTHS[month]} the same categories have ${weeks.toFixed(1)} weeks of cover, and ${inPlan.rows[0]?.n ?? 0} of their styles are in the reorder plan now.`,
      href: '/stock/purchasing',
      action: 'Open the reorder plan',
    });
  }
  for (const l of leftovers.rows.filter((r) => SEASONAL.includes(r.category))) {
    const left = l.bought > 0 ? 1 - l.sold / l.bought : 0;
    // only judged once the season is closing: in its peak month most of a buy is meant to be unsold
    const mk = (l.season.startsWith('SS') ? 'EG' : markets[0]) as Market;
    const idx = facts.index[markets.includes(mk) ? mk : markets[0]][l.category];
    const ending = (idx[(month + 1) % 12] + idx[(month + 2) % 12]) / 2 < Math.min(0.85, idx[month]);
    if (left < 0.3 || !ending) continue;
    const m = md.rows.find((x) => x.category === l.category);
    lessons.push({
      tone: 'warn',
      title: `${CATEGORY_LABEL[l.category]} was bought too deep for ${l.season}`,
      body: `By the end of ${MONTHS[month]} ${lastY}, ${pct(left)} of the ${num(l.bought)} pieces bought were still unsold${m && m.units ? `, and ${pct(m.md / m.units)} of that month's pieces went at a markdown` : ''}. This year: buy close to the forecast with a second order in reserve, and start the markdown two weeks earlier.`,
      href: `/stock/inventory?category=${l.category}&view=clear`,
      action: 'See what is left now',
    });
  }
  if (lyUnits) {
    const yoy = prevUnits ? (lyUnits - prevUnits) / prevUnits : null;
    const vs = fcTarget && lyUnits ? (fcTarget - lyUnits) / lyUnits : null;
    lessons.push({
      tone: 'info',
      title: `${MONTHS[month]} ${lastY} sold ${num(lyUnits)} pieces`,
      body: `${yoy != null ? `${yoy >= 0 ? 'Up' : 'Down'} ${pct(Math.abs(yoy))} on ${MONTHS[month]} ${lastY - 1}. ` : ''}${fcTarget ? `The forecast for ${MONTHS[month]} ${targetY} is ${num(fcTarget)}${vs != null ? `, ${vs >= 0 ? '+' : '−'}${pct(Math.abs(vs))} on last year` : ''}.` : ''}${s.money ? ` Last year's sales were ${moneyIn(lyRev, viewCurrency(p), { compact: true })}.` : ''}`,
    });
  }
  for (const m of markets) {
    for (const e of eventsBetween(m, `${targetKey}-01`, new Date(Date.UTC(targetY, month + 1, 0)).toISOString().slice(0, 10))) {
      const prev = lastYearOf(e);
      if (!prev || prev.where) continue;
      const ev = await db.execute<{ units: number; base: number }>(sql`
        select coalesce(sum(sw.units) filter (where sw.week + 6 >= ${prev.from}::date and sw.week <= ${prev.to}::date), 0)::int as units,
          coalesce(sum(sw.units) filter (where sw.week >= ${prev.from}::date - 35 and sw.week < ${prev.from}::date - 7), 0)::float8 / 4 as base
        from sales_weekly sw join products p on p.id = sw.product_id where p.market = ${m}`);
      const r = ev.rows[0];
      if (!r?.base) continue;
      const weeks = Math.max(1, Math.round((Date.parse(prev.to) - Date.parse(prev.from)) / (7 * 86_400_000)));
      const x = r.units / weeks / r.base;
      if (x < 1.15) continue;
      lessons.push({ tone: 'good', title: `${e.label.replace(/ \d{4}$/, '')} in ${m === 'EG' ? 'Egypt' : 'Kuwait'}`, body: `Last year its week sold ${x.toFixed(1)}× a normal week. This year it runs ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${e.from}T00:00:00Z`))} – ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${e.to}T00:00:00Z`))}: the stock for it has to be in the shops and the warehouse a week before.` });
    }
  }
  if (markets.includes('KW') && (month === 6 || month === 7)) {
    const may = monthly.rows.find((r) => r.ym === ym(lastY, 4) && r.market === 'KW');
    const aug = monthly.rows.find((r) => r.ym === lyKey && r.market === 'KW');
    if (may && aug) lessons.push({ tone: 'info', title: 'Kuwait goes away for the summer', body: `Kuwait sold ${pct(1 - aug.units / Math.max(1, may.units))} fewer pieces in ${MONTHS[month]} than in May last year, almost all of it in the malls; the websites held up. Pull slow shop stock back to the warehouse in early July so the websites can sell it.` });
  }

  // ── when each category sells, and when to buy for it ──
  const shown = CATEGORIES.filter((c) => ps.some((x) => x.category === c && x.rate > 0.5));
  const heat = markets.flatMap((m) => shown.filter((c) => ps.some((x) => x.market === m && x.category === c)).map((c) => ({ label: `${CATEGORY_LABEL[c]}${markets.length > 1 ? ` · ${m}` : ''}`, values: facts.index[m][c] })));
  const leadOf = (c: Category, m: Market) => {
    const xs = ps.filter((x) => x.category === c && x.market === m);
    return xs.length ? Math.round(xs.reduce((a, x) => a + x.leadDays, 0) / xs.length) : 42;
  };
  const calendar = markets
    .flatMap((m) =>
      shown.map((c) => {
        const idx = facts.index[m][c];
        // the next month at least a quarter above average, within five months
        for (let k = 1; k <= 5; k++) {
          const mm = (thisM + k) % 12;
          if (idx[mm] >= 1.25 && idx[(mm + 11) % 12] < idx[mm]) {
            const y = thisM + k >= 12 ? thisY + 1 : thisY;
            const start = Date.UTC(y, mm, 1);
            const lead = leadOf(c, m);
            const orderBy = start - (lead + 14) * 86_400_000;
            return { market: m, category: CATEGORY_LABEL[c], peak: MONTHS[mm], x: idx[mm], lead, orderBy: new Date(orderBy).toISOString(), late: orderBy < Date.now() };
          }
        }
        return null;
      }),
    )
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => a.orderBy.localeCompare(b.orderBy));

  // ── open to buy, next three months, at cost ──
  let otb: { month: string; need: number; stock: number; onOrder: number; open: number }[] | null = null;
  if (s.cost) {
    const committed = ps.reduce((a, x) => a + egpMinor(x.onOrder * x.cost, x.currency), 0);
    const stock = ps.reduce((a, x) => a + x.valueCostEgp, 0);
    let pool = stock + committed;
    otb = [1, 2, 3].map((k) => {
      const d = new Date(Date.UTC(thisY, thisM + k - 1, 1));
      const key = ym(d.getUTCFullYear(), d.getUTCMonth());
      const need = ps.reduce((a, x) => {
        let u = 0;
        facts.weeks.forEach((w, i) => {
          const wd = new Date(`${w}T00:00:00Z`);
          wd.setUTCDate(wd.getUTCDate() + 3);
          if (ym(wd.getUTCFullYear(), wd.getUTCMonth()) === key) u += x.forecast[i];
        });
        return a + egpMinor(Math.round(u * x.cost), x.currency);
      }, 0);
      const open = Math.max(0, need - pool);
      pool = Math.max(0, pool - need);
      return { month: MONTHS[d.getUTCMonth()], need, stock: k === 1 ? stock : 0, onOrder: k === 1 ? committed : 0, open };
    });
  }

  return {
    month,
    monthName: MONTHS[month],
    targetY,
    lastY,
    markets,
    seesMoney: s.money,
    months,
    lastYear: {
      units: lyUnits,
      revenue: s.money ? lyRev : null,
      yoy: prevUnits ? (lyUnits - prevUnits) / prevUnits : null,
      forecast: fcTarget,
      top: top.rows,
      lost: lost.map((r) => ({ ...r, lostValue: s.money ? r.lostValue : null })),
      lostUnits,
      lostValue: s.money ? lostValue : null,
      categories: CATEGORIES.map((c) => ({ c, label: CATEGORY_LABEL[c], units: cats.rows.filter((r) => r.category === c).reduce((a, r) => a + r.units, 0), md: md.rows.find((r) => r.category === c) }))
        .filter((x) => x.units > 0)
        .sort((a, b) => b.units - a.units),
    },
    lessons,
    heat,
    thisMonth: thisM,
    calendar,
    otb,
  };
}

export type Planning = Awaited<ReturnType<typeof planning>>;
