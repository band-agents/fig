import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { can, canSee, ROLES, seesCost, type Principal, type Role } from './domain/perms';
import { CHANNELS, channelLabel } from './channels';
import { BUSINESSES, channelsIn, type Business } from './business';
import { putSetting } from './engine';
import { getTargets, targetsKey } from './targets';
import { forget } from './remember';
import { invalidateFacts } from './stock/facts';
import { logActivity } from './stock/core';
import { marketsFor } from './stock/views/common';
import { byHeader, numberIn } from './sheet-read';
import { moneyDecimals, type Sheet } from './sheet';
import type { Market } from './domain/stock/calendar';

/**
 * Imports, next to the exports (Dan, 24 Oct: "export and import everywhere"): a sheet people keep in
 * Excel goes back into the console. Each kind has a template that already holds today's figures, a
 * preview that says row by row what matched and what did not, and an apply that checks everything
 * again on the server before it writes. Columns are found by their header, so an exported sheet that
 * was edited comes back as it went out.
 */

export type ImportKind = 'costs' | 'targets' | 'team';
export const IMPORT_KINDS: ImportKind[] = ['costs', 'targets', 'team'];

export type Problem = { line: number; message: string };
export type Preview<R> = { rows: R[]; problems: Problem[]; missing: string[]; summary: string };

export const IMPORT_LABEL: Record<ImportKind, { title: string; sub: string; apply: string }> = {
  costs: { title: 'Import cost prices', sub: 'Style code or barcode, and the cost of one piece in the style’s own currency. Margins use it at the next stock reading.', apply: 'Update costs' },
  targets: { title: 'Import brand targets', sub: 'Brand, month, and a sales and/or pieces target. Brand pages then show the month against its target.', apply: 'Save targets' },
  team: { title: 'Import teammates', sub: 'Email, name and job, with their stores and brands. Each gets a temporary password to change at first sign-in.', apply: 'Add teammates' },
};

/** Who may bring each kind in. */
export function mayImport(p: Principal, kind: ImportKind) {
  if (kind === 'costs') return seesCost(p) && (can(p, 'procurement', 2) || can(p, 'stock', 3));
  if (kind === 'targets') return canSee(p, 'brands') && (can(p, 'overview', 2) || can(p, 'procurement', 3) || can(p, 'merch', 3));
  return can(p, 'team', 2);
}

// ── costs ────────────────────────────────────────────────────────────────────────────────────────────

const COST_FIELDS = { styleCode: ['style code', 'style', 'style no', 'style number', 'model'], barcode: ['barcode', 'ean', 'upc', 'item code'], cost: ['cost', 'cost price', 'unit cost', 'cost kwd', 'cost egp', 'cost price kwd', 'cost price egp'] };
type CostRow = { line: number; productId: string; title: string; currency: string; cost: number; was: number };

async function costsTemplate(p: Principal): Promise<Sheet> {
  const db = await getDb();
  const markets = marketsFor(p);
  const rows = await db.execute<{ style_code: string; title: string; brand: string; currency: string; price: number; cost: number }>(sql`
    select style_code, title, brand, currency, price, cost from products
    where market in (${sql.join(markets.map((m) => sql`${m}`), sql`, `)}) and status = 'active' order by brand, style_code limit 20000`);
  return {
    name: 'Costs',
    columns: [{ key: 'styleCode', label: 'Style code' }, { key: 'title', label: 'Style' }, { key: 'brand', label: 'Brand' }, { key: 'currency', label: 'Currency' }, { key: 'price', label: 'Price', kind: 'num', decimals: 3 }, { key: 'cost', label: 'Cost price', kind: 'num', decimals: 3 }],
    rows: rows.rows.map((r) => ({ styleCode: r.style_code, title: r.title, brand: r.brand, currency: r.currency, price: Number(r.price) / 10 ** moneyDecimals(r.currency), cost: Number(r.cost) / 10 ** moneyDecimals(r.currency) })),
  };
}

async function costsPreview(p: Principal, grid: string[][]): Promise<Preview<CostRow>> {
  const { rows, missing } = byHeader(grid, COST_FIELDS);
  const need = missing.includes('cost') ? ['Cost price'] : missing.includes('styleCode') && missing.includes('barcode') ? ['Style code or barcode'] : [];
  if (need.length) return { rows: [], problems: [], missing: need, summary: '' };
  const db = await getDb();
  const markets = marketsFor(p);
  const codes = [...new Set(rows.map((r) => r.styleCode).filter(Boolean))];
  const barcodes = [...new Set(rows.map((r) => r.barcode).filter(Boolean))];
  const inMarkets = sql`p.market in (${sql.join(markets.map((m) => sql`${m}`), sql`, `)})`;
  const byCode = new Map<string, { id: string; title: string; currency: string; cost: number }>();
  for (let i = 0; i < codes.length; i += 1000) {
    const r = await db.execute<{ id: string; style_code: string; title: string; currency: string; cost: number }>(sql`select p.id, p.style_code, p.title, p.currency, p.cost from products p where ${inMarkets} and p.style_code in (${sql.join(codes.slice(i, i + 1000).map((c) => sql`${c}`), sql`, `)})`);
    for (const x of r.rows) byCode.set(x.style_code.toLowerCase(), { id: x.id, title: x.title, currency: x.currency, cost: Number(x.cost) });
  }
  const byBarcode = new Map<string, { id: string; title: string; currency: string; cost: number }>();
  for (let i = 0; i < barcodes.length; i += 1000) {
    const r = await db.execute<{ barcode: string; id: string; title: string; currency: string; cost: number }>(sql`select v.barcode, p.id, p.title, p.currency, p.cost from variants v join products p on p.id = v.product_id where ${inMarkets} and v.barcode in (${sql.join(barcodes.slice(i, i + 1000).map((c) => sql`${c}`), sql`, `)})`);
    for (const x of r.rows) byBarcode.set(x.barcode, { id: x.id, title: x.title, currency: x.currency, cost: Number(x.cost) });
  }
  const out: CostRow[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    if (!r.styleCode && !r.barcode && !r.cost) return;
    const hit = (r.barcode && byBarcode.get(r.barcode)) || (r.styleCode && byCode.get(r.styleCode.toLowerCase()));
    if (!hit) return void problems.push({ line, message: `${r.styleCode || r.barcode}: not a style in your stores` });
    const v = numberIn(r.cost);
    if (v == null || v < 0) return void problems.push({ line, message: `${r.styleCode || r.barcode}: the cost “${r.cost}” is not a number` });
    if (seen.has(hit.id)) return;
    seen.add(hit.id);
    out.push({ line, productId: hit.id, title: hit.title, currency: hit.currency, cost: Math.round(v * 10 ** moneyDecimals(hit.currency)), was: hit.cost });
  });
  const changed = out.filter((x) => x.cost !== x.was).length;
  return { rows: out, problems, missing: [], summary: `${out.length} styles matched, ${changed} with a new cost${problems.length ? `, ${problems.length} rows not used` : ''}` };
}

async function costsApply(p: Principal, rows: CostRow[]) {
  const db = await getDb();
  const changed = rows.filter((r) => r.cost !== r.was && Number.isFinite(r.cost) && r.cost >= 0);
  // only styles in this person's markets, whatever the browser sent back
  const markets = marketsFor(p);
  const ids = changed.map((r) => r.productId);
  const allowed = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const r = await db.select({ id: schema.products.id }).from(schema.products).where(and(inArray(schema.products.id, ids.slice(i, i + 1000)), inArray(schema.products.market, markets)));
    for (const x of r) allowed.add(x.id);
  }
  let n = 0;
  for (const r of changed) {
    if (!allowed.has(r.productId)) continue;
    await db.update(schema.products).set({ cost: r.cost }).where(eq(schema.products.id, r.productId));
    n++;
  }
  if (n) {
    invalidateFacts();
    await logActivity({ id: p.id, name: p.name }, { area: 'procurement', kind: 'import', message: `Imported cost prices for ${n} styles` });
  }
  forget('brands:');
  return `${n} cost prices updated. Margins use them at the next stock reading.`;
}

// ── brand targets ────────────────────────────────────────────────────────────────────────────────────


const TARGET_FIELDS = { brand: ['brand'], month: ['month', 'period'], market: ['market', 'business', 'country'], value: ['sales target', 'target sales', 'sales', 'value target', 'target'], units: ['pieces target', 'target pieces', 'pieces', 'units', 'units target'] };
type TargetRow = { line: number; market: Market; brand: string; month: string; value: number | null; units: number | null };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthOf(s: string): string | null {
  const t = s.trim().toLowerCase();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = t.match(/^([a-z]{3})[a-z]*[\s,-]+(\d{4})$/);
  if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
  // a date cell as Excel stores it: days since 30 Dec 1899
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const d = new Date((Number(t) - 25569) * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return null;
}

const marketOf = (s: string, fallback: Market[]): Market | null => {
  const t = s.trim().toLowerCase();
  if (!t) return fallback.length === 1 ? fallback[0] : null;
  if (['kw', 'kuwait', 'labesny', 'd&h', 'dh', 'dco'].includes(t)) return 'KW';
  if (['eg', 'egypt', 'fig'].includes(t)) return 'EG';
  return null;
};

async function targetsTemplate(p: Principal): Promise<Sheet> {
  const db = await getDb();
  const markets = marketsFor(p) as Market[];
  const brands = await db.execute<{ market: Market; brand: string }>(sql`select market, brand from products where market in (${sql.join(markets.map((m) => sql`${m}`), sql`, `)}) and status = 'active' group by 1, 2 order by 1, count(*) desc`);
  const now = new Date();
  const months = [0, 1, 2].map((k) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const rows: Record<string, unknown>[] = [];
  for (const m of markets) {
    const t = await getTargets(m);
    const cur = m === 'KW' ? 'KWD' : 'EGP';
    for (const b of brands.rows.filter((x) => x.market === m))
      for (const mo of months) rows.push({ market: m === 'KW' ? 'Kuwait' : 'Egypt', brand: b.brand, month: mo, value: t[b.brand]?.[mo]?.value != null ? t[b.brand][mo].value! / 10 ** moneyDecimals(cur) : null, units: t[b.brand]?.[mo]?.units ?? null });
  }
  return { name: 'Targets', columns: [{ key: 'market', label: 'Market' }, { key: 'brand', label: 'Brand' }, { key: 'month', label: 'Month' }, { key: 'value', label: `Sales target (${markets.length === 1 && markets[0] === 'KW' ? 'KWD' : markets.length === 1 ? 'EGP' : 'KWD in Kuwait, EGP in Egypt'})`, kind: 'num', decimals: 3 }, { key: 'units', label: 'Pieces target', kind: 'int' }], rows };
}

async function targetsPreview(p: Principal, grid: string[][]): Promise<Preview<TargetRow>> {
  const { rows, missing } = byHeader(grid, TARGET_FIELDS);
  const markets = marketsFor(p) as Market[];
  const need = [...(missing.includes('brand') ? ['Brand'] : []), ...(missing.includes('month') ? ['Month'] : []), ...(missing.includes('value') && missing.includes('units') ? ['Sales target or Pieces target'] : [])];
  if (need.length) return { rows: [], problems: [], missing: need, summary: '' };
  const db = await getDb();
  const known = new Set((await db.execute<{ k: string }>(sql`select distinct market || '|' || lower(brand) as k from products`)).rows.map((r) => r.k));
  const out: TargetRow[] = [];
  const problems: Problem[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    if (!r.brand && !r.month) return;
    const market = marketOf(r.market, markets);
    if (!market || !markets.includes(market)) return void problems.push({ line, message: `${r.brand}: say the market (Kuwait or Egypt)` });
    if (!known.has(`${market}|${r.brand.toLowerCase()}`)) return void problems.push({ line, message: `${r.brand}: no such brand in ${market === 'KW' ? 'Kuwait' : 'Egypt'}` });
    const month = monthOf(r.month);
    if (!month) return void problems.push({ line, message: `${r.brand}: the month “${r.month}” is not a month (write 2026-11)` });
    const v = r.value ? numberIn(r.value) : null;
    const u = r.units ? numberIn(r.units) : null;
    if (v == null && u == null) return;
    const cur = market === 'KW' ? 'KWD' : 'EGP';
    out.push({ line, market, brand: r.brand.trim(), month, value: v == null ? null : Math.round(v * 10 ** moneyDecimals(cur)), units: u == null ? null : Math.round(u) });
  });
  return { rows: out, problems, missing: [], summary: `${out.length} brand-months${problems.length ? `, ${problems.length} rows not used` : ''}` };
}

async function targetsApply(p: Principal, rows: TargetRow[]) {
  const markets = marketsFor(p) as Market[];
  let n = 0;
  for (const m of markets) {
    const mine = rows.filter((r) => r.market === m);
    if (!mine.length) continue;
    const t = await getTargets(m);
    for (const r of mine) {
      t[r.brand] ??= {};
      t[r.brand][r.month] = { ...(r.value != null ? { value: r.value } : {}), ...(r.units != null ? { units: r.units } : {}) };
      n++;
    }
    await putSetting(targetsKey(m), t, p.name);
  }
  forget('brands:');
  return `${n} targets saved.`;
}

// ── teammates ────────────────────────────────────────────────────────────────────────────────────────

const TEAM_FIELDS = { email: ['email', 'e-mail', 'work email'], name: ['name', 'full name'], job: ['job', 'role', 'access'], title: ['title', 'job title'], stores: ['stores', 'store', 'business', 'channels'], brands: ['brands', 'brand'], password: ['temporary password', 'password', 'temp password'] };
export type TeamRow = { line: number; email: string; name: string; role: Role; title: string | null; channels: string[]; brands: string[]; storesLabel: string; password: string | null };

const roleOf = (s: string): Role | null => {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (t in ROLES) return t as Role;
  const hit = (Object.entries(ROLES) as [Role, { label: string }][]).find(([, r]) => r.label.toLowerCase() === t || r.label.toLowerCase().startsWith(t));
  if (hit) return hit[0];
  if (['cs', 'customer service', 'customer support'].includes(t)) return 'care';
  return null;
};

function storesOf(s: string): { channels: string[]; label: string } | null {
  const parts = s
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length || parts.some((x) => ['all', 'every store', 'everything', 'both'].includes(x.toLowerCase()))) return { channels: [], label: 'Every store' };
  const out = new Set<string>();
  for (const x of parts) {
    const t = x.toLowerCase();
    const biz = BUSINESSES.find((b) => b.label.toLowerCase() === t || b.id === t);
    if (biz) {
      for (const c of channelsIn({ channels: [] }, biz.id as Business)) out.add(c);
      continue;
    }
    const c = CHANNELS.find((c) => c.id === t || c.name.toLowerCase() === t || channelLabel(c.id).toLowerCase() === t || `${c.name} ${c.surface}`.toLowerCase() === t);
    if (!c) return null;
    out.add(c.id);
  }
  return { channels: [...out], label: [...out].map(channelLabel).join(', ') };
}

export { tempPassword } from './auth/password';

async function teamTemplate(): Promise<Sheet> {
  return {
    name: 'Teammates',
    columns: [{ key: 'email', label: 'Email' }, { key: 'name', label: 'Name' }, { key: 'job', label: 'Job' }, { key: 'title', label: 'Title' }, { key: 'stores', label: 'Stores' }, { key: 'brands', label: 'Brands' }, { key: 'password', label: 'Temporary password' }],
    rows: [
      { email: 'name@company.com', name: 'Full name', job: ROLES.care.label, title: 'Customer care · Kuwait', stores: 'Labesny', brands: '', password: '' },
      { email: 'brand.manager@company.com', name: 'Full name', job: ROLES.brand.label, title: 'Brand manager', stores: 'all', brands: 'Women Secret, Etam', password: '' },
    ],
  };
}

async function teamPreview(p: Principal, grid: string[][]): Promise<Preview<TeamRow>> {
  const { rows, missing } = byHeader(grid, TEAM_FIELDS);
  const need = [...(missing.includes('email') ? ['Email'] : []), ...(missing.includes('name') ? ['Name'] : []), ...(missing.includes('job') ? ['Job'] : [])];
  if (need.length) return { rows: [], problems: [], missing: need, summary: '' };
  const db = await getDb();
  const emails = rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean);
  const taken = new Set(emails.length ? (await db.select({ e: schema.users.email }).from(schema.users).where(inArray(schema.users.email, emails))).map((r) => r.e) : []);
  const out: TeamRow[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    const email = r.email.trim().toLowerCase();
    if (!email && !r.name) return;
    if (email.endsWith('@company.com')) return; // the template's examples
    if (!/^\S+@\S+\.\S+$/.test(email)) return void problems.push({ line, message: `${r.email || '(empty)'}: not an email` });
    if (taken.has(email) || seen.has(email)) return void problems.push({ line, message: `${email}: already on the team` });
    const role = roleOf(r.job);
    if (!role) return void problems.push({ line, message: `${email}: “${r.job}” is not a job (${Object.values(ROLES).map((x) => x.label).join(', ')})` });
    if (role === 'admin' && p.role !== 'admin') return void problems.push({ line, message: `${email}: only an admin can add an admin` });
    const stores = storesOf(r.stores);
    if (!stores) return void problems.push({ line, message: `${email}: stores “${r.stores}” not recognised (use Labesny, FIG, all, or store names)` });
    seen.add(email);
    out.push({ line, email, name: r.name.trim() || email, role, title: r.title.trim() || null, channels: stores.channels, brands: r.brands.split(/[,;|]/).map((b) => b.trim()).filter(Boolean), storesLabel: stores.label, password: r.password.trim() || null });
  });
  return { rows: out, problems, missing: [], summary: `${out.length} new teammates${problems.length ? `, ${problems.length} rows not used` : ''}` };
}

// ── dispatch ─────────────────────────────────────────────────────────────────────────────────────────

export async function importTemplate(p: Principal, kind: ImportKind): Promise<Sheet> {
  if (kind === 'costs') return costsTemplate(p);
  if (kind === 'targets') return targetsTemplate(p);
  return teamTemplate();
}

export async function previewImport(p: Principal, kind: ImportKind, grid: string[][]): Promise<Preview<CostRow | TargetRow | TeamRow>> {
  if (kind === 'costs') return costsPreview(p, grid);
  if (kind === 'targets') return targetsPreview(p, grid);
  return teamPreview(p, grid);
}

/** Costs and targets apply here; teammates go through the Team action one by one (same checks as the form). */
export async function applyImport(p: Principal, kind: 'costs' | 'targets', rows: unknown[]) {
  if (kind === 'costs') return costsApply(p, rows as CostRow[]);
  return targetsApply(p, rows as TargetRow[]);
}

export const isKind = (k: string): k is ImportKind => (IMPORT_KINDS as string[]).includes(k);
