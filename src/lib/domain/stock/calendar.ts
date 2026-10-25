// The retail calendar the planner reads: Sunday-start weeks in Gulf/Cairo time, and the moments
// that move fashion in Egypt and Kuwait (White Friday, the run-up to each Eid, Mother's Day, the
// Kuwaiti summer away). Pure: dates in, numbers out.

import type { Category } from './categories';

export const DAY = 86_400_000;
const OFFSET = 3 * 3_600_000; // Kuwait all year, Cairo in summer; close enough for day and week keys

export type Market = 'EG' | 'KW';

/** "2026-10-13" for a moment, in local time. */
export const dayKey = (t: number | Date) => new Date(+t + OFFSET).toISOString().slice(0, 10);

/** The Sunday a moment's week starts on, as "YYYY-MM-DD". */
export function weekOf(t: number | Date): string {
  const d = new Date(+t + OFFSET);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay())).toISOString().slice(0, 10);
}

const keyMs = (k: string) => Date.parse(`${k}T00:00:00Z`);

/** Local midnight at the start of a day key, as a timestamp. */
export const keyToTime = (k: string) => keyMs(k) - OFFSET;

export const addDays = (k: string, n: number) => new Date(keyMs(k) + n * DAY).toISOString().slice(0, 10);
export const addWeeks = (k: string, n: number) => addDays(k, n * 7);
export const weeksBetween = (a: string, b: string) => Math.round((keyMs(b) - keyMs(a)) / (7 * DAY));

/** Every week key from `from` to `to`, both included. */
export function weekRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addWeeks(k, 1)) out.push(k);
  return out;
}

/** A week belongs to the month its Wednesday falls in. 0 = January. */
export const monthOfWeek = (k: string) => new Date(keyMs(k) + 3 * DAY).getUTCMonth();
export const yearMonthOfWeek = (k: string) => new Date(keyMs(k) + 3 * DAY).toISOString().slice(0, 7);

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

export type RetailEvent = {
  id: string;
  label: string;
  markets: Market[];
  from: string; // first day, inclusive
  to: string; // last day, inclusive
  /** Demand multiplier while it runs: per category, else `all`. */
  lift: Partial<Record<Category | 'all', number>>;
  /** Shops only (people away), or the websites only. Both when absent. */
  where?: 'store' | 'online';
  /** Share of units sold at a reduced price while it runs. */
  markdown?: number;
};

const EID_FITR = ['2025-03-30', '2026-03-20', '2027-03-10'];
const EID_ADHA = ['2024-06-16', '2025-06-06', '2026-05-27', '2027-05-16'];
const WHITE_FRIDAY = ['2024-11-29', '2025-11-28', '2026-11-27', '2027-11-26'];

function build(): RetailEvent[] {
  const ev: RetailEvent[] = [];
  for (const d of WHITE_FRIDAY) {
    const y = d.slice(0, 4);
    ev.push({ id: `wf-${y}`, label: `White Friday ${y}`, markets: ['EG', 'KW'], from: addDays(d, -7), to: addDays(d, 2), lift: { all: 1.85, lingerie: 2.2, nightwear: 2.1, bags: 2.2, accessories: 1.9 }, markdown: 0.55 });
  }
  for (const d of EID_FITR) {
    const y = d.slice(0, 4);
    ev.push({ id: `eid-fitr-${y}`, label: `Eid al-Fitr ${y}`, markets: ['EG', 'KW'], from: addDays(d, -14), to: addDays(d, -1), lift: { all: 1.3, dresses: 1.75, kids: 1.8, tops: 1.4, bags: 1.35 } });
  }
  for (const d of EID_ADHA) {
    const y = d.slice(0, 4);
    ev.push({ id: `eid-adha-${y}`, label: `Eid al-Adha ${y}`, markets: ['EG', 'KW'], from: addDays(d, -10), to: addDays(d, -1), lift: { all: 1.18, dresses: 1.45, kids: 1.5, swimwear: 1.3 } });
  }
  for (const y of [2025, 2026, 2027]) {
    ev.push({ id: `valentine-${y}`, label: `Valentine's ${y}`, markets: ['EG', 'KW'], from: `${y}-02-07`, to: `${y}-02-14`, lift: { lingerie: 1.9, nightwear: 1.35, accessories: 1.2 } });
    ev.push({ id: `mothers-${y}`, label: `Mother's Day ${y}`, markets: ['EG', 'KW'], from: `${y}-03-14`, to: `${y}-03-21`, lift: { nightwear: 1.5, homewear: 1.5, bags: 1.6, accessories: 1.4 } });
    ev.push({ id: `national-${y}`, label: `National Day ${y}`, markets: ['KW'], from: `${y}-02-20`, to: `${y}-02-28`, lift: { all: 1.3 } });
    ev.push({ id: `winter-sale-${y}`, label: `Winter sale ${y}`, markets: ['EG', 'KW'], from: `${y}-01-02`, to: `${y}-01-31`, lift: { all: 1.2, outerwear: 1.45, knitwear: 1.4 }, markdown: 0.45 });
    ev.push({ id: `summer-sale-${y}`, label: `Summer sale ${y}`, markets: ['EG', 'KW'], from: `${y}-07-10`, to: `${y}-08-10`, lift: { all: 1.18, swimwear: 1.3 }, markdown: 0.42 });
  }
  for (const y of [2024, 2025, 2026, 2027]) {
    ev.push({ id: `school-eg-${y}`, label: `Back to school ${y}`, markets: ['EG'], from: `${y}-09-12`, to: `${y}-10-04`, lift: { kids: 1.75, bags: 1.3 } });
    ev.push({ id: `school-kw-${y}`, label: `Back to school ${y}`, markets: ['KW'], from: `${y}-08-28`, to: `${y}-09-18`, lift: { kids: 1.6, bags: 1.25 } });
    ev.push({ id: `nye-${y}`, label: `New Year's Eve ${y}`, markets: ['EG', 'KW'], from: `${y}-12-22`, to: `${y}-12-31`, lift: { dresses: 1.45, nightwear: 1.2, accessories: 1.25, bags: 1.2 } });
    // Kuwait empties in high summer: the malls go quiet, the websites hold up better.
    ev.push({ id: `kw-summer-${y}`, label: `Kuwait summer away ${y}`, markets: ['KW'], from: `${y}-07-01`, to: `${y}-08-25`, lift: { all: 0.64 }, where: 'store' });
  }
  return ev.sort((a, b) => a.from.localeCompare(b.from));
}

export const EVENTS: RetailEvent[] = build();

const overlapDays = (e: RetailEvent, weekKey: string) => {
  const ws = weekKey;
  const we = addDays(weekKey, 6);
  if (e.to < ws || e.from > we) return 0;
  const a = e.from > ws ? e.from : ws;
  const b = e.to < we ? e.to : we;
  return Math.round((keyMs(b) - keyMs(a)) / DAY) + 1;
};

// The calendar never changes while the server runs, and a stock reading asks the same few thousand
// (market, category, week, shops or websites) questions about a million times: 53 of its 58 seconds
// went here (24 Oct). Each answer is worked out once.
// market|category|where → week → lift: nested, so a lookup builds no string (a million lookups a reading)
const liftMemo = new Map<string, Map<string, number>>();
const markdownMemo = new Map<string, number>();

/** The demand multiplier events put on one category in one week, for shops or for the websites. */
export function eventLift(market: Market, category: Category, weekKey: string, where: 'store' | 'online'): number {
  const group = market + category + where;
  let weeks = liftMemo.get(group);
  if (!weeks) liftMemo.set(group, (weeks = new Map()));
  const hit = weeks.get(weekKey);
  if (hit !== undefined) return hit;
  const m = liftOf(market, category, weekKey, where);
  weeks.set(weekKey, m);
  return m;
}

function liftOf(market: Market, category: Category, weekKey: string, where: 'store' | 'online'): number {
  let m = 1;
  for (const e of EVENTS) {
    if (!e.markets.includes(market) || (e.where && e.where !== where)) continue;
    const days = overlapDays(e, weekKey);
    if (!days) continue;
    const lift = e.lift[category] ?? e.lift.all ?? 1;
    m *= 1 + (lift - 1) * (days / 7);
  }
  return m;
}

/** Share of a week's units sold at a reduced price. */
export function markdownShare(market: Market, weekKey: string): number {
  const key = `${market}|${weekKey}`;
  const hit = markdownMemo.get(key);
  if (hit !== undefined) return hit;
  let s = 0;
  for (const e of EVENTS) {
    if (!e.markets.includes(market) || !e.markdown) continue;
    const days = overlapDays(e, weekKey);
    if (days) s = Math.max(s, e.markdown * (days / 7));
  }
  markdownMemo.set(key, s);
  return s;
}

/** Events that touch a span of days, for the planning calendar. */
export function eventsBetween(market: Market, from: string, to: string): RetailEvent[] {
  return EVENTS.filter((e) => e.markets.includes(market) && e.to >= from && e.from <= to);
}

/** The same event last year: "White Friday 2026" → "White Friday 2025". */
export function lastYearOf(e: RetailEvent): RetailEvent | undefined {
  const base = e.id.replace(/-\d{4}$/, '');
  const y = Number(e.id.slice(-4)) - 1;
  return EVENTS.find((x) => x.id === `${base}-${y}`);
}
