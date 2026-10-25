import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { CHANNEL, channelConfigured } from '../channels';
import type { Principal } from '../domain/perms';
import { decimalsFor, TO_EGP } from '../format';
import { brandMatch, scope } from '../queries';
import { marketsFor, sees, viewCurrency, type Sees } from '../stock/views/common';
import { bucketsOf, PRESETS, rangeOf, ymd, type Grain, type Preset, type Query, type Range } from './periods';
export { bucketsOf, PRESETS, rangeOf, type Grain, type Preset, type Query, type Range };

/**
 * Reports (Dan, 25 Oct: "an analytics module with every report the finance team or a brand manager may
 * need"). Each report is a definition: who may open it, which filters it takes, and a `run` that reads
 * the database for one period and returns figures, charts and tables. One page draws any of them and one
 * route exports any of them, so a new report is a new definition and nothing else.
 *
 * Money is EGP-equivalent minor units inside a report (so markets add up) and shows in the view's
 * currency: a Labesny view reads KWD. Days are the business's own: Kuwait time for Labesny, Cairo for FIG.
 */

export type Fmt = 'money' | 'int' | 'num' | 'pct' | 'text' | 'date' | 'hours' | 'days' | 'weeks';
export type Measure = 'value' | 'units';

export type Fig = { label: string; value: number | string | null; fmt: Fmt; prev?: number | null; better?: 'up' | 'down'; note?: string; measure?: Measure };
export type Col = { key: string; label: string; fmt: Fmt; total?: boolean; measure?: Measure; wide?: boolean; exportOnly?: boolean };
export type Row = Record<string, string | number | null | undefined> & { _href?: string };
export type Table = { title: string; sub?: string; columns: Col[]; rows: Row[]; limit?: number };
export type Series = { name: string; values: number[]; measure: Measure; color?: string };
export type Chart =
  | { kind: 'trend'; title: string; sub?: string; labels: string[]; series: Series[] }
  | { kind: 'bars'; title: string; sub?: string; rows: { label: string; value: number; units?: number; sub?: string; href?: string }[]; fmt: Fmt; measured?: boolean; ordered?: boolean }
  | { kind: 'heatmap'; title: string; sub?: string; grid: number[][]; rows: string[] };
export type Result = { figures: Fig[]; charts: Chart[]; tables: Table[]; notes?: string[]; empty?: string };

export type Filter = 'brand' | 'channel' | 'category' | 'branch';
export type Group = 'sales' | 'brands' | 'stock' | 'customers' | 'returns' | 'finance' | 'operations';
export const GROUPS: { key: Group; label: string; sub: string }[] = [
  { key: 'sales', label: 'Sales', sub: 'What sold, when, where and how it was paid' },
  { key: 'brands', label: 'Brands & products', sub: 'How each brand, category, style and size performs' },
  { key: 'stock', label: 'Stock', sub: 'What is on hand, where, and how healthy it is' },
  { key: 'customers', label: 'Customers', sub: 'Who buys, how often, and from where' },
  { key: 'returns', label: 'Returns & cancellations', sub: 'What comes back, why, and what it costs' },
  { key: 'finance', label: 'Finance', sub: 'Revenue, payments, refunds, cash and margin' },
  { key: 'operations', label: 'Operations', sub: 'Speed, couriers and deadlines' },
];

export type Report = {
  id: string;
  group: Group;
  title: string;
  blurb: string;
  /** Who it is mostly for, shown on its card. */
  for: ('finance' | 'brand' | 'ops' | 'management')[];
  filters: Filter[];
  /** Extra access beyond opening Reports: money (amounts), payments (money 2), cost (margin), customers (names). */
  needs?: ('money' | 'payments' | 'cost' | 'customers')[];
  /** Reads whole orders (payments, totals, every brand in the basket): not offered to someone limited to brands. */
  wholeOrders?: boolean;
  /** The websites' order handling (payments to chase, couriers, deadlines, refunds): only for the people who work the orders. */
  floor?: boolean;
  /** Reads no period (a stock snapshot): the period chips are hidden. */
  snapshot?: boolean;
  run: (c: Ctx) => Promise<Result>;
};

// ── The reading context ────────────────────────────────────────────────────────────────────────


export type Ctx = {
  p: Principal;
  s: Sees;
  /** Amounts shown at all (money level 1+). */
  money: boolean;
  payments: boolean;
  cost: boolean;
  customers: boolean;
  currency: string;
  tz: string;
  range: Range;
  q: Query;
  /** The stores read: the person's, in the markets they cover, connected stores only where one is connected. */
  channels: string[];
  /** Orders this person may see in the stores read, narrowed by the brand / store / category filters. */
  orders: (o?: string) => SQL;
  /** Order lines of the brands this person covers, narrowed by the brand and category filters. */
  items: (oi?: string) => SQL;
  /** Products (the catalogue) in the markets read, of the person's brands, narrowed by the filters. */
  products: (p?: string) => SQL;
  /** An amount column in its own currency as EGP-equivalent minor units, so stores add up. */
  egp: (amount: SQL, currency: SQL) => SQL;
  /** A timestamp as the business's local date (or bucket start). */
  day: (ts: SQL, grain?: Grain) => SQL;
  between: (ts: SQL, which?: 'now' | 'prev') => SQL;
};

/** A sale is an order that went ahead: not cancelled, not refused at the door. */
export const SOLD = (o = 'o') => sql.raw(`${o}.stage not in ('cancelled', 'rto', 'rto_closed')`);

export const list = (xs: string[]) => (xs.length ? sql.join(xs.map((x) => sql`${x}`), sql`, `) : sql`'—'`);

export function contextFor(p: Principal, q: Query): Ctx {
  const s = sees(p);
  const markets = marketsFor(p);
  const inScope = Object.values(CHANNEL).filter((c) => !c.parked && markets.includes(c.country as 'EG' | 'KW') && (!p.channels.length || p.channels.includes(c.id)));
  let channels = inScope.filter((c) => !inScope.some((x) => x.country === c.country && channelConfigured(x)) || channelConfigured(c)).map((c) => c.id);
  if (q.channel && channels.includes(q.channel)) channels = [q.channel];
  const range = rangeOf(q);
  const tz = markets.length === 1 && markets[0] === 'KW' ? 'Asia/Kuwait' : 'Africa/Cairo';
  const factor = (c: string) => ((TO_EGP[c] ?? 1) * 100) / 10 ** decimalsFor(c);
  const egpOf = (amount: SQL, currency: SQL) =>
    sql`((${amount})::numeric * case ${currency} ${sql.join(
      Object.keys(TO_EGP).map((c) => sql.raw(`when '${c}' then ${factor(c)}`)),
      sql` `,
    )} else 1 end)`;
  const brandFilter = q.brand ? [q.brand] : [];
  const items = (oi = 'oi') => {
    const col = sql.raw(`${oi}.brand`);
    const parts: SQL[] = [brandMatch(p.brands, col)];
    if (brandFilter.length) parts.push(brandMatch(brandFilter, col));
    if (q.category) parts.push(sql`${sql.raw(`${oi}.category`)} = ${q.category}`);
    return sql.join(parts, sql` and `);
  };
  const orders = (o = 'o') => {
    const id = sql.raw(`${o}.id`);
    const parts: SQL[] = [sql`${sql.raw(`${o}.channel_id`)} in (${list(channels)})`, scope({ channels: [], brands: p.brands }, sql.raw(`${o}.channel_id`), id)];
    if (brandFilter.length || q.category) parts.push(sql`exists (select 1 from order_items fi where fi.order_id = ${id} and ${items('fi')})`);
    return sql.join(parts, sql` and `);
  };
  const products = (pr = 'p') => {
    const parts: SQL[] = [sql`${sql.raw(`${pr}.market`)} in (${list(markets)})`, brandMatch(p.brands, sql.raw(`${pr}.brand`))];
    if (brandFilter.length) parts.push(brandMatch(brandFilter, sql.raw(`${pr}.brand`)));
    if (q.category) parts.push(sql`${sql.raw(`${pr}.category`)} = ${q.category}`);
    return sql.join(parts, sql` and `);
  };
  const day = (ts: SQL, grain: Grain = 'day') => sql`date_trunc(${grain}, ${ts} at time zone ${tz})::date`;
  const between = (ts: SQL, which: 'now' | 'prev' = 'now') => {
    const [f, t] = which === 'now' ? [range.from, range.to] : [range.prevFrom, range.prevTo];
    // the period's days are local days: midnight in the business's own time zone
    return sql`${ts} >= (${ymd(f)}::timestamp at time zone ${tz}) and ${ts} < (${ymd(t)}::timestamp at time zone ${tz})`;
  };
  return {
    p,
    s,
    money: s.money,
    payments: s.money && (p.scopes.money ?? 0) >= 2,
    cost: s.cost,
    customers: (p.scopes.customers ?? 0) >= 1,
    currency: viewCurrency(p),
    tz,
    range,
    q,
    channels,
    orders,
    items,
    products,
    egp: egpOf,
    day,
    between,
  };
}

// ── Small helpers for report definitions ───────────────────────────────────────────────────────

/**
 * A line's value before discounts (Shopify's original unit price × quantity), and after them: the
 * order's discount shared over its lines by value, so a brand's sales carry their part of a basket
 * discount and the brands of one order add up to the order. Both EGP-equivalent minor.
 */
export const lineGross = (c: Ctx, oi = 'oi', o = 'o') => c.egp(sql.raw(`${oi}.unit_price * ${oi}.quantity`), sql.raw(`${o}.currency`));
export const lineNet = (c: Ctx, oi = 'oi', o = 'o') =>
  c.egp(sql.raw(`${oi}.unit_price * ${oi}.quantity * (1 - coalesce(${o}.discount::numeric / nullif(${o}.subtotal, 0), 0))`), sql.raw(`${o}.currency`));

export const n = (v: unknown) => Number(v ?? 0);
export const ratio = (a: number, b: number) => (b ? a / b : null);
export const ymdOf = ymd;
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Rows keyed by bucket into one value per bucket, zero where nothing happened. */
export function series(keys: string[], rows: { k: string; v: number }[]) {
  const m = new Map(rows.map((r) => [r.k, r.v]));
  return keys.map((k) => m.get(k) ?? 0);
}

/** Share of a total, for a table's "share" column. */
export const shareOf = (v: number, total: number) => (total ? v / total : null);
