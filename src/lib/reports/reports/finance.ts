import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { channelLabel } from '../../channels';
import { weekOf } from '../../domain/stock/calendar';
import { n, ratio, shareOf, SOLD, type Ctx, type Report, type Row } from '../engine';
import { payLabel } from './sales';

const METHOD: Record<string, string> = { original: 'Back to the card', store_credit: 'Store credit', cash_at_store: 'Cash at a store' };
const STATUS: Record<string, string> = { paid: 'Paid', pending: 'Waiting for payment', cod_due: 'Cash on delivery, not collected', cod_collected: 'Cash collected', refunded: 'Refunded', partially_refunded: 'Partly refunded', voided: 'Voided' };

/** Refunds in the period: returns refunded, and cancelled orders whose money went back. */
async function refundsIn(c: Ctx, which: 'now' | 'prev' = 'now') {
  const db = await getDb();
  const r = await db.execute<{ returns: number; amount: number; bonus: number }>(sql`
    select count(*)::int as returns, coalesce(sum(${c.egp(sql`r.amount`, sql`r.currency`)}), 0)::float8 as amount, coalesce(sum(${c.egp(sql`r.bonus`, sql`r.currency`)}), 0)::float8 as bonus
    from returns r join orders o on o.id = r.order_id
    where ${c.orders()} and r.stage in ('refunded', 'closed') and r.resolution <> 'exchange' and ${c.between(sql`coalesce(r.closed_at, r.stage_at)`, which)}`);
  const x = r.rows[0];
  return { returns: n(x?.returns), amount: Math.round(n(x?.amount)), bonus: Math.round(n(x?.bonus)) };
}

const bridge: Report = {
  id: 'revenue',
  wholeOrders: true,
  group: 'finance',
  title: 'Revenue: from full price to net',
  blurb: 'Full price, discounts, net sales, shipping, total charged, refunds and what is left, by store, against the period before.',
  for: ['finance', 'management'],
  filters: ['channel'],
  needs: ['payments'],
  async run(c) {
    const db = await getDb();
    const q = (which: 'now' | 'prev') =>
      db.execute<{ channel: string; orders: number; gross: number; disc: number; ship: number; total: number; cancelled: number; cancelled_value: number }>(sql`
        select o.channel_id as channel, count(*) filter (where ${SOLD()})::int as orders,
          coalesce(sum(${c.egp(sql`o.subtotal`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as gross,
          coalesce(sum(${c.egp(sql`o.discount`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as disc,
          coalesce(sum(${c.egp(sql`o.shipping`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as ship,
          coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as total,
          count(*) filter (where not ${SOLD()})::int as cancelled,
          coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}) filter (where not ${SOLD()}), 0)::float8 as cancelled_value
        from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`, which)} group by 1`);
    const [now, prev, ref, refPrev] = await Promise.all([q('now'), q('prev'), refundsIn(c), refundsIn(c, 'prev')]);
    const sum = (rows: typeof now.rows, k: keyof (typeof now.rows)[number]) => Math.round(rows.reduce((a, x) => a + n(x[k]), 0));
    const G = sum(now.rows, 'gross');
    const D = sum(now.rows, 'disc');
    const S = sum(now.rows, 'ship');
    const T = sum(now.rows, 'total');
    const left = T - ref.amount;
    const pT = sum(prev.rows, 'total');
    return {
      figures: [
        { label: 'Full price', value: G, fmt: 'money', prev: sum(prev.rows, 'gross') },
        { label: 'Discounts', value: D, fmt: 'money', prev: sum(prev.rows, 'disc'), better: 'down' },
        { label: 'Net sales', value: G - D, fmt: 'money', prev: sum(prev.rows, 'gross') - sum(prev.rows, 'disc'), better: 'up' },
        { label: 'Shipping charged', value: S, fmt: 'money', prev: sum(prev.rows, 'ship') },
        { label: 'Total charged', value: T, fmt: 'money', prev: pT, better: 'up' },
        { label: 'Refunded', value: ref.amount, fmt: 'money', prev: refPrev.amount, better: 'down', note: `${ref.returns} returns refunded in the period` },
        { label: 'After refunds', value: left, fmt: 'money', prev: pT - refPrev.amount, better: 'up' },
        { label: 'Cancelled or refused', value: sum(now.rows, 'cancelled_value'), fmt: 'money', better: 'down', note: `${sum(now.rows, 'cancelled')} orders, not in the figures above` },
      ],
      charts: [
        {
          kind: 'bars',
          title: 'From full price to what is kept',
          rows: [
            { label: 'Full price', value: G },
            { label: '− Discounts', value: D },
            { label: '= Net sales', value: G - D },
            { label: '+ Shipping', value: S },
            { label: '= Total charged', value: T },
            { label: '− Refunds', value: ref.amount },
            { label: '= After refunds', value: left },
          ],
          fmt: 'money',
          ordered: true,
        },
      ],
      tables: [
        {
          title: 'By store',
          columns: [
            { key: 'store', label: 'Store', fmt: 'text', wide: true },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            { key: 'gross', label: 'Full price', fmt: 'money', total: true },
            { key: 'disc', label: 'Discounts', fmt: 'money', total: true },
            { key: 'net', label: 'Net sales', fmt: 'money', total: true },
            { key: 'ship', label: 'Shipping', fmt: 'money', total: true },
            { key: 'total', label: 'Total charged', fmt: 'money', total: true },
            { key: 'cancelled', label: 'Cancelled / refused', fmt: 'int', total: true },
          ],
          rows: now.rows.map<Row>((x) => ({ store: channelLabel(x.channel), orders: n(x.orders), gross: Math.round(n(x.gross)), disc: Math.round(n(x.disc)), net: Math.round(n(x.gross) - n(x.disc)), ship: Math.round(n(x.ship)), total: Math.round(n(x.total)), cancelled: n(x.cancelled) })),
        },
      ],
      notes: ['Orders count on the day they were placed; refunds on the day they were issued.'],
      empty: now.rows.length ? undefined : 'No orders in this period.',
    };
  },
};

const status: Report = {
  id: 'payment-status',
  floor: true,
  wholeOrders: true,
  group: 'finance',
  title: 'Payments: paid, waiting, owed',
  blurb: 'Every order’s money by status: paid, waiting, cash still with the courier, refunded; cancelled orders still holding payment.',
  for: ['finance'],
  filters: ['channel'],
  needs: ['payments'],
  async run(c) {
    const db = await getDb();
    const [byStatus, owed] = await Promise.all([
      db.execute<{ status: string; method: string; orders: number; value: number }>(sql`
        select o.payment_status as status, o.payment_method as method, count(*)::int as orders, coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}), 0)::float8 as value
        from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`)} group by 1, 2 order by 4 desc`),
      db.execute<{ number: string; channel: string; placed: string; stage: string; status: string; method: string; value: number; days: number }>(sql`
        select o.number, o.channel_id as channel, o.placed_at::text as placed, o.stage, o.payment_status as status, o.payment_method as method,
          ${c.egp(sql`o.total`, sql`o.currency`)}::float8 as value, floor(extract(epoch from now() - coalesce(o.delivered_at, o.stage_at)) / 86400)::int as days
        from orders o where ${c.orders()} and (
          (o.stage = 'cancelled' and o.payment_status = 'paid')
          or (o.payment_status = 'cod_due' and o.stage in ('delivered', 'settled'))
          or (o.payment_status = 'pending' and o.stage not in ('cancelled', 'rto_closed')))
        order by days desc limit 500`),
    ]);
    const total = byStatus.rows.reduce((a, x) => a + n(x.value), 0);
    const agg = (k: string) => byStatus.rows.filter((x) => x.status === k).reduce((a, x) => ({ orders: a.orders + n(x.orders), value: a.value + n(x.value) }), { orders: 0, value: 0 });
    const paid = agg('paid');
    const due = agg('cod_due');
    const pending = agg('pending');
    const kinds = (r: (typeof owed.rows)[number]) => (r.stage === 'cancelled' ? 'Cancelled, still paid: refund it' : r.status === 'cod_due' ? 'Delivered, cash not collected' : 'Waiting for payment');
    return {
      figures: [
        { label: 'Paid', value: Math.round(paid.value), fmt: 'money', note: `${paid.orders} orders` },
        { label: 'Cash on delivery due', value: Math.round(due.value), fmt: 'money', note: `${due.orders} orders not collected yet` },
        { label: 'Waiting for payment', value: Math.round(pending.value), fmt: 'money', note: `${pending.orders} orders` },
        { label: 'Needs action', value: owed.rows.length, fmt: 'int', better: 'down', note: 'listed below, oldest first' },
      ],
      charts: [
        {
          kind: 'bars',
          title: 'By status',
          rows: [...new Set(byStatus.rows.map((x) => x.status))].map((k) => {
            const xs = byStatus.rows.filter((x) => x.status === k);
            const v = xs.reduce((a, x) => a + n(x.value), 0);
            return { label: STATUS[k] ?? k, value: Math.round(v), units: xs.reduce((a, x) => a + n(x.orders), 0), sub: `${Math.round((v / Math.max(1, total)) * 100)}%` };
          }),
          fmt: 'money',
          measured: true,
        },
      ],
      tables: [
        {
          title: 'Needs action',
          sub: 'Cancelled orders still holding the customer’s money, cash still with the courier, payments never completed; any date',
          columns: [
            { key: 'kind', label: '', fmt: 'text', wide: true },
            { key: 'number', label: 'Order', fmt: 'text' },
            { key: 'store', label: 'Store', fmt: 'text' },
            { key: 'placed', label: 'Placed', fmt: 'date' },
            { key: 'method', label: 'Payment', fmt: 'text' },
            { key: 'value', label: 'Amount', fmt: 'money', total: true },
            { key: 'days', label: 'Days waiting', fmt: 'int' },
          ],
          rows: owed.rows.map<Row>((x) => ({ kind: kinds(x), number: x.number, store: channelLabel(x.channel), placed: x.placed.slice(0, 10), method: payLabel(x.method), value: Math.round(n(x.value)), days: n(x.days), _href: `/orders?q=${encodeURIComponent(x.number)}&view=all` })),
        },
        {
          title: 'By status and method',
          columns: [{ key: 'status', label: 'Status', fmt: 'text', wide: true }, { key: 'method', label: 'Payment', fmt: 'text' }, { key: 'orders', label: 'Orders', fmt: 'int', total: true }, { key: 'value', label: 'Amount', fmt: 'money', total: true }, { key: 'share', label: 'Share', fmt: 'pct' }],
          rows: byStatus.rows.map((x) => ({ status: STATUS[x.status] ?? x.status, method: payLabel(x.method), orders: n(x.orders), value: Math.round(n(x.value)), share: shareOf(n(x.value), total) })),
        },
      ],
      empty: byStatus.rows.length || owed.rows.length ? undefined : 'No orders in this period.',
    };
  },
};

const cod: Report = {
  id: 'cod-cash',
  floor: true,
  wholeOrders: true,
  group: 'finance',
  title: 'Cash on delivery and courier settlements',
  blurb: 'Cash the couriers collected and still owe, what each settlement expected and remitted, and any gaps.',
  for: ['finance'],
  filters: ['channel'],
  needs: ['payments'],
  async run(c) {
    const db = await getDb();
    const [owed, sets] = await Promise.all([
      db.execute<{ courier: string; orders: number; value: number; oldest: number }>(sql`
        select coalesce(o.courier, 'No courier') as courier, count(*)::int as orders, coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}), 0)::float8 as value,
          max(floor(extract(epoch from now() - coalesce(o.delivered_at, o.stage_at)) / 86400))::int as oldest
        from orders o where ${c.orders()} and o.payment_method = 'cod' and o.stage = 'delivered' and o.settlement_id is null group by 1 order by 3 desc`),
      db.execute<{ reference: string; courier: string; from: string; to: string; expected: number; remitted: number | null; orders: number; status: string }>(sql`
        select s.reference, s.courier, s.period_from::text as from, s.period_to::text as to, ${c.egp(sql`s.expected`, sql`s.currency`)}::float8 as expected,
          case when s.remitted is null then null else ${c.egp(sql`s.remitted`, sql`s.currency`)}::float8 end as remitted, s.order_count as orders, s.status
        from settlements s where ${c.between(sql`s.created_at`)} and exists (select 1 from orders o where o.settlement_id = s.id and ${c.orders()})
        order by s.created_at desc`),
    ]);
    const due = owed.rows.reduce((a, x) => a + n(x.value), 0);
    const exp = sets.rows.reduce((a, x) => a + n(x.expected), 0);
    const rem = sets.rows.reduce((a, x) => a + n(x.remitted), 0);
    return {
      figures: [
        { label: 'With couriers now', value: Math.round(due), fmt: 'money', better: 'down', note: `${owed.rows.reduce((a, x) => a + n(x.orders), 0)} delivered orders not settled` },
        { label: 'Settlements in the period', value: sets.rows.length, fmt: 'int' },
        { label: 'Expected', value: Math.round(exp), fmt: 'money' },
        { label: 'Remitted', value: Math.round(rem), fmt: 'money' },
        { label: 'Gap', value: Math.round(exp - rem), fmt: 'money', better: 'down', note: `${sets.rows.filter((x) => x.status === 'discrepancy').length} settlements with a discrepancy` },
      ],
      charts: [],
      tables: [
        {
          title: 'Cash still with couriers',
          columns: [{ key: 'courier', label: 'Courier', fmt: 'text', wide: true }, { key: 'orders', label: 'Orders', fmt: 'int', total: true }, { key: 'value', label: 'Amount', fmt: 'money', total: true }, { key: 'oldest', label: 'Oldest (days)', fmt: 'int' }],
          rows: owed.rows.map((x) => ({ courier: x.courier, orders: n(x.orders), value: Math.round(n(x.value)), oldest: n(x.oldest) })),
        },
        {
          title: 'Settlements',
          columns: [
            { key: 'reference', label: 'Reference', fmt: 'text' },
            { key: 'courier', label: 'Courier', fmt: 'text' },
            { key: 'to', label: 'Up to', fmt: 'date' },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            { key: 'expected', label: 'Expected', fmt: 'money', total: true },
            { key: 'remitted', label: 'Remitted', fmt: 'money', total: true },
            { key: 'gap', label: 'Gap', fmt: 'money', total: true },
            { key: 'status', label: 'Status', fmt: 'text' },
          ],
          rows: sets.rows.map((x) => ({ reference: x.reference, courier: x.courier, to: x.to.slice(0, 10), orders: n(x.orders), expected: Math.round(n(x.expected)), remitted: x.remitted == null ? null : Math.round(n(x.remitted)), gap: x.remitted == null ? null : Math.round(n(x.expected) - n(x.remitted)), status: x.status })),
        },
      ],
      empty: owed.rows.length || sets.rows.length ? undefined : 'No cash on delivery owed and no settlements in this period.',
    };
  },
};

const refunds: Report = {
  id: 'refunds',
  floor: true,
  wholeOrders: true,
  group: 'finance',
  title: 'Refunds issued',
  blurb: 'Every refund in the period: how much, how (card, store credit, cash at a store), the credit bonus, and how long it took.',
  for: ['finance'],
  filters: ['channel', 'brand'],
  needs: ['payments'],
  async run(c) {
    const db = await getDb();
    const [list_, now, prev] = await Promise.all([
      db.execute<{ number: string; order: string; channel: string; requested: string; refunded: string; method: string; reason: string; amount: number; bonus: number; days: number }>(sql`
        select r.number, o.number as order, o.channel_id as channel, r.requested_at::text as requested, coalesce(r.closed_at, r.stage_at)::text as refunded, r.refund_method as method, r.reason,
          ${c.egp(sql`r.amount`, sql`r.currency`)}::float8 as amount, ${c.egp(sql`r.bonus`, sql`r.currency`)}::float8 as bonus,
          round(extract(epoch from coalesce(r.closed_at, r.stage_at) - r.requested_at) / 86400)::int as days
        from returns r join orders o on o.id = r.order_id
        where ${c.orders()} and r.stage in ('refunded', 'closed') and r.resolution <> 'exchange' and ${c.between(sql`coalesce(r.closed_at, r.stage_at)`)}
        order by 5 desc`),
      refundsIn(c),
      refundsIn(c, 'prev'),
    ]);
    const byMethod = new Map<string, { n: number; amount: number; bonus: number }>();
    for (const x of list_.rows) {
      const a = byMethod.get(x.method) ?? (byMethod.set(x.method, { n: 0, amount: 0, bonus: 0 }), byMethod.get(x.method)!);
      a.n += 1;
      a.amount += n(x.amount);
      a.bonus += n(x.bonus);
    }
    const days = list_.rows.map((x) => n(x.days)).sort((a, b) => a - b);
    return {
      figures: [
        { label: 'Refunded', value: now.amount, fmt: 'money', prev: prev.amount, better: 'down' },
        { label: 'Refunds', value: now.returns, fmt: 'int', prev: prev.returns, better: 'down' },
        { label: 'Store-credit bonus', value: now.bonus, fmt: 'money', note: 'paid to customers who took credit' },
        { label: 'Days to refund', value: days.length ? days[Math.floor(days.length / 2)] : null, fmt: 'num', better: 'down', note: 'median, from request to refund' },
        { label: 'Kept as store credit', value: shareOf(byMethod.get('store_credit')?.amount ?? 0, now.amount), fmt: 'pct', better: 'up' },
      ],
      charts: [{ kind: 'bars', title: 'How the money went back', rows: [...byMethod.entries()].map(([k, a]) => ({ label: METHOD[k] ?? k, value: Math.round(a.amount), units: a.n, sub: `${a.n} refunds` })), fmt: 'money', measured: true }],
      tables: [
        {
          title: 'Every refund',
          columns: [
            { key: 'number', label: 'Return', fmt: 'text' },
            { key: 'order', label: 'Order', fmt: 'text' },
            { key: 'store', label: 'Store', fmt: 'text' },
            { key: 'refunded', label: 'Refunded', fmt: 'date' },
            { key: 'method', label: 'Money went', fmt: 'text' },
            { key: 'amount', label: 'Amount', fmt: 'money', total: true },
            { key: 'bonus', label: 'Bonus', fmt: 'money', total: true },
            { key: 'days', label: 'Days', fmt: 'int' },
          ],
          rows: list_.rows.map<Row>((x) => ({ number: x.number, order: x.order, store: channelLabel(x.channel), refunded: x.refunded.slice(0, 10), method: METHOD[x.method] ?? x.method, amount: Math.round(n(x.amount)), bonus: Math.round(n(x.bonus)), days: n(x.days) })),
        },
      ],
      notes: ['A cancelled order refunded from Finance → Cancelled, paid shows in Payments, not here (it is an order, not a return).'],
      empty: list_.rows.length ? undefined : 'No refunds issued in this period.',
    };
  },
};

const margin: Report = {
  id: 'margin',
  group: 'finance',
  title: 'Gross margin',
  blurb: 'Sales against cost, by brand and category: margin in money and percent, where costs are known.',
  for: ['finance', 'management'],
  filters: ['brand', 'category'],
  needs: ['money', 'cost'],
  async run(c) {
    const db = await getDb();
    // the weekly sales table carries each style's cost: the period's weeks, Monday to Monday
    const from = weekOf(c.range.from.getTime());
    const to = weekOf(c.range.to.getTime() - 1);
    const q = (key: string) =>
      db.execute<{ k: string; units: number; revenue: number; cost: number; costed: number }>(sql`
        select ${sql.raw(key)} as k, sum(sw.units)::int as units, coalesce(sum(${c.egp(sql`sw.revenue`, sql`p.currency`)}), 0)::float8 as revenue,
          coalesce(sum(${c.egp(sql`sw.cost`, sql`p.currency`)}), 0)::float8 as cost, coalesce(sum(${c.egp(sql`sw.revenue`, sql`p.currency`)}) filter (where p.cost > 0 and p.cost <> round(coalesce(p.compare_at, p.price) * 0.4)), 0)::float8 as costed
        from sales_weekly sw join products p on p.id = sw.product_id
        where ${c.products('p')} and sw.week >= ${from}::date and sw.week <= ${to}::date
        group by 1`);
    const [brands, cats] = await Promise.all([q('p.brand'), q('p.category')]);
    const rows = (xs: (typeof brands.rows)[number][]) =>
      xs
        .map<Row>((x) => ({ name: x.k, units: n(x.units), revenue: Math.round(n(x.revenue)), cost: Math.round(n(x.cost)), margin: Math.round(n(x.revenue) - n(x.cost)), pct: ratio(n(x.revenue) - n(x.cost), n(x.revenue)), costed: ratio(n(x.costed), n(x.revenue)) }))
        .sort((a, b) => n(b.revenue) - n(a.revenue));
    const b = rows(brands.rows);
    const R = b.reduce((a, x) => a + n(x.revenue), 0);
    const C = b.reduce((a, x) => a + n(x.cost), 0);
    const costed = brands.rows.reduce((a, x) => a + n(x.costed), 0);
    const cols = (label: string) => [
      { key: 'name', label, fmt: 'text' as const, wide: true },
      { key: 'units', label: 'Pieces', fmt: 'int' as const, total: true },
      { key: 'revenue', label: 'Sales', fmt: 'money' as const, total: true },
      { key: 'cost', label: 'Cost', fmt: 'money' as const, total: true },
      { key: 'margin', label: 'Margin', fmt: 'money' as const, total: true },
      { key: 'pct', label: 'Margin %', fmt: 'pct' as const },
      { key: 'costed', label: 'Sales with a real cost', fmt: 'pct' as const },
    ];
    return {
      figures: [
        { label: 'Sales', value: R, fmt: 'money' },
        { label: 'Cost of goods', value: C, fmt: 'money' },
        { label: 'Gross margin', value: R - C, fmt: 'money', better: 'up' },
        { label: 'Margin %', value: ratio(R - C, R), fmt: 'pct', better: 'up' },
        { label: 'Sales with a real cost', value: ratio(costed, R), fmt: 'pct', note: 'the rest use an estimate' },
      ],
      charts: [{ kind: 'bars', title: 'Margin % by brand', rows: b.filter((x) => n(x.revenue) > 0).slice(0, 15).map((x) => ({ label: String(x.name), value: n(x.pct), sub: `${Math.round(n(x.costed) * 100)}% with a real cost` })), fmt: 'pct' }],
      tables: [
        { title: 'By brand', columns: cols('Brand'), rows: b },
        { title: 'By category', columns: cols('Category'), rows: rows(cats.rows) },
      ],
      notes: [
        ...(ratio(costed, R) ?? 0) < 0.5
          ? ['No real cost prices for most of these sales yet: Shopify holds none, so the console estimates cost at 40% of full price and this margin is that estimate. Import real costs from Brands → Import costs (or Lucida, once connected).']
          : [],
        `Read by week (${from} to ${to}).`,
      ],
      empty: R ? undefined : 'No sales in this period.',
    };
  },
};

export const FINANCE_REPORTS: Report[] = [bridge, status, cod, refunds, margin];
