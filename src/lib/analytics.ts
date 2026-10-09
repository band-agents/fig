import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { scope } from './queries';
import type { Principal } from './domain/perms';
import { inEgp } from './format';
import { CHANNEL } from './channels';
import { slaTargets } from './engine';

const BRAND_OF = (id: string) => CHANNEL[id]?.brand ?? 'FIG';

export async function analytics(p: Principal, days: number) {
  const db = await getDb();
  const s = scope(p, sql`o.channel_id`);
  const since = sql`now() - (${days} || ' days')::interval`;

  const [daily, heat, dwell, rto, reasons, products, perChannel, team] = await Promise.all([
    db.execute<{ d: string; channel_id: string; n: number }>(sql`
      select to_char(o.placed_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as d, o.channel_id, count(*)::int as n
      from orders o where ${s} and o.placed_at > ${since} group by 1, 2 order by 1`),
    db.execute<{ dow: number; h: number; n: number }>(sql`
      select extract(dow from o.placed_at at time zone 'Africa/Cairo')::int as dow, extract(hour from o.placed_at at time zone 'Africa/Cairo')::int as h, count(*)::int as n
      from orders o where ${s} and o.placed_at > ${since} group by 1, 2`),
    db.execute<{ stage: string; hours: number; n: number; within: number }>(sql`
      with x as (
        select e.order_id, e.to_stage as stage, e.at, e.actor_name,
          lead(e.at) over (partition by e.order_id order by e.at) as left_at
        from events e join orders o on o.id = e.order_id
        where ${s} and e.kind = 'stage' and e.return_id is null and o.placed_at > ${since}
      )
      select stage, avg(extract(epoch from left_at - at) / 3600)::float8 as hours, count(*)::int as n,
        0 as within
      from x where left_at is not null and stage in ('confirming','finance','ready','picking','packed','shipped','delivering','delivered','rto')
      group by stage`),
    db.execute<{ region: string; rate: number; n: number }>(sql`
      select coalesce(o.address->>'region','') as region, avg((o.stage in ('rto','rto_closed'))::int)::float8 as rate, count(*)::int as n
      from orders o where ${s} and o.payment_method = 'cod' and o.stage in ('delivered','settled','rto','rto_closed') and o.placed_at > now() - interval '60 days'
      group by 1 having count(*) >= 6 order by rate desc limit 12`),
    db.execute<{ reason: string; n: number }>(sql`
      select r.reason, count(*)::int as n from returns r where ${scope(p, sql`r.channel_id`)} and r.requested_at > ${since} group by 1 order by 2 desc`),
    db.execute<{ title: string; brand: string; image: string | null; back: number; sold: number; top_reason: string }>(sql`
      with back as (
        select i.title, count(*)::int as back, mode() within group (order by r.reason) as top_reason
        from return_items ri join returns r on r.id = ri.return_id join order_items i on i.id = ri.order_item_id
        where ${scope(p, sql`r.channel_id`)} and r.requested_at > ${since} group by i.title
      ), sold as (
        select i.title, max(i.brand) as brand, max(i.image) as image, sum(i.quantity)::int as sold
        from order_items i join orders o on o.id = i.order_id where ${s} and o.placed_at > ${since} - interval '14 days' group by i.title
      )
      select back.title, sold.brand, sold.image, back.back, sold.sold, back.top_reason from back join sold using (title) order by back.back desc, sold.sold asc limit 8`),
    db.execute<{ channel_id: string; currency: string; n: number; revenue: number; cod: number; rto: number; rto_d: number; delivered: number; returns: number; ship_h: number | null }>(sql`
      select o.channel_id, max(o.currency) as currency, count(*)::int as n,
        coalesce(sum(o.total) filter (where o.stage <> 'cancelled'), 0)::bigint as revenue,
        count(*) filter (where o.payment_method = 'cod')::int as cod,
        count(*) filter (where o.stage in ('rto','rto_closed'))::int as rto,
        count(*) filter (where o.payment_method = 'cod' and o.stage in ('delivered','settled','rto','rto_closed'))::int as rto_d,
        count(*) filter (where o.delivered_at is not null)::int as delivered,
        (select count(*)::int from returns r where r.channel_id = o.channel_id and r.requested_at > ${since}) as returns,
        avg(extract(epoch from o.shipped_at - o.placed_at) / 3600) filter (where o.shipped_at is not null)::float8 as ship_h
      from orders o where ${s} and o.placed_at > ${since} group by o.channel_id order by n desc`),
    db.execute<{ name: string; hue: number | null; n: number }>(sql`
      select e.actor_name as name, max(u.hue) as hue, count(*)::int as n from events e
      left join users u on u.id = e.actor_id join orders o on o.id = e.order_id
      where ${s} and e.kind = 'stage' and e.at > now() - interval '7 days' and e.actor_id is not null
      group by 1 order by 3 desc limit 10`),
  ]);

  // daily by brand
  const dayKeys = Array.from({ length: days }, (_, i) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() - (days - 1 - i) * 86400000)));
  const brands = ['FIG', "Women'secret", 'Labesny'] as const;
  const byDay = dayKeys.map((k) => ({
    label: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${k}T12:00:00`)),
    values: brands.map((b) => daily.rows.filter((r) => r.d === k && BRAND_OF(r.channel_id) === b).reduce((a, r) => a + r.n, 0)),
  }));

  const grid = Array.from({ length: 7 }, (_, dow) => Array.from({ length: 24 }, (_, h) => heat.rows.find((r) => r.dow === dow && r.h === h)?.n ?? 0));
  const targets = await slaTargets();
  const totalRto = rto.rows.reduce((a, r) => ({ s: a.s + r.rate * r.n, n: a.n + r.n }), { s: 0, n: 0 });

  return {
    byDay,
    brands,
    grid,
    dwell: dwell.rows.map((r) => ({ ...r, target: (targets.orders as Record<string, number | undefined>)[r.stage] ?? null })),
    rto: rto.rows,
    rtoBaseline: totalRto.n ? totalRto.s / totalRto.n : 0,
    reasons: reasons.rows,
    products: products.rows,
    channels: perChannel.rows.map((r) => ({
      ...r,
      revenueEgp: inEgp(Number(r.revenue), r.currency),
      aov: r.n ? Number(r.revenue) / r.n : 0,
      rtoRate: r.rto_d ? r.rto / r.rto_d : null,
      returnRate: r.delivered ? r.returns / r.delivered : null,
    })),
    team: team.rows,
  };
}
