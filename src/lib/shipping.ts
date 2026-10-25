import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import { CHANNEL } from './channels';
import { getSetting } from './engine';
import { egpMinor } from './stock/core';
import { DEFAULT_RATES, normaliseRates, parcelCost, pickupCost, type ShippingRates } from './domain/shipping-cost';

export const shippingRates = async (): Promise<ShippingRates> => normaliseRates(await getSetting('shipping.rates', DEFAULT_RATES));

type Row = { channel_id: string; courier: string | null; city: string | null; region: string | null; items: number; total: string; payment_method: string; stage: string; shipping: string; currency: string };

/**
 * The shipping we paid for a period: every order that left the warehouse, priced on the courier's
 * card (placeholder cards until the real ones are in), against what customers paid us for delivery.
 * Refused parcels pay the trip back; returns the desk agreed we pay for add one collection each.
 * Totals are EGP-equivalent minor units, like the rest of Finance & analysis.
 */
export async function shippingFor(input: { from: Date; to: Date; channels: string[]; orderScope: SQL; returnScope: SQL }) {
  const db = await getDb();
  const rates = await shippingRates();
  const ch = input.channels.length ? sql.join(input.channels.map((c) => sql`${c}`), sql`, `) : sql`'—'`;
  const [orders, pickups] = await Promise.all([
    db.execute<Row>(sql`
      select channel_id, courier, address->>'city' as city, address->>'region' as region, items, total::text, payment_method, stage, shipping::text, currency
      from orders
      where channel_id in (${ch}) and ${input.orderScope}
        and stage in ('shipped','delivering','delivered','settled','rto','rto_closed')
        and coalesce(shipped_at, placed_at) >= ${input.from} and coalesce(shipped_at, placed_at) < ${input.to}`),
    db.execute<{ channel_id: string; courier: string | null; paid_by: string | null; n: number }>(sql`
      select r.channel_id, o.courier, r.review->>'shippingPaidBy' as paid_by, count(*)::int as n
      from returns r join orders o on o.id = r.order_id
      where r.channel_id in (${ch}) and ${input.returnScope} and r.method = 'pickup'
        and r.stage in ('pickup','in_transit','received','inspected','refund_pending','refunded','closed')
        and r.stage_at >= ${input.from} and r.stage_at < ${input.to}
      group by 1, 2, 3`),
  ]);

  const byCourier = new Map<string, { courier: string; market: string; parcels: number; cost: number; charged: number; refused: number }>();
  const byZone = new Map<string, { zone: string; market: string; parcels: number; cost: number }>();
  let cost = 0;
  let charged = 0;
  let parcels = 0;
  let refused = 0;
  let refusedCost = 0;
  let codFees = 0;
  let placeholder = false;
  for (const o of orders.rows) {
    const market = CHANNEL[o.channel_id]?.country ?? 'EG';
    const isRefused = o.stage === 'rto' || o.stage === 'rto_closed';
    const pc = parcelCost(rates, { market, courier: o.courier, city: o.city, region: o.region, pieces: Math.max(1, Number(o.items)), cod: o.payment_method === 'cod' ? Number(o.total) : 0, refused: isRefused });
    if (!pc) continue;
    placeholder ||= pc.placeholder;
    const c = egpMinor(pc.total, pc.currency);
    const paid = egpMinor(Number(o.shipping), o.currency);
    cost += c;
    charged += paid;
    parcels += 1;
    codFees += egpMinor(pc.cod, pc.currency);
    if (isRefused) {
      refused += 1;
      refusedCost += c;
    }
    const k = `${market}:${pc.courier}`;
    const x = byCourier.get(k) ?? { courier: pc.courier, market, parcels: 0, cost: 0, charged: 0, refused: 0 };
    x.parcels += 1;
    x.cost += c;
    x.charged += paid;
    if (isRefused) x.refused += 1;
    byCourier.set(k, x);
    const zk = `${market}:${pc.zone}`;
    const z = byZone.get(zk) ?? { zone: pc.zone, market, parcels: 0, cost: 0 };
    z.parcels += 1;
    z.cost += c;
    byZone.set(zk, z);
  }

  let returnsCost = 0;
  let returnsOurs = 0;
  let returnsUnreviewed = 0;
  for (const r of pickups.rows) {
    if (r.paid_by === 'customer') continue;
    const market = CHANNEL[r.channel_id]?.country ?? 'EG';
    const pc = pickupCost(rates, market, r.courier);
    if (!pc) continue;
    placeholder ||= pc.placeholder;
    returnsCost += egpMinor(pc.total, pc.currency) * r.n;
    if (r.paid_by === 'us') returnsOurs += r.n;
    else returnsUnreviewed += r.n;
  }

  const total = cost + returnsCost;
  return {
    placeholder,
    parcels,
    cost: total,
    deliveries: cost,
    charged,
    net: charged - total,
    perParcel: parcels ? total / parcels : null,
    refused,
    refusedCost,
    codFees,
    returns: { cost: returnsCost, ours: returnsOurs, unreviewed: returnsUnreviewed },
    byCourier: [...byCourier.values()].sort((a, b) => b.cost - a.cost),
    byZone: [...byZone.values()].sort((a, b) => b.cost - a.cost),
    rates,
  };
}
