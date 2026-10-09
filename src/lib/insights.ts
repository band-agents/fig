import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { scope } from './queries';
import { can, type Principal } from './domain/perms';
import { ORDER_STAGE, RETURN_REASONS, type OrderStage, type ReturnReason } from './domain/stages';
import { money, num, pct } from './format';
import { span } from './domain/sla';

// "Relay noticed": plain-language findings computed from the floor's own data, each with the place to
// act on it. Nothing is invented: every sentence is a query result, and quiet days produce fewer cards.

export type Insight = {
  key: string;
  severity: 'critical' | 'warn' | 'info' | 'good';
  kicker: string;
  title: string;
  body: string;
  href?: string;
  action?: string;
  metric?: string;
};

export async function insightsFor(p: Principal): Promise<Insight[]> {
  const db = await getDb();
  const s = scope(p);
  const out: Insight[] = [];

  // 1. Bottleneck: where late work piles up
  const late = await db.execute<{ stage: string; n: number; oldest: string }>(sql`
    select stage, count(*)::int as n, min(due_at) as oldest from orders
    where ${s} and not on_hold and due_at < now() and stage not in ('settled','cancelled','rto_closed')
    group by stage order by n desc limit 3`);
  if (late.rows.length) {
    const top = late.rows[0];
    const meta = ORDER_STAGE[top.stage as OrderStage];
    const total = late.rows.reduce((a, r) => a + r.n, 0);
    const dept = meta.dept === 'care' ? 'care' : meta.dept;
    out.push({
      key: `bottleneck:${top.stage}`,
      severity: top.n >= 8 ? 'critical' : 'warn',
      kicker: 'Bottleneck',
      title: `${meta.label} is holding things up`,
      body: `${top.n} order${top.n > 1 ? 's are' : ' is'} past target here, the oldest by ${span(Date.now() - new Date(top.oldest).getTime())}.${total > top.n ? ` ${total - top.n} more are late elsewhere.` : ''}`,
      href: dept === 'none' ? '/orders?sla=late' : dept === 'care' ? '/queue/care' : `/queue/${dept}`,
      action: 'Open the queue',
      metric: String(top.n),
    });
  } else {
    out.push({ key: 'on-time', severity: 'good', kicker: 'On time', title: 'Nothing is running late', body: 'Every open order is inside its stage target right now.', metric: '0' });
  }

  // 2. Parcels the courier has gone quiet on
  const quiet = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from orders where ${s} and stage in ('shipped','delivering')
    and (exception ilike '%no courier scan%' or shipped_at < now() - interval '72 hours')`);
  if (quiet.rows[0].n > 0) {
    out.push({
      key: 'courier-quiet',
      severity: 'warn',
      kicker: 'Courier',
      title: `${quiet.rows[0].n} parcel${quiet.rows[0].n > 1 ? 's have' : ' has'} gone quiet`,
      body: 'Shipped more than three days ago with no delivery scan. Worth a chase before the customer calls.',
      href: '/queue/shipping?view=exceptions',
      action: 'See parcels',
      metric: String(quiet.rows[0].n),
    });
  }

  // 3. Refusal hotspots (COD), learned from the last 45 days
  const rto = await db.execute<{ region: string; rate: number; n: number; base: number }>(sql`
    with x as (
      select coalesce(address->>'region','') as region, (stage in ('rto','rto_closed'))::int as refused
      from orders where ${s} and payment_method = 'cod' and stage in ('delivered','settled','rto','rto_closed') and placed_at > now() - interval '45 days'
    ), b as (select avg(refused)::float8 as base from x)
    select region, avg(refused)::float8 as rate, count(*)::int as n, (select base from b) as base
    from x group by region having count(*) >= 8 order by rate desc limit 3`);
  const hot = rto.rows.filter((r) => r.base > 0 && r.rate >= r.base * 1.8);
  if (hot.length) {
    const h = hot[0];
    out.push({
      key: `rto:${h.region}`,
      severity: 'warn',
      kicker: 'Refusals',
      title: `Cash orders to ${h.region} come back ${(h.rate / h.base).toFixed(1)}× more often`,
      body: `${pct(h.rate)} of COD parcels to ${h.region} were refused (average ${pct(h.base)}).${hot[1] ? ` ${hot[1].region} is next at ${pct(hot[1].rate)}.` : ''} New COD orders from there now score higher risk and go to a confirmation call.`,
      href: '/insights#refusals',
      action: 'See refusal map',
      metric: pct(h.rate),
    });
  }

  // 4. A product that runs small (or isn't as pictured)
  const fit = await db.execute<{ title: string; brand: string; reason: string; n: number; sold: number; image: string | null }>(sql`
    with sold as (
      select i.title, max(i.brand) as brand, max(i.image) as image, sum(i.quantity)::int as sold
      from order_items i join orders o on o.id = i.order_id
      where ${scope(p, sql`o.channel_id`)} and o.stage in ('delivered','settled') and o.placed_at > now() - interval '45 days'
      group by i.title
    ), back as (
      select i.title, r.reason, count(*)::int as n
      from return_items ri join returns r on r.id = ri.return_id join order_items i on i.id = ri.order_item_id
      where ${scope(p, sql`r.channel_id`)} and r.requested_at > now() - interval '45 days'
      group by i.title, r.reason
    )
    select back.title, sold.brand, back.reason, back.n, sold.sold, sold.image from back join sold using (title)
    where back.n >= 3 and back.reason in ('too_small','too_large','not_as_pictured','quality') and back.n::float / greatest(sold.sold,1) >= 0.25
    order by back.n::float / greatest(sold.sold,1) desc limit 1`);
  if (fit.rows.length) {
    const f = fit.rows[0];
    const why = RETURN_REASONS[f.reason as ReturnReason].toLowerCase();
    out.push({
      key: `fit:${f.title}`,
      severity: 'warn',
      kicker: 'Returns',
      title: `${f.title} keeps coming back ${why}`,
      body: `${f.n} of ${f.sold} sold were returned as ${why}. ${f.reason === 'too_small' ? 'A “runs small, size up” note on the product page usually cuts this in half.' : f.reason === 'too_large' ? 'A “runs large” note on the product page would help.' : 'Check the photos and description against the real piece.'}`,
      href: '/insights#returns',
      action: 'See return reasons',
      metric: `${f.n}/${f.sold}`,
    });
  }

  // 5. Cash: short remittances, and cash still with the courier
  if (can(p, 'money', 2)) {
    const short = await db.execute<{ reference: string; diff: number; currency: string; n: number }>(sql`
      select s.reference, (s.expected - s.remitted)::bigint as diff, s.currency,
        (select count(*)::int from orders o where o.settlement_id = s.id and o.stage = 'delivered') as n
      from settlements s where s.status = 'discrepancy' order by s.created_at desc limit 1`);
    if (short.rows.length) {
      const d = short.rows[0];
      out.push({
        key: `short:${d.reference}`,
        severity: 'critical',
        kicker: 'Cash',
        title: `Aramex remittance ${d.reference.replace('ARX-EG-', '')} is short`,
        body: `${money(Number(d.diff), d.currency)} missing across ${d.n} order${d.n === 1 ? '' : 's'} marked delivered. Raise it with the courier before the next cycle.`,
        href: '/finance',
        action: 'Reconcile',
        metric: money(Number(d.diff), d.currency, { compact: true }),
      });
    }
    const held = await db.execute<{ currency: string; total: number; n: number }>(sql`
      select currency, sum(total)::bigint as total, count(*)::int as n from orders
      where ${s} and stage = 'delivered' and payment_method = 'cod' group by currency`);
    for (const h of held.rows) {
      out.push({
        key: `cash-out:${h.currency}`,
        severity: 'info',
        kicker: 'Cash',
        title: `${money(Number(h.total), h.currency, { compact: true })} is with the courier`,
        body: `Collected on ${num(h.n)} delivered orders and not yet remitted. It settles on the next Aramex cycle (Sundays and Wednesdays).`,
        href: '/finance',
        action: 'Open cash',
        metric: num(h.n),
      });
    }
  }

  // 6. Try-at-home baskets waiting for a call
  const bracket = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from orders where ${s} and stage in ('new','confirming') and risk_reasons @> '[{"code":"bracketing"}]'::jsonb`);
  if (bracket.rows[0].n > 0) {
    out.push({
      key: 'bracketing',
      severity: 'info',
      kicker: 'Confirmation',
      title: `${bracket.rows[0].n} basket${bracket.rows[0].n > 1 ? 's have' : ' has'} one item in several sizes`,
      body: 'Classic try-on-and-return. Ask which size they want before it ships: it saves a return trip both ways.',
      href: '/queue/care',
      action: 'Call them',
      metric: String(bracket.rows[0].n),
    });
  }

  // 7. Holds
  const holds = await db.execute<{ n: number; oldest: string }>(sql`select count(*)::int as n, min(stage_at) as oldest from orders where ${s} and on_hold`);
  if (holds.rows[0].n > 0) {
    out.push({
      key: 'holds',
      severity: 'info',
      kicker: 'On hold',
      title: `${holds.rows[0].n} order${holds.rows[0].n > 1 ? 's are' : ' is'} paused`,
      body: 'Holds stop the clock but not the customer’s patience. Review them before the end of the day.',
      href: '/orders?view=held',
      action: 'Review holds',
      metric: String(holds.rows[0].n),
    });
  }

  // 8. Autopilot: hand-offs nobody had to touch this week
  const auto = await db.execute<{ auto: number; all: number }>(sql`
    select count(*) filter (where e.actor_name = 'Relay Autopilot')::int as auto, count(*)::int as all
    from events e join orders o on o.id = e.order_id
    where ${scope(p, sql`o.channel_id`)} and e.kind = 'stage' and e.at > now() - interval '7 days'
      and e.to_stage in ('confirming','finance','ready','settled')`);
  const a = auto.rows[0];
  if (a.all > 0 && a.auto > 0) {
    out.push({
      key: 'autopilot',
      severity: 'good',
      kicker: 'Autopilot',
      title: `${pct(a.auto / a.all)} of hand-offs cleared themselves`,
      body: `${num(a.auto)} approvals and routings this week needed no one, about ${Math.round((a.auto * 2.5) / 60)} hours of clicking saved. The rest went to people because they needed judgement.`,
      href: '/rules',
      action: 'Tune the rules',
      metric: num(a.auto),
    });
  }

  const rank = { critical: 0, warn: 1, info: 2, good: 3 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
