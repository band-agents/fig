// Lucida (FIG's ERP) StockInquiry request and response shapes, copied from fig-app's proven client.
// Pure: env is passed in. Status above 1 is a failure even on HTTP 200 and must never read as zero stock.

export type LucidaAccount = { username: string; password: string; accountId?: string };
export type StockFigure = { qty: number; price?: number; was?: number; store?: string };
export type StockRow = { barcode: string; qty: number; priceA?: number; priceE?: number; storeCode?: string };

/** LUCIDA_ACCOUNTS (a JSON array, one entry per company database) or the single LUCIDA_USERNAME/LUCIDA_PASSWORD. */
export function parseLucidaAccounts(env: Record<string, string | undefined>): LucidaAccount[] {
  const raw = env.LUCIDA_ACCOUNTS?.trim();
  if (raw) {
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Error('LUCIDA_ACCOUNTS is not valid JSON; expected [{"username":"…","password":"…"}].');
    }
    if (!Array.isArray(list)) throw new Error('LUCIDA_ACCOUNTS must be a JSON array of {username, password}.');
    return list.map((a, i) => {
      const o = (a ?? {}) as Record<string, unknown>;
      if (typeof o.username !== 'string' || !o.username.trim() || typeof o.password !== 'string' || !o.password) {
        throw new Error(`LUCIDA_ACCOUNTS entry ${i + 1} needs a username and a password.`);
      }
      return { username: o.username.trim(), password: o.password, ...(typeof o.accountId === 'string' ? { accountId: o.accountId } : {}) };
    });
  }
  const username = env.LUCIDA_USERNAME?.trim();
  const password = env.LUCIDA_PASSWORD;
  return username && password ? [{ username, password }] : [];
}

/**
 * The request body. Credentials travel here, not in a header. Naming barcodes means LastUpdateID 0;
 * HideZeroBalance 0 keeps sold-out items in the answer; BalanceByStore 0 gives one figure per item.
 */
export function buildStockRequest(account: LucidaAccount, barcodes: string[], opts: { platform?: number; lang?: number } = {}) {
  return {
    Username: account.username,
    Password: account.password,
    AccountID: account.accountId ?? '',
    Platform: opts.platform ?? 1,
    Lang: opts.lang ?? 1,
    ItemCode: '',
    ItemBarcode: barcodes.join(','),
    StoreCode: '',
    BalanceByStore: 0,
    HideZeroBalance: 0,
    UpdateType: 1,
    LastUpdateID: 0,
  };
}

const field = (row: unknown, names: string[]): unknown => {
  if (!row || typeof row !== 'object') return undefined;
  const r = row as Record<string, unknown>;
  for (const n of names) if (r[n] !== undefined && r[n] !== null) return r[n];
  return undefined;
};

const preview = (v: unknown) => JSON.stringify(v)?.slice(0, 200) ?? String(v);

/** Lucida documents PascalCase and answers camelCase, so both are read. */
export function readStockResponse(payload: unknown, label = 'Lucida'): StockRow[] {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const status = Number(field(payload, ['status', 'Status']));
    if (Number.isFinite(status) && status > 1) {
      const remarks = field(payload, ['remarks', 'Remarks']);
      throw new Error(`${label} reported ${status === 3 ? 'an entry error' : 'a failure'} (status ${status}): ${preview(remarks ?? payload)}`);
    }
  }
  let rows: unknown[] | null = Array.isArray(payload) ? payload : null;
  if (!rows && payload && typeof payload === 'object') {
    for (const k of ['itemsList', 'ItemsList', 'items', 'data']) {
      const v = (payload as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        rows = v;
        break;
      }
    }
  }
  if (!rows) throw new Error(`${label} answered without an items list: ${preview(payload)}`);

  return rows.map((row, i) => {
    const barcode = field(row, ['itemBarcode', 'ItemBarcode', 'barcode']);
    const qty = Number(field(row, ['qty', 'QTY', 'Qty', 'quantity']));
    if (typeof barcode !== 'string' || !barcode.trim()) throw new Error(`${label} row ${i} has no item barcode: ${preview(row)}`);
    if (!Number.isFinite(qty)) throw new Error(`${label} row for ${barcode.trim()} has no readable quantity: ${preview(row)}`);
    const out: StockRow = { barcode: barcode.trim(), qty };
    const priceA = Number(field(row, ['priceA', 'PriceA']));
    const priceE = Number(field(row, ['priceE', 'PriceE']));
    const store = field(row, ['storeCode', 'StoreCode']);
    if (Number.isFinite(priceA) && priceA > 0) out.priceA = priceA;
    if (Number.isFinite(priceE) && priceE > 0) out.priceE = priceE;
    if (typeof store === 'string' && store.trim()) out.storeCode = store.trim();
    return out;
  });
}

/**
 * One figure per barcode. Within an account the last row wins: a repeated row restates the same
 * figure and is never added. Across accounts a barcode belongs to one database, so the first account
 * reporting stock keeps it. `store` is the store code when Lucida gives one, else the account.
 */
export function mergeStock(results: { account: string; rows: StockRow[] }[]): Map<string, StockFigure> {
  const out = new Map<string, StockFigure>();
  for (const { account, rows } of results) {
    const mine = new Map<string, StockFigure>();
    for (const r of rows) {
      const fig: StockFigure = { qty: Math.max(0, Math.trunc(r.qty)), store: r.storeCode ?? account };
      if (r.priceA !== undefined) fig.price = r.priceA;
      if (r.priceE !== undefined) fig.was = r.priceE;
      mine.set(r.barcode, fig);
    }
    for (const [barcode, fig] of mine) {
      const prev = out.get(barcode);
      if (!prev || (prev.qty === 0 && fig.qty > 0)) out.set(barcode, fig);
    }
  }
  return out;
}
