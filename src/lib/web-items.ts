import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL, CHANNELS, channelConfigured, channelLabel } from './channels';
import { exportWebsiteItems } from './connectors/shopify';
import { lucidaBudget, lucidaConfigured, webItemsFromLucida } from './connectors/lucida';
import { getSetting, putSetting } from './engine';
import { seesBrand, type Principal } from './domain/perms';
import { judge, REASONS, styleReasons, VERDICTS, worst, type Reason, type Verdict } from './domain/web-gap';
import { toMinor } from './format';
import { marketsFor } from './stock/views/common';

/**
 * Website against Lucida: every size the store holds, live or not, beside what Lucida reports for the
 * same barcode, and why the two differ. The website side is one Shopify bulk read; the Lucida side is
 * one call per 3,000 barcodes per Lucida database, made only when someone asks, inside this console's
 * hourly call budget. Both are kept in web_items, so the page itself never calls anyone.
 */

export type RunState = {
  websiteAt?: string;
  products?: number;
  sizes?: number;
  lucidaAt?: string;
  lucidaCalls?: number;
  lucidaReported?: number;
  absent?: number;
  days?: number;
  running?: 'website' | 'lucida' | null;
  startedAt?: string | null;
  error?: string | null;
  by?: string;
};

const key = (channelId: string) => `webitems.${channelId}`;
const running = new Map<string, Promise<void>>();

/**
 * The page reads every size a store holds (about 52,000 for Labesny), which took PGlite ~5 s per visit.
 * They only change when a run in this file rewrites them, so they are kept in memory, already judged,
 * and dropped when a run ends (Dan, 22 Oct: pages must open at once). One server owns the database, so
 * nothing else can change them behind this copy's back.
 */
type Judged = { r: typeof schema.webItems.$inferSelect; verdict: Verdict; reasons: Reason[] };
const memo = new Map<string, Promise<Judged[]>>();
function judgedRows(channelId: string) {
  let m = memo.get(channelId);
  if (!m) {
    m = (async () => {
      const db = await getDb();
      const rows = await db.select().from(schema.webItems).where(eq(schema.webItems.channelId, channelId));
      return rows.map((r) => ({ r, ...judge({ barcode: r.barcode, status: r.status, hasPhoto: r.hasPhoto, hasDescription: r.hasDescription, hasCategory: r.hasCategory, price: r.price, webQty: r.webQty, lucidaQty: r.lucidaQty, lucidaPrice: r.lucidaPrice }) }));
    })();
    m.catch(() => memo.delete(channelId));
    memo.set(channelId, m);
  }
  return m;
}

export const webStores = () => CHANNELS.filter((c) => c.platform === 'shopify' && !c.parked && channelConfigured(c));

const sizeOf = (opts: { name: string; value: string }[]) => {
  const o = opts.find((x) => /size|مقاس/i.test(x.name)) ?? opts[0];
  return !o || /default title/i.test(o.value) ? null : o.value.trim();
};
const tick = () => new Promise((r) => setImmediate(r));

async function setState(channelId: string, patch: RunState, by: string) {
  const cur = await getSetting<RunState>(key(channelId), {});
  await putSetting(key(channelId), { ...cur, ...patch }, by);
}

/** Starts a run in the background; the page shows it as running until it ends. */
export function startRun(channelId: string, what: 'website' | 'lucida', by: string, opts: { days?: number } = {}) {
  if (running.has(channelId)) throw new Error('A comparison is already running for this store.');
  const c = CHANNEL[channelId];
  if (!c || !webStores().some((x) => x.id === channelId)) throw new Error('That store is not connected.');
  if (what === 'lucida' && !lucidaConfigured()) throw new Error('Lucida is not connected to this console yet.');
  const job = (async () => {
    await setState(channelId, { running: what, startedAt: new Date().toISOString(), error: null, by }, by);
    try {
      if (what === 'website') await readWebsite(channelId, by);
      else await readLucida(channelId, by, opts.days ?? 0);
      await setState(channelId, { running: null, startedAt: null }, by);
    } catch (e) {
      await setState(channelId, { running: null, startedAt: null, error: e instanceof Error ? e.message : String(e) }, by);
    } finally {
      running.delete(channelId);
      memo.delete(channelId);
    }
  })();
  running.set(channelId, job);
}

/**
 * A connected store that was never read gets its first website reading when the server starts, so the
 * page is not empty until someone thinks to press the button (22 Oct: it sat empty on live). Read-only
 * towards the store; one at a time per store, like the button.
 */
export async function readUnreadWebsites() {
  for (const c of webStores()) {
    const state = await getSetting<RunState>(key(c.id), {});
    if (state.websiteAt || running.has(c.id)) continue;
    startRun(c.id, 'website', 'Console (first reading)');
  }
}

/** The store's whole catalogue into web_items, keeping what Lucida last said about each barcode. */
async function readWebsite(channelId: string, by: string) {
  const c = CHANNEL[channelId];
  const db = await getDb();
  const products = await exportWebsiteItems(c);
  const before = await db.select({ barcode: schema.webItems.barcode, status: schema.webItems.status, lucidaQty: schema.webItems.lucidaQty, lucidaPrice: schema.webItems.lucidaPrice, lucidaWas: schema.webItems.lucidaWas, lucidaDb: schema.webItems.lucidaDb, lucidaDesc: schema.webItems.lucidaDesc, lucidaAt: schema.webItems.lucidaAt }).from(schema.webItems).where(eq(schema.webItems.channelId, channelId));
  const lucida = new Map(before.map((b) => [b.barcode, b]));
  const now = new Date();
  const rows: (typeof schema.webItems.$inferInsert)[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    const status = String(p.status).toLowerCase();
    const hasCategory = Boolean(p.productType?.trim()) || p.tags.some((t) => /^(cat|subcat|category):/i.test(t));
    for (const v of p.variants) {
      // a size without a barcode still counts, under a key of its own, so it is not lost
      const barcode = v.barcode?.trim() || `no-barcode:${v.id.split('/').pop()}`;
      if (seen.has(barcode)) continue;
      seen.add(barcode);
      const l = lucida.get(barcode);
      rows.push({
        channelId,
        barcode,
        sku: v.sku?.trim() || null,
        productId: p.id,
        variantId: v.id,
        handle: p.handle,
        title: p.title,
        brand: p.vendor || null,
        size: sizeOf(v.selectedOptions),
        productType: p.productType || null,
        status: status === 'active' || status === 'draft' || status === 'archived' ? status : 'draft',
        hasPhoto: Boolean(p.featuredImage?.url),
        hasDescription: Boolean(p.description?.trim()),
        hasCategory,
        price: v.price ? toMinor(v.price, c.currency) : null,
        compareAt: v.compareAtPrice ? toMinor(v.compareAtPrice, c.currency) : null,
        webQty: v.inventoryQuantity ?? 0,
        lucidaQty: l?.lucidaQty ?? null,
        lucidaPrice: l?.lucidaPrice ?? null,
        lucidaWas: l?.lucidaWas ?? null,
        lucidaDb: l?.lucidaDb ?? null,
        lucidaDesc: l?.lucidaDesc ?? null,
        lucidaAt: l?.lucidaAt ?? null,
        currency: c.currency,
        checkedAt: now,
      });
    }
  }
  // Lucida items the store still does not have stay listed as not uploaded; those it now has become store rows
  await db.delete(schema.webItems).where(and(eq(schema.webItems.channelId, channelId), sql`status <> 'absent'`));
  const arrived = before.filter((b) => b.status === 'absent' && seen.has(b.barcode)).map((b) => b.barcode);
  for (let i = 0; i < arrived.length; i += 500) await db.delete(schema.webItems).where(and(eq(schema.webItems.channelId, channelId), inArray(schema.webItems.barcode, arrived.slice(i, i + 500))));
  for (let i = 0; i < rows.length; i += 800) {
    await db.insert(schema.webItems).values(rows.slice(i, i + 800)).onConflictDoNothing();
    await tick(); // let other pages through between chunks: the database is shared
  }
  await setState(channelId, { websiteAt: now.toISOString(), products: products.length, sizes: rows.length }, by);
}

/** Asks Lucida about every barcode the store holds (and, with days, what Lucida changed lately). */
async function readLucida(channelId: string, by: string, days: number) {
  const c = CHANNEL[channelId];
  const db = await getDb();
  const rows = await db.select({ barcode: schema.webItems.barcode, status: schema.webItems.status }).from(schema.webItems).where(eq(schema.webItems.channelId, channelId));
  const barcodes = rows.map((r) => r.barcode).filter((b) => !b.startsWith('no-barcode:'));
  if (!barcodes.length) throw new Error('Read the website first: there are no barcodes to ask Lucida about.');
  const { items, calls } = await webItemsFromLucida(barcodes, { days: days || undefined });
  const now = new Date();
  const mine = new Set(rows.map((r) => r.barcode));
  // every barcode asked: what Lucida said, or 0 when it said nothing
  for (let i = 0; i < barcodes.length; i += 500) {
    const values = barcodes.slice(i, i + 500).map((b) => {
      const x = items.get(b);
      return sql`(${b}, ${x?.qty ?? 0}::int, ${x?.price ? toMinor(x.price, c.currency) : null}::bigint, ${x?.was ? toMinor(x.was, c.currency) : null}::bigint, ${x?.account ?? null}::text, ${x?.desc ?? null}::text)`;
    });
    await db.execute(sql`
      update web_items w set lucida_qty = v.qty, lucida_price = v.price, lucida_was = v.was, lucida_db = v.db, lucida_desc = v.descr, lucida_at = ${now.toISOString()}::timestamptz
      from (values ${sql.join(values, sql`, `)}) as v(barcode, qty, price, was, db, descr)
      where w.channel_id = ${channelId} and w.barcode = v.barcode`);
    await tick();
  }
  // what Lucida holds that the store does not: listed as never uploaded
  const missing = [...items.entries()].filter(([b, x]) => !mine.has(b) && x.qty > 0);
  for (let i = 0; i < missing.length; i += 500) {
    await db
      .insert(schema.webItems)
      .values(missing.slice(i, i + 500).map(([b, x]) => ({ channelId, barcode: b, status: 'absent', title: x.desc ?? null, lucidaDesc: x.desc ?? null, lucidaQty: x.qty, lucidaPrice: x.price ? toMinor(x.price, c.currency) : null, lucidaWas: x.was ? toMinor(x.was, c.currency) : null, lucidaDb: x.account, currency: c.currency, lucidaAt: now, checkedAt: now })))
      .onConflictDoNothing();
  }
  const reported = barcodes.filter((b) => (items.get(b)?.qty ?? 0) > 0).length;
  await setState(channelId, { lucidaAt: now.toISOString(), lucidaCalls: calls, lucidaReported: reported, absent: missing.length, days }, by);
}

export type Style = { key: string; title: string; brand: string | null; handle: string | null; status: string; sizes: number; webQty: number; lucidaQty: number | null; verdict: Verdict; reasons: Reason[]; price: number | null; lucidaPrice: number | null; productId: string | null; asked: boolean; hasPhoto: boolean };

/** Sizes into styles (one product, or one Lucida item never uploaded): the worst verdict and every reason. */
function toStyles(mine: Judged[]): Style[] {
  const styles = new Map<string, { rows: Judged['r'][]; verdicts: Verdict[]; reasons: Reason[][] }>();
  for (const { r, verdict, reasons } of mine) {
    const k = r.handle ?? `absent:${r.barcode}`;
    const s = styles.get(k) ?? { rows: [], verdicts: [], reasons: [] };
    s.rows.push(r);
    s.verdicts.push(verdict);
    s.reasons.push(reasons);
    styles.set(k, s);
  }
  return [...styles.entries()].map(([k, s]) => {
    const r0 = s.rows[0];
    const asked = s.rows.some((r) => r.lucidaQty !== null);
    return {
      key: k,
      title: r0.title ?? r0.lucidaDesc ?? r0.barcode,
      brand: r0.brand,
      handle: r0.handle,
      status: r0.status,
      sizes: s.rows.length,
      webQty: s.rows.reduce((a, r) => a + Math.max(0, r.webQty ?? 0), 0),
      lucidaQty: asked ? s.rows.reduce((a, r) => a + (r.lucidaQty ?? 0), 0) : null,
      verdict: worst(s.verdicts),
      reasons: styleReasons(s.reasons),
      price: r0.price,
      lucidaPrice: r0.lucidaPrice,
      productId: r0.productId,
      asked,
      hasPhoto: r0.hasPhoto !== false,
    };
  });
}

/** The stores whose websites this person may compare: their markets and their own stores. */
const storesFor = (p: Principal) => {
  const markets = marketsFor(p);
  return webStores().filter((c) => markets.includes(c.country as 'EG' | 'KW') && (!p.channels.length || p.channels.includes(c.id)));
};
const theirs = (p: Principal, judged: Judged[]) => judged.filter(({ r }) => !p.brands?.length || seesBrand(p, r.brand ?? r.lucidaDesc));

/** Every style on every website this person sees, with its store: what the money engine reads (smart/leaks.ts). */
export async function webStylesFor(p: Principal) {
  const out: (Style & { channelId: string; currency: string; market: 'EG' | 'KW' })[] = [];
  for (const c of storesFor(p)) for (const s of toStyles(theirs(p, await judgedRows(c.id)))) out.push({ ...s, channelId: c.id, currency: c.currency, market: c.country as 'EG' | 'KW' });
  return out;
}

export type GapFilters = { store?: string; group?: string; verdict?: string; reason?: string; brand?: string; q?: string; page?: number };
export type Group = (typeof VERDICTS)[Verdict]['group'];
const noGroups = () => ({ matched: 0, gap: 0, unpublished: 0, quiet: 0 }) as Record<Group, number>;

export async function webItemsView(p: Principal, f: GapFilters) {
  const stores = storesFor(p);
  const store = stores.find((c) => c.id === f.store) ?? stores[0] ?? null;
  const base = { stores: stores.map((c) => ({ id: c.id, label: channelLabel(c.id) })), store: store ? { id: store.id, label: channelLabel(store.id), currency: store.currency } : null, lucida: lucidaConfigured(), budget: lucidaConfigured() ? lucidaBudget() : null };
  if (!store) return { ...base, state: {} as RunState, empty: true as const };
  const [state, judged] = await Promise.all([getSetting<RunState>(key(store.id), {}), judgedRows(store.id)]);
  const mine = theirs(p, judged);

  const sizeCount = new Map<Verdict, number>();
  for (const { verdict } of mine) sizeCount.set(verdict, (sizeCount.get(verdict) ?? 0) + 1);
  const all = toStyles(mine);

  const byVerdict = (Object.keys(VERDICTS) as Verdict[]).map((v) => ({ verdict: v, styles: all.filter((s) => s.verdict === v).length, sizes: sizeCount.get(v) ?? 0 })).filter((x) => x.styles > 0);
  const byReason = (Object.keys(REASONS) as Reason[]).map((r) => ({ reason: r, styles: all.filter((s) => s.reasons.includes(r) && s.verdict !== 'ok').length })).filter((x) => x.styles > 0).sort((a, b) => b.styles - a.styles);
  const groups = noGroups();
  const brands = new Map<string, { brand: string; live: number; unpublishedStock: number; gaps: number; notUploaded: number; total: number; groups: Record<Group, number> }>();
  for (const s of all) {
    const b = s.brand ?? 'Unknown';
    const x = brands.get(b) ?? { brand: b, live: 0, unpublishedStock: 0, gaps: 0, notUploaded: 0, total: 0, groups: noGroups() };
    x.total += 1;
    x.groups[VERDICTS[s.verdict].group] += 1;
    groups[VERDICTS[s.verdict].group] += 1;
    if (s.status === 'active') x.live += 1;
    if (s.verdict === 'unpublished_stock') x.unpublishedStock += 1;
    if (s.verdict === 'not_uploaded') x.notUploaded += 1;
    if (VERDICTS[s.verdict].group === 'gap') x.gaps += 1;
    brands.set(b, x);
  }

  const q = f.q?.trim().toLowerCase();
  const list = all
    .filter((s) => (f.group ? f.group === 'all' || VERDICTS[s.verdict].group === f.group : true))
    .filter((s) => (f.group || f.verdict ? !f.verdict || f.verdict === 'all' || s.verdict === f.verdict : s.verdict !== 'ok' && s.verdict !== 'unpublished_none' && s.verdict !== 'live_web_only'))
    .filter((s) => !f.reason || s.reasons.includes(f.reason as Reason))
    .filter((s) => !f.brand || (s.brand ?? 'Unknown') === f.brand)
    .filter((s) => !q || `${s.title} ${s.handle ?? ''} ${s.brand ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => ORDER_RANK(a.verdict) - ORDER_RANK(b.verdict) || (b.lucidaQty ?? 0) - (a.lucidaQty ?? 0) || b.webQty - a.webQty);
  const page = Math.max(1, f.page ?? 1);
  const per = 60;
  const rows = list.slice((page - 1) * per, page * per);
  // the photos of the styles on screen, from the console's own catalogue
  const handles = rows.map((r) => r.handle).filter((h): h is string => Boolean(h));
  const db = await getDb();
  const pics = handles.length ? await db.select({ handle: schema.products.handle, image: schema.products.image }).from(schema.products).where(inArray(schema.products.handle, handles)) : [];
  const image = new Map(pics.filter((x) => x.image).map((x) => [x.handle, x.image]));
  return {
    ...base,
    empty: false as const,
    state: { ...state, running: running.has(store.id) ? (state.running ?? 'website') : null },
    totals: {
      styles: all.length,
      live: all.filter((s) => s.status === 'active').length,
      notPublished: all.filter((s) => s.status === 'draft' || s.status === 'archived').length,
      sizes: mine.length,
      asked: mine.some(({ r }) => r.lucidaQty !== null),
    },
    byVerdict,
    byReason,
    // most to fix first: what Lucida says should be on sale, then everything off or not on sale
    brands: [...brands.values()].sort((a, b) => b.unpublishedStock + b.notUploaded - (a.unpublishedStock + a.notUploaded) || b.groups.gap + b.groups.unpublished - (a.groups.gap + a.groups.unpublished) || b.total - a.total),
    groups,
    rows: rows.map((r) => ({ ...r, image: (r.handle && image.get(r.handle)) || null })),
    total: list.length,
    page,
    per,
    allRows: list,
  };
}

const RANK: Verdict[] = ['live_not_lucida', 'unpublished_stock', 'not_uploaded', 'live_qty', 'live_price', 'live_sold_out', 'unpublished', 'unpublished_none', 'live_web_only', 'ok'];
const ORDER_RANK = (v: Verdict) => RANK.indexOf(v);
