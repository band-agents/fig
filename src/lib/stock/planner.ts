import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { addWeeks, keyToTime, MONTHS, type Market } from '../domain/stock/calendar';
import { CATEGORY_LABEL, SEASONAL } from '../domain/stock/categories';
import { project, reorderQty, safetyStock, splitSizes, Z } from '../domain/stock/forecast';
import { rebalance, type Spot } from '../domain/stock/rebalance';
import { anchorsFor, crossSellUplift, popupUplift, upsellFor, worthPushing, type Piece } from '../domain/stock/merch';
import { estimateMinutes, pace, pickAssignee, TASK_KIND, type Candidate, type TaskKind } from '../domain/stock/work';
import { effectiveScopes, level } from '../domain/perms';
import { CHANNEL, channelLabel } from '../channels';
import { money, moneyIn, num } from '../format';

/** An amount the planner says out loud, in the currency of the market it is about. */
const said = (egp: number, market: string) => moneyIn(egp, market === 'KW' ? 'KWD' : 'EGP', { compact: true });
import type { Reason } from '../db/schema';
import { egpMinor, logActivity, nextNumber, PLANNER, stockChanged, stockRules, type StockRules } from './core';
import { getFacts, type Facts, type ProductFacts } from './facts';
import { rollupOnlineSales } from './rollup';
import { weekOf } from '../domain/stock/calendar';

const weekOfNow = () => weekOf(Date.now());

// The AI planner. It reads the whole range once (facts.ts), then writes what each team should do
// next as recommendations, raises the routine tasks nobody should have to remember, and hands
// unassigned work to the right person. It never moves stock or money by itself: a person accepts.

type Rec = {
  key: string;
  kind: string;
  area: 'procurement' | 'stock' | 'warehouse' | 'merch';
  market: Market;
  title: string;
  body: string;
  reasons: Reason[];
  impact: number; // EGP-equivalent minor
  impactLabel: string;
  confidence: number;
  priority: number;
  productId?: string;
  locationId?: string;
  supplierId?: string;
  payload: Record<string, unknown>;
};

const fmtDate = (week: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${week}T00:00:00Z`));
const fmtDay = (t: number) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(t));
const round1 = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
const sumTo = (a: number[], n: number) => a.slice(0, Math.max(0, n)).reduce((s, x) => s + x, 0);

type Loc = { id: string; kind: string; name: string; country: string; brands: string[] };

const sellsBrand = (loc: Loc, brand: string) => {
  if (!loc.brands.length) return true;
  const f = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return loc.brands.some((b) => f(b).includes(f(brand)) || f(brand).includes(f(b)));
};

// ── Reorders ──────────────────────────────────────────────────────────────────────────────────
function reorders(f: Facts, rules: StockRules, reserved: Map<string, number>): Rec[] {
  const out: Rec[] = [];
  for (const p of f.products) {
    if (!p.supplierId || p.status !== 'active' || p.base <= 0.05) continue;
    if (/^SS|^AW/.test(p.season) && seasonOver(p)) continue;
    const lead = p.leadDays / 7;
    const horizon = Math.ceil(lead + rules.reviewWeeks);
    const demandCover = sumTo(p.forecast, horizon);
    const avgSi = demandCover / Math.max(1e-6, horizon * p.base * p.trend);
    const safety = safetyStock(p.sigma * Math.max(0.5, avgSi), horizon, Z[p.abc]);
    const res = reserved.get(p.id) ?? 0;
    const position = p.onHand + p.onOrder - res;
    const qty = reorderQty({ position, demandCover, safety, moq: p.moq, pack: p.casePack });
    if (qty <= 0 || p.inDraft > 0) continue;
    // the long tail is bought on the seasonal plan, not chased week to week
    if (p.abc === 'C' && p.rate < 1.5) continue;
    // a seasonal style landing after its season is not a reorder, it is next year's markdown
    const arrive = addWeeks(f.week, Math.ceil(lead));
    if (SEASONAL.includes(p.category) && f.si(p.market, p.category, addWeeks(arrive, 2), 0) < 0.6) continue;
    const proj = project(p.onHand - res, f.weeks, p.forecast, p.arrivals);
    const out1 = proj.find((x) => x.short > 0.5)?.week ?? null;
    const shortUnits = proj.slice(0, horizon + 4).reduce((s, x) => s + x.short, 0);
    if (!out1 && position > safety + sumTo(p.forecast, Math.ceil(lead))) continue;
    const weeksToOut = out1 ? Math.max(0, Math.round((keyToTime(out1) - keyToTime(f.week)) / (7 * 86_400_000))) : null;
    const orderByT = out1 ? keyToTime(out1) - p.leadDays * 86_400_000 : Date.now();
    const late = orderByT < Date.now() - 86_400_000;
    const sizes = splitSizes(qty, p.sizes, p.sizeMix);
    // urgent means an important style that will be empty before anything can arrive
    const priority = weeksToOut != null && weeksToOut <= lead && p.abc === 'A' ? 1 : weeksToOut != null && weeksToOut <= horizon ? 2 : 3;
    const peak = peakAhead(f, p);
    const impact = egpMinor(Math.round(shortUnits * p.price), p.currency);
    out.push({
      key: `reorder:${p.id}`,
      kind: 'reorder',
      area: 'procurement',
      market: p.market,
      title: `Reorder ${p.title}`,
      body: [
        `Sells about ${round1(p.rate)} a week${peak ? ` and ${peak.label} runs ${peak.x.toFixed(1)}× an average month` : ''}, so the next ${horizon} weeks need about ${num(Math.round(demandCover))}.`,
        `There ${p.onHand === 1 ? 'is' : 'are'} ${num(p.onHand)} on hand${res ? ` (${res} promised to open orders)` : ''}${p.onOrder ? ` and ${num(p.onOrder)} on order` : ' and none on order'}${out1 ? `: it runs out in the week of ${fmtDate(out1)}.` : '.'}`,
        `${p.supplierName ?? 'The supplier'} needs ${p.leadDays} days, so ${late ? 'this is already late: order today and ask about air freight.' : `order by ${fmtDay(orderByT)}.`}`,
      ].join(' '),
      reasons: [
        { label: 'Rate', value: `${round1(p.rate)}/wk` },
        { label: 'Cover', value: Number.isFinite(p.cover) ? `${round1(p.cover)} wks` : '—', tone: p.cover < lead ? 'bad' : 'neutral' },
        { label: 'Lead time', value: `${p.leadDays} days` },
        { label: 'Class', value: `${p.abc}${p.xyz}` },
        ...(p.trend > 1.08 ? [{ label: 'Trend', value: `+${Math.round((p.trend - 1) * 100)}%`, tone: 'good' as const }] : []),
      ],
      impact,
      impactLabel: shortUnits > 0.5 ? `${said(egpMinor(Math.round(shortUnits * p.price), p.currency), p.market)} of sales at risk` : 'Keeps the shelf full',
      confidence: confidence(p),
      priority,
      productId: p.id,
      supplierId: p.supplierId,
      payload: { qty, sizes, unitCost: p.cost, currency: p.currency, leadDays: p.leadDays, stockout: out1, orderBy: new Date(orderByT).toISOString(), late, horizon, demandCover: Math.round(demandCover), safety: Math.round(safety), position },
    });
  }
  return out;
}

function seasonOver(p: ProductFacts) {
  // an out-of-season label (SS in autumn, AW in spring) is not bought again this year
  const m = new Date().getUTCMonth();
  if (p.season.startsWith('SS')) return m >= 8 || m <= 1;
  if (p.season.startsWith('AW')) return m >= 2 && m <= 6;
  return false;
}

/** The busiest of the next two months for this style's category, on the learned curve alone. */
function peakAhead(f: Facts, p: ProductFacts) {
  const now = new Date().getUTCMonth();
  const idx = f.index[p.market][p.category];
  let best: { label: string; x: number } | null = null;
  for (const m of [(now + 1) % 12, (now + 2) % 12]) {
    const x = idx[m];
    if (x > 1.2 && (!best || x > best.x)) best = { label: MONTHS[m], x };
  }
  return best;
}

function confidence(p: ProductFacts) {
  let c = p.xyz === 'X' ? 86 : p.xyz === 'Y' ? 74 : 60;
  if (p.weeksLive < 10) c -= 12;
  if (p.weekly.length < 8) c -= 8;
  return Math.max(35, Math.min(95, c));
}

// ── Markdowns ─────────────────────────────────────────────────────────────────────────────────
function markdowns(f: Facts): Rec[] {
  const out: Rec[] = [];
  const history = historyWeeks(f);
  for (const p of f.products) {
    // already reduced by 30% or more: leave the price to the next season's plan
    if ((p.compareAt && 1 - p.price / p.compareAt >= 0.3) || p.onHand < 15) continue;
    const ahead = f.weeks.slice(1, 9).reduce((s, w) => s + f.si(p.market, p.category, w, p.onlineShare), 0) / 8;
    const seasonEnding = SEASONAL.includes(p.category) ? ahead < 0.75 : false;
    // "not selling" needs a season of history to mean anything; a young website has not had one
    const stale = (history[p.market] ?? 0) >= 16 && (p.velocity === 'dead' || (p.velocity === 'slow' && p.cover > 40));
    if (!(seasonEnding && p.cover > 20) && !stale) continue;
    const depth = p.velocity === 'dead' || p.cover > 52 ? 0.5 : p.cover > 32 ? 0.4 : 0.3;
    const lift = 1 + 2.2 * depth; // a 30% cut roughly doubles the rate in fashion
    const before = Math.min(p.onHand, p.rate * 8);
    const after = Math.min(p.onHand, Math.max(p.rate, 0.4) * lift * 8);
    const cash = egpMinor(Math.round(after * p.price * (1 - depth)), p.currency);
    out.push({
      key: `markdown:${p.id}`,
      kind: 'markdown',
      area: 'stock',
      market: p.market,
      title: `Mark down ${p.title} by ${Math.round(depth * 100)}%`,
      body: seasonEnding
        ? `${num(p.onHand)} left and ${CATEGORY_LABEL[p.category].toLowerCase()} is going out of season: the next two months sell ${Math.round((1 - ahead) * 100)}% below an average month. At the current pace that is ${Number.isFinite(p.cover) ? `${Math.round(p.cover)} weeks` : 'more than a year'} of stock. A ${Math.round(depth * 100)}% cut should move about ${Math.round(after)} in eight weeks instead of ${Math.round(before)}.`
        : `${num(p.onHand)} pieces and ${p.weeksSinceSale == null ? 'no sale on record' : p.weeksSinceSale >= 10 ? `no sale in ${p.weeksSinceSale} weeks` : `only ${p.sold8} sold in eight weeks`}. Holding it costs space and cash; a ${Math.round(depth * 100)}% cut should clear about ${Math.round(after)} in eight weeks.`,
      reasons: [
        { label: 'On hand', value: num(p.onHand) },
        { label: 'Cover', value: Number.isFinite(p.cover) ? `${Math.round(p.cover)} wks` : '∞', tone: 'bad' },
        { label: 'Sell-through 8w', value: `${Math.round(p.sellThrough8 * 100)}%`, tone: 'bad' },
        { label: 'Margin', value: `${Math.round(p.margin * 100)}%` },
      ],
      impact: cash,
      impactLabel: `${said(cash, p.market)} back in cash in 8 weeks`,
      confidence: seasonEnding ? 78 : 66,
      priority: p.velocity === 'dead' ? 2 : 3,
      productId: p.id,
      payload: { depth, newPrice: Math.round(p.price * (1 - depth)), currency: p.currency, locations: Object.entries(p.byLocation).filter(([, l]) => l.onHand > 0).map(([id, l]) => ({ id, units: l.onHand })), expectUnits: Math.round(after) },
    });
  }
  return out.sort((a, b) => b.impact - a.impact).slice(0, 14);
}

// ── Transfers between shops and the warehouse ──────────────────────────────────────────────────
function transfers(f: Facts, locs: Loc[]): Rec[] {
  type Line = { productId: string; title: string; qty: number; why: string; price: number; currency: string };
  const routes = new Map<string, { from: string; to: string; market: Market; lines: Line[] }>();
  for (const p of f.products) {
    const spots: Spot[] = [];
    for (const l of locs) {
      if (l.country !== p.market) continue;
      const at = p.byLocation[l.id];
      const sells = sellsBrand(l, p.brand) && (l.kind === 'warehouse' ? p.channels.length > 0 : true);
      if (!at && !sells) continue;
      const seasonal = f.si(p.market, p.category, f.weeks[2], l.kind === 'warehouse' ? 1 : 0) / Math.max(0.2, f.si(p.market, p.category, addWeeks(f.week, -4), l.kind === 'warehouse' ? 1 : 0));
      spots.push({ locationId: l.id, kind: l.kind as Spot['kind'], onHand: Math.max(0, at?.onHand ?? 0), rate: (at?.rate ?? 0) * Math.min(1.6, Math.max(0.5, seasonal)), sells });
    }
    for (const m of rebalance(spots)) {
      const key = `${m.from}>${m.to}`;
      const r = routes.get(key) ?? { from: m.from, to: m.to, market: p.market, lines: [] };
      r.lines.push({ productId: p.id, title: p.title, qty: m.qty, why: m.why, price: p.price, currency: p.currency });
      routes.set(key, r);
    }
  }
  const name = (id: string) => locs.find((l) => l.id === id)?.name ?? id;
  return [...routes.values()]
    .map((r) => {
      const units = r.lines.reduce((s, l) => s + l.qty, 0);
      const value = r.lines.reduce((s, l) => s + egpMinor(l.qty * l.price, l.currency), 0);
      const top = [...r.lines].sort((a, b) => b.qty - a.qty);
      return {
        key: `transfer:${r.from}>${r.to}`,
        kind: 'transfer',
        area: 'stock' as const,
        market: r.market,
        title: `Move ${num(units)} pieces from ${name(r.from)} to ${name(r.to)}`,
        body: `${top.length} style${top.length > 1 ? 's' : ''} sit${top.length > 1 ? '' : 's'} at ${name(r.from)} while ${name(r.to)} is running short of ${top.length > 1 ? 'them' : 'it'}: ${top
          .slice(0, 3)
          .map((l) => `${l.title} (${l.qty})`)
          .join(', ')}${top.length > 3 ? ` and ${top.length - 3} more` : ''}. ${top[0].why}.`,
        reasons: [
          { label: 'Pieces', value: num(units) },
          { label: 'Styles', value: String(top.length) },
          { label: 'Retail value', value: said(value, r.market) },
        ],
        impact: Math.round(value * 0.55),
        impactLabel: `${said(Math.round(value * 0.55), r.market)} of sales unlocked`,
        confidence: 72,
        priority: 3,
        locationId: r.to,
        payload: { from: r.from, to: r.to, lines: r.lines.map((l) => ({ productId: l.productId, qty: l.qty })) },
      } satisfies Rec;
    })
    .filter((r) => (r.payload.lines as unknown[]).length > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 10);
}

// ── Website merchandising ─────────────────────────────────────────────────────────────────────
const COPY = {
  cross_sell: { en: 'Complete the look', ar: 'أكملي إطلالتك' },
  set: { en: 'Make it a set', ar: 'اجعليها طقماً' },
  upsell: { en: 'Treat yourself to the upgrade', ar: 'دلّلي نفسك بالأفضل' },
  popup: { en: 'The last of the season', ar: 'آخر قطع الموسم' },
};

function merchandising(f: Facts, markdownIds: Set<string>): Rec[] {
  const out: Rec[] = [];
  for (const m of ['EG', 'KW'] as Market[]) {
    const inM = f.products.filter((p) => p.market === m && p.channels.length);
    const piece = (p: ProductFacts): Piece => {
      const whRate = Math.max(0.01, p.rate * p.onlineShare);
      return { id: p.id, category: p.category, price: p.price, margin: p.margin, rate: p.rate * p.onlineShare, onHand: p.warehouseOnHand, cover: p.warehouseOnHand / whRate, channels: p.channels };
    };
    const pieces = new Map(inM.map((p) => [p.id, piece(p)]));
    // the pages shoppers actually land on: fast and steady sellers, or on a young website its best sellers
    const ranked = inM.filter((p) => p.sold8 > 0 && p.warehouseOnHand > 2).sort((a, b) => b.sold8 - a.sold8);
    const top = new Set(ranked.slice(0, Math.max(12, Math.ceil(ranked.length * 0.15))).map((p) => p.id));
    const anchors = inM.filter((p) => ((p.velocity === 'fast' || p.velocity === 'steady') && p.warehouseOnHand > 5) || top.has(p.id)).map((p) => pieces.get(p.id)!);
    const push = inM
      .filter((p) => !markdownIds.has(p.id) && (p.velocity === 'slow' || p.velocity === 'dead' || p.velocity === 'steady') && worthPushing(pieces.get(p.id)!))
      .sort((a, b) => b.warehouseOnHand * b.cost - a.warehouseOnHand * a.cost)
      .slice(0, 9);

    const pushed = new Set<string>();
    for (const p of push) {
      // one proposal per brand and category: the next one in line waits for the result
      const family = `${p.brand}|${p.category}`;
      if (pushed.has(family)) continue;
      const it = pieces.get(p.id)!;
      const as = anchorsFor(it, anchors, 4);
      if (!as.length) continue;
      const perWeek = crossSellUplift(as.map((a) => a.rate));
      const units30 = Math.min(p.warehouseOnHand, Math.round(perWeek * 4.3));
      pushed.add(family);
      const anchorTitles = as.map((a) => f.byId.get(a.id)!.title);
      const set = f.byId.get(as[0].id)!.category === p.category || (p.category === 'homewear' && f.byId.get(as[0].id)!.category === 'nightwear');
      const copy = set ? COPY.set : COPY.cross_sell;
      const rev = egpMinor(units30 * p.price, p.currency);
      out.push({
        key: `cross_sell:${p.id}`,
        kind: 'cross_sell',
        area: 'merch',
        market: m,
        title: `Show ${p.title} on ${as.length} best-selling product page${as.length > 1 ? 's' : ''}`,
        body: `${num(p.warehouseOnHand)} in the warehouse and only ${p.sold8} sold in eight weeks. It is worn with ${anchorTitles.slice(0, 2).join(' and ')}${anchorTitles.length > 2 ? ` and ${anchorTitles.length - 2} more` : ''}, which sell ${round1(as.reduce((s, a) => s + a.rate, 0))} a week online. A “${copy.en}” row under their add-to-bag button ${units30 >= 2 ? `should sell about ${units30} extra in 30 days` : 'puts it in front of the shoppers who are already buying'}.`,
        reasons: [
          { label: 'Warehouse', value: num(p.warehouseOnHand) },
          { label: 'Sold 8w', value: num(p.sold8), tone: 'bad' },
          { label: 'Anchor pages', value: String(as.length) },
          { label: 'Margin', value: `${Math.round(p.margin * 100)}%`, tone: 'good' },
        ],
        impact: rev,
        impactLabel: units30 >= 2 ? `+${units30} units · ${said(rev, p.market)} in 30 days` : 'Grows with the traffic on those pages',
        confidence: units30 >= 2 ? 64 : 48,
        priority: 3,
        productId: p.id,
        payload: { kind: 'cross_sell', items: [p.id], anchors: as.map((a) => a.id), channels: p.channels.filter((c) => as.some((a) => a.channels.includes(c))), headline: copy.en, headlineAr: copy.ar, expectUnits30: units30 },
      });
    }

    const fast = inM.filter((p) => p.velocity === 'fast').sort((a, b) => b.rate - a.rate).slice(0, 8);
    for (const a of fast) {
      const up = upsellFor(pieces.get(a.id)!, [...pieces.values()]);
      if (!up) continue;
      const u = f.byId.get(up.id)!;
      if (out.some((r) => r.productId === u.id)) continue;
      const units30 = Math.min(u.warehouseOnHand, Math.max(2, Math.round(a.rate * a.onlineShare * 4.3 * 34 * 0.03 * 0.3)));
      const rev = egpMinor(units30 * u.price, u.currency);
      out.push({
        key: `upsell:${u.id}`,
        kind: 'upsell',
        area: 'merch',
        market: m,
        title: `Offer ${u.title} as the step up from ${a.title}`,
        body: `${a.title} is one of the fastest sellers online (${round1(a.rate)} a week). ${u.title} is the same kind of piece at ${money(u.price, u.currency)}, with ${num(u.warehouseOnHand)} in the warehouse and a ${Math.round(u.margin * 100)}% margin. Shown as an upgrade on its page and in the cart, it should sell about ${units30} in 30 days.`,
        reasons: [
          { label: 'Anchor rate', value: `${round1(a.rate)}/wk`, tone: 'good' },
          { label: 'Price step', value: `+${Math.round((u.price / a.price - 1) * 100)}%` },
          { label: 'Cover', value: `${Math.round(up.cover)} wks`, tone: 'bad' },
        ],
        impact: rev,
        impactLabel: `+${units30} units · ${said(rev, u.market)} in 30 days`,
        confidence: 58,
        priority: 4,
        productId: u.id,
        payload: { kind: 'upsell', items: [u.id], anchors: [a.id], channels: u.channels.filter((c) => a.channels.includes(c)), headline: COPY.upsell.en, headlineAr: COPY.upsell.ar, expectUnits30: units30 },
      });
    }

    // one clearance pop-up per catalogue (a website and its app share one), for its leftovers
    const sites = [...new Set(inM.map((p) => p.channels.join('+')))].map((k) => k.split('+'));
    for (const group of sites) {
      const site = group[0];
      const left = inM.filter((p) => group.every((c) => p.channels.includes(c)) && markdownIds.has(p.id) && p.warehouseOnHand >= 8).sort((a, b) => b.warehouseOnHand - a.warehouseOnHand).slice(0, 4);
      if (left.length < 3) continue;
      // about 1.6 pieces to an order
      const ordersWk = inM.filter((p) => p.channels.includes(site)).reduce((s, p) => s + p.rate * p.onlineShare, 0) / 1.6;
      const units30 = Math.round(popupUplift(ordersWk) * 4.3 * left.length * 0.6);
      const rev = left.reduce((s, p) => s + egpMinor(Math.round((units30 / left.length) * p.price * 0.7), p.currency), 0);
      out.push({
        key: `popup:${site}`,
        kind: 'popup',
        area: 'merch',
        market: m,
        title: `Pop-up on ${group.map(channelLabel).join(' and ')}: the last of the season`,
        body: `${left.length} out-of-season styles have ${num(left.reduce((s, p) => s + p.warehouseOnHand, 0))} pieces left in the warehouse: ${left.map((p) => p.title).join(', ')}. A pop-up for returning visitors, once a session, with the markdown price, should clear about ${units30} in 30 days. Publish it after the markdown is approved.`,
        reasons: [
          { label: 'Styles', value: String(left.length) },
          { label: 'Pieces', value: num(left.reduce((s, p) => s + p.warehouseOnHand, 0)) },
          { label: 'Site orders/wk', value: num(Math.round(ordersWk)) },
        ],
        impact: rev,
        impactLabel: `+${units30} units · ${said(rev, left[0].market)} in 30 days`,
        confidence: 55,
        priority: 4,
        payload: { kind: 'popup', items: left.map((p) => p.id), anchors: [], channels: group, headline: COPY.popup.en, headlineAr: COPY.popup.ar, offer: 'Up to 40% off', expectUnits30: units30 },
      });
    }
  }
  return out;
}

// ── Cycle counts ──────────────────────────────────────────────────────────────────────────────
async function counts(f: Facts, locs: Loc[], rules: StockRules): Promise<Rec[]> {
  const db = await getDb();
  const rows = await db.execute<{ product_id: string; location_id: string; counted: string | null; negative: number }>(sql`
    select product_id, location_id, min(counted_at)::text as counted, count(*) filter (where on_hand < 0)::int as negative
    from stock_levels where on_hand <> 0 or counted_at is not null group by 1, 2`);
  const out: Rec[] = [];
  for (const l of locs) {
    const here = rows.rows.filter((r) => r.location_id === l.id);
    // A and B styles past their count date, the most valuable first, a shift's worth at most
    const due = here
      .filter((r) => {
        const p = f.byId.get(r.product_id);
        if (!p) return false;
        if (r.negative > 0) return true;
        if (p.abc === 'C') return false;
        const every = rules.countEveryDays[p.abc] * 86_400_000;
        return !r.counted || Date.now() - new Date(r.counted).getTime() > every;
      })
      .sort((a, b) => b.negative - a.negative || (f.byId.get(b.product_id)?.valueRetailEgp ?? 0) - (f.byId.get(a.product_id)?.valueRetailEgp ?? 0))
      .slice(0, 40);
    const negative = due.filter((r) => r.negative > 0).length;
    if (due.length < (l.kind === 'warehouse' ? 8 : 6) && !negative) continue;
    const a = due.filter((r) => f.byId.get(r.product_id)?.abc === 'A').length;
    const units = due.reduce((s, r) => s + Math.max(0, f.byId.get(r.product_id)?.byLocation[l.id]?.onHand ?? 0), 0);
    out.push({
      key: `count:${l.id}`,
      kind: 'count',
      area: 'warehouse',
      market: l.country as Market,
      title: `Count ${due.length} styles at ${l.name}`,
      body: `${negative ? `${negative} style${negative > 1 ? 's show' : ' shows'} less than zero on hand, which means a sale or a delivery was booked wrong. ` : ''}${a} A-style${a === 1 ? '' : 's'} (the ones that make most of the money) ${a === 1 ? 'is' : 'are'} past ${rules.countEveryDays.A} days since a count. About ${num(units)} pieces, roughly ${Math.max(15, Math.round(units * 0.05 + due.length * 2))} minutes.`,
      reasons: [
        { label: 'Styles', value: String(due.length) },
        { label: 'A-styles', value: String(a) },
        ...(negative ? [{ label: 'Below zero', value: String(negative), tone: 'bad' as const }] : []),
      ],
      impact: 0,
      impactLabel: negative ? 'Fixes stock the websites cannot trust' : 'Keeps the numbers honest',
      confidence: 90,
      priority: negative ? 2 : 4,
      locationId: l.id,
      payload: { locationId: l.id, productIds: due.map((r) => r.product_id), units },
    });
  }
  return out.sort((a, b) => a.priority - b.priority).slice(0, 8);
}

// ── Purchase orders that will land too late ───────────────────────────────────────────────────
async function expedites(f: Facts): Promise<Rec[]> {
  const db = await getDb();
  const open = await db
    .select({ po: schema.purchaseOrders, supplier: schema.suppliers.name })
    .from(schema.purchaseOrders)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
    .where(inArray(schema.purchaseOrders.status, ['sent', 'confirmed']));
  const out: Rec[] = [];
  for (const { po, supplier } of open) {
    if (!po.expectedAt) continue;
    const lines = await db.select({ productId: schema.poLines.productId }).from(schema.poLines).where(eq(schema.poLines.poId, po.id));
    const ids = [...new Set(lines.map((l) => l.productId))];
    const hurt = ids
      .map((id) => f.byId.get(id))
      .filter((p): p is ProductFacts => Boolean(p && p.abc !== 'C'))
      .map((p) => ({ p, out: project(p.onHand, f.weeks, p.forecast).find((x) => x.short > 0.5)?.week }))
      .filter((x) => x.out && keyToTime(x.out) < po.expectedAt!.getTime() - 3 * 86_400_000);
    if (!hurt.length) continue;
    const lost = hurt.reduce((s, x) => {
      const gap = Math.ceil((po.expectedAt!.getTime() - keyToTime(x.out!)) / (7 * 86_400_000));
      return s + egpMinor(Math.round(sumTo(x.p.forecast.slice(f.weeks.indexOf(x.out!)), gap) * x.p.price), x.p.currency);
    }, 0);
    out.push({
      key: `expedite:${po.id}`,
      kind: 'expedite',
      area: 'procurement',
      market: po.market as Market,
      title: `Ask ${supplier ?? 'the supplier'} to bring ${po.number} forward`,
      body: `${po.number} lands ${fmtDay(po.expectedAt.getTime())}, but ${hurt.length} of its styles run out before then: ${hurt
        .slice(0, 3)
        .map((x) => `${x.p.title} (week of ${fmtDate(x.out!)})`)
        .join(', ')}. Ask for a partial air shipment of those lines.`,
      reasons: [
        { label: 'Lands', value: fmtDay(po.expectedAt.getTime()) },
        { label: 'Styles short', value: String(hurt.length), tone: 'bad' },
      ],
      impact: lost,
      impactLabel: `${said(lost, hurt[0].p.market)} of sales lost while waiting`,
      confidence: 70,
      priority: 1,
      supplierId: po.supplierId,
      payload: { poId: po.id, number: po.number, products: hurt.map((x) => x.p.id) },
    });
  }
  return out;
}

// ── Writing the proposals ─────────────────────────────────────────────────────────────────────
async function upsert(recs: Rec[], runId: string) {
  const db = await getDb();
  const existing = await db.select().from(schema.recommendations);
  const byKey = new Map(existing.map((r) => [r.key, r]));
  const seen = new Set<string>();
  const now = new Date();
  for (const r of recs) {
    seen.add(r.key);
    const prev = byKey.get(r.key);
    const values = { kind: r.kind, area: r.area, market: r.market, title: r.title, body: r.body, reasons: r.reasons, impact: r.impact, impactLabel: r.impactLabel, confidence: r.confidence, priority: r.priority, productId: r.productId ?? null, locationId: r.locationId ?? null, supplierId: r.supplierId ?? null, payload: r.payload, runId, updatedAt: now };
    if (!prev) {
      await db.insert(schema.recommendations).values({ key: r.key, status: 'open', ...values });
      continue;
    }
    const age = prev.decidedAt ? now.getTime() - prev.decidedAt.getTime() : 0;
    if (prev.status === 'open') await db.update(schema.recommendations).set(values).where(eq(schema.recommendations.id, prev.id));
    // a decision stands for a while; after that the planner may raise it again if it still holds
    else if ((prev.status === 'dismissed' && age > 14 * 86_400_000) || (['accepted', 'done', 'expired'].includes(prev.status) && age > 21 * 86_400_000) || (prev.status === 'expired' && !prev.decidedAt)) {
      await db.update(schema.recommendations).set({ ...values, status: 'open', createdAt: now, decidedAt: null, decidedBy: null, decidedByName: null, resultRef: null }).where(eq(schema.recommendations.id, prev.id));
    }
  }
  const stale = existing.filter((r) => r.status === 'open' && !seen.has(r.key)).map((r) => r.id);
  if (stale.length) await db.update(schema.recommendations).set({ status: 'expired', updatedAt: now }).where(inArray(schema.recommendations.id, stale));
  return { written: recs.length, expired: stale.length };
}

// ── Routine tasks and who does them ───────────────────────────────────────────────────────────
export async function candidatesFor(area: 'warehouse' | 'procurement' | 'merch' | 'stock') {
  const db = await getDb();
  const [users, locs, queue, done] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.active, true)),
    db.select({ id: schema.locations.id, country: schema.locations.country }).from(schema.locations),
    db.execute<{ assignee_id: string; minutes: number }>(sql`select assignee_id, sum(est_minutes)::int as minutes from tasks where status in ('open','doing') and assignee_id is not null group by 1`),
    db.execute<{ assignee_id: string; est: number; spent: number | null }>(sql`select assignee_id, est_minutes as est, spent_minutes as spent from tasks where status = 'done' and done_at > now() - interval '30 days' and assignee_id is not null`),
  ]);
  return users
    // managers hand work out; they are not handed it
    .filter((u) => !['admin', 'viewer', 'supply', 'ops'].includes(u.role))
    .map(
      (u): Candidate => ({
        id: u.id,
        level: level({ scopes: effectiveScopes(u.role, u.scopes) }, area),
        locationId: u.locationId,
        country: locs.find((l) => l.id === u.locationId)?.country ?? (u.channels.length ? CHANNEL[u.channels[0]]?.country ?? null : null),
        shift: u.shiftStart != null && u.shiftEnd != null ? { start: u.shiftStart, end: u.shiftEnd, restDays: u.restDays } : null,
        queueMinutes: queue.rows.find((q) => q.assignee_id === u.id)?.minutes ?? 0,
        pace: pace(done.rows.filter((d) => d.assignee_id === u.id).map((d) => ({ estMinutes: d.est, spentMinutes: d.spent }))),
        skills: u.skills,
      }),
    )
    .filter((c) => c.level >= 2);
}

export async function createTask(t: {
  kind: TaskKind;
  title: string;
  detail?: string;
  locationId?: string | null;
  units?: number;
  dueAt?: Date | null;
  priority?: number;
  refType?: string;
  refId?: string;
  source?: 'ai' | 'manual' | 'system';
  by: { id: string | null; name: string };
  assigneeId?: string | null;
  autoAssign?: boolean;
  at?: Date;
}) {
  const db = await getDb();
  const area = TASK_KIND[t.kind].area;
  const est = estimateMinutes(t.kind, t.units ?? 0);
  let assignee = t.assigneeId ?? null;
  if (!assignee && t.autoAssign !== false) {
    const [loc] = t.locationId ? await db.select({ country: schema.locations.country }).from(schema.locations).where(eq(schema.locations.id, t.locationId)) : [];
    assignee = pickAssignee({ kind: t.kind, locationId: t.locationId ?? null, country: loc?.country ?? null, estMinutes: est }, await candidatesFor(area), Date.now());
  }
  const [row] = await db
    .insert(schema.tasks)
    .values({
      number: await nextNumber('task'),
      kind: t.kind,
      area,
      title: t.title,
      detail: t.detail ?? null,
      locationId: t.locationId ?? null,
      assigneeId: assignee,
      priority: t.priority ?? 3,
      dueAt: t.dueAt ?? null,
      estMinutes: est,
      units: t.units ?? 0,
      refType: t.refType ?? null,
      refId: t.refId ?? null,
      source: t.source ?? 'manual',
      createdBy: t.by.id,
      createdByName: t.by.name,
      createdAt: t.at ?? new Date(),
    })
    .returning();
  return row;
}

async function routineTasks(rules: StockRules) {
  if (!rules.autoTasks) return 0;
  const db = await getDb();
  let made = 0;
  const pos = await db
    .select({ po: schema.purchaseOrders, supplier: schema.suppliers.name })
    .from(schema.purchaseOrders)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
    .where(inArray(schema.purchaseOrders.status, ['sent', 'confirmed', 'partial']));
  const openTasks = await db.select({ kind: schema.tasks.kind, refId: schema.tasks.refId }).from(schema.tasks).where(inArray(schema.tasks.status, ['open', 'doing', 'blocked']));
  const has = (kind: string, ref: string) => openTasks.some((t) => t.kind === kind && t.refId === ref);
  const now = Date.now();
  for (const { po, supplier } of pos) {
    const due = po.expectedAt?.getTime() ?? null;
    if ((po.status === 'confirmed' || po.status === 'partial') && due && due < now + 36 * 3_600_000 && !has('receive', po.id)) {
      const [{ left }] = (await db.execute<{ left: number }>(sql`select coalesce(sum(qty - received), 0)::int as left from po_lines where po_id = ${po.id}`)).rows;
      await createTask({ kind: 'receive', title: `Receive ${po.number} from ${supplier ?? 'supplier'}`, detail: `${num(left)} pieces expected ${fmtDay(due)}. Scan each carton; anything short or damaged is recorded against the line.`, locationId: po.locationId, units: left, dueAt: new Date(Math.max(due, now) + 6 * 3_600_000), priority: 2, refType: 'po', refId: po.id, source: 'ai', by: PLANNER, autoAssign: rules.autoAssign });
      made++;
    }
    const chaseAfter = rules.chaseAfterDays * 86_400_000;
    if (po.status === 'sent' && po.sentAt && now - po.sentAt.getTime() > chaseAfter && !has('supplier_followup', po.id)) {
      await createTask({ kind: 'supplier_followup', title: `Chase ${supplier ?? 'supplier'} to confirm ${po.number}`, detail: `Sent ${fmtDay(po.sentAt.getTime())} and not confirmed yet. Get the ship date and the quantities they can do.`, units: po.units, dueAt: new Date(now + 8 * 3_600_000), priority: 2, refType: 'po', refId: po.id, source: 'ai', by: PLANNER, assigneeId: po.createdBy, autoAssign: rules.autoAssign });
      made++;
    }
    if (due && due < now - 2 * 86_400_000 && po.status !== 'partial' && !has('supplier_followup', po.id)) {
      await createTask({ kind: 'supplier_followup', title: `${po.number} is ${Math.round((now - due) / 86_400_000)} days late: get a new date`, detail: `${supplier ?? 'The supplier'} promised ${fmtDay(due)}. Ask where it is and update the expected date so the plan can use it.`, dueAt: new Date(now + 6 * 3_600_000), priority: 1, refType: 'po', refId: po.id, source: 'ai', by: PLANNER, assigneeId: po.createdBy, autoAssign: rules.autoAssign });
      made++;
    }
  }
  if (rules.autoAssign) {
    const loose = await db.select().from(schema.tasks).where(and(eq(schema.tasks.status, 'open'), sql`${schema.tasks.assigneeId} is null`));
    for (const t of loose) {
      const area = t.area as 'warehouse' | 'procurement' | 'merch' | 'stock';
      const [loc] = t.locationId ? await db.select({ country: schema.locations.country }).from(schema.locations).where(eq(schema.locations.id, t.locationId)) : [];
      const who = pickAssignee({ kind: t.kind as TaskKind, locationId: t.locationId, country: loc?.country ?? null, estMinutes: t.estMinutes }, await candidatesFor(area), now);
      if (who) await db.update(schema.tasks).set({ assigneeId: who }).where(eq(schema.tasks.id, t.id));
    }
  }
  return made;
}

export type RunSummary = { at: string; ms: number; recs: number; expired: number; byKind: Record<string, number>; impact: number; tasks: number; drafted?: number };

/** One full pass. Called by the schedule, after a demo rebuild, and from "Run the planner now". */
export async function runPlanner(opts: { quiet?: boolean } = {}): Promise<RunSummary> {
  const t0 = Date.now();
  // the websites' latest orders into the weekly sales the planner reads (this week and last)
  await rollupOnlineSales(addWeeks(weekOfNow(), -1));
  const [f, rules, db] = await Promise.all([getFacts({ fresh: true }), stockRules(), getDb()]);
  const locs = (await db.select().from(schema.locations).where(eq(schema.locations.active, true))).map((l) => ({ id: l.id, kind: l.kind, name: l.name, country: l.country, brands: l.brands }));
  const reserved = await reservedByProduct();
  const md = markdowns(f);
  const recs = [...reorders(f, rules, reserved), ...md, ...transfers(f, locs), ...merchandising(f, new Set(md.map((r) => r.productId!))), ...(await counts(f, locs, rules)), ...(await expedites(f))];
  const runId = `run-${t0}`;
  const { written, expired } = await upsert(recs, runId);
  // what the AI may do by itself (Rules → the AI planner): draft the routine work, and with autopilot
  // send its drafts for approval. Markdowns and website placements always wait for a person.
  let drafted = 0;
  if (rules.autonomy !== 'suggest') {
    const ops = await import('./ops');
    const mine = await db
      .select({ id: schema.recommendations.id, kind: schema.recommendations.kind, priority: schema.recommendations.priority })
      .from(schema.recommendations)
      .where(and(eq(schema.recommendations.status, 'open'), eq(schema.recommendations.runId, runId), inArray(schema.recommendations.kind, ['reorder', 'transfer', 'count'])));
    for (const r of mine) {
      if (r.kind === 'reorder' && r.priority > 2) continue;
      try {
        await ops.acceptRecommendation(ops.PLANNER_PRINCIPAL, r.id);
        drafted++;
      } catch (e) {
        console.error('[stock] planner could not apply', r.id, e);
      }
    }
    if (rules.autonomy === 'auto') {
      const drafts = await db.select({ id: schema.purchaseOrders.id }).from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.status, 'draft'), eq(schema.purchaseOrders.source, 'ai')));
      for (const d of drafts) await ops.movePo(ops.PLANNER_PRINCIPAL, d.id, 'approval').catch(() => undefined);
    }
  }
  const tasks = await routineTasks(rules);
  const byKind = recs.reduce<Record<string, number>>((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {});
  const summary: RunSummary = { at: new Date().toISOString(), ms: Date.now() - t0, recs: written, expired, byKind, impact: recs.reduce((s, r) => s + r.impact, 0), tasks, drafted };
  await db
    .insert(schema.settings)
    .values({ key: 'stock.last_run', value: summary })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: summary, updatedAt: new Date() } });
  if (!opts.quiet) {
    await logActivity(PLANNER, { area: 'stock', kind: 'planner', message: `Read ${num(f.products.length)} styles and proposed ${written} actions worth ${money(summary.impact, 'EGP', { compact: true })}${tasks ? `; raised ${tasks} routine task${tasks > 1 ? 's' : ''}` : ''}.`, data: { byKind } });
    stockChanged('The AI planner finished a pass');
  }
  return summary;
}

/** Weeks of sales history each market has: a young website has not yet seen a full season. */
function historyWeeks(f: Facts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of f.products) {
    const first = p.weekly.findIndex((o) => o.units > 0);
    if (first < 0) continue;
    const weeks = p.weekly.length - first;
    out[p.market] = Math.max(out[p.market] ?? 0, weeks);
  }
  return out;
}

async function reservedByProduct() {
  const db = await getDb();
  const kw = Object.values(CHANNEL)
    .filter((c) => c.country === 'KW')
    .map((c) => c.id);
  const rows = await db.execute<{ product_id: string; n: number }>(sql`
    select v.product_id, sum(i.quantity)::int as n
    from order_items i join orders o on o.id = i.order_id join variants v on v.sku = i.sku join products p on p.id = v.product_id
    where o.stage in ('new','confirming','finance','ready','picking')
      and p.market = case when o.channel_id in (${sql.join([...kw, '-'].map((c) => sql`${c}`), sql`, `)}) then 'KW' else 'EG' end
    group by 1`);
  return new Map(rows.rows.map((r) => [r.product_id, r.n]));
}

export async function lastRun(): Promise<RunSummary | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'stock.last_run'));
  return (row?.value as RunSummary) ?? null;
}

