import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { can, canSee, seesCost, worksOrders, type Page, type Principal } from '../domain/perms';
import { channelLabel } from '../channels';
import { TO_EGP } from '../format';
import { major, moneyDecimals, type Sheet } from '../sheet';
import { contextFor, GROUPS, PRESETS, type Ctx, type Query, type Report, type Result } from './engine';
import { SALES_REPORTS } from './reports/sales';
import { BRAND_REPORTS } from './reports/brands';
import { STOCK_REPORTS } from './reports/stock';
import { CUSTOMER_REPORTS } from './reports/customers';
import { RETURN_REPORTS } from './reports/returns';
import { FINANCE_REPORTS } from './reports/finance';
import { OPERATIONS_REPORTS } from './reports/operations';

export { GROUPS, PRESETS };
export type { Report, Result, Query };

export const REPORTS: Report[] = [...SALES_REPORTS, ...BRAND_REPORTS, ...STOCK_REPORTS, ...CUSTOMER_REPORTS, ...RETURN_REPORTS, ...FINANCE_REPORTS, ...OPERATIONS_REPORTS];
export const reportById = (id: string) => REPORTS.find((r) => r.id === id) ?? null;

/** The pages that already are reports, listed in the library beside the new ones so there is one place to look. */
export const PAGE_REPORTS: { group: Report['group']; title: string; blurb: string; href: string; page: Page }[] = [
  { group: 'brands', title: 'Brands', blurb: "Every brand's sales, pace, stock, cover and website gaps on one list.", href: '/brands', page: 'brands' },
  { group: 'brands', title: 'Fast and slow movers', blurb: 'Every style by pace, cover and weeks since its last sale.', href: '/brands/movers', page: 'brands' },
  { group: 'brands', title: 'High vs low price', blurb: 'Whether the high-priced or the low-priced brands sell more, by price band.', href: '/brands/prices', page: 'brands' },
  { group: 'stock', title: 'Inventory', blurb: 'Every style with stock by location, cover and status.', href: '/stock/inventory', page: 'inventory' },
  { group: 'stock', title: 'Website vs Lucida', blurb: 'What Lucida holds against what the website shows.', href: '/stock/web-items', page: 'webItems' },
  { group: 'finance', title: 'Finance & analysis', blurb: 'The month in money: sales, cost, margin, cash to come in and to go out.', href: '/financials', page: 'financials' },
];

/** Who may open a report: Reports itself, then what the report reads (amounts, payments, cost, customer names). */
export function mayOpen(p: Principal, r: Report) {
  if (!canSee(p, 'analytics')) return false;
  if (r.wholeOrders && p.brands?.length) return false;
  if (r.floor && !worksOrders(p)) return false;
  for (const need of r.needs ?? []) {
    if (need === 'money' && !can(p, 'money', 1)) return false;
    if (need === 'payments' && !can(p, 'money', 2)) return false;
    if (need === 'cost' && !seesCost(p)) return false;
    if (need === 'customers' && !can(p, 'customers', 1)) return false;
  }
  return true;
}

export const reportsFor = (p: Principal) => REPORTS.filter((r) => mayOpen(p, r));

export async function runReport(p: Principal, r: Report, q: Query): Promise<{ ctx: Ctx; result: Result }> {
  const ctx = contextFor(p, q);
  return { ctx, result: await r.run(ctx) };
}

/** What the filter lists offer this person: the stores read, their brands, the categories sold, the branches Lucida named. */
export async function filterOptions(p: Principal, r: Report) {
  const ctx = contextFor(p, {});
  const db = await getDb();
  const wants = new Set(r.filters);
  const [brands, categories, branches] = await Promise.all([
    wants.has('brand')
      ? db.execute<{ b: string }>(sql`select distinct brand as b from products p where ${ctx.products('p')} and brand <> '' union select distinct oi.brand from order_items oi join orders o on o.id = oi.order_id where ${ctx.orders('o')} and ${ctx.items('oi')} and oi.brand is not null order by 1`)
      : Promise.resolve({ rows: [] }),
    wants.has('category') ? db.execute<{ c: string }>(sql`select distinct oi.category as c from order_items oi join orders o on o.id = oi.order_id where ${ctx.orders('o')} and ${ctx.items('oi')} and oi.category is not null and oi.category <> '' order by 1`) : Promise.resolve({ rows: [] }),
    wants.has('branch') ? db.execute<{ code: string; name: string | null }>(sql`select store_code as code, max(store_name) as name from branch_stock group by 1 order by 2`) : Promise.resolve({ rows: [] }),
  ]);
  return {
    channels: ctx.channels.map((id) => ({ id, label: channelLabel(id) })),
    brands: [...new Set(brands.rows.map((x) => (x as { b: string }).b).filter(Boolean))],
    categories: categories.rows.map((x) => (x as { c: string }).c),
    branches: branches.rows.map((x) => ({ code: (x as { code: string }).code, name: (x as { name: string | null }).name ?? (x as { code: string }).code })),
  };
}

/** A report as a workbook: the figures on the first sheet, then every table, money in the view's currency. */
export function resultSheets(r: Report, ctx: Ctx, res: Result): Sheet[] {
  const cur = ctx.currency;
  const toCur = (egpMinor: number) => major(Math.round((egpMinor / 100 / (TO_EGP[cur] ?? 1)) * 10 ** moneyDecimals(cur)), cur);
  const cell = (v: unknown, fmt: string) => (v == null || v === '' ? null : fmt === 'money' ? toCur(Number(v)) : v);
  const kind = (fmt: string) => (fmt === 'money' || fmt === 'num' || fmt === 'hours' || fmt === 'days' || fmt === 'weeks' ? ('num' as const) : fmt === 'int' ? ('int' as const) : fmt === 'pct' ? ('pct' as const) : fmt === 'date' ? ('date' as const) : ('text' as const));
  const summary: Sheet = {
    name: 'Summary',
    columns: [
      { key: 'label', label: r.title },
      { key: 'value', label: r.snapshot ? 'Now' : ctx.range.label, kind: 'text' },
      { key: 'prev', label: ctx.range.compare === 'ly' ? 'Same dates last year' : 'Period before', kind: 'text' },
    ],
    rows: res.figures.map((f) => ({
      label: f.fmt === 'money' ? `${f.label} (${cur})` : f.label,
      value: typeof f.value === 'number' ? String(f.fmt === 'money' ? toCur(f.value) : f.fmt === 'pct' ? `${Math.round(f.value * 1000) / 10}%` : Math.round(f.value * 100) / 100) : (f.value ?? ''),
      prev: f.prev == null ? '' : String(f.fmt === 'money' ? toCur(f.prev) : f.fmt === 'pct' ? `${Math.round(f.prev * 1000) / 10}%` : Math.round(f.prev * 100) / 100),
    })),
  };
  return [
    summary,
    ...res.tables.map((t, i) => ({
      name: (t.title || `Table ${i + 1}`).slice(0, 31),
      columns: t.columns.map((col) => ({ key: col.key, label: col.fmt === 'money' ? `${col.label} (${cur})` : col.label, kind: kind(col.fmt), decimals: col.fmt === 'money' ? moneyDecimals(cur) : col.fmt === 'num' || col.fmt === 'hours' || col.fmt === 'days' || col.fmt === 'weeks' ? 1 : undefined })),
      rows: t.rows.map((row) => Object.fromEntries(t.columns.map((col) => [col.key, cell(row[col.key], col.fmt)]))),
    })),
  ];
}
