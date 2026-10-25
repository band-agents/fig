import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { channelLabel } from '../../channels';
import { ORDER_STAGE, type OrderStage } from '../../domain/stages';
import { bucketsOf, n, ratio, series, shareOf, type Report, type Row } from '../engine';

const H = (col: string) => sql.raw(`extract(epoch from ${col}) / 3600`);
const hrs = (v: number | null) => (v == null ? '—' : v >= 48 ? `${(v / 24).toFixed(1)} d` : `${v.toFixed(v < 10 ? 1 : 0)} h`);

const speed: Report = {
  id: 'fulfilment-speed',
  group: 'operations',
  title: 'Fulfilment speed',
  blurb: 'How long orders take: placed to packed, to shipped, to delivered; the typical order and the slow tenth, by store and over time.',
  for: ['ops', 'management'],
  filters: ['channel'],
  async run(c) {
    const db = await getDb();
    const keys = bucketsOf(c.range);
    const pct = (expr: ReturnType<typeof sql.raw>, p: number) => sql`percentile_cont(${p}) within group (order by ${expr})`;
    const toPack = H('o.packed_at - o.placed_at');
    const toShip = H('o.shipped_at - o.placed_at');
    const transit = H('o.delivered_at - o.shipped_at');
    const toDoor = H('o.delivered_at - o.placed_at');
    const [all, byStore, trend] = await Promise.all([
      db.execute<{ orders: number; pack50: number; ship50: number; ship90: number; transit50: number; door50: number; door90: number; same: number; shipped: number }>(sql`
        select count(*)::int as orders, ${pct(toPack, 0.5)} as pack50, ${pct(toShip, 0.5)} as ship50, ${pct(toShip, 0.9)} as ship90,
          ${pct(transit, 0.5)} as transit50, ${pct(toDoor, 0.5)} as door50, ${pct(toDoor, 0.9)} as door90,
          count(*) filter (where o.shipped_at is not null and (o.shipped_at at time zone ${c.tz})::date = (o.placed_at at time zone ${c.tz})::date)::int as same,
          count(*) filter (where o.shipped_at is not null)::int as shipped
        from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`)} and o.stage not in ('cancelled')`),
      db.execute<{ channel: string; orders: number; ship50: number; ship90: number; door50: number }>(sql`
        select o.channel_id as channel, count(*)::int as orders, ${pct(toShip, 0.5)} as ship50, ${pct(toShip, 0.9)} as ship90, ${pct(toDoor, 0.5)} as door50
        from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`)} and o.stage not in ('cancelled') group by 1`),
      db.execute<{ k: string; v: number }>(sql`
        select ${c.day(sql`o.placed_at`, c.range.grain)}::text as k, ${pct(toShip, 0.5)} as v
        from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`)} and o.shipped_at is not null group by 1`),
    ]);
    const a = all.rows[0];
    const h = (v: unknown) => (v == null ? null : Math.round(n(v) * 10) / 10);
    return {
      figures: [
        { label: 'Placed to packed', value: h(a?.pack50), fmt: 'hours', better: 'down', note: 'typical order' },
        { label: 'Placed to shipped', value: h(a?.ship50), fmt: 'hours', better: 'down', note: `slowest tenth: ${hrs(h(a?.ship90))}` },
        { label: 'Shipped to delivered', value: h(a?.transit50), fmt: 'hours', better: 'down' },
        { label: 'Placed to delivered', value: h(a?.door50), fmt: 'hours', better: 'down', note: `slowest tenth: ${hrs(h(a?.door90))}` },
        { label: 'Shipped the same day', value: ratio(n(a?.same), n(a?.shipped)), fmt: 'pct', better: 'up' },
      ],
      charts: [{ kind: 'trend', title: `Hours from order to shipping, by ${c.range.grain}`, sub: 'Typical order (median)', labels: keys, series: [{ name: 'Hours to ship', values: series(keys, trend.rows.map((x) => ({ k: x.k, v: Math.round(n(x.v) * 10) / 10 }))), measure: 'units' }] }],
      tables: [
        {
          title: 'By store',
          columns: [
            { key: 'store', label: 'Store', fmt: 'text', wide: true },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            { key: 'ship50', label: 'To ship, typical', fmt: 'hours' },
            { key: 'ship90', label: 'To ship, slow tenth', fmt: 'hours' },
            { key: 'door50', label: 'To the door, typical', fmt: 'hours' },
          ],
          rows: byStore.rows.map<Row>((x) => ({ store: channelLabel(x.channel), orders: n(x.orders), ship50: h(x.ship50), ship90: h(x.ship90), door50: h(x.door50) })),
        },
      ],
      empty: n(a?.orders) ? undefined : 'No orders in this period.',
    };
  },
};

const couriers: Report = {
  id: 'couriers',
  group: 'operations',
  title: 'Courier performance',
  blurb: 'Each courier: parcels shipped, delivered, refused, delivery rate, days in transit, attempts and cash on delivery share.',
  for: ['ops', 'finance', 'management'],
  filters: ['channel'],
  async run(c) {
    const db = await getDb();
    const r = await db.execute<{ courier: string; shipped: number; delivered: number; refused: number; open: number; days: number; attempts: number; cod: number }>(sql`
      select coalesce(o.courier, 'No courier') as courier, count(*)::int as shipped,
        count(*) filter (where o.delivered_at is not null)::int as delivered,
        count(*) filter (where o.stage in ('rto', 'rto_closed'))::int as refused,
        count(*) filter (where o.stage in ('shipped', 'delivering'))::int as open,
        percentile_cont(0.5) within group (order by extract(epoch from o.delivered_at - o.shipped_at) / 86400) as days,
        avg(o.attempts)::float8 as attempts,
        count(*) filter (where o.payment_method = 'cod')::int as cod
      from orders o where ${c.orders()} and o.shipped_at is not null and ${c.between(sql`o.shipped_at`)} group by 1 order by 2 desc`);
    const rows = r.rows.map<Row>((x) => ({ courier: x.courier, shipped: n(x.shipped), delivered: n(x.delivered), refused: n(x.refused), open: n(x.open), rate: ratio(n(x.delivered), n(x.delivered) + n(x.refused)), days: x.days == null ? null : Math.round(n(x.days) * 10) / 10, attempts: Math.round(n(x.attempts) * 10) / 10, cod: shareOf(n(x.cod), n(x.shipped)) }));
    const S = rows.reduce((a, x) => a + n(x.shipped), 0);
    const D = rows.reduce((a, x) => a + n(x.delivered), 0);
    const F = rows.reduce((a, x) => a + n(x.refused), 0);
    return {
      figures: [
        { label: 'Parcels shipped', value: S, fmt: 'int' },
        { label: 'Delivered', value: D, fmt: 'int' },
        { label: 'Delivery rate', value: ratio(D, D + F), fmt: 'pct', better: 'up', note: 'delivered of delivered + refused' },
        { label: 'Refused at the door', value: F, fmt: 'int', better: 'down' },
      ],
      charts: [{ kind: 'bars', title: 'Parcels by courier', rows: rows.map((x) => ({ label: String(x.courier), value: n(x.shipped), units: n(x.shipped), sub: x.rate != null ? `${Math.round(n(x.rate) * 100)}% delivered` : undefined })), fmt: 'int' }],
      tables: [
        {
          title: 'By courier',
          columns: [
            { key: 'courier', label: 'Courier', fmt: 'text', wide: true },
            { key: 'shipped', label: 'Shipped', fmt: 'int', total: true },
            { key: 'delivered', label: 'Delivered', fmt: 'int', total: true },
            { key: 'refused', label: 'Refused', fmt: 'int', total: true },
            { key: 'open', label: 'Still out', fmt: 'int', total: true },
            { key: 'rate', label: 'Delivery rate', fmt: 'pct' },
            { key: 'days', label: 'Days in transit', fmt: 'days' },
            { key: 'attempts', label: 'Attempts', fmt: 'num' },
            { key: 'cod', label: 'Cash on delivery', fmt: 'pct' },
          ],
          rows,
        },
      ],
      empty: S ? undefined : 'Nothing shipped in this period.',
    };
  },
};

const deadlines: Report = {
  id: 'deadlines',
  group: 'operations',
  title: 'Deadlines and late orders',
  blurb: 'Open orders by stage now: how many, how many late, the oldest; and how many orders in the period shipped within 24 and 48 hours.',
  for: ['ops', 'management'],
  filters: ['channel'],
  async run(c) {
    const db = await getDb();
    const [open, hit] = await Promise.all([
      db.execute<{ stage: string; orders: number; late: number; held: number; oldest: number }>(sql`
        select o.stage, count(*)::int as orders, count(*) filter (where not o.on_hold and o.due_at < now())::int as late, count(*) filter (where o.on_hold)::int as held,
          max(floor(extract(epoch from now() - o.stage_at) / 3600))::int as oldest
        from orders o where ${c.orders()} and o.stage not in ('delivered', 'settled', 'cancelled', 'rto_closed') group by 1`),
      db.execute<{ shipped: number; d1: number; d2: number; d3: number }>(sql`
        select count(*)::int as shipped,
          count(*) filter (where o.shipped_at - o.placed_at <= interval '24 hours')::int as d1,
          count(*) filter (where o.shipped_at - o.placed_at <= interval '48 hours')::int as d2,
          count(*) filter (where o.shipped_at - o.placed_at <= interval '72 hours')::int as d3
        from orders o where ${c.orders()} and o.shipped_at is not null and ${c.between(sql`o.placed_at`)}`),
    ]);
    const order = Object.keys(ORDER_STAGE);
    const rows = open.rows
      .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
      .map<Row>((x) => ({ stage: ORDER_STAGE[x.stage as OrderStage]?.label ?? x.stage, orders: n(x.orders), late: n(x.late), held: n(x.held), oldest: n(x.oldest), _href: `/orders?stage=${x.stage}` }));
    const h = hit.rows[0];
    const L = rows.reduce((a, x) => a + n(x.late), 0);
    return {
      figures: [
        { label: 'Open orders', value: rows.reduce((a, x) => a + n(x.orders), 0), fmt: 'int' },
        { label: 'Late now', value: L, fmt: 'int', better: 'down' },
        { label: 'Shipped within 24 h', value: ratio(n(h?.d1), n(h?.shipped)), fmt: 'pct', better: 'up', note: 'orders placed in the period' },
        { label: 'Within 48 h', value: ratio(n(h?.d2), n(h?.shipped)), fmt: 'pct', better: 'up' },
        { label: 'Within 72 h', value: ratio(n(h?.d3), n(h?.shipped)), fmt: 'pct', better: 'up' },
      ],
      charts: [{ kind: 'bars', title: 'Late now, by stage', rows: rows.filter((x) => n(x.late) > 0).map((x) => ({ label: String(x.stage), value: n(x.late), units: n(x.late), sub: `of ${x.orders}`, href: x._href })), fmt: 'int' }],
      tables: [
        {
          title: 'Open orders by stage, now',
          sub: 'Deadlines are set per stage in Rules & SLAs',
          columns: [{ key: 'stage', label: 'Stage', fmt: 'text', wide: true }, { key: 'orders', label: 'Orders', fmt: 'int', total: true }, { key: 'late', label: 'Late', fmt: 'int', total: true }, { key: 'held', label: 'On hold', fmt: 'int', total: true }, { key: 'oldest', label: 'Oldest (hours in stage)', fmt: 'int' }],
          rows,
        },
      ],
    };
  },
};

const shipFrom: Report = {
  id: 'ship-from',
  group: 'operations',
  title: 'Orders by branch they left from',
  blurb: 'Which warehouse or mall each order was sent from, as the team recorded it on the order page.',
  for: ['ops', 'management', 'brand'],
  filters: ['channel', 'brand'],
  async run(c) {
    const db = await getDb();
    const r = await db.execute<{ branch: string; orders: number; units: number }>(sql`
      select coalesce(o.ship_from_name, o.ship_from, 'Not recorded') as branch, count(distinct o.id)::int as orders, coalesce(sum(oi.quantity), 0)::int as units
      from orders o join order_items oi on oi.order_id = o.id
      where ${c.orders()} and ${c.items()} and o.stage not in ('cancelled') and ${c.between(sql`o.placed_at`)} group by 1 order by 2 desc`);
    const T = r.rows.reduce((a, x) => a + n(x.orders), 0);
    const known = r.rows.filter((x) => x.branch !== 'Not recorded').reduce((a, x) => a + n(x.orders), 0);
    return {
      figures: [
        { label: 'Orders', value: T, fmt: 'int' },
        { label: 'Branch recorded', value: ratio(known, T), fmt: 'pct', better: 'up' },
        { label: 'Branches used', value: r.rows.filter((x) => x.branch !== 'Not recorded').length, fmt: 'int' },
      ],
      charts: [{ kind: 'bars', title: 'Orders by branch', rows: r.rows.map((x) => ({ label: x.branch, value: n(x.orders), units: n(x.orders), sub: `${n(x.units)} pcs` })), fmt: 'int' }],
      tables: [{ title: 'By branch', columns: [{ key: 'branch', label: 'Branch', fmt: 'text', wide: true }, { key: 'orders', label: 'Orders', fmt: 'int', total: true }, { key: 'share', label: 'Share', fmt: 'pct' }, { key: 'units', label: 'Pieces', fmt: 'int', total: true }], rows: r.rows.map((x) => ({ branch: x.branch, orders: n(x.orders), share: shareOf(n(x.orders), T), units: n(x.units) })) }],
      notes: ['Lucida picks the branch itself when the website posts a sale and does not say which, so this is the branch the team set on each order (order page → Ship from). Once Kaitco returns the branch on posted sales, this fills in by itself.'],
      empty: T ? undefined : 'No orders in this period.',
    };
  },
};

export const OPERATIONS_REPORTS: Report[] = [speed, couriers, deadlines, shipFrom];
