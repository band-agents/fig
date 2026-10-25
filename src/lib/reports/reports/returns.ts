import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { channelLabel } from '../../channels';
import { RETURN_REASONS, RETURN_STAGE, type ReturnReason, type ReturnStage } from '../../domain/stages';
import { bucketsOf, n, ratio, series, shareOf, SOLD, type Col, type Ctx, type Report, type Row } from '../engine';
import { payLabel } from './sales';

/** Shopify's cancel reasons as people say them; the console's own reasons are already words. */
const CANCEL: Record<string, string> = { customer: 'Customer asked to cancel', inventory: 'Out of stock', fraud: 'Suspected fraud', declined: 'Payment declined', staff: 'Staff error', other: 'Other' };
const cancelLabel = (k: string) => CANCEL[k.toLowerCase()] ?? k;
const reasonLabel = (k: string) => RETURN_REASONS[k as ReturnReason] ?? k.replace(/_/g, ' ');
const METHOD: Record<string, string> = { original: 'Back to the card', store_credit: 'Store credit', cash_at_store: 'Cash at a store' };
const RESOLUTION: Record<string, string> = { refund: 'Refund', exchange: 'Exchange', credit: 'Store credit' };

/** Returns opened in the period, of orders in this person's stores holding their brands. */
const RETURNS = (c: Ctx) => sql`returns r join orders o on o.id = r.order_id where ${c.orders()} and ${c.between(sql`r.requested_at`)}`;

const overview: Report = {
  id: 'returns',
  wholeOrders: true,
  group: 'returns',
  title: 'Returns',
  blurb: 'Returns opened, pieces and money back, the return rate, why customers return, and how they are refunded.',
  for: ['finance', 'brand', 'ops', 'management'],
  filters: ['channel', 'brand'],
  async run(c) {
    const db = await getDb();
    const keys = bucketsOf(c.range);
    const [tot, prevTot, trend, reasons, methods, stages, sold] = await Promise.all([
      db.execute<{ returns: number; amount: number; bonus: number; units: number }>(sql`
        select count(distinct r.id)::int as returns, coalesce(sum(distinct_amount), 0)::float8 as amount, coalesce(sum(distinct_bonus), 0)::float8 as bonus, coalesce(sum(units), 0)::int as units from (
          select r.id, ${c.egp(sql`r.amount`, sql`r.currency`)} as distinct_amount, ${c.egp(sql`r.bonus`, sql`r.currency`)} as distinct_bonus,
            (select coalesce(sum(ri.quantity), 0) from return_items ri where ri.return_id = r.id) as units
          from ${RETURNS(c)}) r`),
      db.execute<{ returns: number }>(sql`select count(*)::int as returns from returns r join orders o on o.id = r.order_id where ${c.orders()} and ${c.between(sql`r.requested_at`, 'prev')}`),
      db.execute<{ k: string; v: number }>(sql`select ${c.day(sql`r.requested_at`, c.range.grain)}::text as k, count(*)::int as v from ${RETURNS(c)} group by 1`),
      db.execute<{ k: string; returns: number; units: number }>(sql`
        select coalesce(ri.reason, r.reason) as k, count(distinct r.id)::int as returns, coalesce(sum(ri.quantity), 0)::int as units
        from returns r join orders o on o.id = r.order_id left join return_items ri on ri.return_id = r.id
        where ${c.orders()} and ${c.between(sql`r.requested_at`)} group by 1 order by 3 desc, 2 desc`),
      db.execute<{ resolution: string; method: string; returns: number; amount: number; bonus: number }>(sql`
        select r.resolution, r.refund_method as method, count(*)::int as returns, coalesce(sum(${c.egp(sql`r.amount`, sql`r.currency`)}), 0)::float8 as amount, coalesce(sum(${c.egp(sql`r.bonus`, sql`r.currency`)}), 0)::float8 as bonus
        from ${RETURNS(c)} group by 1, 2 order by 3 desc`),
      db.execute<{ stage: string; returns: number }>(sql`select r.stage, count(*)::int as returns from ${RETURNS(c)} group by 1`),
      db.execute<{ units: number }>(sql`
        select coalesce(sum(oi.quantity), 0)::int as units from orders o join order_items oi on oi.order_id = o.id
        where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}`),
    ]);
    const t = tot.rows[0];
    const R = n(t?.returns);
    const reasonTotal = reasons.rows.reduce((a, x) => a + n(x.units), 0);
    return {
      figures: [
        { label: 'Returns opened', value: R, fmt: 'int', prev: n(prevTot.rows[0]?.returns), better: 'down' },
        { label: 'Pieces returned', value: n(t?.units), fmt: 'int' },
        { label: 'Return rate', value: ratio(n(t?.units), n(sold.rows[0]?.units)), fmt: 'pct', better: 'down', note: 'pieces returned of pieces sold in the period' },
        ...(c.money ? [{ label: 'Money back', value: Math.round(n(t?.amount)), fmt: 'money' as const, better: 'down' as const }, { label: 'Store-credit bonus given', value: Math.round(n(t?.bonus)), fmt: 'money' as const, note: 'the extra for taking credit' }] : []),
        { label: 'Top reason', value: reasons.rows[0] ? reasonLabel(reasons.rows[0].k) : '—', fmt: 'text', note: reasons.rows[0] ? `${Math.round((n(reasons.rows[0].units) / Math.max(1, reasonTotal)) * 100)}% of pieces` : undefined },
      ],
      charts: [
        { kind: 'trend', title: `Returns opened by ${c.range.grain}`, labels: keys, series: [{ name: 'Returns', values: series(keys, trend.rows.map((x) => ({ k: x.k, v: n(x.v) }))), measure: 'units' }] },
        { kind: 'bars', title: 'Why customers return', rows: reasons.rows.map((x) => ({ label: reasonLabel(x.k), value: n(x.units), units: n(x.units), sub: `${Math.round((n(x.units) / Math.max(1, reasonTotal)) * 100)}%` })), fmt: 'int' },
      ],
      tables: [
        {
          title: 'By reason',
          columns: [{ key: 'reason', label: 'Reason', fmt: 'text', wide: true }, { key: 'returns', label: 'Returns', fmt: 'int', total: true }, { key: 'units', label: 'Pieces', fmt: 'int', total: true }, { key: 'share', label: 'Share', fmt: 'pct' }],
          rows: reasons.rows.map((x) => ({ reason: reasonLabel(x.k), returns: n(x.returns), units: n(x.units), share: shareOf(n(x.units), reasonTotal) })),
        },
        {
          title: 'By outcome and refund method',
          columns: [
            { key: 'resolution', label: 'Outcome', fmt: 'text' },
            { key: 'method', label: 'Money goes', fmt: 'text', wide: true },
            { key: 'returns', label: 'Returns', fmt: 'int', total: true },
            ...(c.money ? [{ key: 'amount', label: 'Amount', fmt: 'money' as const, total: true }, { key: 'bonus', label: 'Of which bonus', fmt: 'money' as const, total: true }] : []),
          ],
          rows: methods.rows.map((x) => ({ resolution: RESOLUTION[x.resolution] ?? x.resolution, method: METHOD[x.method] ?? x.method, returns: n(x.returns), amount: c.money ? Math.round(n(x.amount)) : null, bonus: c.money ? Math.round(n(x.bonus)) : null })),
        },
        {
          title: 'Where they are now',
          columns: [{ key: 'stage', label: 'Stage', fmt: 'text', wide: true }, { key: 'returns', label: 'Returns', fmt: 'int', total: true }],
          rows: stages.rows.map((x) => ({ stage: RETURN_STAGE[x.stage as ReturnStage]?.label ?? x.stage, returns: n(x.returns) })).sort((a, b) => b.returns - a.returns),
        },
      ],
      empty: R ? undefined : 'No returns opened in this period.',
    };
  },
};

const byProduct: Report = {
  id: 'returns-by-product',
  group: 'returns',
  title: 'Return rate by brand, style and size',
  blurb: 'Of the pieces sold in the period, how many came back: by brand, category, style and size, to spot fit and quality problems.',
  for: ['brand', 'management'],
  filters: ['channel', 'brand', 'category'],
  async run(c) {
    const db = await getDb();
    const q = (key: string) =>
      db.execute<{ k: string; sold: number; returned: number }>(sql`
        select ${sql.raw(key)} as k, coalesce(sum(oi.quantity), 0)::int as sold, coalesce(sum(ri.q), 0)::int as returned
        from orders o join order_items oi on oi.order_id = o.id
        left join (select order_item_id, sum(quantity) as q from return_items group by 1) ri on ri.order_item_id = oi.id
        where ${c.orders()} and ${c.items()} and ${SOLD()} and ${c.between(sql`o.placed_at`)}
        group by 1`);
    const [brands, cats, styles, sizes] = await Promise.all([q(`coalesce(oi.brand, '—')`), q(`coalesce(nullif(oi.category, ''), 'Uncategorised')`), q(`oi.title || ' · ' || coalesce(oi.brand, '')`), q(`coalesce(nullif(oi.size, ''), 'One size')`)]);
    const rows = (xs: { k: string; sold: number; returned: number }[], min = 0) =>
      xs
        .filter((x) => n(x.sold) >= min)
        .map<Row>((x) => ({ name: x.k, sold: n(x.sold), returned: n(x.returned), rate: ratio(n(x.returned), n(x.sold)) }))
        .sort((a, b) => n(b.rate) - n(a.rate) || n(b.returned) - n(a.returned));
    const cols = (label: string): Col[] => [
      { key: 'name', label, fmt: 'text', wide: true },
      { key: 'sold', label: 'Sold', fmt: 'int', total: true },
      { key: 'returned', label: 'Returned', fmt: 'int', total: true },
      { key: 'rate', label: 'Return rate', fmt: 'pct' },
    ];
    const S = brands.rows.reduce((a, x) => a + n(x.sold), 0);
    const Rt = brands.rows.reduce((a, x) => a + n(x.returned), 0);
    const b = rows(brands.rows);
    return {
      figures: [
        { label: 'Return rate', value: ratio(Rt, S), fmt: 'pct', better: 'down' },
        { label: 'Pieces sold', value: S, fmt: 'int' },
        { label: 'Pieces returned', value: Rt, fmt: 'int' },
        { label: 'Most returned brand', value: b.find((x) => n(x.returned) > 0)?.name ?? '—', fmt: 'text' },
      ],
      charts: [{ kind: 'bars', title: 'Return rate by brand', rows: b.filter((x) => n(x.sold) > 0).slice(0, 15).map((x) => ({ label: String(x.name), value: n(x.rate), sub: `${x.returned} of ${x.sold}` })), fmt: 'pct' }],
      tables: [
        { title: 'By brand', columns: cols('Brand'), rows: b },
        { title: 'By category', columns: cols('Category'), rows: rows(cats.rows) },
        { title: 'By size', columns: cols('Size'), rows: rows(sizes.rows) },
        { title: 'By style', sub: 'Styles with 3 or more pieces sold, highest rate first', columns: cols('Style'), rows: rows(styles.rows, 3), limit: 200 },
      ],
      notes: ['Returns are counted against the orders they came from, so a period’s rate keeps rising for a few weeks as late returns come in.'],
      empty: S ? undefined : 'No sales in this period.',
    };
  },
};

const cancellations: Report = {
  id: 'cancellations',
  floor: true,
  wholeOrders: true,
  group: 'returns',
  title: 'Cancellations and refusals',
  blurb: 'Orders cancelled before shipping and parcels refused at the door: how many, how much, why, by store and payment method.',
  for: ['finance', 'ops', 'management'],
  filters: ['channel'],
  async run(c) {
    const db = await getDb();
    const [byReason, byStore, totals] = await Promise.all([
      db.execute<{ kind: string; reason: string; orders: number; value: number }>(sql`
        select case when o.stage = 'cancelled' then 'Cancelled' else 'Refused at the door' end as kind, coalesce(nullif(o.cancel_reason, ''), nullif(o.exception, ''), 'No reason given') as reason,
          count(*)::int as orders, coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}), 0)::float8 as value
        from orders o where ${c.orders()} and o.stage in ('cancelled', 'rto', 'rto_closed') and ${c.between(sql`o.placed_at`)}
        group by 1, 2 order by 3 desc`),
      db.execute<{ channel: string; method: string; all: number; cancelled: number; refused: number }>(sql`
        select o.channel_id as channel, o.payment_method as method, count(*)::int as all,
          count(*) filter (where o.stage = 'cancelled')::int as cancelled, count(*) filter (where o.stage in ('rto', 'rto_closed'))::int as refused
        from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`)} group by 1, 2`),
      db.execute<{ all: number; cancelled: number; refused: number; paid_open: number; paid_open_value: number }>(sql`
        select count(*)::int as all, count(*) filter (where o.stage = 'cancelled')::int as cancelled, count(*) filter (where o.stage in ('rto', 'rto_closed'))::int as refused,
          count(*) filter (where o.stage = 'cancelled' and o.payment_status = 'paid')::int as paid_open,
          coalesce(sum(${c.egp(sql`o.total`, sql`o.currency`)}) filter (where o.stage = 'cancelled' and o.payment_status = 'paid'), 0)::float8 as paid_open_value
        from orders o where ${c.orders()} and ${c.between(sql`o.placed_at`)}`),
    ]);
    const t = totals.rows[0];
    return {
      figures: [
        { label: 'Cancelled', value: n(t?.cancelled), fmt: 'int', better: 'down', note: n(t?.all) ? `${Math.round((n(t?.cancelled) / n(t?.all)) * 100)}% of orders` : undefined },
        { label: 'Refused at the door', value: n(t?.refused), fmt: 'int', better: 'down', note: n(t?.all) ? `${Math.round((n(t?.refused) / n(t?.all)) * 100)}% of orders` : undefined },
        ...(c.payments ? [{ label: 'Cancelled but still paid', value: n(t?.paid_open), fmt: 'int' as const, better: 'down' as const, note: 'to refund: Finance → Cancelled, paid' }, { label: 'Owed back', value: Math.round(n(t?.paid_open_value)), fmt: 'money' as const }] : []),
      ],
      charts: [{ kind: 'bars', title: 'Why', rows: byReason.rows.map((x) => ({ label: cancelLabel(x.reason), value: n(x.orders), units: n(x.orders), sub: x.kind })), fmt: 'int' }],
      tables: [
        {
          title: 'By reason',
          columns: [{ key: 'kind', label: '', fmt: 'text' }, { key: 'reason', label: 'Reason', fmt: 'text', wide: true }, { key: 'orders', label: 'Orders', fmt: 'int', total: true }, ...(c.money ? [{ key: 'value', label: 'Order value', fmt: 'money' as const, total: true }] : [])],
          rows: byReason.rows.map((x) => ({ kind: x.kind, reason: cancelLabel(x.reason), orders: n(x.orders), value: c.money ? Math.round(n(x.value)) : null })),
        },
        {
          title: 'By store and payment method',
          columns: [
            { key: 'store', label: 'Store', fmt: 'text' },
            { key: 'method', label: 'Payment', fmt: 'text' },
            { key: 'all', label: 'Orders', fmt: 'int', total: true },
            { key: 'cancelled', label: 'Cancelled', fmt: 'int', total: true },
            { key: 'cRate', label: 'Cancel rate', fmt: 'pct' },
            { key: 'refused', label: 'Refused', fmt: 'int', total: true },
            { key: 'rRate', label: 'Refusal rate', fmt: 'pct' },
          ],
          rows: byStore.rows.map((x) => ({ store: channelLabel(x.channel), method: payLabel(x.method), all: n(x.all), cancelled: n(x.cancelled), cRate: ratio(n(x.cancelled), n(x.all)), refused: n(x.refused), rRate: ratio(n(x.refused), n(x.all)) })).sort((a, b) => b.all - a.all),
        },
      ],
      empty: n(t?.all) ? undefined : 'No orders in this period.',
    };
  },
};

export const RETURN_REPORTS: Report[] = [overview, byProduct, cancellations];
