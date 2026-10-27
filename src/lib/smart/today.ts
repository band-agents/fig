import 'server-only';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { can, canAny, type Area, type Principal } from '../domain/perms';
import { DEPTS, ORDER_STAGE, type OrderStage } from '../domain/stages';
import { span } from '../domain/sla';
import { scope } from '../queries';
import { egpMinor } from '../stock/core';
import { LEAK_AREAS, moneyLeaks } from './leaks';

/**
 * Today (Dan, 28 Oct): one list per person, across every part of the console, of what to do now and
 * what it is worth. It reads what the other screens already know (money leaks, late orders, the stock
 * suggestions, refunds, courier cash) and keeps only what this person's job can act on. Ranked by
 * money: a leak counts four weeks of itself, so a weekly loss and a sum at stake compare fairly; late
 * work goes first at the same money. "Done" hides an item for a week; if it is still true then, it
 * comes back.
 */

export type TaskKind = 'leak' | 'late' | 'suggestion' | 'refunds' | 'review' | 'cash' | 'risk';
export type Task = {
  key: string;
  kind: TaskKind;
  team: string;
  title: string;
  why: string;
  money: number; // EGP-equivalent minor
  per: 'week' | 'stake';
  href: string;
  action: string;
  late?: boolean;
  image?: string | null;
};

const DONE_FOR = 7 * 86400000;
const score = (t: Task) => (t.per === 'week' ? t.money * 4 : t.money) * (t.late ? 1.5 : 1);

export async function todayFor(p: Principal & { id: string }) {
  const db = await getDb();
  const s = scope(p, sql`o.channel_id`, sql`o.id`);
  const tasks: Task[] = [];

  // 1. the leaks this person's job fixes: the biggest few of each
  const leaks = await moneyLeaks(p);
  for (const l of leaks.leaks) {
    if (l.off || !canAny(p, LEAK_AREAS[l.key])) continue;
    // styles are each their own job; refusals, returns and cancellations are one job: the top reason
    const per = l.key === 'sizes' || l.key === 'hidden' || l.key === 'photos' || l.key === 'price' ? 3 : 1;
    for (const i of l.items.slice(0, per)) tasks.push({ key: i.key, kind: 'leak', team: l.team, title: i.title, why: `${l.short}: ${i.sub}`, money: i.weekly, per: 'week', href: i.href, action: l.fix, image: i.image });
  }

  // 2. orders past their stage target, for the queues this person works
  const late = await db.execute<{ stage: string; n: number; oldest: string; total: string; currency: string }>(sql`
    select o.stage, count(*)::int as n, min(o.due_at)::text as oldest, sum(o.total)::text as total, o.currency
    from orders o where ${s} and not o.on_hold and o.due_at < now() and o.stage not in ('settled', 'cancelled', 'rto_closed')
    group by o.stage, o.currency`);
  const byStage = new Map<string, { n: number; oldest: string; money: number }>();
  for (const r of late.rows) {
    const x = byStage.get(r.stage) ?? { n: 0, oldest: r.oldest, money: 0 };
    x.n += r.n;
    x.money += egpMinor(Number(r.total), r.currency);
    if (r.oldest < x.oldest) x.oldest = r.oldest;
    byStage.set(r.stage, x);
  }
  for (const [stage, x] of byStage) {
    const meta = ORDER_STAGE[stage as OrderStage];
    if (!meta) continue;
    const dept = meta.dept === 'none' ? null : DEPTS[meta.dept];
    if (!(dept ? can(p, dept.area, 2) : can(p, 'overview', 1))) continue;
    tasks.push({
      key: `late:${stage}`,
      kind: 'late',
      team: dept?.label ?? 'Operations',
      title: `${x.n} order${x.n === 1 ? '' : 's'} late: ${meta.verb.toLowerCase()}`,
      why: `The oldest is ${span(Date.now() - new Date(x.oldest).getTime())} past its target.`,
      money: x.money,
      per: 'stake',
      href: meta.dept === 'none' || meta.dept === 'care' ? '/orders?sla=late' : `/queue/${meta.dept}`,
      action: 'Clear the queue',
      late: true,
    });
  }

  // 3. cash orders that look likely to be refused, before they leave
  if (can(p, 'intake', 2) || can(p, 'shipping', 2)) {
    const risky = await db.execute<{ n: number; total: string; currency: string }>(sql`
      select count(*)::int as n, sum(o.total)::text as total, o.currency from orders o
      where ${s} and o.payment_method = 'cod' and o.risk_level = 'high' and o.stage in ('new', 'confirming', 'finance', 'ready', 'picking', 'packed')
      group by o.currency`);
    const n = risky.rows.reduce((a, r) => a + r.n, 0);
    if (n) tasks.push({ key: 'risk:cod', kind: 'risk', team: 'Customer care', title: `${n} cash order${n === 1 ? '' : 's'} likely to be refused`, why: 'High refusal risk and not shipped yet: confirm by phone or ask for payment first.', money: risky.rows.reduce((a, r) => a + egpMinor(Number(r.total), r.currency), 0), per: 'stake', href: '/orders?risk=high', action: 'Call before shipping' });
  }

  // 4. the stock suggestions waiting for a decision in this person's areas
  const areas = (['procurement', 'stock', 'warehouse', 'merch'] as Area[]).filter((a) => can(p, a, 2));
  if (areas.length) {
    const recs = await db
      .select()
      .from(schema.recommendations)
      .where(and(eq(schema.recommendations.status, 'open'), sql`${schema.recommendations.area} in (${sql.join(areas.map((a) => sql`${a}`), sql`, `)})`, gt(schema.recommendations.impact, 0)))
      .orderBy(sql`${schema.recommendations.impact} * ${schema.recommendations.confidence} desc`)
      .limit(6);
    for (const r of recs)
      tasks.push({ key: `rec:${r.id}`, kind: 'suggestion', team: r.area === 'procurement' ? 'Buying' : r.area === 'merch' ? 'E-commerce' : r.area === 'warehouse' ? 'Warehouse' : 'Stock & buying', title: r.title, why: r.impactLabel ?? r.body, money: Math.round((r.impact * r.confidence) / 100), per: 'stake', href: r.productId ? `/stock/inventory/${r.productId}#ai` : '/stock', action: 'Decide' });
  }

  // 5. refunds customers are waiting for
  if (can(p, 'finance', 1)) {
    const refunds = await db.execute<{ n: number; amount: string; currency: string; oldest: string }>(sql`
      select count(*)::int as n, sum(r.amount)::text as amount, r.currency, min(r.stage_at)::text as oldest
      from returns r join orders o on o.id = r.order_id where ${s} and r.stage = 'refund_pending' group by r.currency`);
    const n = refunds.rows.reduce((a, r) => a + r.n, 0);
    if (n) {
      const oldest = refunds.rows.map((r) => r.oldest).sort()[0];
      tasks.push({ key: 'refunds:pending', kind: 'refunds', team: 'Finance', title: `${n} refund${n === 1 ? '' : 's'} waiting to be paid`, why: `The oldest has waited ${span(Date.now() - new Date(oldest).getTime())}.`, money: refunds.rows.reduce((a, r) => a + egpMinor(Number(r.amount), r.currency), 0), per: 'stake', href: '/finance', action: 'Pay them', late: Date.now() - new Date(oldest).getTime() > 3 * 86400000 });
    }
    // courier cash that came in short
    const short = await db.execute<{ n: number; gap: string; currency: string }>(sql`
      select count(*)::int as n, sum(expected - coalesce(remitted, 0))::text as gap, currency from settlements where status = 'discrepancy' group by currency`);
    const m = short.rows.reduce((a, r) => a + r.n, 0);
    if (m) tasks.push({ key: 'cash:short', kind: 'cash', team: 'Finance', title: `${m} courier settlement${m === 1 ? '' : 's'} came in short`, why: 'What the courier paid does not match the cash they collected.', money: short.rows.reduce((a, r) => a + egpMinor(Math.max(0, Number(r.gap)), r.currency), 0), per: 'stake', href: '/finance', action: 'Chase the courier' });
  }

  // 6. returns customers opened themselves that nobody has looked at
  if (can(p, 'returns', 2)) {
    const open = await db.execute<{ n: number; amount: string; currency: string; oldest: string }>(sql`
      select count(*)::int as n, sum(r.amount)::text as amount, r.currency, min(r.requested_at)::text as oldest
      from returns r join orders o on o.id = r.order_id where ${s} and r.stage = 'requested' and r.review is null group by r.currency`);
    const n = open.rows.reduce((a, r) => a + r.n, 0);
    if (n) {
      const oldest = open.rows.map((r) => r.oldest).sort()[0];
      tasks.push({ key: 'review:returns', kind: 'review', team: 'Customer care', title: `${n} return request${n === 1 ? '' : 's'} to review`, why: `Opened by customers; the oldest ${span(Date.now() - new Date(oldest).getTime())} ago.`, money: open.rows.reduce((a, r) => a + egpMinor(Number(r.amount), r.currency), 0), per: 'stake', href: '/returns', action: 'Review them', late: Date.now() - new Date(oldest).getTime() > 86400000 });
    }
  }

  // what this person marked done in the last week stays out of the list
  const done = await db.select({ key: schema.dismissals.key, at: schema.dismissals.at }).from(schema.dismissals).where(and(eq(schema.dismissals.userId, p.id), sql`${schema.dismissals.key} like 'today:%'`));
  const doneKeys = new Set(done.filter((d) => Date.now() - d.at.getTime() < DONE_FOR).map((d) => d.key.slice('today:'.length)));
  const open = tasks.filter((t) => !doneKeys.has(t.key)).sort((a, b) => score(b) - score(a));
  const finished = tasks.filter((t) => doneKeys.has(t.key));
  return {
    tasks: open,
    done: finished,
    weekly: open.filter((t) => t.per === 'week').reduce((a, t) => a + t.money, 0),
    stake: open.filter((t) => t.per === 'stake').reduce((a, t) => a + t.money, 0),
    late: open.filter((t) => t.late).length,
    leaks,
  };
}

export type Today = Awaited<ReturnType<typeof todayFor>>;
