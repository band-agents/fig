import 'server-only';
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { CHANNEL, CHANNELS, channelConfigured } from '../channels';
import { exportCatalogue, stockLocations } from '../connectors/shopify';
import { categorize } from '../domain/stock/categories';
import { companyOfBrand } from '../domain/stock/brands';
import { sortSizes, bySize } from '../domain/stock/sizes';
import { weekOf } from '../domain/stock/calendar';
import { sameBrand } from '../domain/branches';
import { toMinor } from '../format';
import { syncChannel } from '../sync';
import { rollupOnlineSales } from './rollup';
import { invalidateFacts } from './facts';
import { catalogueChanged } from './hooks';
import { runPlanner } from './planner';
import { logActivity, PLANNER } from './core';

// A live storefront's real stockroom: its catalogue, sizes and stock from Shopify, every order it has
// taken, and the weekly sales those orders make. Importing it replaces that market's demo stock, so
// what the console shows for the market is the store's own data and nothing invented beside it.

export type LiveImport = { at: string; channelId: string; products: number; variants: number; pieces: number; orders: number; firstOrder: string | null; location: string; ms: number };

const SEASON = /\b(SS|AW|FW)[\s-]?(\d{2})\b/i;
const sizeOf = (opts: { name: string; value: string }[]) => {
  const o = opts.find((x) => /size|مقاس/i.test(x.name)) ?? opts[0];
  return !o || /default title/i.test(o.value) ? null : o.value.trim();
};

/** Removes a market's demo stockroom: its demo styles and everything that hung off them. */
export async function clearDemoMarket(market: string) {
  const db = await getDb();
  const locs = (await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.country, market))).map((l) => l.id);
  const users = await db.select().from(schema.users);
  const marketChannels = CHANNELS.filter((c) => c.country === market).map((c) => c.id);
  // people who work in this market only: their demo task history goes with the demo stock
  const people = users.filter((u) => (u.locationId && locs.includes(u.locationId)) || (u.channels.length > 0 && u.channels.every((c) => marketChannels.includes(c)))).map((u) => u.id);
  const inList = (xs: string[]) => sql.join((xs.length ? xs : ['-']).map((x) => sql`${x}`), sql`, `);
  await db.execute(sql`delete from products where market = ${market} and source = 'demo'`);
  await db.execute(sql`delete from sales_weekly where product_id not in (select id from products)`);
  await db.execute(sql`delete from stock_moves where product_id not in (select id from products)`);
  await db.execute(sql`delete from purchase_orders where market = ${market}`);
  await db.execute(sql`delete from transfers where from_id in (${inList(locs)})`);
  await db.execute(sql`delete from tasks where location_id in (${inList(locs)}) or assignee_id in (${inList(people)})`);
  await db.execute(sql`delete from recommendations where market = ${market}`);
  await db.execute(sql`delete from placements where market = ${market}`);
  await db.execute(sql`delete from activity where actor_id in (${inList(people)})`);
}

/** Demo orders never sit beside a live store's real ones. */
export async function clearDemoOrders(channelId: string) {
  const db = await getDb();
  await db.execute(sql`
    delete from events where order_id in (select id from orders where channel_id = ${channelId} and source = 'demo')
      or return_id in (select r.id from returns r join orders o on o.id = r.order_id where o.channel_id = ${channelId} and o.source = 'demo')`);
  await db.execute(sql`delete from orders where channel_id = ${channelId} and source = 'demo'`);
  await db.execute(sql`delete from customers where id not in (select distinct customer_id from orders where customer_id is not null)`);
}

/**
 * A Shopify store connected since the last start and never read (FIG, once its keys are in): its
 * catalogue, stock, orders and weekly sales come in once, on their own, while the console keeps
 * running, so nobody has to stop it for `npm run import:live`. One store at a time.
 */
export async function importNewStores() {
  const db = await getDb();
  for (const c of CHANNELS.filter((x) => x.platform === 'shopify' && !x.parked && channelConfigured(x))) {
    const [done] = await db.select({ key: schema.settings.key }).from(schema.settings).where(eq(schema.settings.key, `live.${c.id}`));
    if (done) continue;
    console.log(`[stock] first reading of ${c.name} from Shopify…`);
    try {
      const r = await importShopifyStock(c.id, { log: (m) => console.log(`[stock] ${m}`) });
      console.log(`[stock] ${c.name}: ${r.products} styles, ${r.pieces} pieces, ${r.orders} orders in ${Math.round(r.ms / 1000)}s`);
    } catch (e) {
      console.error(`[stock] first reading of ${c.name} failed`, e instanceof Error ? e.message : e);
    }
  }
}

/**
 * The store's catalogue, every size and its stock, read again from Shopify (a bulk export, read-only
 * there) and written over what the console holds: new styles come in, prices, seasons and stock move to
 * the store's own, styles no longer on the store stop being planned. Imported cost prices are kept.
 */
async function readCatalogue(c: (typeof CHANNELS)[number], opened: number, opts: { log: (m: string) => void; clearDemo?: boolean }) {
  const log = opts.log;
  const db = await getDb();
  const market = c.country;
  // ── where the stock is ──
  const locations = await stockLocations(c);
  const main = locations[0];
  if (main) {
    await db
      .update(schema.locations)
      .set({ name: main.name.replace(/, Kuwait$/, ''), city: main.address.city, externalCode: main.id, source: 'shopify' })
      .where(eq(schema.locations.id, c.warehouse));
  }

  // ── the catalogue, every size, and its stock ──
  log('Asking Shopify for the whole catalogue with stock (bulk export)…');
  const rows = await exportCatalogue(c, log);
  const styles = new Set(rows.map((r) => r.product.id)).size;
  log(`  ${rows.length.toLocaleString('en')} sizes across ${styles.toLocaleString('en')} styles`);
  if (opts.clearDemo) await clearDemoMarket(market);
  else {
    // a re-read that comes back far smaller than what is held is a broken answer, not a shrunk store:
    // writing it would mark most of the range discontinued
    const [{ held }] = (await db.execute<{ held: number }>(sql`select count(*)::int as held from products where market = ${market} and source = 'shopify' and status = 'active'`)).rows;
    if (styles < held * 0.5) throw new Error(`Shopify answered with ${styles} styles where the console holds ${held}; nothing was changed.`);
  }

  // suppliers: the brand principals already set up, and one per brand that has none yet
  const sups = await db.select().from(schema.suppliers);
  const vendors = [...new Set(rows.map((r) => r.product.vendor).filter(Boolean))];
  for (const v of vendors) {
    if (sups.some((s) => s.brands.some((b) => sameBrand(b, v)))) continue;
    const [s] = await db.insert(schema.suppliers).values({ name: v, country: '—', currency: 'EUR', brands: [v], leadDays: 45, moq: 6, casePack: 1, notes: `Created from the ${c.name} catalogue. Set the real lead time, minimum and terms.`, source: 'shopify' }).returning();
    sups.push(s);
  }
  const supplierOf = (vendor: string) => sups.find((s) => s.brands.some((b) => sameBrand(b, vendor)))?.id ?? null;

  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) byProduct.set(r.product.id, [...(byProduct.get(r.product.id) ?? []), r]);
  const products = [...byProduct.values()].map((vs) => {
    const p = vs[0].product;
    const prices = vs.map((v) => toMinor(v.price, c.currency));
    const compares = vs.map((v) => (v.compareAtPrice ? toMinor(v.compareAtPrice, c.currency) : 0));
    const price = Math.min(...prices);
    const compareAt = Math.max(...compares);
    const full = compareAt > price ? compareAt : price;
    const season = p.tags.map((t) => t.match(SEASON)).find(Boolean);
    return {
      market,
      company: market === 'KW' ? companyOfBrand(p.vendor) : 'FIG',
      styleCode: p.handle,
      title: p.title,
      brand: p.vendor || 'Unbranded',
      category: categorize(p.title, p.tags, p.productType),
      season: season ? `${season[1].toUpperCase() === 'FW' ? 'AW' : season[1].toUpperCase()}${season[2]}` : 'core',
      image: p.featuredImage?.url ?? null,
      currency: c.currency,
      price,
      // Shopify holds no cost price for this store: estimated at 40% of the full price until Lucida supplies it
      cost: Math.round(full * 0.4),
      compareAt: compareAt > price ? compareAt : null,
      sizes: sortSizes(vs.map((v) => sizeOf(v.selectedOptions)).filter((x): x is string => Boolean(x))),
      sizeMix: {},
      supplierId: supplierOf(p.vendor),
      channels: [c.id],
      handle: p.handle,
      status: 'active',
      // it could first sell online when the store opened, whatever day it was created in the admin
      launchedAt: new Date(Math.max(new Date(p.createdAt).getTime(), opened)),
      source: 'shopify',
    } satisfies typeof schema.products.$inferInsert;
  });

  log('Writing the stockroom…');
  const idOf = new Map<string, string>();
  for (let i = 0; i < products.length; i += 400) {
    const chunk = products.slice(i, i + 400);
    const out = await db
      .insert(schema.products)
      .values(chunk)
      .onConflictDoUpdate({
        target: [schema.products.market, schema.products.styleCode],
        set: { title: sql`excluded.title`, brand: sql`excluded.brand`, category: sql`excluded.category`, season: sql`excluded.season`, image: sql`excluded.image`, price: sql`excluded.price`,
          // an estimated cost (40% of full price) follows the price; an imported one is kept
          cost: sql`case when ${schema.products.cost} = round(coalesce(${schema.products.compareAt}, ${schema.products.price}) * 0.4) then excluded.cost else ${schema.products.cost} end`, compareAt: sql`excluded.compare_at`, sizes: sql`excluded.sizes`, status: 'active', channels: sql`excluded.channels`, source: 'shopify' },
      })
      .returning({ id: schema.products.id, styleCode: schema.products.styleCode });
    for (const r of out) idOf.set(r.styleCode, r.id);
  }
  // styles no longer live on the store stop being planned
  const live = [...idOf.values()];
  await db.execute(sql`update products set status = 'discontinued' where market = ${market} and source = 'shopify' and id not in (${sql.join(live.map((x) => sql`${x}`), sql`, `)})`);

  const variants = rows.map((v) => {
    const productId = idOf.get(v.product.handle)!;
    const size = sizeOf(v.selectedOptions);
    const sizes = products.find((p) => p.styleCode === v.product.handle)?.sizes ?? [];
    return { productId, sku: v.sku?.trim() || v.barcode?.trim() || v.id.split('/').pop()!, barcode: v.barcode?.trim() || null, size, sizeIdx: Math.max(0, size ? [...sizes].sort(bySize).indexOf(size) : 0), qty: v.inventoryQuantity ?? 0 };
  });
  const varIds = new Map<string, string>();
  for (let i = 0; i < variants.length; i += 800) {
    const chunk = variants.slice(i, i + 800);
    const out = await db
      .insert(schema.variants)
      .values(chunk.map((v) => ({ productId: v.productId, sku: v.sku, barcode: v.barcode, size: v.size, sizeIdx: v.sizeIdx })))
      .onConflictDoUpdate({ target: [schema.variants.productId, schema.variants.sku], set: { barcode: sql`excluded.barcode`, size: sql`excluded.size`, sizeIdx: sql`excluded.size_idx` } })
      .returning({ id: schema.variants.id, productId: schema.variants.productId, sku: schema.variants.sku });
    for (const r of out) varIds.set(`${r.productId}|${r.sku}`, r.id);
  }
  const now = new Date();
  const levels = variants.map((v) => ({ variantId: varIds.get(`${v.productId}|${v.sku}`)!, productId: v.productId, locationId: c.warehouse, onHand: v.qty, updatedAt: now })).filter((l) => l.variantId);
  for (let i = 0; i < levels.length; i += 1000) {
    await db
      .insert(schema.stockLevels)
      .values(levels.slice(i, i + 1000))
      .onConflictDoUpdate({ target: [schema.stockLevels.variantId, schema.stockLevels.locationId], set: { onHand: sql`excluded.on_hand`, updatedAt: now } });
  }
  const pieces = levels.reduce((a, l) => a + Math.max(0, l.onHand), 0);
  return { products: products.length, variants: variants.length, pieces, location: main?.name ?? c.warehouse };
}

export async function importShopifyStock(channelId: string, opts: { log?: (m: string) => void; plan?: boolean } = {}): Promise<LiveImport> {
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const c = CHANNEL[channelId];
  if (!c || c.platform !== 'shopify' || !channelConfigured(c)) throw new Error(`${channelId} is not a connected Shopify store.`);
  const db = await getDb();
  const market = c.country;

  // ── orders first: every order the store has taken, and no demo orders beside them ──
  log(`Reading every ${c.name} order…`);
  await clearDemoOrders(c.id);
  const sync = await syncChannel(c, { full: true, days: 800 });
  log(`  ${sync.note}`);
  const [{ first, n }] = (await db.execute<{ first: string | null; n: number }>(sql`select min(placed_at)::text as first, count(*)::int as n from orders where channel_id = ${c.id} and source <> 'demo'`)).rows;
  const opened = first ? new Date(first).getTime() : Date.now();

  const cat = await readCatalogue(c, opened, { log, clearDemo: true });

  // ── sales: the real orders, week by week ──
  log('Turning the orders into weekly sales…');
  // the store's weekly sales are rebuilt from its own orders, nothing else
  await db.execute(sql`delete from sales_weekly where product_id in (select id from products where market = ${market} and source <> 'demo')`);
  if (first) await rollupOnlineSales(weekOf(new Date(first)));
  catalogueChanged();
  invalidateFacts();

  const now = new Date();
  const result: LiveImport = { at: now.toISOString(), channelId: c.id, products: cat.products, variants: cat.variants, pieces: cat.pieces, orders: n, firstOrder: first, location: cat.location, ms: Date.now() - t0 };
  await db
    .insert(schema.settings)
    .values({ key: `live.${c.id}`, value: result })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: result, updatedAt: now } });
  await logActivity(PLANNER, { area: 'stock', kind: 'live_import', message: `Read ${c.name} from Shopify: ${cat.products.toLocaleString('en')} styles, ${cat.pieces.toLocaleString('en')} pieces, ${n} orders.` });
  if (opts.plan !== false) {
    log('The AI planner is reading the real range…');
    const r = await runPlanner({ quiet: true });
    log(`  ${r.recs} proposals in ${(r.ms / 1000).toFixed(1)}s`);
  }
  return result;
}

export type CatalogueRead = { at: string; channelId: string; products: number; variants: number; pieces: number; ms: number; ok: boolean; note?: string };
export const catalogueKey = (channelId: string) => `catalogue.${channelId}`;

/**
 * Every imported store's catalogue and stock again (25 Oct: the console had read Labesny once, on 13 Oct,
 * so its stock drifted, styles added since were missing and the season tags never arrived). Orders and
 * weekly sales are left as they are; only styles, sizes, prices, seasons and stock move.
 */
export async function refreshCatalogues(log: (m: string) => void = () => {}) {
  const db = await getDb();
  const out: CatalogueRead[] = [];
  for (const c of CHANNELS.filter((x) => x.platform === 'shopify' && !x.parked && channelConfigured(x))) {
    const [done] = await db.select().from(schema.settings).where(eq(schema.settings.key, `live.${c.id}`));
    if (!done) continue; // never imported: importNewStores does the first reading
    const t0 = Date.now();
    const first = (done.value as LiveImport).firstOrder;
    try {
      const cat = await readCatalogue(c, first ? new Date(first).getTime() : Date.now(), { log });
      out.push({ at: new Date().toISOString(), channelId: c.id, products: cat.products, variants: cat.variants, pieces: cat.pieces, ms: Date.now() - t0, ok: true });
    } catch (e) {
      out.push({ at: new Date().toISOString(), channelId: c.id, products: 0, variants: 0, pieces: 0, ms: Date.now() - t0, ok: false, note: e instanceof Error ? e.message : String(e) });
    }
    const r = out[out.length - 1];
    await db.insert(schema.settings).values({ key: catalogueKey(c.id), value: r }).onConflictDoUpdate({ target: schema.settings.key, set: { value: r, updatedAt: new Date() } });
  }
  if (out.some((r) => r.ok)) {
    catalogueChanged();
    invalidateFacts();
  }
  return out;
}

/** Once a night, after 2am local: the catalogue re-read (Labesny is Kuwait time). */
export async function maybeRefreshCataloguesTonight(tz = 'Asia/Kuwait') {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  if (hour < 2 || hour > 5) return;
  const db = await getDb();
  const rows = await db.select().from(schema.settings).where(sql`${schema.settings.key} like 'catalogue.%'`);
  const last = Math.max(0, ...rows.map((r) => Date.parse((r.value as CatalogueRead).at) || 0));
  if (Date.now() - last < 20 * 3_600_000) return;
  const r = await refreshCatalogues();
  for (const x of r) console.log(`[stock] catalogue ${x.channelId}: ${x.ok ? `${x.products} styles, ${x.pieces} pieces in ${Math.round(x.ms / 1000)}s` : `failed: ${x.note}`}`);
}

/** When each store's catalogue was last read: the first import, or the nightly re-read after it. */
export async function catalogueReadAt(channelIds: string[]) {
  const db = await getDb();
  const keys = channelIds.flatMap((id) => [`live.${id}`, catalogueKey(id)]);
  if (!keys.length) return null;
  const rows = await db.select().from(schema.settings).where(inArray(schema.settings.key, keys));
  const ats = rows.map((r) => Date.parse((r.value as { at: string; ok?: boolean }).at)).filter(Number.isFinite);
  return ats.length ? new Date(Math.max(...ats)) : null;
}

/** What each live market's last import found, for the pages that show where the data comes from. */
export async function liveImports(): Promise<LiveImport[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.settings).where(inArray(schema.settings.key, CHANNELS.map((c) => `live.${c.id}`)));
  return rows.map((r) => r.value as LiveImport);
}
