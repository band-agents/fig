import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { scope } from './queries';
import type { Principal } from './domain/perms';
import { inEgp } from './format';
import { CHANNELS } from './channels';

const KW = sql`('labesny-web','labesny-app','ws-kw')`;
const TODAY = sql`(date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo')`;

export const LANES = [
  { key: 'care', label: 'Customer care', verb: 'confirming', stages: ['new', 'confirming'], tint: 'violet', href: '/queue/care' },
  { key: 'finance', label: 'Finance', verb: 'clearing', stages: ['finance'], tint: 'amber', href: '/queue/finance' },
  { key: 'fulfilment', label: 'Pick & pack', verb: 'in the warehouse', stages: ['ready', 'picking'], tint: 'blue', href: '/queue/fulfilment' },
  { key: 'shipping', label: 'Courier', verb: 'on the road', stages: ['packed', 'shipped', 'delivering'], tint: 'cyan', href: '/queue/shipping' },
  { key: 'cash', label: 'Cash to settle', verb: 'awaiting cash', stages: ['delivered'], tint: 'green', href: '/finance' },
] as const;

export async function commandCentre(p: Principal) {
  const db = await getDb();
  const s = scope(p);

  const [kpi] = (
    await db.execute<{
      today: number;
      yday: number;
      inflight: number;
      late: number;
      ontime_n: number;
      ontime_d: number;
      rto_n: number;
      rto_d: number;
      ret_n: number;
      ret_d: number;
    }>(sql`
    select
      count(*) filter (where placed_at >= ${TODAY})::int as today,
      count(*) filter (where placed_at >= ${TODAY} - interval '1 day' and placed_at < now() - interval '1 day')::int as yday,
      count(*) filter (where stage not in ('settled','cancelled','rto_closed','delivered'))::int as inflight,
      count(*) filter (where not on_hold and due_at < now() and stage not in ('settled','cancelled','rto_closed'))::int as late,
      count(*) filter (where placed_at between now() - interval '9 days' and now() - interval '2 days' and shipped_at is not null
        and shipped_at - placed_at <= case when channel_id in ${KW} then interval '30 hours' else interval '48 hours' end)::int as ontime_n,
      count(*) filter (where placed_at between now() - interval '9 days' and now() - interval '2 days' and shipped_at is not null)::int as ontime_d,
      count(*) filter (where payment_method = 'cod' and placed_at > now() - interval '30 days' and stage in ('rto','rto_closed'))::int as rto_n,
      count(*) filter (where payment_method = 'cod' and placed_at > now() - interval '30 days' and stage in ('delivered','settled','rto','rto_closed'))::int as rto_d,
      (select count(*)::int from returns r where ${scope(p, sql`r.channel_id`)} and r.requested_at > now() - interval '30 days') as ret_n,
      count(*) filter (where delivered_at > now() - interval '30 days')::int as ret_d
    from orders where ${s}`)
  ).rows;

  const revenue = await db.execute<{ currency: string; today: number; yday: number }>(sql`
    select currency,
      coalesce(sum(total) filter (where placed_at >= ${TODAY}), 0)::bigint as today,
      coalesce(sum(total) filter (where placed_at >= ${TODAY} - interval '1 day' and placed_at < now() - interval '1 day'), 0)::bigint as yday
    from orders where ${s} and stage <> 'cancelled' group by currency`);

  const days = await db.execute<{ d: string; currency: string; n: number; total: number; rto: number }>(sql`
    select to_char(placed_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as d, currency, count(*)::int as n, sum(total)::bigint as total,
      count(*) filter (where stage in ('rto','rto_closed'))::int as rto
    from orders where ${s} and placed_at > now() - interval '14 days' and stage <> 'cancelled'
    group by 1, 2 order by 1`);
  const retDays = await db.execute<{ d: string; n: number }>(sql`
    select to_char(requested_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as d, count(*)::int as n from returns
    where ${scope(p, sql`channel_id`)} and requested_at > now() - interval '14 days' group by 1 order by 1`);
  const keys = Array.from({ length: 14 }, (_, i) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() - (13 - i) * 86400000)));
  const spark = {
    orders: keys.map((k) => days.rows.filter((r) => r.d === k).reduce((a, r) => a + r.n, 0)),
    revenue: keys.map((k) => Math.round(days.rows.filter((r) => r.d === k).reduce((a, r) => a + inEgp(Number(r.total), r.currency), 0))),
    rto: keys.map((k) => days.rows.filter((r) => r.d === k).reduce((a, r) => a + r.rto, 0)),
    returns: keys.map((k) => retDays.rows.find((r) => r.d === k)?.n ?? 0),
  };

  const lanes = await db.execute<{ stage: string; n: number; late: number; soon: number; held: number; dwell: number }>(sql`
    select stage, count(*)::int as n,
      count(*) filter (where not on_hold and due_at < now())::int as late,
      count(*) filter (where not on_hold and due_at >= now() and due_at < now() + interval '1 hour')::int as soon,
      count(*) filter (where on_hold)::int as held,
      coalesce(extract(epoch from avg(now() - stage_at)), 0)::float8 as dwell
    from orders where ${s} and stage not in ('settled','cancelled','rto_closed') group by stage`);
  const passed = await db.execute<{ from_stage: string; n: number }>(sql`
    select e.from_stage, count(*)::int as n from events e join orders o on o.id = e.order_id
    where ${scope(p, sql`o.channel_id`)} and e.kind = 'stage' and e.at > now() - interval '24 hours' and e.from_stage is not null
    group by 1`);
  const laneData = LANES.map((l) => {
    const rows = lanes.rows.filter((r) => (l.stages as readonly string[]).includes(r.stage));
    const n = rows.reduce((a, r) => a + r.n, 0);
    const dwell = n ? rows.reduce((a, r) => a + r.dwell * r.n, 0) / n : 0;
    const out = passed.rows.filter((r) => (l.stages as readonly string[]).includes(r.from_stage)).reduce((a, r) => a + r.n, 0);
    return { ...l, n, late: rows.reduce((a, r) => a + r.late, 0), soon: rows.reduce((a, r) => a + r.soon, 0), held: rows.reduce((a, r) => a + r.held, 0), dwellMs: dwell * 1000, passed24h: out };
  });
  const rto = lanes.rows.find((r) => r.stage === 'rto');
  const openReturns = await db.execute<{ n: number; late: number }>(sql`
    select count(*)::int as n, count(*) filter (where due_at < now())::int as late from returns where ${scope(p, sql`channel_id`)} and stage not in ('refunded','closed','rejected')`);

  const hours = await db.execute<{ h: number; today: number; prev: number }>(sql`
    select extract(hour from placed_at at time zone 'Africa/Cairo')::int as h,
      count(*) filter (where placed_at >= ${TODAY})::int as today,
      count(*) filter (where placed_at >= ${TODAY} - interval '7 days' and placed_at < ${TODAY})::int as prev
    from orders where ${s} and placed_at >= ${TODAY} - interval '7 days' group by 1`);
  const today = Array.from({ length: 24 }, (_, h) => hours.rows.find((r) => r.h === h)?.today ?? 0);
  const usual = Array.from({ length: 24 }, (_, h) => (hours.rows.find((r) => r.h === h)?.prev ?? 0) / 7);
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Cairo' }).format(new Date())) % 24;

  const perChannel = await db.execute<{ channel_id: string; n: number; currency: string; total: number; open: number }>(sql`
    select channel_id, count(*) filter (where placed_at >= ${TODAY})::int as n, max(currency) as currency,
      coalesce(sum(total) filter (where placed_at >= ${TODAY} and stage <> 'cancelled'), 0)::bigint as total,
      count(*) filter (where stage not in ('settled','cancelled','rto_closed','delivered'))::int as open
    from orders where ${s} group by channel_id`);
  const modes = await db.select().from(schema.channels);
  const channels = CHANNELS.filter((c) => !p.channels.length || p.channels.includes(c.id)).map((c) => {
    const r = perChannel.rows.find((x) => x.channel_id === c.id);
    const m = modes.find((x) => x.id === c.id);
    return { id: c.id, n: r?.n ?? 0, total: Number(r?.total ?? 0), currency: c.currency, open: r?.open ?? 0, mode: m?.mode ?? 'off', lastSyncAt: m?.lastSyncAt ?? null };
  });

  return {
    kpi: {
      today: kpi.today,
      yday: kpi.yday,
      inflight: kpi.inflight,
      late: kpi.late,
      onTime: kpi.ontime_d ? kpi.ontime_n / kpi.ontime_d : null,
      refusal: kpi.rto_d ? kpi.rto_n / kpi.rto_d : null,
      returnRate: kpi.ret_d ? kpi.ret_n / kpi.ret_d : null,
      revenueToday: revenue.rows.reduce((a, r) => a + inEgp(Number(r.today), r.currency), 0),
      revenueYday: revenue.rows.reduce((a, r) => a + inEgp(Number(r.yday), r.currency), 0),
      byCurrency: revenue.rows.map((r) => ({ currency: r.currency, today: Number(r.today) })),
    },
    spark,
    lanes: laneData,
    exceptions: { rto: rto?.n ?? 0, held: lanes.rows.reduce((a, r) => a + r.held, 0), returns: openReturns.rows[0].n, returnsLate: openReturns.rows[0].late },
    hourly: { today, usual, nowHour },
    channels,
  };
}
