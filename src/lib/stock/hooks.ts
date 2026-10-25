import 'server-only';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { CHANNEL } from '../channels';

// The order floor and the stockroom are one system: a parcel leaving the warehouse takes its pieces
// off the shelf, a refused parcel coming back puts them on again, and a return that passes
// inspection is sellable stock once more. Called by the engine; never allowed to stop an order.

type Line = { sku: string | null; barcode: string | null; quantity: number };

const LEAVES = new Set(['packed', 'shipped', 'delivering', 'delivered']);

// Until a catalogue exists there is nothing to move; checked once a minute rather than per order.
let catalogueSeen = { at: 0, any: false };
async function hasCatalogue() {
  if (Date.now() - catalogueSeen.at < 60_000) return catalogueSeen.any;
  const db = await getDb();
  const [row] = await db.select({ id: schema.products.id }).from(schema.products).limit(1);
  catalogueSeen = { at: Date.now(), any: Boolean(row) };
  return catalogueSeen.any;
}
export const catalogueChanged = () => {
  catalogueSeen = { at: 0, any: false };
};

async function variantsFor(market: string, lines: Line[]) {
  const db = await getDb();
  const skus = lines.map((l) => l.sku).filter((s): s is string => Boolean(s));
  const codes = lines.map((l) => l.barcode).filter((s): s is string => Boolean(s));
  if (!skus.length && !codes.length) return new Map<string, { variantId: string; productId: string }>();
  const rows = await db
    .select({ id: schema.variants.id, productId: schema.variants.productId, sku: schema.variants.sku, barcode: schema.variants.barcode })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.products.market, market), or(...[skus.length ? inArray(schema.variants.sku, skus) : undefined, codes.length ? inArray(schema.variants.barcode, codes) : undefined].filter(Boolean))));
  const map = new Map<string, { variantId: string; productId: string }>();
  for (const r of rows) {
    map.set(r.sku, { variantId: r.id, productId: r.productId });
    if (r.barcode) map.set(r.barcode, { variantId: r.id, productId: r.productId });
  }
  return map;
}

/** Posts one movement and keeps the level in step with it. */
export async function postMove(m: typeof schema.stockMoves.$inferInsert) {
  const db = await getDb();
  await db.insert(schema.stockMoves).values(m);
  await db
    .insert(schema.stockLevels)
    .values({ variantId: m.variantId, productId: m.productId, locationId: m.locationId, onHand: m.qty, updatedAt: m.at ?? new Date() })
    .onConflictDoUpdate({
      target: [schema.stockLevels.variantId, schema.stockLevels.locationId],
      set: { onHand: sql`${schema.stockLevels.onHand} + ${m.qty}`, updatedAt: m.at ?? new Date() },
    });
}

/** An order changed stage: take its pieces off the shelf when it leaves, put them back if it comes back. */
export async function stockFollowsOrder(orderId: string, to: string, at: Date, actorName: string) {
  try {
    if (!(await hasCatalogue())) return;
    const db = await getDb();
    const [o] = await db.select({ id: schema.orders.id, channelId: schema.orders.channelId, number: schema.orders.number }).from(schema.orders).where(eq(schema.orders.id, orderId));
    const ch = o && CHANNEL[o.channelId];
    if (!ch) return;
    const done = await db
      .select({ kind: schema.stockMoves.kind })
      .from(schema.stockMoves)
      .where(and(eq(schema.stockMoves.refType, 'order'), eq(schema.stockMoves.refId, orderId)));
    const sold = done.some((d) => d.kind === 'sale');
    const back = done.some((d) => d.kind === 'return');
    const leaving = LEAVES.has(to) && !sold;
    const returning = to === 'rto_closed' && sold && !back;
    if (!leaving && !returning) return;

    const lines = await db.select({ sku: schema.orderItems.sku, barcode: schema.orderItems.barcode, quantity: schema.orderItems.quantity }).from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    const map = await variantsFor(ch.country, lines);
    for (const l of lines) {
      const v = (l.sku && map.get(l.sku)) || (l.barcode && map.get(l.barcode));
      if (!v) continue;
      await postMove({
        at,
        variantId: v.variantId,
        productId: v.productId,
        locationId: ch.warehouse,
        qty: leaving ? -l.quantity : l.quantity,
        kind: leaving ? 'sale' : 'return',
        refType: 'order',
        refId: orderId,
        channelId: o.channelId,
        actorName,
        note: leaving ? `${o.number} left the warehouse` : `${o.number} came back refused`,
      });
    }
  } catch (e) {
    console.error('[stock] could not follow order', orderId, e);
  }
}

/** A return passed inspection and went back on the shelf. */
export async function stockFollowsReturn(returnId: string, at: Date, actorName: string) {
  try {
    if (!(await hasCatalogue())) return;
    const db = await getDb();
    const [r] = await db.select({ id: schema.returns.id, channelId: schema.returns.channelId, number: schema.returns.number }).from(schema.returns).where(eq(schema.returns.id, returnId));
    const ch = r && CHANNEL[r.channelId];
    if (!ch) return;
    const [already] = await db.select({ id: schema.stockMoves.id }).from(schema.stockMoves).where(and(eq(schema.stockMoves.refType, 'return'), eq(schema.stockMoves.refId, returnId))).limit(1);
    if (already) return;
    const items = await db
      .select({ sku: schema.orderItems.sku, barcode: schema.orderItems.barcode, quantity: schema.returnItems.quantity })
      .from(schema.returnItems)
      .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.returnItems.orderItemId))
      .where(eq(schema.returnItems.returnId, returnId));
    const map = await variantsFor(ch.country, items);
    for (const l of items) {
      const v = (l.sku && map.get(l.sku)) || (l.barcode && map.get(l.barcode));
      if (!v) continue;
      await postMove({ at, variantId: v.variantId, productId: v.productId, locationId: ch.warehouse, qty: l.quantity, kind: 'return', refType: 'return', refId: returnId, channelId: r.channelId, actorName, note: `${r.number} passed inspection` });
    }
  } catch (e) {
    console.error('[stock] could not follow return', returnId, e);
  }
}

/** Pieces promised to open orders that have not left the building yet, by variant. */
export async function reservedByVariant(variantIds?: string[]) {
  const db = await getDb();
  const rows = await db.execute<{ variant_id: string; n: number }>(sql`
    select v.id as variant_id, sum(i.quantity)::int as n
    from order_items i
    join orders o on o.id = i.order_id
    join variants v on v.sku = i.sku
    join products p on p.id = v.product_id
    where o.stage in ('new','confirming','finance','ready','picking')
      and p.market = case when o.channel_id in (${sql.join(
        Object.values(CHANNEL)
          .filter((c) => c.country === 'KW')
          .map((c) => sql`${c.id}`),
        sql`, `,
      )}) then 'KW' else 'EG' end
      ${variantIds?.length ? sql`and v.id in (${sql.join(variantIds.map((v) => sql`${v}`), sql`, `)})` : sql``}
    group by v.id`);
  return new Map(rows.rows.map((r) => [r.variant_id, r.n]));
}

