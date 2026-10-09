import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import type { Principal } from './domain/perms';

/** Restricts any orders/returns query to the channels this person covers. */
export function scope(p: Pick<Principal, 'channels'>, column: SQL = sql`channel_id`): SQL {
  if (!p.channels.length) return sql`true`;
  return sql`${column} in (${sql.join(p.channels.map((c) => sql`${c}`), sql`, `)})`;
}

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
    from orders where ${scope(p)} and stage not in ('settled','cancelled','rto_closed')
    group by stage`);
  return r.rows.map((x) => ({ ...x, oldest: x.oldest ? new Date(x.oldest) : null }));
}

export async function returnStageCounts(p: Principal) {
  const db = await getDb();
  const r = await db.execute<{ stage: string; n: number; late: number }>(sql`
    select stage, count(*)::int as n, count(*) filter (where due_at < now())::int as late
    from returns where ${scope(p)} and stage not in ('refunded','closed','rejected') group by stage`);
  return r.rows;
}

/** Badge counts for the sidebar: work waiting in each department. */
export async function queueBadges(p: Principal) {
  const [orders, rets] = await Promise.all([stageCounts(p), returnStageCounts(p)]);
  const sum = (stages: string[], key: 'n' | 'late' = 'n') => orders.filter((o) => stages.includes(o.stage)).reduce((s, o) => s + o[key], 0);
  const rsum = (stages: string[], key: 'n' | 'late' = 'n') => rets.filter((o) => stages.includes(o.stage)).reduce((s, o) => s + o[key], 0);
  return {
    care: { n: sum(['new', 'confirming']) + rsum(['requested']), late: sum(['new', 'confirming'], 'late') + rsum(['requested'], 'late') },
    finance: { n: sum(['finance']) + rsum(['refund_pending']), late: sum(['finance'], 'late') + rsum(['refund_pending'], 'late') },
    fulfilment: { n: sum(['ready', 'picking']), late: sum(['ready', 'picking'], 'late') },
    shipping: { n: sum(['packed', 'shipped', 'delivering', 'rto']) + rsum(['approved', 'pickup', 'in_transit']), late: sum(['packed', 'shipped', 'delivering'], 'late') },
    returns: { n: rsum(['received', 'inspected']) + sum(['rto']), late: rsum(['received', 'inspected'], 'late') },
  };
}
export type Badges = Awaited<ReturnType<typeof queueBadges>>;
