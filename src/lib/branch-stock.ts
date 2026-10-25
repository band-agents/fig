import 'server-only';
import { and, inArray, isNotNull, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { lucidaAccountCount, lucidaBudget, lucidaConfigured, stockByStore } from './connectors/lucida';
import { getSetting, putSetting } from './engine';
import type { Market } from './domain/stock/calendar';

/**
 * Stock per branch for the whole catalogue (Dan, 25 Oct: "stock level of each product and where").
 * Lucida's StockInquiry with BalanceByStore answers, per barcode, every store holding it; 3,000
 * barcodes a call, once per company database. Read once a night and on demand (within this console's
 * hourly call budget), kept in branch_stock so the reports never wait on Lucida.
 */

const BATCH = 3000;
const KEY = 'branchStock.lastRun';
export type BranchRun = { at: string; barcodes: number; rows: number; stores: number; calls: number; ok: boolean; note?: string };

export const lastBranchRun = () => getSetting<BranchRun | null>(KEY, null);

async function catalogueBarcodes(markets: Market[]) {
  const db = await getDb();
  const rows = await db
    .select({ b: schema.variants.barcode })
    .from(schema.variants)
    .innerJoin(schema.products, sql`${schema.products.id} = ${schema.variants.productId}`)
    .where(and(isNotNull(schema.variants.barcode), inArray(schema.products.market, markets)));
  return [...new Set(rows.map((r) => (r.b ?? '').trim()).filter(Boolean))];
}

/** The calls a full reading takes, and whether this hour's budget has them. */
export async function branchReadCost(markets: Market[]) {
  const barcodes = (await catalogueBarcodes(markets)).length;
  const calls = lucidaAccountCount() * Math.ceil(barcodes / BATCH);
  const budget = lucidaConfigured() ? lucidaBudget() : null;
  return { barcodes, calls, budget, possible: Boolean(budget && calls > 0 && calls <= budget.left) };
}

const g = globalThis as unknown as { __branchRead?: Promise<BranchRun> };

/** Reads every catalogue barcode's stock per branch from Lucida and replaces what was kept. One at a time. */
export function readAllBranches(markets: Market[]): Promise<BranchRun> {
  if (g.__branchRead) return g.__branchRead;
  g.__branchRead = (async () => {
    const started = new Date();
    try {
      if (!lucidaConfigured()) throw new Error('Lucida is not connected: the logins go in LUCIDA_ACCOUNTS.');
      const barcodes = await catalogueBarcodes(markets);
      const rows = await stockByStore(barcodes); // spends the calls, or refuses before making any
      const seen = new Map<string, (typeof rows)[number]>();
      for (const r of rows) seen.set(`${r.barcode}|${r.account}|${r.storeCode}`, r);
      const values = [...seen.values()].map((r) => ({ barcode: r.barcode, account: r.account, storeCode: r.storeCode, storeName: r.storeName, qty: r.qty, checkedAt: started }));
      const db = await getDb();
      await db.transaction(async (tx) => {
        for (let i = 0; i < barcodes.length; i += BATCH) await tx.delete(schema.branchStock).where(inArray(schema.branchStock.barcode, barcodes.slice(i, i + BATCH)));
        for (let i = 0; i < values.length; i += 1000) await tx.insert(schema.branchStock).values(values.slice(i, i + 1000));
      });
      const run: BranchRun = { at: started.toISOString(), barcodes: barcodes.length, rows: values.length, stores: new Set(values.map((v) => `${v.account}:${v.storeCode}`)).size, calls: lucidaAccountCount() * Math.ceil(barcodes.length / BATCH), ok: true };
      await putSetting(KEY, run, 'Lucida branch reading');
      return run;
    } catch (e) {
      const run: BranchRun = { at: started.toISOString(), barcodes: 0, rows: 0, stores: 0, calls: 0, ok: false, note: e instanceof Error ? e.message : String(e) };
      await putSetting(KEY, run, 'Lucida branch reading').catch(() => {});
      return run;
    } finally {
      g.__branchRead = undefined;
    }
  })();
  return g.__branchRead;
}

/** The nightly reading: after 3am local, once a day, when Lucida is connected and the budget allows. */
export async function maybeReadBranchesTonight(markets: Market[], tz = 'Asia/Kuwait') {
  if (!lucidaConfigured()) return;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  if (hour < 3 || hour > 6) return;
  const last = await lastBranchRun();
  if (last && Date.now() - Date.parse(last.at) < 20 * 3_600_000) return;
  const cost = await branchReadCost(markets);
  if (!cost.possible) return;
  const run = await readAllBranches(markets);
  console.log(`[relay] branch stock: ${run.ok ? `${run.rows} rows, ${run.stores} branches, ${run.calls} Lucida calls` : `failed: ${run.note}`}`);
}
