import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { lucidaBudget, lucidaConfigured, stockByStore } from './connectors/lucida';
import { sameBrand } from './domain/branches';

/**
 * Which branch an order leaves from.
 *
 * Dan, 21 Oct 2026: "we would like to know if a specific order is going from this mall or from
 * another mall". What Lucida offers today: StockInquiry with BalanceByStore = 1 answers, per barcode,
 * every store holding it (storeCode, storeName, qty), so the console can show which branches can fill
 * an order and suggest one. What it does not offer yet: when the website posts the sale (the Labesny
 * backend's AddTransItem with SetAvailableStore = 1), Lucida picks the store itself and nothing we
 * read back says which; that needs Lucida to return the store on the transaction, or the backend to
 * name the store it posts to. Until then the branch here is the one the team records.
 */

const FRESH_MS = 30 * 60_000;

export type BranchOption = { code: string; name: string; account: string; lines: number; units: number; complete: boolean; known: boolean };

export async function shipFromOptions(orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) return null;
  const lines = await db.select({ barcode: schema.orderItems.barcode, sku: schema.orderItems.sku, quantity: schema.orderItems.quantity, title: schema.orderItems.title, brand: schema.orderItems.brand }).from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  const brands = [...new Set(lines.map((l) => l.brand).filter((b): b is string => Boolean(b)))];
  const codes = [...new Set(lines.map((l) => (l.barcode ?? l.sku ?? '').trim()).filter(Boolean))];
  const country = CHANNEL[o.channelId]?.country ?? 'EG';
  const [rows, locs] = await Promise.all([
    codes.length ? db.select().from(schema.branchStock).where(inArray(schema.branchStock.barcode, codes)) : Promise.resolve([] as (typeof schema.branchStock.$inferSelect)[]),
    db.select().from(schema.locations).where(and(eq(schema.locations.country, country), eq(schema.locations.active, true))),
  ]);
  const nameOf = (code: string, fallback: string | null) => locs.find((l) => l.externalCode === code)?.name ?? fallback ?? code;
  const checkedAt = rows.length ? new Date(Math.min(...rows.map((r) => r.checkedAt.getTime()))) : null;

  const byStore = new Map<string, BranchOption>();
  for (const l of lines) {
    const code = (l.barcode ?? l.sku ?? '').trim();
    for (const r of rows.filter((x) => x.barcode === code && x.qty > 0)) {
      const k = `${r.account}:${r.storeCode}`;
      const b = byStore.get(k) ?? { code: r.storeCode, name: nameOf(r.storeCode, r.storeName), account: r.account, lines: 0, units: 0, complete: false, known: locs.some((x) => x.externalCode === r.storeCode) };
      if (r.qty >= l.quantity) b.lines += 1;
      b.units += r.qty;
      byStore.set(k, b);
    }
  }
  const options = [...byStore.values()].map((b) => ({ ...b, complete: b.lines >= lines.length && lines.length > 0 })).sort((a, b) => Number(b.complete) - Number(a.complete) || b.lines - a.lines || b.units - a.units);
  const perLine = lines.map((l) => {
    const code = (l.barcode ?? l.sku ?? '').trim();
    const here = rows.filter((x) => x.barcode === code && x.qty > 0);
    return { title: l.title, code, quantity: l.quantity, branches: here.map((x) => ({ code: x.storeCode, name: nameOf(x.storeCode, x.storeName), qty: x.qty })).sort((a, b) => b.qty - a.qty) };
  });
  return {
    current: o.shipFrom ? { code: o.shipFrom, name: o.shipFromName ?? o.shipFrom, by: o.shipFromBy, at: o.shipFromAt } : null,
    suggestion: options.find((x) => x.complete) ?? null,
    options,
    perLine,
    // our own shops and warehouse in the market, to choose from when Lucida has not been asked
    // the warehouse and the shops that sell the order's brands first, then every other branch
    places: locs
      .map((l) => ({ code: l.externalCode || l.id, name: l.name, kind: l.kind, sells: l.kind === 'warehouse' || !l.brands.length || l.brands.some((x) => brands.some((b) => sameBrand(x, b))) }))
      .sort((a, b) => Number(b.sells) - Number(a.sells) || Number(b.kind === 'warehouse') - Number(a.kind === 'warehouse') || a.name.localeCompare(b.name)),
    checkedAt,
    stale: !checkedAt || Date.now() - checkedAt.getTime() > FRESH_MS,
    lucida: lucidaConfigured(),
    budget: lucidaConfigured() ? lucidaBudget() : null,
    codes: codes.length,
  };
}
export type ShipFromOptions = NonNullable<Awaited<ReturnType<typeof shipFromOptions>>>;

/** Asks Lucida, once, which branches hold this order's pieces, and keeps the answer. */
export async function checkBranches(orderId: string) {
  const db = await getDb();
  const lines = await db.select({ barcode: schema.orderItems.barcode, sku: schema.orderItems.sku }).from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  const codes = [...new Set(lines.map((l) => (l.barcode ?? l.sku ?? '').trim()).filter(Boolean))];
  if (!codes.length) return 0;
  const rows = await stockByStore(codes);
  await db.delete(schema.branchStock).where(inArray(schema.branchStock.barcode, codes));
  const now = new Date();
  // one row per barcode, database and store: a repeated row restates the same figure
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) seen.set(`${r.barcode}|${r.account}|${r.storeCode}`, r);
  const values = [...seen.values()].map((r) => ({ barcode: r.barcode, account: r.account, storeCode: r.storeCode, storeName: r.storeName, qty: r.qty, checkedAt: now }));
  if (values.length) await db.insert(schema.branchStock).values(values);
  return values.length;
}
