import 'server-only';
// Lucida stock by barcode, across every company database Relay has a login for (D&H, DCO, …).
// A failed or refused call throws: an unanswered barcode is unknown, never zero.
import { ConnectorError, errorText, fetchRetry } from './http';
import { buildStockRequest, mergeStock, parseLucidaAccounts, readStockResponse, type StockFigure, type StockRow } from './lucida-map';

export type { StockFigure } from './lucida-map';

const DEFAULT_URL = 'https://API.Lucida.Cloud/api/Stock/StockInquiry';
const BATCH = 3000;

export function lucidaConfigured() {
  try {
    return parseLucidaAccounts(process.env).length > 0;
  } catch {
    return false;
  }
}

export async function stockByBarcode(barcodes: string[]): Promise<Map<string, StockFigure>> {
  const wanted = [...new Set(barcodes.map((b) => b.trim()).filter(Boolean))];
  if (!wanted.length) return new Map();
  const accounts = parseLucidaAccounts(process.env);
  if (!accounts.length) throw new ConnectorError('Lucida is not configured: set LUCIDA_ACCOUNTS or LUCIDA_USERNAME and LUCIDA_PASSWORD.');
  const url = process.env.LUCIDA_URL?.trim() || DEFAULT_URL;

  const results = await Promise.all(
    accounts.map(async (account) => {
      const label = `Lucida (${account.username})`;
      const rows: StockRow[] = [];
      for (let i = 0; i < wanted.length; i += BATCH) {
        const res = await fetchRetry(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(buildStockRequest(account, wanted.slice(i, i + BATCH))),
          },
          { label, tries: 2, timeoutMs: 120_000 },
        );
        if (!res.ok) throw new ConnectorError(`${label} stock call failed: ${res.status} ${await errorText(res)}`, res.status);
        rows.push(...readStockResponse(await res.json(), label));
      }
      return { account: account.username, rows };
    }),
  );
  return mergeStock(results);
}
