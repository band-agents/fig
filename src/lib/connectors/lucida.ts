import 'server-only';
// Lucida stock by barcode, across every company database Relay has a login for (D&H, DCO, …).
// A failed or refused call throws: an unanswered barcode is unknown, never zero.
import { ConnectorError, errorText, fetchRetry } from './http';
import { buildStockRequest, mergeStock, parseLucidaAccounts, readStockResponse, type LucidaAccount, type StockFigure, type StockRow } from './lucida-map';

export type { StockFigure } from './lucida-map';

const DEFAULT_URL = 'https://API.Lucida.Cloud/api/Stock/StockInquiry';
const BATCH = 3000;

/**
 * Lucida meters the API at about sixty calls an hour per login, and the Labesny and FIG backends
 * already spend some of that on their own stock sync. So this console keeps to a budget of its own
 * (LUCIDA_CALLS_PER_HOUR, default 20) and refuses a call that would go over it rather than make one.
 */
const calls: number[] = [];
const budget = () => Math.max(1, Number(process.env.LUCIDA_CALLS_PER_HOUR ?? 20));
export function lucidaBudget() {
  const hour = Date.now() - 3_600_000;
  while (calls.length && calls[0] < hour) calls.shift();
  return { used: calls.length, left: Math.max(0, budget() - calls.length), limit: budget() };
}
function spend(n: number) {
  const b = lucidaBudget();
  if (n > b.left) throw new ConnectorError(`That needs ${n} Lucida call${n > 1 ? 's' : ''} and only ${b.left} of this hour's ${b.limit} are left. Try again later.`);
  for (let i = 0; i < n; i++) calls.push(Date.now());
}

export function lucidaConfigured() {
  try {
    return parseLucidaAccounts(process.env).length > 0;
  } catch {
    return false;
  }
}

const accounts = () => {
  const list = parseLucidaAccounts(process.env);
  if (!list.length) throw new ConnectorError('Lucida is not configured: set LUCIDA_ACCOUNTS or LUCIDA_USERNAME and LUCIDA_PASSWORD.');
  return list;
};

async function ask(account: LucidaAccount, barcodes: string[], opts: { byStore?: boolean; days?: number } = {}): Promise<StockRow[]> {
  const url = process.env.LUCIDA_URL?.trim() || DEFAULT_URL;
  const label = `Lucida (${account.username})`;
  const res = await fetchRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(buildStockRequest(account, barcodes, opts)),
    },
    { label, tries: 2, timeoutMs: 180_000 },
  );
  if (!res.ok) throw new ConnectorError(`${label} stock call failed: ${res.status} ${await errorText(res)}`, res.status);
  return readStockResponse(await res.json(), label);
}

const unique = (barcodes: string[]) => [...new Set(barcodes.map((b) => b.trim()).filter(Boolean))];
const batches = (xs: string[]) => Array.from({ length: Math.ceil(xs.length / BATCH) }, (_, i) => xs.slice(i * BATCH, (i + 1) * BATCH));

export async function stockByBarcode(barcodes: string[]): Promise<Map<string, StockFigure>> {
  const wanted = unique(barcodes);
  if (!wanted.length) return new Map();
  const list = accounts();
  spend(list.length * Math.ceil(wanted.length / BATCH));
  const results = await Promise.all(
    list.map(async (account) => {
      const rows: StockRow[] = [];
      for (const b of batches(wanted)) rows.push(...(await ask(account, b)));
      return { account: account.username, rows };
    }),
  );
  return mergeStock(results);
}

/** Each barcode's stock per store, in every database: which branches hold the piece. */
export async function stockByStore(barcodes: string[]) {
  const wanted = unique(barcodes);
  if (!wanted.length) return [];
  const list = accounts();
  spend(list.length * Math.ceil(wanted.length / BATCH));
  const out: { account: string; barcode: string; storeCode: string; storeName: string | null; qty: number }[] = [];
  for (const account of list) {
    for (const b of batches(wanted)) {
      for (const r of await ask(account, b, { byStore: true })) {
        out.push({ account: account.username, barcode: r.barcode, storeCode: r.storeCode ?? account.username, storeName: r.storeName ?? null, qty: Math.max(0, Math.trunc(r.qty)) });
      }
    }
  }
  return out;
}

/**
 * What Lucida holds for a website's barcodes, one figure per barcode and database: quantity, price,
 * was-price and its own description. A barcode Lucida does not answer for is either not defined as
 * a web item or sold out there (StockInquiry leaves quantity 0 out), which the caller cannot tell apart.
 * With \`days\`, also every item Lucida changed in that many days, to find web items the store lacks.
 */
export async function webItemsFromLucida(barcodes: string[], opts: { days?: number } = {}) {
  const wanted = unique(barcodes);
  const list = accounts();
  const n = list.length * (Math.ceil(wanted.length / BATCH) + (opts.days ? 1 : 0));
  spend(n);
  const out = new Map<string, { account: string; qty: number; price?: number; was?: number; desc?: string }>();
  const keep = (account: string, r: StockRow) => {
    const prev = out.get(r.barcode);
    // a barcode belongs to one database; the one reporting stock wins
    if (prev && !(prev.qty === 0 && r.qty > 0)) return;
    out.set(r.barcode, { account, qty: Math.max(0, Math.trunc(r.qty)), price: r.priceA, was: r.priceE, desc: r.desc });
  };
  for (const account of list) {
    for (const b of batches(wanted)) for (const r of await ask(account, b)) keep(account.username, r);
    if (opts.days) for (const r of await ask(account, [], { days: opts.days })) keep(account.username, r);
  }
  return { items: out, calls: n };
}

/** How many Lucida databases this console has a login for (each call is made once per database). */
export function lucidaAccountCount() {
  try {
    return parseLucidaAccounts(process.env).length;
  } catch {
    return 0;
  }
}
