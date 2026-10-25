import 'server-only';
import { desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { seesBrand, type Principal } from '../../domain/perms';
import { addWeeks, weekRange } from '../../domain/stock/calendar';
import { CATEGORY_LABEL } from '../../domain/stock/categories';
import { PO_STATUS, TRANSFER_STATUS, type PoStatus, type TransferStatus } from '../../domain/stock/flows';
import { money } from '../../format';
import { getFacts } from '../facts';
import { marketsFor, sees } from './common';
import { openRecs } from './recs';

export async function productDetail(p: Principal, id: string) {
  const db = await getDb();
  const s = sees(p);
  const [row] = await db.select().from(schema.products).where(eq(schema.products.id, id));
  if (!row || !marketsFor(p).includes(row.market as 'EG' | 'KW') || !seesBrand(p, row.brand)) return null;
  const facts = await getFacts();
  const fx = facts.byId.get(id) ?? null;
  const week = facts.week;
  const from = addWeeks(week, -52);

  const [weekly, levels, variants, locs, poLines, trLines, moves, sizeSales, placements, lastYear] = await Promise.all([
    db.execute<{ week: string; online: number; stores: number; so: number }>(sql`
      select sw.week::text as week, coalesce(sum(sw.units) filter (where l.kind = 'warehouse'), 0)::int as online,
        coalesce(sum(sw.units) filter (where l.kind <> 'warehouse'), 0)::int as stores, max(sw.stockout_days)::int as so
      from sales_weekly sw join locations l on l.id = sw.location_id
      where sw.product_id = ${id} and sw.week >= ${from} group by 1 order by 1`),
    db.select().from(schema.stockLevels).where(eq(schema.stockLevels.productId, id)),
    db.select().from(schema.variants).where(eq(schema.variants.productId, id)),
    db.select().from(schema.locations),
    db
      .select({ l: schema.poLines, po: schema.purchaseOrders, supplier: schema.suppliers.name })
      .from(schema.poLines)
      .innerJoin(schema.purchaseOrders, eq(schema.purchaseOrders.id, schema.poLines.poId))
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
      .where(eq(schema.poLines.productId, id))
      .orderBy(desc(schema.purchaseOrders.createdAt)),
    db
      .select({ l: schema.transferLines, t: schema.transfers })
      .from(schema.transferLines)
      .innerJoin(schema.transfers, eq(schema.transfers.id, schema.transferLines.transferId))
      .where(eq(schema.transferLines.productId, id))
      .orderBy(desc(schema.transfers.createdAt))
      .limit(30),
    db.select().from(schema.stockMoves).where(eq(schema.stockMoves.productId, id)).orderBy(desc(schema.stockMoves.at)).limit(40),
    db.execute<{ size: string | null; n: number }>(sql`
      select v.size, sum(i.quantity)::int as n from order_items i join orders o on o.id = i.order_id join variants v on v.sku = i.sku
      where v.product_id = ${id} and o.placed_at > now() - interval '180 days' and o.stage <> 'cancelled' group by 1`),
    db.select().from(schema.placements).where(sql`${schema.placements.items} ? ${id} or ${schema.placements.anchors} ? ${id}`),
    db.execute<{ units: number }>(sql`select coalesce(sum(units), 0)::int as units from sales_weekly where product_id = ${id} and week >= ${addWeeks(week, -60)} and week < ${addWeeks(week, -52)}`),
  ]);

  const byWeek = new Map(weekly.rows.map((r) => [r.week, r]));
  const history = weekRange(from, addWeeks(week, -1)).map((w) => ({ week: w, online: byWeek.get(w)?.online ?? 0, stores: byWeek.get(w)?.stores ?? 0, stockout: byWeek.get(w)?.so ?? 0 }));
  const ahead = fx ? facts.weeks.slice(0, 26).map((w, i) => ({ week: w, online: 0, stores: 0, forecast: Math.round(fx.forecast[i] / (i === 0 ? Math.max(0.15, facts.firstWeekLeft) : 1)) })) : [];

  // where it is, size by size
  const sizes = variants.sort((a, b) => a.sizeIdx - b.sizeIdx);
  const places = locs
    .map((l) => {
      const here = levels.filter((x) => x.locationId === l.id);
      const onHand = here.reduce((a, x) => a + x.onHand, 0);
      const rate = fx?.byLocation[l.id]?.rate ?? 0;
      return {
        id: l.id,
        name: l.name,
        kind: l.kind,
        onHand,
        rate,
        cover: rate > 0.05 ? onHand / rate : onHand > 0 ? Infinity : 0,
        bySize: sizes.map((v) => here.find((x) => x.variantId === v.id)?.onHand ?? 0),
        counted: here.reduce<Date | null>((a, x) => (x.countedAt && (!a || x.countedAt < a) ? x.countedAt : a), null),
        bin: here.find((x) => x.bin)?.bin ?? null,
      };
    })
    .filter((x) => x.onHand !== 0 || x.rate > 0)
    .sort((a, b) => (a.kind === b.kind ? b.onHand - a.onHand : a.kind === 'warehouse' ? -1 : 1));

  // size curve: what customers bought online in six months against what is on the shelves now
  const sold = sizes.map((v) => sizeSales.rows.find((r) => r.size === v.size)?.n ?? 0);
  const soldTotal = sold.reduce((a, b) => a + b, 0);
  const stockBySize = sizes.map((v) => levels.filter((x) => x.variantId === v.id).reduce((a, x) => a + Math.max(0, x.onHand), 0));
  const stockTotal = stockBySize.reduce((a, b) => a + b, 0);
  const curve = sizes.map((v, i) => ({
    size: v.size ?? 'One size',
    sales: soldTotal >= 12 ? sold[i] / soldTotal : (row.sizeMix[v.size ?? ''] ?? 1 / sizes.length),
    stock: stockTotal ? stockBySize[i] / stockTotal : 0,
  }));

  const pos = new Map<string, { id: string; number: string; status: PoStatus; label: string; tint: string; supplier: string | null; qty: number; received: number; expectedAt: Date | null; createdAt: Date }>();
  for (const { l, po, supplier } of poLines) {
    const cur = pos.get(po.id) ?? { id: po.id, number: po.number, status: po.status as PoStatus, label: PO_STATUS[po.status as PoStatus]?.label ?? po.status, tint: PO_STATUS[po.status as PoStatus]?.tint ?? 'neutral', supplier, qty: 0, received: 0, expectedAt: po.expectedAt, createdAt: po.createdAt };
    cur.qty += l.qty;
    cur.received += l.received;
    pos.set(po.id, cur);
  }
  const trs = new Map<string, { id: string; number: string; status: string; label: string; tint: string; from: string; to: string; qty: number; at: Date }>();
  for (const { l, t } of trLines) {
    const cur = trs.get(t.id) ?? { id: t.id, number: t.number, status: t.status, label: TRANSFER_STATUS[t.status as TransferStatus]?.label ?? t.status, tint: TRANSFER_STATUS[t.status as TransferStatus]?.tint ?? 'neutral', from: locs.find((x) => x.id === t.fromId)?.name ?? t.fromId, to: locs.find((x) => x.id === t.toId)?.name ?? t.toId, qty: 0, at: t.createdAt };
    cur.qty += l.qty;
    trs.set(t.id, cur);
  }

  const recs = (await openRecs(p)).filter((r) => r.product?.id === id || r.items.some((x) => x.id === id) || ((r.payload.lines as { productId: string }[] | undefined) ?? []).some((l) => l.productId === id));

  return {
    product: {
      id: row.id,
      title: row.title,
      brand: row.brand,
      image: row.image,
      market: row.market,
      company: row.company,
      styleCode: row.styleCode,
      category: CATEGORY_LABEL[row.category as keyof typeof CATEGORY_LABEL] ?? row.category,
      season: row.season,
      status: row.status,
      price: s.money ? money(row.price, row.currency) : null,
      compareAt: s.money && row.compareAt ? money(row.compareAt, row.currency) : null,
      cost: s.cost ? money(row.cost, row.currency) : null,
      margin: s.cost && row.price ? 1 - row.cost / row.price : null,
      channels: row.channels,
      launchedAt: row.launchedAt,
    },
    fx,
    lastYear8: lastYear.rows[0]?.units ?? 0,
    weeks: [...history, ...ahead],
    sizes: sizes.map((v) => ({ id: v.id, size: v.size ?? 'One size', sku: v.sku, barcode: v.barcode })),
    places,
    curve,
    pos: [...pos.values()].sort((a, b) => (PO_STATUS[a.status]?.open === PO_STATUS[b.status]?.open ? b.createdAt.getTime() - a.createdAt.getTime() : PO_STATUS[a.status]?.open ? -1 : 1)).slice(0, 8),
    transfers: [...trs.values()].slice(0, 6),
    moves: moves.map((m) => ({ ...m, place: locs.find((l) => l.id === m.locationId)?.name ?? m.locationId, size: sizes.find((v) => v.id === m.variantId)?.size ?? '' })),
    recs,
    placements: placements.map((x) => ({ id: x.id, number: x.number, kind: x.kind, status: x.status, headline: x.headline, role: x.items.includes(id) ? 'shown' : 'anchor' })),
    canAdjust: s.act('stock'),
    seesMoney: s.money,
  };
}

