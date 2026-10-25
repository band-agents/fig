import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { scope } from './queries';
import type { Principal } from './domain/perms';
import type { FeedRow } from '@/components/dashboard/activity';

export async function feedFor(p: Principal, limit = 24): Promise<FeedRow[]> {
  const db = await getDb();
  const r = await db.execute<{
    id: string;
    at: string;
    actor_name: string;
    hue: number | null;
    kind: string;
    to_stage: string | null;
    message: string;
    order_id: string | null;
    return_id: string | null;
    number: string | null;
    channel_id: string | null;
  }>(sql`
    select e.id, e.at, e.actor_name, u.hue, e.kind, e.to_stage, e.message, e.order_id, e.return_id,
      coalesce(r.number, o.number) as number, o.channel_id
    from events e
    left join orders o on o.id = e.order_id
    left join returns r on r.id = e.return_id
    left join users u on u.id = e.actor_id
    where e.at <= now() and ${scope(p, sql`o.channel_id`, sql`o.id`)} and e.kind in ('stage','call','note','courier','hold','system','sync')
    order by e.at desc limit ${limit}`);
  return r.rows.map((x) => ({
    id: x.id,
    at: new Date(x.at),
    actorName: x.actor_name,
    actorHue: x.hue,
    kind: x.kind,
    toStage: x.to_stage,
    message: x.message,
    orderId: x.order_id,
    returnId: x.return_id,
    number: x.number,
    channelId: x.channel_id,
  }));
}
