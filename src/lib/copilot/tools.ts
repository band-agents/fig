import 'server-only';
import { sql } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getDb } from '../db';
import { scope, stageCounts, returnStageCounts } from '../queries';
import { listOrders } from '../order-query';
import { orderDetail } from '../order-detail';
import { analytics } from '../analytics';
import { insightsFor } from '../insights';
import { can, type Principal } from '../domain/perms';
import { ORDER_STAGE, RETURN_REASONS, type OrderStage, type ReturnReason } from '../domain/stages';
import { channelLabel, CHANNELS } from '../channels';
import { money, pct } from '../format';
import { span } from '../domain/sla';

// Ask Relay's tools. Each one runs with the asker's own access: masked names stay masked, hidden money
// stays hidden, and a Kuwait-only teammate only ever sees Kuwait. Results are compact JSON for the model.

export type Found = { id: string; number: string; kind: 'order' | 'return' };

const CHANNEL_IDS = CHANNELS.map((c) => c.id);

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'floor_snapshot',
    description:
      'Right-now picture of the whole floor: open orders per stage with how many are late or on hold, open returns per stage, and the plain-language findings Relay computed (bottlenecks, refusal hotspots, products that run small, short courier remittances). Call this first for any "what needs attention" or general status question.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_orders',
    description:
      'Search and filter orders. Use for questions like "which Kuwait orders are late", "high-risk cash orders waiting for confirmation", "orders for Salma", "anything with waybill 412…". Returns up to `limit` orders with stage, target status, risk, payment and exception.',
    input_schema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['open', 'attention', 'late', 'held', 'risk', 'cod', 'delivered', 'closed', 'all'], description: 'Preset view. "attention" = late, on hold, courier exceptions, or high-risk awaiting confirmation. Default "open".' },
        q: { type: 'string', description: 'Free text: order number, customer name, phone, city, governorate, product title, SKU, brand or waybill.' },
        channel: { type: 'string', enum: CHANNEL_IDS, description: 'Limit to one storefront.' },
        country: { type: 'string', enum: ['EG', 'KW'], description: 'Limit to Egypt or Kuwait storefronts.' },
        stage: { type: 'string', enum: Object.keys(ORDER_STAGE), description: 'Exact stage.' },
        payment: { type: 'string', enum: ['cod', 'card', 'knet', 'wallet', 'instapay'] },
        risk: { type: 'string', enum: ['high', 'medium', 'low'] },
        sort: { type: 'string', enum: ['new', 'old', 'due', 'value', 'risk'], description: '"due" = most urgent first.' },
        limit: { type: 'integer', minimum: 1, maximum: 40 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_order',
    description: 'Everything about one order by its number (e.g. "FIG-24518", "#1042"): items, customer history across stores, payment, delivery, risk reasons, returns and the latest timeline events.',
    input_schema: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'], additionalProperties: false },
  },
  {
    name: 'refusals_by_region',
    description: 'Cash-on-delivery refusal rate by governorate/area over the last 60 days, with the overall average. Use for "why are refusals up", "where do parcels get refused".',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'returns_summary',
    description: 'Returns over the last `days`: reasons, the most-returned products with return-to-sold ratio, and open returns per stage.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 120 } }, additionalProperties: false },
  },
  {
    name: 'channel_scorecard',
    description: 'Per-storefront scorecard over the last `days`: orders, sales, average order, cash share, refusal rate, return rate, time from order to shipped.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 120 } }, additionalProperties: false },
  },
  {
    name: 'compare_periods',
    description: 'Compare the last `days` with the `days` before that, per storefront: orders, sales, refused cash parcels and returns opened. Use for "how is Kuwait doing compared with last week".',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 60 } }, required: ['days'], additionalProperties: false },
  },
  {
    name: 'team_activity',
    description: 'Who moved orders in the last `hours` and how many hand-offs each, plus what Autopilot cleared. Use for team throughput questions.',
    input_schema: { type: 'object', properties: { hours: { type: 'integer', minimum: 1, maximum: 336 } }, additionalProperties: false },
  },
];

const findSchema = z.object({
  view: z.string().optional(),
  q: z.string().optional(),
  channel: z.string().optional(),
  country: z.enum(['EG', 'KW']).optional(),
  stage: z.string().optional(),
  payment: z.string().optional(),
  risk: z.string().optional(),
  sort: z.string().optional(),
  limit: z.number().int().min(1).max(40).optional(),
});

export async function runTool(p: Principal, name: string, input: unknown, found: Found[]): Promise<unknown> {
  const db = await getDb();
  const seesMoney = can(p, 'money', 1);
  switch (name) {
    case 'floor_snapshot': {
      const [stages, rets, insights] = await Promise.all([stageCounts(p), returnStageCounts(p), insightsFor(p)]);
      return {
        now: new Date().toISOString(),
        openOrdersByStage: stages.map((s) => ({ stage: ORDER_STAGE[s.stage as OrderStage]?.label ?? s.stage, open: s.n, late: s.late, dueWithinHour: s.soon, onHold: s.held, oldestEnteredAgo: s.oldest ? span(Date.now() - s.oldest.getTime()) : null })),
        openReturnsByStage: rets,
        findings: insights.map((i) => ({ severity: i.severity, title: i.title, detail: i.body })),
      };
    }
    case 'find_orders': {
      const f = findSchema.parse(input ?? {});
      const narrowed = f.country ? { ...p, channels: (p.channels.length ? p.channels : CHANNEL_IDS).filter((c) => CHANNELS.find((x) => x.id === c)?.country === f.country) } : p;
      const r = await listOrders(narrowed, { view: f.view ?? 'open', q: f.q, channel: f.channel, stage: f.stage, pay: f.payment, risk: f.risk, sort: f.sort ?? 'due', limit: f.limit ?? 15 });
      for (const o of r.rows) found.push({ id: o.id, number: o.number, kind: 'order' });
      return {
        totalMatching: r.total,
        orders: r.rows.map((o) => ({
          number: o.number,
          store: channelLabel(o.channelId),
          customer: o.customer,
          city: o.city,
          total: seesMoney && o.total != null ? money(o.total, o.currency) : undefined,
          payment: `${o.paymentMethod} (${o.paymentStatus})`,
          stage: ORDER_STAGE[o.stage as OrderStage]?.label,
          inStageFor: span(Date.now() - o.stageAt.getTime()),
          target: o.onHold ? `on hold: ${o.holdReason}` : o.dueAt ? (o.dueAt.getTime() < Date.now() ? `late by ${span(Date.now() - o.dueAt.getTime())}` : `${span(o.dueAt.getTime() - Date.now())} left`) : 'no target',
          risk: `${o.riskLevel} ${o.risk}${o.riskReasons.length ? ` (${o.riskReasons.slice(0, 3).map((x) => x.label).join('; ')})` : ''}`,
          exception: o.exception ?? undefined,
          items: o.lines.map((l) => `${l.title}${l.size ? ` [${l.size}]` : ''}${l.quantity > 1 ? ` ×${l.quantity}` : ''}`).join(', '),
          assignee: o.assignee ?? undefined,
        })),
      };
    }
    case 'get_order': {
      const { number } = z.object({ number: z.string() }).parse(input);
      const clean = number.trim().replace(/^#/, '');
      const [row] = (
        await db.execute<{ id: string }>(sql`select id from orders where ${scope(p)} and (number = ${number.trim()} or number = ${clean} or number = ${'#' + clean} or number ilike ${'%' + clean}) order by placed_at desc limit 1`)
      ).rows;
      if (!row) return { error: `No order ${number} within your access.` };
      const d = await orderDetail(p, row.id);
      if (!d) return { error: 'Not visible to you.' };
      found.push({ id: d.order.id, number: d.order.number, kind: 'order' });
      return {
        number: d.order.number,
        store: channelLabel(d.order.channelId),
        placed: d.order.placedAt,
        stage: ORDER_STAGE[d.order.stage as OrderStage]?.label,
        onHold: d.order.onHold ? d.order.holdReason : false,
        exception: d.order.exception,
        customer: { name: d.order.customerName, city: d.order.address?.city, history: d.customer ? { orders: d.customer.orders, delivered: d.customer.delivered, refused: d.customer.refused, returned: d.customer.returned, vip: d.customer.vip } : null },
        payment: { method: d.order.paymentMethod, status: d.order.paymentStatus, total: d.order.total != null ? money(d.order.total, d.order.currency) : undefined },
        delivery: { courier: d.order.courier, waybill: d.order.tracking, attempts: d.order.attempts },
        risk: { score: d.order.risk, level: d.order.riskLevel, reasons: d.order.riskReasons.map((r) => r.label) },
        items: d.lines.map((l) => ({ title: l.title, brand: l.brand, size: l.size, qty: l.quantity, finalSale: !l.returnable })),
        returns: d.returns.map((r) => ({ number: r.number, stage: r.stage, reason: RETURN_REASONS[r.reason as ReturnReason] })),
        returnPolicy: d.policy.why,
        timeline: d.events.slice(-14).map((e) => ({ at: e.at, by: e.actorName, what: e.message })),
      };
    }
    case 'refusals_by_region': {
      const a = await analytics(p, 30);
      return { last60Days: a.rto.map((r) => ({ area: r.region || 'unknown', refused: pct(r.rate, 1), cashParcels: r.n })), average: pct(a.rtoBaseline, 1) };
    }
    case 'returns_summary': {
      const { days } = z.object({ days: z.number().int().optional() }).parse(input ?? {});
      const a = await analytics(p, days ?? 30);
      const open = await returnStageCounts(p);
      return {
        days: days ?? 30,
        reasons: a.reasons.map((r) => ({ reason: RETURN_REASONS[r.reason as ReturnReason] ?? r.reason, count: r.n })),
        mostReturned: a.products.map((x) => ({ product: x.title, brand: x.brand, returned: x.back, sold: x.sold, mainReason: RETURN_REASONS[x.top_reason as ReturnReason] })),
        openByStage: open,
      };
    }
    case 'channel_scorecard': {
      const { days } = z.object({ days: z.number().int().optional() }).parse(input ?? {});
      const a = await analytics(p, days ?? 30);
      return a.channels.map((c) => ({
        store: channelLabel(c.channel_id),
        orders: c.n,
        sales: seesMoney ? money(Number(c.revenue), c.currency, { compact: true }) : undefined,
        averageOrder: seesMoney ? money(Math.round(c.aov), c.currency) : undefined,
        cashShare: c.n ? pct(c.cod / c.n) : null,
        refused: c.rtoRate == null ? null : pct(c.rtoRate, 1),
        returned: c.returnRate == null ? null : pct(c.returnRate, 1),
        orderToShipped: c.ship_h == null ? null : span(c.ship_h * 3600_000),
      }));
    }
    case 'compare_periods': {
      const { days } = z.object({ days: z.number().int().min(1).max(60) }).parse(input);
      const r = await db.execute<{ channel_id: string; currency: string; period: string; n: number; sales: number; rto: number }>(sql`
        select channel_id, max(currency) as currency,
          case when placed_at > now() - (${days} || ' days')::interval then 'current' else 'previous' end as period,
          count(*)::int as n, coalesce(sum(total) filter (where stage <> 'cancelled'), 0)::bigint as sales,
          count(*) filter (where stage in ('rto','rto_closed'))::int as rto
        from orders where ${scope(p)} and placed_at > now() - (${days * 2} || ' days')::interval
        group by 1, 3`);
      const rets = await db.execute<{ channel_id: string; period: string; n: number }>(sql`
        select channel_id, case when requested_at > now() - (${days} || ' days')::interval then 'current' else 'previous' end as period, count(*)::int as n
        from returns where ${scope(p)} and requested_at > now() - (${days * 2} || ' days')::interval group by 1, 2`);
      const ids = [...new Set(r.rows.map((x) => x.channel_id))];
      return ids.map((id) => {
        const cur = r.rows.find((x) => x.channel_id === id && x.period === 'current');
        const prev = r.rows.find((x) => x.channel_id === id && x.period === 'previous');
        const cur$ = Number(cur?.sales ?? 0);
        const prev$ = Number(prev?.sales ?? 0);
        const currency = cur?.currency ?? prev?.currency ?? 'EGP';
        return {
          store: channelLabel(id),
          orders: { current: cur?.n ?? 0, previous: prev?.n ?? 0 },
          sales: seesMoney ? { current: money(cur$, currency, { compact: true }), previous: money(prev$, currency, { compact: true }), change: prev$ ? pct((cur$ - prev$) / prev$) : null } : undefined,
          refusedParcels: { current: cur?.rto ?? 0, previous: prev?.rto ?? 0 },
          returnsOpened: { current: rets.rows.find((x) => x.channel_id === id && x.period === 'current')?.n ?? 0, previous: rets.rows.find((x) => x.channel_id === id && x.period === 'previous')?.n ?? 0 },
        };
      });
    }
    case 'team_activity': {
      const { hours } = z.object({ hours: z.number().int().optional() }).parse(input ?? {});
      const h = hours ?? 24;
      const r = await db.execute<{ actor: string; dept: string | null; n: number }>(sql`
        select e.actor_name as actor, max(e.dept) as dept, count(*)::int as n from events e join orders o on o.id = e.order_id
        where ${scope(p, sql`o.channel_id`)} and e.kind = 'stage' and e.at > now() - (${h} || ' hours')::interval
        group by 1 order by 3 desc limit 20`);
      return { hours: h, handoffs: r.rows };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
