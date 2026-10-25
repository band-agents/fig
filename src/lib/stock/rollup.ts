import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { CHANNELS } from '../channels';

/**
 * Website sales into the planner's weekly table. Every order line from `fromWeek` on is matched
 * to its style by SKU (or barcode) within the storefront's market, summed per Sunday-start week, and
 * filed under the warehouse that storefront ships from. Re-running replaces those weeks, so it is
 * safe to call on every planner pass. Shop sales arrive the same way from Lucida, under each shop.
 */
export async function rollupOnlineSales(fromWeek: string) {
  const db = await getDb();
  const live = CHANNELS.filter((c) => !c.parked);
  if (!live.length) return 0;
  const market = sql.join(live.map((c) => sql`when ${c.id} then ${c.country}`), sql` `);
  const house = sql.join(live.map((c) => sql`when ${c.id} then ${c.warehouse}`), sql` `);
  const r = await db.execute<{ n: number }>(sql`
    with lines as (
      select
        ((date_trunc('week', (o.placed_at at time zone 'Asia/Kuwait') + interval '1 day') - interval '1 day'))::date as week,
        case o.channel_id ${market} end as market,
        case o.channel_id ${house} end as location_id,
        i.sku, i.barcode, i.quantity, i.unit_price, o.source
      from order_items i join orders o on o.id = i.order_id
      where o.stage <> 'cancelled' and o.placed_at >= ${fromWeek}::date - interval '3 hours'
    ), matched as (
      select l.week, p.id as product_id, l.location_id, l.quantity, l.unit_price, p.cost
      from lines l
      join variants v on (v.sku = l.sku or (l.barcode is not null and v.barcode = l.barcode))
      join products p on p.id = v.product_id and p.market = l.market
      -- a live store's styles count only real orders, never a demo order that shares a barcode
      where l.location_id is not null and l.week >= ${fromWeek}::date and not (l.source = 'demo' and p.source <> 'demo')
    ), rolled as (
      select week, product_id, location_id, sum(quantity)::int as units, sum(quantity * unit_price)::bigint as revenue, sum(quantity * cost)::bigint as cost
      from matched group by 1, 2, 3
    ), ins as (
      insert into sales_weekly (week, product_id, location_id, units, revenue, cost)
      select week, product_id, location_id, units, revenue, cost from rolled
      on conflict (week, product_id, location_id) do update set units = excluded.units, revenue = excluded.revenue, cost = excluded.cost
      returning 1
    )
    select count(*)::int as n from ins`);
  return r.rows[0]?.n ?? 0;
}
