// What write-back decides before it talks to Shopify: pure, so it is tested on its own
// (src/lib/connectors/__tests__/shopify-writeback.test.ts). The calls themselves live in shopify.ts.
import type { WriteBackChange } from './types';

export type StoreLine = { id: string; sku: string | null; title: string; quantity: number; refundableQuantity: number; variant: { barcode: string | null } | null };
export type SuggestedTransaction = { gateway: string | null; kind: string; parentTransaction: { id: string } | null; amountSet: { presentmentMoney: { amount: string } }; maximumRefundableSet: { presentmentMoney: { amount: string } } | null };

/** The console's hold reasons in Shopify's own words; the note carries ours. */
export const holdReason = (reason: string) =>
  /stock/i.test(reason) ? 'INVENTORY_OUT_OF_STOCK' : /address/i.test(reason) ? 'INCORRECT_ADDRESS' : /payment/i.test(reason) ? 'AWAITING_PAYMENT' : /delay|date/i.test(reason) ? 'UNKNOWN_DELIVERY_DATE' : /fraud|risk/i.test(reason) ? 'HIGH_RISK_OF_FRAUD' : 'OTHER';
export const cancelReason = (reason: string) =>
  /customer/i.test(reason) ? 'CUSTOMER' : /stock|inventory/i.test(reason) ? 'INVENTORY' : /fraud/i.test(reason) ? 'FRAUD' : /confirm|declin|payment/i.test(reason) ? 'DECLINED' : 'OTHER';

/** The store's lines for the returned pieces: by barcode, then SKU, then title; never more than is still refundable. */
export function matchLines(store: StoreLine[], ours: Extract<WriteBackChange, { kind: 'refund' }>['lines']) {
  const left = new Map(store.map((l) => [l.id, l.refundableQuantity]));
  const out: { lineItemId: string; quantity: number; restockType: 'NO_RESTOCK' }[] = [];
  const missing: string[] = [];
  for (const o of ours) {
    const hit =
      (o.barcode && store.find((l) => l.variant?.barcode === o.barcode && (left.get(l.id) ?? 0) > 0)) ||
      (o.sku && store.find((l) => l.sku === o.sku && (left.get(l.id) ?? 0) > 0)) ||
      store.find((l) => l.title.trim().toLowerCase() === o.title.trim().toLowerCase() && (left.get(l.id) ?? 0) > 0);
    if (!hit) {
      missing.push(o.title);
      continue;
    }
    const q = Math.min(o.quantity, left.get(hit.id) ?? 0);
    left.set(hit.id, (left.get(hit.id) ?? 0) - q);
    const prev = out.find((x) => x.lineItemId === hit.id);
    if (prev) prev.quantity += q;
    else out.push({ lineItemId: hit.id, quantity: q, restockType: 'NO_RESTOCK' });
  }
  return { lines: out.filter((x) => x.quantity > 0), missing };
}

/** What to send back through the gateways the order was paid with, up to `want` (a decimal), from Shopify's own suggestion. */
export function refundTransactions(orderId: string, suggested: SuggestedTransaction[], want: number, decimals: number) {
  const out: { orderId: string; parentId: string; gateway: string; kind: 'REFUND'; amount: string }[] = [];
  let left = want;
  for (const t of suggested) {
    if (left <= 0) break;
    if (!t.parentTransaction?.id || !t.gateway) continue;
    const cap = Number(t.maximumRefundableSet?.presentmentMoney.amount ?? t.amountSet.presentmentMoney.amount);
    const take = Math.min(left, Number(t.amountSet.presentmentMoney.amount), Number.isFinite(cap) ? cap : Infinity);
    if (!(take > 0)) continue;
    out.push({ orderId, parentId: t.parentTransaction.id, gateway: t.gateway, kind: 'REFUND', amount: take.toFixed(decimals) });
    left = Math.round((left - take) * 10 ** decimals) / 10 ** decimals;
  }
  return out;
}
