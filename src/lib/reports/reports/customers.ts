import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { lineNet, n, ratio, shareOf, SOLD, type Report, type Row } from '../engine';

/** One customer across orders: the customer record when there is one, else the phone, else the email. */
const WHO = sql.raw(`coalesce(o.customer_id, nullif(o.phone, ''), lower(nullif(o.email, '')), o.id)`);

const overview: Report = {
  id: 'customers',
  group: 'customers',
  title: 'Customers',
  blurb: 'New and returning customers, how often they buy, what they spend, and the best customers.',
  for: ['management', 'finance'],
  filters: ['channel', 'brand'],
  async run(c) {
    const db = await getDb();
    const r = await db.execute<{ who: string; name: string; city: string | null; orders: number; net: number; first_ever: string; last: string }>(sql`
      with mine as (
        select ${WHO} as who, max(o.customer_name) as name, max(coalesce(o.address->>'area', o.address->>'city')) as city,
          count(distinct o.id)::int as orders, coalesce(sum(${lineNet(c)}), 0)::float8 as net, max(o.placed_at)::text as last
        from orders o join order_items oi on oi.order_id = o.id
        where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}
        group by 1),
      firsts as (select ${WHO} as who, min(o.placed_at)::text as first_ever from orders o where ${c.orders()} and ${SOLD()} group by 1)
      select mine.*, firsts.first_ever from mine join firsts using (who)`);
    const from = c.range.from.toISOString();
    const rows = r.rows.map((x) => ({ ...x, isNew: x.first_ever >= from }));
    const fresh = rows.filter((x) => x.isNew);
    const back = rows.filter((x) => !x.isNew);
    const repeat = rows.filter((x) => n(x.orders) > 1);
    const T = rows.reduce((a, x) => a + n(x.net), 0);
    const top = [...rows].sort((a, b) => n(b.net) - n(a.net) || n(b.orders) - n(a.orders)).slice(0, 100);
    const masked = !c.customers;
    return {
      figures: [
        { label: 'Customers', value: rows.length, fmt: 'int' },
        { label: 'New customers', value: fresh.length, fmt: 'int', note: rows.length ? `${Math.round((fresh.length / rows.length) * 100)}% of customers` : undefined },
        { label: 'Returning customers', value: back.length, fmt: 'int', note: 'bought before this period' },
        { label: 'Bought more than once', value: ratio(repeat.length, rows.length), fmt: 'pct', note: 'in this period' },
        { label: 'Orders per customer', value: ratio(rows.reduce((a, x) => a + n(x.orders), 0), rows.length), fmt: 'num' },
        ...(c.money ? [{ label: 'Spend per customer', value: rows.length ? Math.round(T / rows.length) : null, fmt: 'money' as const }, { label: 'From returning customers', value: shareOf(back.reduce((a, x) => a + n(x.net), 0), T), fmt: 'pct' as const, note: 'of net sales' }] : []),
      ],
      charts: c.money
        ? [{ kind: 'bars', title: 'New vs returning', rows: [{ label: 'New', value: Math.round(fresh.reduce((a, x) => a + n(x.net), 0)), units: fresh.length, sub: `${fresh.length} customers` }, { label: 'Returning', value: Math.round(back.reduce((a, x) => a + n(x.net), 0)), units: back.length, sub: `${back.length} customers` }], fmt: 'money', measured: true }]
        : [],
      tables: [
        {
          title: 'Best customers',
          sub: masked ? 'Names hidden for your access' : 'Most spent in the period',
          columns: [
            { key: 'name', label: 'Customer', fmt: 'text', wide: true },
            { key: 'city', label: 'Area', fmt: 'text' },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            ...(c.money ? [{ key: 'net', label: 'Net sales', fmt: 'money' as const, total: true }] : []),
            { key: 'kind', label: '', fmt: 'text' },
            { key: 'first', label: 'First order', fmt: 'date' },
          ],
          rows: top.map<Row>((x, i) => ({ name: masked ? `Customer ${i + 1}` : x.name, city: x.city, orders: n(x.orders), net: c.money ? Math.round(n(x.net)) : null, kind: x.isNew ? 'New' : 'Returning', first: x.first_ever.slice(0, 10) })),
        },
      ],
      empty: rows.length ? undefined : 'No customers in this period.',
    };
  },
};

const areas: Report = {
  id: 'sales-by-area',
  group: 'customers',
  title: 'Sales by area',
  blurb: 'Where orders go: areas and cities by orders, customers, net sales, cash on delivery and refusals.',
  for: ['management', 'ops', 'finance'],
  filters: ['channel', 'brand'],
  async run(c) {
    const db = await getDb();
    const r = await db.execute<{ area: string; orders: number; customers: number; net: number; cod: number; refused: number; all_orders: number }>(sql`
      with lines as (
        select o.id, o.payment_method, o.stage, ${WHO} as who, coalesce(nullif(o.address->>'area', ''), nullif(o.address->>'city', ''), 'Unknown') as area, ${lineNet(c)} as net
        from orders o join order_items oi on oi.order_id = o.id
        where ${c.orders()} and ${c.items()} and ${c.between(sql`o.placed_at`)})
      select initcap(lower(area)) as area,
        count(distinct id) filter (where stage not in ('cancelled', 'rto', 'rto_closed'))::int as orders,
        count(distinct who) filter (where stage not in ('cancelled', 'rto', 'rto_closed'))::int as customers,
        coalesce(sum(net) filter (where stage not in ('cancelled', 'rto', 'rto_closed')), 0)::float8 as net,
        count(distinct id) filter (where payment_method = 'cod')::int as cod,
        count(distinct id) filter (where stage in ('rto', 'rto_closed'))::int as refused,
        count(distinct id)::int as all_orders
      from lines group by 1`);
    const rows = r.rows
      .map<Row>((x) => ({ area: x.area, orders: n(x.orders), customers: n(x.customers), net: c.money ? Math.round(n(x.net)) : null, aov: c.money && n(x.orders) ? Math.round(n(x.net) / n(x.orders)) : null, cod: ratio(n(x.cod), n(x.all_orders)), refused: ratio(n(x.refused), n(x.all_orders)) }))
      .sort((a, b) => n(b.orders) - n(a.orders));
    const T = rows.reduce((a, x) => a + n(x.orders), 0);
    return {
      figures: [
        { label: 'Areas', value: rows.length, fmt: 'int' },
        { label: 'Top area', value: rows[0]?.area ?? '—', fmt: 'text', note: rows[0] ? `${Math.round((n(rows[0].orders) / Math.max(1, T)) * 100)}% of orders` : undefined },
        { label: 'Top 5 areas', value: shareOf(rows.slice(0, 5).reduce((a, x) => a + n(x.orders), 0), T), fmt: 'pct', note: 'of orders' },
      ],
      charts: [{ kind: 'bars', title: 'Orders by area', rows: rows.slice(0, 15).map((x) => ({ label: String(x.area), value: n(x.net), units: n(x.orders), sub: `${x.orders} orders` })), fmt: 'money', measured: true }],
      tables: [
        {
          title: 'Every area',
          columns: [
            { key: 'area', label: 'Area', fmt: 'text', wide: true },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            { key: 'customers', label: 'Customers', fmt: 'int', total: true },
            ...(c.money ? [{ key: 'net', label: 'Net sales', fmt: 'money' as const, total: true }, { key: 'aov', label: 'Avg order', fmt: 'money' as const }] : []),
            { key: 'cod', label: 'Cash on delivery', fmt: 'pct' },
            { key: 'refused', label: 'Refused at door', fmt: 'pct' },
          ],
          rows,
        },
      ],
      empty: rows.length ? undefined : 'No orders in this period.',
    };
  },
};

export const CUSTOMER_REPORTS: Report[] = [overview, areas];
