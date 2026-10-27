import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { CHANNEL, channelLabel } from '../channels';
import { getSetting } from '../engine';
import type { Principal } from '../domain/perms';
import { parcelCost, pickupCost } from '../domain/shipping-cost';
import { remember } from '../remember';
import { scope } from '../queries';
import { shippingRates } from '../shipping';
import { egpMinor } from '../stock/core';

/**
 * True profit (Dan, 28 Oct): what each order really leaves after the cost of the goods, the courier
 * (out, and back when refused), the cash-on-delivery fee, the payment fee, refunds and the return
 * collections we paid for. Sliced by destination, pieces per order, payment, brand and store, so the
 * orders that lose money show themselves.
 *
 * - Cost of goods is the catalogue's cost price, matched by barcode or SKU (estimated until Lucida's
 *   costs come in). A line with no match takes the average cost share of the lines that matched.
 * - Courier costs come from the rate cards (Setup → shipping), placeholder cards included until the
 *   real ones are in, and the page says when.
 * - Payment fees are a share of the order by method, kept in the `profit.fees` setting.
 * - Refunded pieces come back to stock, so their cost of goods comes back too.
 * Amounts are EGP-equivalent minor units.
 */

export type Fees = Record<string, number>; // payment method → share of the order total
export const DEFAULT_FEES: Fees = { card: 0.025, knet: 0.01, wallet: 0.02, instapay: 0, cod: 0, store_credit: 0 };

export type OrderProfit = {
  id: string;
  number: string;
  channel: string;
  market: string;
  placedAt: string;
  city: string;
  zone: string;
  pieces: number;
  payment: string;
  refused: boolean;
  net: number; // what the customer paid for the goods, after discounts
  shipCharged: number;
  cogs: number;
  courier: number;
  payFee: number;
  refunds: number;
  returnCost: number;
  profit: number;
  costGuessed: boolean;
};

type Slice = { key: string; label: string; orders: number; net: number; profit: number; courier: number; losing: number };

export function trueProfit(p: Principal, days: number) {
  return remember(`profit:${days}:${p.channels.join(',')}:${(p.brands ?? []).join(',')}`, 5 * 60_000, () => compute(p, days));
}

async function compute(p: Principal, days: number) {
  const db = await getDb();
  const s = scope(p, sql`o.channel_id`, sql`o.id`);
  const since = new Date(Date.now() - days * 86400000);
  const [rates, fees] = await Promise.all([shippingRates(), getSetting<Fees>('profit.fees', DEFAULT_FEES)]);
  const fee = (method: string) => (Number.isFinite(fees[method]) ? fees[method] : (DEFAULT_FEES[method] ?? 0));

  const orders = await db.execute<{ id: string; number: string; channel_id: string; placed_at: string; city: string | null; region: string | null; courier: string | null; items: number; payment_method: string; stage: string; subtotal: string; discount: string; shipping: string; total: string; currency: string }>(sql`
    select o.id, o.number, o.channel_id, o.placed_at::text, o.address->>'city' as city, o.address->>'region' as region, o.courier, o.items, o.payment_method, o.stage,
      o.subtotal::text, o.discount::text, o.shipping::text, o.total::text, o.currency
    from orders o where ${s} and o.source <> 'demo' and o.stage <> 'cancelled' and o.placed_at >= ${since}`);
  if (!orders.rows.length) return { orders: [] as OrderProfit[], totals: null, slices: null, days, placeholder: false, guessed: 0, fees, at: Date.now() };
  const ids = orders.rows.map((o) => sql`${o.id}`);

  // the lines with their catalogue cost, by barcode, then by SKU
  const lines = await db.execute<{ order_id: string; brand: string | null; quantity: number; unit_price: string; currency: string; cost: string | null; cost_currency: string | null }>(sql`
    select oi.order_id, coalesce(oi.brand, c.brand) as brand, oi.quantity, oi.unit_price::text, o.currency, c.cost::text, c.currency as cost_currency
    from order_items oi join orders o on o.id = oi.order_id
    left join lateral (
      select p.cost, p.currency, p.brand from variants v join products p on p.id = v.product_id
      where (oi.barcode is not null and oi.barcode <> '' and v.barcode = oi.barcode) or (oi.sku is not null and oi.sku <> '' and v.sku = oi.sku)
      limit 1
    ) c on true
    where oi.order_id in (${sql.join(ids, sql`, `)})`);
  const refunds = await db.execute<{ order_id: string; amount: string; currency: string; method: string; paid_by: string | null; stage: string; channel_id: string; courier: string | null }>(sql`
    select r.order_id, r.amount::text, r.currency, r.method, r.review->>'shippingPaidBy' as paid_by, r.stage, r.channel_id, o.courier
    from returns r join orders o on o.id = r.order_id
    where r.order_id in (${sql.join(ids, sql`, `)}) and r.stage <> 'rejected'`);

  // the cost share of the lines we could price, for the ones we could not
  let knownSales = 0;
  let knownCost = 0;
  for (const l of lines.rows) {
    if (l.cost == null || Number(l.cost) <= 0) continue;
    knownSales += egpMinor(Number(l.unit_price) * l.quantity, l.currency);
    knownCost += egpMinor(Number(l.cost) * l.quantity, l.cost_currency ?? l.currency);
  }
  const costShare = knownSales > 0 ? knownCost / knownSales : 0.45;
  const byOrder = new Map<string, { cogs: number; guessed: boolean; brands: Map<string, number> }>();
  for (const l of lines.rows) {
    const value = egpMinor(Number(l.unit_price) * l.quantity, l.currency);
    const known = l.cost != null && Number(l.cost) > 0;
    const cogs = known ? egpMinor(Number(l.cost) * l.quantity, l.cost_currency ?? l.currency) : Math.round(value * costShare);
    const x = byOrder.get(l.order_id) ?? { cogs: 0, guessed: false, brands: new Map() };
    x.cogs += cogs;
    x.guessed ||= !known;
    const b = l.brand?.trim() || 'Unknown brand';
    x.brands.set(b, (x.brands.get(b) ?? 0) + value);
    byOrder.set(l.order_id, x);
  }
  const back = new Map<string, { refunds: number; cost: number }>();
  for (const r of refunds.rows) {
    const x = back.get(r.order_id) ?? { refunds: 0, cost: 0 };
    if (r.stage === 'refunded' || r.stage === 'closed') x.refunds += egpMinor(Number(r.amount), r.currency);
    if (r.method === 'pickup' && r.paid_by !== 'customer') {
      const pc = pickupCost(rates, CHANNEL[r.channel_id]?.country ?? 'EG', r.courier);
      if (pc) x.cost += egpMinor(pc.total, pc.currency);
    }
    back.set(r.order_id, x);
  }

  let placeholder = false;
  const out: OrderProfit[] = [];
  const brandRows = new Map<string, Slice>();
  for (const o of orders.rows) {
    const market = CHANNEL[o.channel_id]?.country ?? 'EG';
    const refused = o.stage === 'rto' || o.stage === 'rto_closed';
    const pieces = Math.max(1, Number(o.items));
    const pc = parcelCost(rates, { market, courier: o.courier, city: o.city, region: o.region, pieces, cod: o.payment_method === 'cod' ? Number(o.total) : 0, refused });
    placeholder ||= Boolean(pc?.placeholder);
    const courier = pc ? egpMinor(pc.total, pc.currency) : 0;
    const net = egpMinor(Number(o.subtotal) - Number(o.discount), o.currency);
    const shipCharged = egpMinor(Number(o.shipping), o.currency);
    const lines = byOrder.get(o.id);
    const r = back.get(o.id) ?? { refunds: 0, cost: 0 };
    // a refused parcel sold nothing: the goods are back on the shelf, only the trips are paid
    const sold = refused ? 0 : net + shipCharged;
    const refundShare = sold > 0 ? Math.min(1, r.refunds / sold) : 0;
    const cogs = refused ? 0 : Math.round((lines?.cogs ?? Math.round(net * costShare)) * (1 - refundShare));
    const payFee = refused ? 0 : Math.round(egpMinor(Number(o.total), o.currency) * fee(o.payment_method));
    const profit = sold - r.refunds - cogs - courier - payFee - r.cost;
    out.push({
      id: o.id,
      number: o.number,
      channel: o.channel_id,
      market,
      placedAt: o.placed_at,
      city: (o.city || o.region || 'Unknown area').trim(),
      zone: pc?.zone ?? 'Unknown zone',
      pieces,
      payment: o.payment_method,
      refused,
      net: refused ? 0 : net,
      shipCharged: refused ? 0 : shipCharged,
      cogs,
      courier,
      payFee,
      refunds: r.refunds,
      returnCost: r.cost,
      profit,
      costGuessed: !lines || lines.guessed,
    });
    // a brand's share of the order: its share of the goods value
    const total = lines ? [...lines.brands.values()].reduce((a, v) => a + v, 0) : 0;
    for (const [b, v] of lines?.brands ?? []) {
      const share = total > 0 ? v / total : 0;
      const x = brandRows.get(b) ?? { key: b, label: b, orders: 0, net: 0, profit: 0, courier: 0, losing: 0 };
      x.orders += share;
      x.net += Math.round((refused ? 0 : net) * share);
      x.profit += Math.round(profit * share);
      x.courier += Math.round(courier * share);
      if (profit < 0) x.losing += share;
      brandRows.set(b, x);
    }
  }

  const sliceBy = (key: (o: OrderProfit) => string, label: (k: string) => string = (k) => k) => {
    const m = new Map<string, Slice>();
    for (const o of out) {
      const k = key(o);
      const x = m.get(k) ?? { key: k, label: label(k), orders: 0, net: 0, profit: 0, courier: 0, losing: 0 };
      x.orders += 1;
      x.net += o.net;
      x.profit += o.profit;
      x.courier += o.courier;
      if (o.profit < 0) x.losing += 1;
      m.set(k, x);
    }
    return [...m.values()];
  };
  const sum = (f: (o: OrderProfit) => number) => out.reduce((a, o) => a + f(o), 0);
  const sales = sum((o) => o.net + o.shipCharged);
  const totals = {
    orders: out.length,
    sales,
    net: sum((o) => o.net),
    shipCharged: sum((o) => o.shipCharged),
    cogs: sum((o) => o.cogs),
    courier: sum((o) => o.courier),
    payFee: sum((o) => o.payFee),
    refunds: sum((o) => o.refunds),
    returnCost: sum((o) => o.returnCost),
    profit: sum((o) => o.profit),
    losing: out.filter((o) => o.profit < 0).length,
    lost: sum((o) => Math.min(0, o.profit)),
    refused: out.filter((o) => o.refused).length,
  };
  const piecesLabel = (k: string) => (k === '4' ? '4 pieces or more' : `${k} piece${k === '1' ? '' : 's'}`);
  return {
    orders: out,
    totals,
    slices: {
      zone: sliceBy((o) => `${o.market === 'KW' ? 'Kuwait' : 'Egypt'} · ${o.zone}`),
      city: sliceBy((o) => o.city),
      pieces: sliceBy((o) => String(Math.min(4, o.pieces)), piecesLabel).sort((a, b) => Number(a.key) - Number(b.key)),
      payment: sliceBy((o) => o.payment, (k) => PAYMENT[k] ?? k),
      store: sliceBy((o) => o.channel, (k) => channelLabel(k)),
      brand: [...brandRows.values()],
    },
    days,
    placeholder,
    guessed: out.filter((o) => o.costGuessed).length,
    costShare,
    fees,
    at: Date.now(),
  };
}

const PAYMENT: Record<string, string> = { cod: 'Cash on delivery', card: 'Card', knet: 'KNET', wallet: 'Wallet', instapay: 'InstaPay', store_credit: 'Store credit' };
export type TrueProfit = Awaited<ReturnType<typeof trueProfit>>;
