import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import type { Principal } from '../domain/perms';
import { remember } from '../remember';
import { egpMinor } from '../stock/core';
import { factsFor, getFacts, type ProductFacts } from '../stock/facts';
import { marketsFor } from '../stock/views/common';

/**
 * Size rescue (Dan, 28 Oct): the sizes the websites cannot sell because the warehouse has none, on
 * styles that sell, what each costs a week, and where pieces could come from: another of our places,
 * a shop in Lucida (branch_stock, once Lucida's logins are in) or a purchase order on its way. Money
 * leaks counts the same gaps (smart/leaks.ts), so both screens agree.
 *
 * A size's share of the style's sales is the style's size mix (what sold, by size), or an even share
 * when the style has no history by size. Online demand only, until Lucida's shop sales come in.
 */

export type Source = { kind: 'place' | 'shop' | 'po'; name: string; qty: number; eta?: string | null };
export type GapSize = { variantId: string; size: string; barcode: string | null; share: number; weekly: number; sources: Source[] };
export type SizeGap = {
  productId: string;
  title: string;
  brand: string;
  styleCode: string;
  image: string | null;
  market: string;
  demand: number; // pieces a week online
  sizes: number;
  gone: GapSize[];
  weekly: number; // EGP-equivalent minor a week
  allOut: boolean;
  action: 'move' | 'incoming' | 'reorder';
  actionText: string;
};

/** Online demand a week for a style: the forecast, or its last eight weeks when the forecast is lower. */
export const demandOf = (x: ProductFacts) => Math.max(x.rate, x.sold8 / 8);

export function sizeGaps(p: Principal) {
  return remember(`sizegaps:${p.channels.join(',')}:${(p.brands ?? []).join(',')}`, 5 * 60_000, () => compute(p));
}

async function compute(p: Principal): Promise<SizeGap[]> {
  const db = await getDb();
  const markets = marketsFor(p);
  const selling = factsFor(await getFacts(), p).products.filter((x) => markets.includes(x.market) && demandOf(x) > 0);
  if (!selling.length) return [];
  const kinds = new Map((await db.execute<{ id: string; name: string; kind: string }>(sql`select id, name, kind from locations`)).rows.map((l) => [l.id, l]));
  const hasWarehouse = [...kinds.values()].some((l) => l.kind === 'warehouse');

  // every size of the selling styles, with its pieces in each place
  type V = { id: string; product: string; size: string; barcode: string | null; online: number; places: { name: string; qty: number }[] };
  const vs = new Map<string, V>();
  for (let i = 0; i < selling.length; i += 2000) {
    const ids = selling.slice(i, i + 2000).map((x) => sql`${x.id}`);
    const r = await db.execute<{ id: string; product_id: string; size: string | null; barcode: string | null; location_id: string | null; on_hand: number | null }>(sql`
      select v.id, v.product_id, v.size, v.barcode, sl.location_id, sl.on_hand from variants v left join stock_levels sl on sl.variant_id = v.id
      where v.product_id in (${sql.join(ids, sql`, `)})`);
    for (const x of r.rows) {
      const v = vs.get(x.id) ?? { id: x.id, product: x.product_id, size: x.size || 'One size', barcode: x.barcode, online: 0, places: [] };
      const loc = x.location_id ? kinds.get(x.location_id) : null;
      const q = x.on_hand ?? 0;
      // the websites sell from the warehouse; a shop's pieces are a place to move them from
      if (!hasWarehouse || !loc || loc.kind === 'warehouse') v.online += q;
      else if (q > 0) v.places.push({ name: loc.name, qty: q });
      vs.set(x.id, v);
    }
  }
  const byProduct = new Map<string, V[]>();
  for (const v of vs.values()) byProduct.set(v.product, [...(byProduct.get(v.product) ?? []), v]);
  const goneIds = [...vs.values()].filter((v) => v.online <= 0);
  if (!goneIds.length) return [];

  // pieces in the shops (Lucida) and on order, for the sizes that are out
  const barcodes = [...new Set(goneIds.map((v) => v.barcode).filter((b): b is string => Boolean(b)))];
  const shops = new Map<string, Source[]>();
  for (let i = 0; i < barcodes.length; i += 2000) {
    const r = await db.execute<{ barcode: string; name: string; qty: number }>(sql`
      select barcode, coalesce(store_name, store_code) as name, qty from branch_stock
      where qty > 0 and barcode in (${sql.join(barcodes.slice(i, i + 2000).map((b) => sql`${b}`), sql`, `)})`);
    for (const x of r.rows) shops.set(x.barcode, [...(shops.get(x.barcode) ?? []), { kind: 'shop', name: x.name, qty: x.qty }]);
  }
  const incoming = new Map<string, Source[]>();
  for (let i = 0; i < goneIds.length; i += 2000) {
    const r = await db.execute<{ variant_id: string; reference: string; qty: number; eta: string | null }>(sql`
      select l.variant_id, po.number as reference, (l.qty - l.received)::int as qty, po.expected_at::text as eta
      from po_lines l join purchase_orders po on po.id = l.po_id
      where po.status in ('approved', 'sent', 'confirmed', 'partial') and l.qty > l.received
        and l.variant_id in (${sql.join(goneIds.slice(i, i + 2000).map((v) => sql`${v.id}`), sql`, `)})`);
    for (const x of r.rows) incoming.set(x.variant_id, [...(incoming.get(x.variant_id) ?? []), { kind: 'po', name: x.reference, qty: x.qty, eta: x.eta }]);
  }

  const out: SizeGap[] = [];
  for (const x of selling) {
    const sizes = byProduct.get(x.id) ?? [];
    const gone = sizes.filter((v) => v.online <= 0);
    if (!gone.length) continue;
    const mix = sizes.reduce((a, v) => a + (x.sizeMix[v.size] ?? 0), 0);
    const share = (v: V) => (mix > 0 ? (x.sizeMix[v.size] ?? 0) / mix : 1 / sizes.length);
    const demand = demandOf(x);
    const g: GapSize[] = gone
      .map((v) => {
        const s = share(v);
        const sources: Source[] = [...v.places.map((pl) => ({ kind: 'place' as const, ...pl })), ...(v.barcode ? (shops.get(v.barcode) ?? []) : []), ...(incoming.get(v.id) ?? [])];
        return { variantId: v.id, size: v.size, barcode: v.barcode, share: s, weekly: Math.round(egpMinor(demand * s * x.price, x.currency)), sources };
      })
      .filter((v) => v.weekly > 0);
    if (!g.length) continue;
    const movable = g.filter((v) => v.sources.some((s) => s.kind !== 'po'));
    const coming = g.filter((v) => v.sources.some((s) => s.kind === 'po'));
    const action = movable.length ? 'move' : coming.length ? 'incoming' : 'reorder';
    const best = movable.length ? movable[0].sources.filter((s) => s.kind !== 'po').sort((a, b) => b.qty - a.qty)[0] : null;
    out.push({
      productId: x.id,
      title: x.title,
      brand: x.brand,
      styleCode: x.styleCode,
      image: x.image,
      market: x.market,
      demand,
      sizes: sizes.length,
      gone: g.sort((a, b) => b.weekly - a.weekly),
      weekly: g.reduce((a, v) => a + v.weekly, 0),
      allOut: gone.length === sizes.length,
      action,
      actionText:
        action === 'move'
          ? `Move ${movable.length === 1 ? `size ${movable[0].size}` : `${movable.length} sizes`} in${best ? `: ${best.qty} at ${best.name}` : ''}`
          : action === 'incoming'
            ? `${coming.length === g.length ? 'All' : coming.length} on order${coming[0].sources.find((s) => s.kind === 'po')?.eta ? `, due ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(coming[0].sources.find((s) => s.kind === 'po')!.eta!))}` : ''}`
            : 'Reorder: nowhere else holds it',
    });
  }
  return out.sort((a, b) => b.weekly - a.weekly);
}
