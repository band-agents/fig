import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import { can, type Principal } from './domain/perms';

/**
 * Restricts any orders/returns query to what this person covers: the channels (stores) they work on,
 * and, for someone limited to brands (a brand manager), the orders holding at least one piece of
 * those brands. `orderId` names the order's id in the query: `o.id`, `r.order_id`, or for a table
 * without an alias `orders.id` / `returns.order_id`.
 */
export function scope(p: Pick<Principal, 'channels' | 'brands'>, column: SQL, orderId: SQL): SQL {
  const parts: SQL[] = [];
  if (p.channels.length) parts.push(sql`${column} in (${sql.join(p.channels.map((c) => sql`${c}`), sql`, `)})`);
  if (p.brands?.length) parts.push(sql`exists (select 1 from order_items bi where bi.order_id = ${orderId} and ${brandMatch(p.brands, sql`bi.brand`)})`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/**
 * A brand column matching any of these brands, spelled the way the catalogue or the store list spells
 * it: "WOMEN'SECRET" is Women Secret and "UNITED COLORS OF BENETTON" is Benetton (domain/branches.ts
 * sameBrand, in SQL). An empty list matches everything.
 */
export function brandMatch(brands: string[] | undefined, column: SQL): SQL {
  const wanted = [...new Set((brands ?? []).map(foldBrand).filter(Boolean))];
  if (!wanted.length) return sql`true`;
  const f = sql`regexp_replace(lower(coalesce(${column}, '')), '[^a-z0-9]', '', 'g')`;
  return sql`(${f} <> '' and (${sql.join(wanted.map((w) => sql`position(${w} in ${f}) > 0 or position(${f} in ${w}) > 0`), sql` or `)}))`;
}
export const foldBrand = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export type StageCount = { stage: string; n: number; late: number; soon: number; held: number; oldest: Date | null };

export async function stageCounts(p: Principal): Promise<StageCount[]> {
  const db = await getDb();
  const r = await db.execute<StageCount>(sql`
    select stage,
      count(*)::int as n,
      count(*) filter (where not on_hold and due_at < now())::int as late,
      count(*) filter (where not on_hold and due_at >= now() and due_at < now() + interval '1 hour')::int as soon,
      count(*) filter (where on_hold)::int as held,
      min(stage_at) as oldest
    from orders where ${scope(p, sql`channel_id`, sql`orders.id`)} and stage not in ('settled','cancelled','rto_closed')
    group by stage`);
  return r.rows.map((x) => ({ ...x, oldest: x.oldest ? new Date(x.oldest) : null }));
}

export async function returnStageCounts(p: Principal) {
  const db = await getDb();
  const r = await db.execute<{ stage: string; n: number; late: number }>(sql`
    select stage, count(*)::int as n, count(*) filter (where due_at < now())::int as late
    from returns where ${scope(p, sql`channel_id`, sql`returns.order_id`)} and stage not in ('refunded','closed','rejected') group by stage`);
  return r.rows;
}

/** Stock, buying, warehouse and website work waiting, for the sidebar. Mine if I do the work, everyone's if I run it. */
async function stockBadges(p: Principal) {
  const db = await getDb();
  const zero = { n: 0, late: 0 };
  if (!['stock', 'procurement', 'warehouse', 'merch'].some((a) => can(p, a as never, 1))) return { stock: zero, buying: zero, warehouse: zero, merch: zero };
  const mine = (area: string) => (can(p, area as never, 3) ? sql`true` : sql`assignee_id = ${p.id}`);
  const [recs, tasks, pos] = await Promise.all([
    db.execute<{ area: string; n: number; urgent: number }>(sql`select area, count(*)::int as n, count(*) filter (where priority = 1)::int as urgent from recommendations where status = 'open' group by 1`),
    db.execute<{ area: string; n: number; late: number }>(sql`
      select area, count(*)::int as n, count(*) filter (where due_at < now())::int as late from tasks
      where status in ('open','doing','blocked') and (
        (area = 'warehouse' and ${mine('warehouse')}) or (area = 'procurement' and ${mine('procurement')}) or (area = 'merch' and ${mine('merch')}))
      group by 1`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from purchase_orders where status = 'approval'`),
  ]);
  const r = (a: string) => recs.rows.find((x) => x.area === a);
  const t = (a: string) => tasks.rows.find((x) => x.area === a);
  const all = recs.rows.filter((x) => can(p, x.area as never, 1));
  return {
    stock: { n: all.reduce((s, x) => s + x.urgent, 0), late: all.reduce((s, x) => s + x.urgent, 0) },
    buying: can(p, 'procurement', 1) ? { n: (t('procurement')?.n ?? 0) + (can(p, 'procurement', 3) ? pos.rows[0]?.n ?? 0 : 0), late: t('procurement')?.late ?? 0 } : zero,
    warehouse: can(p, 'warehouse', 1) ? { n: t('warehouse')?.n ?? 0, late: t('warehouse')?.late ?? 0 } : zero,
    merch: can(p, 'merch', 1) ? { n: r('merch')?.n ?? 0, late: 0 } : zero,
  };
}

/** Badge counts for the sidebar: work waiting in each department. */
export async function queueBadges(p: Principal) {
  const [orders, rets, stock] = await Promise.all([stageCounts(p), returnStageCounts(p), stockBadges(p)]);
  const sum = (stages: string[], key: 'n' | 'late' = 'n') => orders.filter((o) => stages.includes(o.stage)).reduce((s, o) => s + o[key], 0);
  const rsum = (stages: string[], key: 'n' | 'late' = 'n') => rets.filter((o) => stages.includes(o.stage)).reduce((s, o) => s + o[key], 0);
  return {
    care: { n: rsum(['requested']), late: rsum(['requested'], 'late') },
    finance: { n: sum(['finance']) + rsum(['refund_pending']), late: sum(['finance'], 'late') + rsum(['refund_pending'], 'late') },
    fulfilment: { n: sum(['new', 'confirming', 'ready', 'picking']), late: sum(['ready', 'picking'], 'late') },
    shipping: { n: sum(['packed', 'shipped', 'delivering', 'rto']) + rsum(['approved', 'pickup', 'in_transit']), late: sum(['packed', 'shipped', 'delivering'], 'late') },
    returns: { n: rsum(['requested', 'received', 'inspected']) + sum(['rto']), late: rsum(['requested', 'received', 'inspected'], 'late') },
    ...stock,
  };
}
export type Badges = Awaited<ReturnType<typeof queueBadges>>;
