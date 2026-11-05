// Tidies the orders already in the console from before the 4 Nov fix (the sync applies it to new pulls):
//  - FIG's old WooCommerce orders copied into Shopify (tag `migrated`) leave the floor, from their
//    `woo-status-…` tag: completed ones close as settled (5 Nov: not left waiting on Finance for cash),
//    refunded and cancelled ones are cancelled. Old orders still open there (processing, on hold) are
//    listed, not touched.
//  - Discount and fee lines ("First Order Discount (10%)" at a minus price, "77,00 EGP fee") stop being
//    items: they are taken off the order's lines and its piece count.
//
//   npx tsx --conditions=react-server scripts/close-migrated.ts            dry run: what would change
//   npx tsx --conditions=react-server scripts/close-migrated.ts --apply    do it
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../src/lib/db';
import { applyPlatformFacts } from '../src/lib/engine';
import { migratedFacts, notGoods } from '../src/lib/connectors/shopify-map';

const apply = process.argv.includes('--apply');
// an old store's order is done once closed: delivered ones close too (they were paid for there)
const FINAL = ['settled', 'cancelled', 'rto', 'rto_closed'];

(async () => {
  const db = await getDb();

  const old = await db.select().from(schema.orders).where(sql`${schema.orders.tags} ? 'migrated'`);
  const open = old.filter((o) => !FINAL.includes(o.stage));
  const left: string[] = [];
  const moves = new Map<string, number>();
  for (const o of open) {
    const facts = migratedFacts(o.tags ?? [], o.placedAt);
    const to = facts?.cancelled ? 'cancelled' : facts?.delivered ? 'settled' : null;
    if (!to) {
      left.push(`${o.number} (${o.stage}, ${(o.tags ?? []).find((t) => t.startsWith('woo-status-')) ?? 'no old status'}, ${o.placedAt.toISOString().slice(0, 10)})`);
      continue;
    }
    moves.set(`${o.stage} → ${to}`, (moves.get(`${o.stage} → ${to}`) ?? 0) + 1);
    if (apply) await applyPlatformFacts(o.id, { channelId: o.channelId, platform: facts! });
  }
  console.log(`Old-store orders: ${old.length}, still on the floor: ${open.length}`);
  for (const [m, n] of moves) console.log(`  ${apply ? 'moved' : 'would move'} ${n} ${m}`);
  if (left.length) console.log(`  left open (still open on the old store): ${left.join('; ')}`);

  const lines = await db.select().from(schema.orderItems);
  const drop = lines.filter((l) => notGoods({ sku: l.sku, barcode: l.barcode, title: l.title, unitPrice: Number(l.unitPrice) }));
  const byTitle = new Map<string, number>();
  for (const l of drop) byTitle.set(l.title, (byTitle.get(l.title) ?? 0) + 1);
  console.log(`\nDiscount and fee lines: ${drop.length} on ${new Set(drop.map((l) => l.orderId)).size} orders`);
  for (const [t, n] of byTitle) console.log(`  ${n} × ${t}`);
  if (apply && drop.length) {
    const orders = [...new Set(drop.map((l) => l.orderId))];
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.id, drop.map((l) => l.id)));
    for (const id of orders) {
      const [{ n }] = await db.select({ n: sql<number>`coalesce(sum(${schema.orderItems.quantity}), 0)::int` }).from(schema.orderItems).where(eq(schema.orderItems.orderId, id));
      await db.update(schema.orders).set({ items: n }).where(eq(schema.orders.id, id));
    }
    console.log(`  removed, and the piece count redone on ${orders.length} orders`);
  }
  if (!apply) console.log('\ndry run: nothing changed (add --apply)');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
