import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { channelLabel } from '../../channels';
import { bucketsOf, DOW, lineGross, lineNet, n, ratio, series, shareOf, SOLD, type Ctx, type Report, type Row } from '../engine';

type Tot = { orders: number; units: number; gross: number; net: number };

/** Orders, pieces and money of the sales in the period (or the one compared with). */
export async function salesTotals(c: Ctx, which: 'now' | 'prev' = 'now'): Promise<Tot> {
  const db = await getDb();
  const r = await db.execute<Tot>(sql`
    select count(distinct o.id)::int as orders, coalesce(sum(oi.quantity), 0)::int as units,
      coalesce(sum(${lineGross(c)}), 0)::float8 as gross, coalesce(sum(${lineNet(c)}), 0)::float8 as net
    from orders o join order_items oi on oi.order_id = o.id
    where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`, which)}`);
  const t = r.rows[0];
  return { orders: n(t?.orders), units: n(t?.units), gross: Math.round(n(t?.gross)), net: Math.round(n(t?.net)) };
}

/** The same by a grouping column: brand, category, store, size… */
async function salesBy(c: Ctx, key: ReturnType<typeof sql.raw>, which: 'now' | 'prev' = 'now') {
  const db = await getDb();
  const r = await db.execute<{ k: string | null; orders: number; units: number; gross: number; net: number }>(sql`
    select ${key} as k, count(distinct o.id)::int as orders, coalesce(sum(oi.quantity), 0)::int as units,
      coalesce(sum(${lineGross(c)}), 0)::float8 as gross, coalesce(sum(${lineNet(c)}), 0)::float8 as net
    from orders o join order_items oi on oi.order_id = o.id
    where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`, which)}
    group by 1`);
  return r.rows.map((x) => ({ k: x.k ?? '—', orders: n(x.orders), units: n(x.units), gross: Math.round(n(x.gross)), net: Math.round(n(x.net)) }));
}
export { salesBy };

const m = (c: Ctx, v: number) => (c.money ? v : null);

/** A breakdown report (by brand, category, store, size): its figures, bars and table, compared with the period before. */
export async function breakdown(c: Ctx, opts: { key: ReturnType<typeof sql.raw>; label: string; name: (k: string) => string; href?: (k: string) => string; limit?: number; sortBy?: 'net' | 'units' }): Promise<Awaited<ReturnType<Report['run']>>> {
  const [now, prev] = await Promise.all([salesBy(c, opts.key), salesBy(c, opts.key, 'prev')]);
  const before = new Map(prev.map((r) => [r.k, r]));
  const T = now.reduce((a, r) => ({ net: a.net + r.net, units: a.units + r.units }), { net: 0, units: 0 });
  const rows = now
    .sort((a, b) => (opts.sortBy === 'units' || !c.money ? b.units - a.units : b.net - a.net))
    .map<Row>((r) => {
      const p = before.get(r.k);
      return {
        name: opts.name(r.k),
        orders: r.orders,
        units: r.units,
        unitsShare: shareOf(r.units, T.units),
        net: m(c, r.net),
        netShare: c.money ? shareOf(r.net, T.net) : null,
        asp: c.money && r.units ? Math.round(r.net / r.units) : null,
        discount: c.money ? ratio(r.gross - r.net, r.gross) : null,
        prevUnits: p?.units ?? 0,
        prevNet: m(c, p?.net ?? 0),
        _href: opts.href?.(r.k),
      };
    });
  return {
    figures: [
      { label: `${opts.label}s selling`, value: now.filter((r) => r.units > 0).length, fmt: 'int', prev: prev.filter((r) => r.units > 0).length },
      ...(c.money ? [{ label: 'Net sales', value: T.net, fmt: 'money' as const, prev: prev.reduce((a, r) => a + r.net, 0), better: 'up' as const, measure: 'value' as const }] : []),
      { label: 'Pieces', value: T.units, fmt: 'int', prev: prev.reduce((a, r) => a + r.units, 0), better: 'up', measure: 'units' },
      { label: `Top ${opts.label.toLowerCase()}`, value: rows[0]?.name ?? '—', fmt: 'text', note: rows[0] ? `${Math.round(n(c.money ? rows[0].netShare : rows[0].unitsShare) * 100)}% of sales` : undefined },
    ],
    charts: [
      {
        kind: 'bars',
        title: `Sales by ${opts.label.toLowerCase()}`,
        sub: `Top ${Math.min(opts.limit ?? 12, rows.length)} of ${rows.length}`,
        rows: rows.slice(0, opts.limit ?? 12).map((r) => ({ label: String(r.name), value: n(r.net), units: n(r.units), sub: `${Math.round(n(c.money ? r.netShare : r.unitsShare) * 100)}%`, href: r._href })),
        fmt: 'money',
        measured: true,
      },
    ],
    tables: [
      {
        title: `Every ${opts.label.toLowerCase()}`,
        sub: `${rows.length} · compared with ${c.range.compare === 'ly' ? 'the same dates last year' : 'the period before'}`,
        columns: [
          { key: 'name', label: opts.label, fmt: 'text', wide: true },
          { key: 'orders', label: 'Orders', fmt: 'int', total: true },
          { key: 'units', label: 'Pieces', fmt: 'int', total: true, measure: 'units' },
          { key: 'unitsShare', label: 'Share', fmt: 'pct', measure: 'units' },
          { key: 'prevUnits', label: 'Pieces before', fmt: 'int', total: true, measure: 'units' },
          ...(c.money
            ? [
                { key: 'net', label: 'Net sales', fmt: 'money' as const, total: true, measure: 'value' as const },
                { key: 'netShare', label: 'Share', fmt: 'pct' as const, measure: 'value' as const },
                { key: 'prevNet', label: 'Net before', fmt: 'money' as const, total: true, measure: 'value' as const },
                { key: 'asp', label: 'Avg price', fmt: 'money' as const },
                { key: 'discount', label: 'Discount', fmt: 'pct' as const },
              ]
            : []),
        ],
        rows,
      },
    ],
    empty: rows.length ? undefined : 'No sales in this period.',
  };
}

const overview: Report = {
  id: 'sales-overview',
  group: 'sales',
  title: 'Sales overview',
  blurb: 'Net sales, orders, pieces, basket size and discounts, day by day, against the period before.',
  for: ['finance', 'brand', 'management'],
  filters: ['channel', 'brand', 'category'],
  async run(c) {
    const db = await getDb();
    const keys = bucketsOf(c.range);
    const [now, prev, by, ship] = await Promise.all([
      salesTotals(c),
      salesTotals(c, 'prev'),
      db.execute<{ k: string; orders: number; units: number; gross: number; net: number }>(sql`
        select ${c.day(sql`o.placed_at`, c.range.grain)}::text as k, count(distinct o.id)::int as orders, coalesce(sum(oi.quantity), 0)::int as units,
          coalesce(sum(${lineGross(c)}), 0)::float8 as gross, coalesce(sum(${lineNet(c)}), 0)::float8 as net
        from orders o join order_items oi on oi.order_id = o.id
        where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}
        group by 1`),
      // shipping charged belongs to orders, not lines: read once per order (no brand split possible)
      db.execute<{ ship: number; cancelled: number }>(sql`
        select coalesce(sum(${c.egp(sql`o.shipping`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as ship,
          count(*) filter (where o.stage = 'cancelled')::int as cancelled
        from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`)}`),
    ]);
    const map = new Map(by.rows.map((r) => [r.k, r]));
    const rows: Row[] = keys.map((k) => {
      const r = map.get(k);
      return { day: k, orders: n(r?.orders), units: n(r?.units), gross: m(c, Math.round(n(r?.gross))), discount: m(c, Math.round(n(r?.gross) - n(r?.net))), net: m(c, Math.round(n(r?.net))), aov: c.money && n(r?.orders) ? Math.round(n(r?.net) / n(r?.orders)) : null };
    });
    const filtered = Boolean(c.p.brands?.length || c.q.brand || c.q.category);
    return {
      figures: [
        ...(c.money
          ? [
              { label: 'Net sales', value: now.net, fmt: 'money' as const, prev: prev.net, better: 'up' as const, note: 'after discounts, before shipping and returns' },
              { label: 'Average order', value: now.orders ? Math.round(now.net / now.orders) : null, fmt: 'money' as const, prev: prev.orders ? Math.round(prev.net / prev.orders) : null, better: 'up' as const },
              { label: 'Average piece price', value: now.units ? Math.round(now.net / now.units) : null, fmt: 'money' as const, prev: prev.units ? Math.round(prev.net / prev.units) : null },
              { label: 'Discounts given', value: now.gross - now.net, fmt: 'money' as const, prev: prev.gross - prev.net, better: 'down' as const, note: now.gross ? `${Math.round(((now.gross - now.net) / now.gross) * 100)}% of full price` : undefined },
            ]
          : []),
        { label: 'Orders', value: now.orders, fmt: 'int', prev: prev.orders, better: 'up' },
        { label: 'Pieces', value: now.units, fmt: 'int', prev: prev.units, better: 'up' },
        { label: 'Pieces per order', value: now.orders ? now.units / now.orders : null, fmt: 'num', prev: prev.orders ? prev.units / prev.orders : null },
        ...(c.money && !filtered ? [{ label: 'Shipping charged', value: Math.round(n(ship.rows[0]?.ship)), fmt: 'money' as const }] : []),
        { label: 'Cancelled orders', value: n(ship.rows[0]?.cancelled), fmt: 'int', better: 'down', note: 'not counted in sales' },
      ],
      charts: [
        {
          kind: 'trend',
          title: `Sales by ${c.range.grain}`,
          labels: keys,
          series: [
            ...(c.money ? [{ name: 'Net sales', values: series(keys, by.rows.map((r) => ({ k: r.k, v: Math.round(n(r.net)) }))), measure: 'value' as const }] : []),
            { name: 'Pieces', values: series(keys, by.rows.map((r) => ({ k: r.k, v: n(r.units) }))), measure: 'units' },
          ],
        },
      ],
      tables: [
        {
          title: `By ${c.range.grain}`,
          columns: [
            { key: 'day', label: c.range.grain === 'day' ? 'Day' : c.range.grain === 'week' ? 'Week of' : 'Month', fmt: 'date' },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            { key: 'units', label: 'Pieces', fmt: 'int', total: true },
            ...(c.money
              ? [
                  { key: 'gross', label: 'Full price', fmt: 'money' as const, total: true },
                  { key: 'discount', label: 'Discounts', fmt: 'money' as const, total: true },
                  { key: 'net', label: 'Net sales', fmt: 'money' as const, total: true },
                  { key: 'aov', label: 'Avg order', fmt: 'money' as const },
                ]
              : []),
          ],
          rows: [...rows].reverse(),
        },
      ],
      empty: now.orders ? undefined : 'No sales in this period.',
    };
  },
};

const byChannel: Report = {
  id: 'sales-by-store',
  group: 'sales',
  title: 'Sales by store',
  blurb: 'Each website and app side by side: orders, pieces, net sales, share and change.',
  for: ['finance', 'management'],
  filters: ['brand', 'category'],
  run: (c) => breakdown(c, { key: sql.raw('o.channel_id'), label: 'Store', name: channelLabel }),
};

const byHour: Report = {
  id: 'sales-by-hour',
  group: 'sales',
  title: 'When customers buy',
  blurb: 'Orders by hour and weekday, to time promotions, posts and staffing.',
  for: ['management', 'brand'],
  filters: ['channel', 'brand'],
  async run(c) {
    const db = await getDb();
    const r = await db.execute<{ dow: number; hour: number; orders: number; net: number }>(sql`
      select extract(isodow from o.placed_at at time zone ${c.tz})::int as dow, extract(hour from o.placed_at at time zone ${c.tz})::int as hour,
        count(distinct o.id)::int as orders, coalesce(sum(${lineNet(c)}), 0)::float8 as net
      from orders o join order_items oi on oi.order_id = o.id
      where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}
      group by 1, 2`);
    const grid = DOW.map(() => Array.from({ length: 24 }, () => 0));
    const byHour = Array.from({ length: 24 }, () => ({ orders: 0, net: 0 }));
    const byDow = DOW.map(() => ({ orders: 0, net: 0 }));
    for (const x of r.rows) {
      grid[x.dow - 1][x.hour] += n(x.orders);
      byHour[x.hour].orders += n(x.orders);
      byHour[x.hour].net += n(x.net);
      byDow[x.dow - 1].orders += n(x.orders);
      byDow[x.dow - 1].net += n(x.net);
    }
    const total = byHour.reduce((a, h) => a + h.orders, 0);
    const peakH = byHour.reduce((b, h, i) => (h.orders > byHour[b].orders ? i : b), 0);
    const peakD = byDow.reduce((b, d, i) => (d.orders > byDow[b].orders ? i : b), 0);
    return {
      figures: [
        { label: 'Orders', value: total, fmt: 'int' },
        { label: 'Busiest hour', value: total ? `${String(peakH).padStart(2, '0')}:00` : '—', fmt: 'text', note: total ? `${Math.round((byHour[peakH].orders / total) * 100)}% of orders` : undefined },
        { label: 'Busiest day', value: total ? DOW[peakD] : '—', fmt: 'text', note: total ? `${Math.round((byDow[peakD].orders / total) * 100)}% of orders` : undefined },
        { label: 'Night orders', value: total ? byHour.slice(0, 7).reduce((a, h) => a + h.orders, 0) / total : null, fmt: 'pct', note: 'midnight to 7am' },
      ],
      charts: [{ kind: 'heatmap', title: 'Orders by weekday and hour', sub: `${c.tz === 'Asia/Kuwait' ? 'Kuwait' : 'Cairo'} time`, grid, rows: DOW }],
      tables: [
        {
          title: 'By weekday',
          columns: [{ key: 'day', label: 'Day', fmt: 'text' }, { key: 'orders', label: 'Orders', fmt: 'int', total: true }, { key: 'share', label: 'Share', fmt: 'pct' }, ...(c.money ? [{ key: 'net', label: 'Net sales', fmt: 'money' as const, total: true }] : [])],
          rows: byDow.map((d, i) => ({ day: DOW[i], orders: d.orders, share: shareOf(d.orders, total), net: m(c, Math.round(d.net)) })),
        },
        {
          title: 'By hour',
          columns: [{ key: 'hour', label: 'Hour', fmt: 'text' }, { key: 'orders', label: 'Orders', fmt: 'int', total: true }, { key: 'share', label: 'Share', fmt: 'pct' }, ...(c.money ? [{ key: 'net', label: 'Net sales', fmt: 'money' as const, total: true }] : [])],
          rows: byHour.map((h, i) => ({ hour: `${String(i).padStart(2, '0')}:00`, orders: h.orders, share: shareOf(h.orders, total), net: m(c, Math.round(h.net)) })),
        },
      ],
      empty: total ? undefined : 'No orders in this period.',
    };
  },
};

const PAY_LABEL: Record<string, string> = { cod: 'Cash on delivery', card: 'Card', knet: 'KNET', wallet: 'Wallet', instapay: 'InstaPay', store_credit: 'Store credit' };
export const payLabel = (k: string) => PAY_LABEL[k] ?? k.replace(/_/g, ' ');

const payments: Report = {
  id: 'payment-methods',
  wholeOrders: true,
  group: 'sales',
  title: 'Payment methods',
  blurb: 'How customers pay: KNET, card, cash on delivery, store credit; orders, value, share and basket size.',
  for: ['finance', 'management'],
  filters: ['channel'],
  needs: ['payments'],
  async run(c) {
    const db = await getDb();
    const q = (which: 'now' | 'prev') =>
      db.execute<{ k: string; orders: number; total: number }>(sql`
        select o.payment_method as k, count(*)::int as orders, coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}), 0)::float8 as total
        from orders o where ${c.orders()} and ${SOLD()} and ${c.between(sql`o.placed_at`, which)} group by 1`);
    const [now, prev] = await Promise.all([q('now'), q('prev')]);
    const before = new Map(prev.rows.map((r) => [r.k, r]));
    const T = now.rows.reduce((a, r) => ({ orders: a.orders + n(r.orders), total: a.total + n(r.total) }), { orders: 0, total: 0 });
    const rows = now.rows
      .sort((a, b) => n(b.total) - n(a.total))
      .map<Row>((r) => ({ name: payLabel(r.k), orders: n(r.orders), share: shareOf(n(r.orders), T.orders), total: Math.round(n(r.total)), valueShare: shareOf(n(r.total), T.total), aov: n(r.orders) ? Math.round(n(r.total) / n(r.orders)) : null, prevOrders: n(before.get(r.k)?.orders) }));
    const cod = now.rows.find((r) => r.k === 'cod');
    return {
      figures: [
        { label: 'Orders', value: T.orders, fmt: 'int', prev: prev.rows.reduce((a, r) => a + n(r.orders), 0) },
        { label: 'Charged', value: Math.round(T.total), fmt: 'money', note: 'order totals, shipping included' },
        { label: 'Paid online', value: T.orders ? 1 - n(cod?.orders) / T.orders : null, fmt: 'pct', note: 'not cash on delivery' },
        { label: 'Top method', value: rows[0]?.name ?? '—', fmt: 'text' },
      ],
      charts: [{ kind: 'bars', title: 'Share of orders', rows: rows.map((r) => ({ label: String(r.name), value: n(r.total), units: n(r.orders), sub: `${Math.round(n(r.share) * 100)}% of orders` })), fmt: 'money', measured: true }],
      tables: [
        {
          title: 'Every method',
          columns: [
            { key: 'name', label: 'Method', fmt: 'text', wide: true },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            { key: 'share', label: 'Share', fmt: 'pct' },
            { key: 'prevOrders', label: 'Orders before', fmt: 'int', total: true },
            { key: 'total', label: 'Charged', fmt: 'money', total: true },
            { key: 'valueShare', label: 'Value share', fmt: 'pct' },
            { key: 'aov', label: 'Avg order', fmt: 'money' },
          ],
          rows,
        },
      ],
      empty: rows.length ? undefined : 'No orders in this period.',
    };
  },
};

const discounts: Report = {
  id: 'discounts',
  group: 'sales',
  title: 'Discounts and promotions',
  blurb: 'How much is sold on discount, how deep, and which codes and brands carry it.',
  for: ['finance', 'brand', 'management'],
  filters: ['channel', 'brand', 'category'],
  needs: ['money'],
  async run(c) {
    const db = await getDb();
    const [byBrand, orders, codes] = await Promise.all([
      db.execute<{ k: string; units: number; gross: number; net: number; disc_units: number }>(sql`
        select coalesce(oi.brand, '—') as k, coalesce(sum(oi.quantity), 0)::int as units, coalesce(sum(${lineGross(c)}), 0)::float8 as gross, coalesce(sum(${lineNet(c)}), 0)::float8 as net,
          coalesce(sum(oi.quantity) filter (where o.discount > 0), 0)::int as disc_units
        from orders o join order_items oi on oi.order_id = o.id
        where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)} group by 1`),
      db.execute<{ all: number; disc: number; gross: number; off: number }>(sql`
        select count(*)::int as all, count(*) filter (where o.discount > 0)::int as disc,
          coalesce(sum(${c.egp(sql`o.subtotal`, sql`o.currency`)}), 0)::float8 as gross, coalesce(sum(${c.egp(sql`o.discount`, sql`o.currency`)}), 0)::float8 as off
        from orders o where ${c.orders()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}`),
      // Shopify discount codes arrive as order tags when the store adds them; otherwise this stays empty
      db.execute<{ tag: string; orders: number; off: number }>(sql`
        select t.tag, count(*)::int as orders, coalesce(sum(${c.egp(sql`o.discount`, sql`o.currency`)}), 0)::float8 as off
        from orders o, jsonb_array_elements_text(o.tags) as t(tag)
        where ${c.orders()} and ${SOLD()} and ${c.between(sql`o.placed_at`)} and o.discount > 0 and t.tag !~ '^relay:'
        group by 1 order by 3 desc limit 30`),
    ]);
    const o = orders.rows[0];
    const rows = byBrand.rows
      .map<Row>((r) => ({ name: r.k, units: n(r.units), discUnits: n(r.disc_units), discShare: shareOf(n(r.disc_units), n(r.units)), gross: Math.round(n(r.gross)), off: Math.round(n(r.gross) - n(r.net)), depth: ratio(n(r.gross) - n(r.net), n(r.gross)), _href: `/analytics/brand-scorecard?brand=${encodeURIComponent(r.k)}` }))
      .sort((a, b) => n(b.off) - n(a.off));
    return {
      figures: [
        { label: 'Discounts given', value: Math.round(n(o?.off)), fmt: 'money', better: 'down' },
        { label: 'Average depth', value: ratio(n(o?.off), n(o?.gross)), fmt: 'pct', note: 'of full price, across all orders' },
        { label: 'Orders with a discount', value: ratio(n(o?.disc), n(o?.all)), fmt: 'pct', note: `${n(o?.disc)} of ${n(o?.all)}` },
        { label: 'Avg discount per discounted order', value: n(o?.disc) ? Math.round(n(o?.off) / n(o?.disc)) : null, fmt: 'money' },
      ],
      charts: [{ kind: 'bars', title: 'Discount by brand', sub: 'Value given away', rows: rows.filter((r) => n(r.off) > 0).slice(0, 12).map((r) => ({ label: String(r.name), value: n(r.off), sub: r.depth != null ? `${Math.round(n(r.depth) * 100)}% deep` : undefined, href: r._href })), fmt: 'money' }],
      tables: [
        {
          title: 'By brand',
          columns: [
            { key: 'name', label: 'Brand', fmt: 'text', wide: true },
            { key: 'units', label: 'Pieces', fmt: 'int', total: true },
            { key: 'discUnits', label: 'On discount', fmt: 'int', total: true },
            { key: 'discShare', label: 'Share on discount', fmt: 'pct' },
            { key: 'gross', label: 'Full price', fmt: 'money', total: true },
            { key: 'off', label: 'Discount', fmt: 'money', total: true },
            { key: 'depth', label: 'Depth', fmt: 'pct' },
          ],
          rows,
        },
        ...(codes.rows.length
          ? [{ title: 'By order tag', sub: 'Discounted orders by the tags Shopify gave them', columns: [{ key: 'tag', label: 'Tag', fmt: 'text' as const, wide: true }, { key: 'orders', label: 'Orders', fmt: 'int' as const, total: true }, { key: 'off', label: 'Discount', fmt: 'money' as const, total: true }], rows: codes.rows.map((r) => ({ tag: r.tag, orders: n(r.orders), off: Math.round(n(r.off)) })) }]
          : []),
      ],
      empty: n(o?.all) ? undefined : 'No orders in this period.',
    };
  },
};

const journal: Report = {
  id: 'daily-journal',
  wholeOrders: true,
  group: 'finance',
  title: 'Daily sales journal',
  blurb: 'One line per day and store for the accounts: orders, full price, discounts, net, shipping, total charged, by payment method.',
  for: ['finance'],
  filters: ['channel'],
  needs: ['payments'],
  async run(c) {
    const db = await getDb();
    const r = await db.execute<{ day: string; channel: string; orders: number; gross: number; disc: number; ship: number; total: number; cod: number; online: number; credit: number; cancelled: number }>(sql`
      select ${c.day(sql`o.placed_at`)}::text as day, o.channel_id as channel,
        count(*) filter (where ${SOLD()})::int as orders,
        coalesce(sum(${c.egp(sql`o.subtotal`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as gross,
        coalesce(sum(${c.egp(sql`o.discount`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as disc,
        coalesce(sum(${c.egp(sql`o.shipping`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as ship,
        coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}) filter (where ${SOLD()}), 0)::float8 as total,
        coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}) filter (where ${SOLD()} and o.payment_method = 'cod'), 0)::float8 as cod,
        coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}) filter (where ${SOLD()} and o.payment_method not in ('cod', 'store_credit')), 0)::float8 as online,
        coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}) filter (where ${SOLD()} and o.payment_method = 'store_credit'), 0)::float8 as credit,
        count(*) filter (where o.stage = 'cancelled')::int as cancelled
      from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`)}
      group by 1, 2 order by 1 desc, 2`);
    const rows = r.rows.map<Row>((x) => ({ day: x.day, store: channelLabel(x.channel), orders: n(x.orders), gross: Math.round(n(x.gross)), disc: Math.round(n(x.disc)), net: Math.round(n(x.gross) - n(x.disc)), ship: Math.round(n(x.ship)), total: Math.round(n(x.total)), online: Math.round(n(x.online)), cod: Math.round(n(x.cod)), credit: Math.round(n(x.credit)), cancelled: n(x.cancelled) }));
    const sum = (k: string) => rows.reduce((a, x) => a + n(x[k]), 0);
    return {
      figures: [
        { label: 'Total charged', value: sum('total'), fmt: 'money' },
        { label: 'Net sales', value: sum('net'), fmt: 'money', note: 'after discounts, before shipping' },
        { label: 'Paid online', value: sum('online'), fmt: 'money' },
        { label: 'Cash on delivery', value: sum('cod'), fmt: 'money' },
      ],
      charts: [],
      tables: [
        {
          title: 'Journal',
          sub: 'Orders by the day they were placed; cancelled and refused orders left out of the money',
          columns: [
            { key: 'day', label: 'Day', fmt: 'date' },
            { key: 'store', label: 'Store', fmt: 'text' },
            { key: 'orders', label: 'Orders', fmt: 'int', total: true },
            { key: 'gross', label: 'Full price', fmt: 'money', total: true },
            { key: 'disc', label: 'Discounts', fmt: 'money', total: true },
            { key: 'net', label: 'Net sales', fmt: 'money', total: true },
            { key: 'ship', label: 'Shipping', fmt: 'money', total: true },
            { key: 'total', label: 'Total charged', fmt: 'money', total: true },
            { key: 'online', label: 'Online', fmt: 'money', total: true },
            { key: 'cod', label: 'Cash on delivery', fmt: 'money', total: true },
            { key: 'credit', label: 'Store credit', fmt: 'money', total: true },
            { key: 'cancelled', label: 'Cancelled', fmt: 'int', total: true },
          ],
          rows,
        },
      ],
      empty: rows.length ? undefined : 'No orders in this period.',
    };
  },
};

export const SALES_REPORTS: Report[] = [overview, byChannel, byHour, payments, discounts, journal];
