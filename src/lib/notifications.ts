import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import { canSee, can, type Page, type Principal } from './domain/perms';
import { ORDER_STAGE, RETURN_STAGE, type OrderStage, type ReturnStage } from './domain/stages';
import { scope } from './queries';

/**
 * The bell (Dan, 24 Oct: "smart, intelligent, effective, practical, needed"). Not every queue count:
 * only what this person should act on, in the queues they work.
 *
 * - Late: in their own queues, the oldest overdue orders and returns by name, each one click away.
 * - New: work that just arrived in their queues, and courier problems, since they last looked
 *   (the browser remembers when; nothing others did on work that is not theirs).
 * - Yours: orders assigned to them, their open stock tasks.
 *
 * The badge counts what needs them: everything late, everything yours, and what is new.
 */

export type Note = { id: string; tone: 'critical' | 'warn' | 'info'; title: string; detail: string; href: string; at: string };
export type Notifications = { late: Note[]; lateTotal: number; recent: Note[]; mine: Note[] };

/** The queues a page stands for: the order and return stages that land in it. */
const QUEUES: { page: Page; label: string; orders: OrderStage[]; returns: ReturnStage[] }[] = [
  { page: 'pick', label: 'Pick & pack', orders: ['ready', 'picking'], returns: [] },
  { page: 'shipping', label: 'Shipping', orders: ['packed', 'shipped', 'delivering'], returns: ['approved', 'pickup', 'in_transit'] },
  { page: 'returns', label: 'Returns', orders: ['rto'], returns: ['requested', 'received', 'inspected'] },
  { page: 'financeQueue', label: 'Finance', orders: ['finance'], returns: ['refund_pending'] },
];

const hoursText = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

export async function notificationsFor(p: Principal): Promise<Notifications> {
  const db = await getDb();
  const mine = QUEUES.filter((q) => canSee(p, q.page));
  const orderStages = [...new Set(mine.flatMap((q) => q.orders))];
  const returnStages = [...new Set(mine.flatMap((q) => q.returns))];
  const so = scope(p, sql`o.channel_id`, sql`o.id`);
  const sr = scope(p, sql`r.channel_id`, sql`r.order_id`);
  const none = sql`false`;
  const inStages = (col: SQL, xs: string[]) => (xs.length ? sql`${col} in (${list(xs)})` : none);
  const careLike = canSee(p, 'orders') && (can(p, 'intake', 1) || can(p, 'orders', 2));

  const [lateOrders, lateReturns, counts, arrivedOrders, arrivedReturns, problems, assigned, tasks, store] = await Promise.all([
    db.execute<{ id: string; number: string; stage: string; hours: number }>(sql`
      select o.id, o.number, o.stage, extract(epoch from now() - o.due_at)::float8 / 3600 as hours
      from orders o where ${so} and ${inStages(sql`o.stage`, orderStages)} and not o.on_hold and o.due_at < now()
      order by o.due_at asc limit 6`),
    db.execute<{ id: string; number: string; stage: string; hours: number }>(sql`
      select r.id, r.number, r.stage, extract(epoch from now() - r.due_at)::float8 / 3600 as hours
      from returns r where ${sr} and ${inStages(sql`r.stage`, returnStages)} and r.due_at < now()
      order by r.due_at asc limit 4`),
    db.execute<{ n: number }>(sql`
      select ((select count(*) from orders o where ${so} and ${inStages(sql`o.stage`, orderStages)} and not o.on_hold and o.due_at < now())
        + (select count(*) from returns r where ${sr} and ${inStages(sql`r.stage`, returnStages)} and r.due_at < now()))::int as n`),
    // new work in their queues, in the last two days: an order arriving in one of their stages, moved there by someone else
    db.execute<{ id: string; order_id: string; number: string; to_stage: string; at: string; actor: string }>(sql`
      select distinct on (e.order_id) e.id, e.order_id, o.number, e.to_stage, e.at::text as at, e.actor_name as actor
      from events e join orders o on o.id = e.order_id
      where ${so} and e.kind = 'stage' and e.return_id is null and ${inStages(sql`e.to_stage`, orderStages)} and e.to_stage = o.stage
        and e.at > now() - interval '48 hours' and e.actor_id is distinct from ${p.id}
      order by e.order_id, e.at desc limit 40`),
    db.execute<{ id: string; number: string; stage: string; at: string; reason: string | null }>(sql`
      select r.id, r.number, r.stage, r.stage_at::text as at, r.reason
      from returns r where ${sr} and ${inStages(sql`r.stage`, returnStages)} and r.stage_at > now() - interval '48 hours'
      order by r.stage_at desc limit 20`),
    // problems the customer will feel: the courier could not deliver, an order went on hold
    careLike || canSee(p, 'shipping')
      ? db.execute<{ id: string; number: string; exception: string | null; hold: string | null; at: string }>(sql`
          select o.id, o.number, o.exception, case when o.on_hold then o.hold_reason end as hold, o.updated_at::text as at
          from orders o where ${so} and (o.exception is not null or o.on_hold) and o.stage not in ('settled','cancelled','rto_closed')
            and o.updated_at > now() - interval '72 hours'
          order by o.updated_at desc limit 12`)
      : Promise.resolve({ rows: [] as { id: string; number: string; exception: string | null; hold: string | null; at: string }[] }),
    db.execute<{ id: string; number: string; stage: string; at: string }>(sql`
      select o.id, o.number, o.stage, o.stage_at::text as at from orders o
      where ${so} and o.assignee_id = ${p.id} and o.stage not in ('settled','cancelled','rto_closed','delivered')
      order by o.due_at asc nulls last limit 10`),
    db.execute<{ id: string; number: string; title: string; due_at: string | null; priority: number; status: string }>(sql`
      select t.id, t.number, t.title, t.due_at::text as due_at, t.priority, t.status from tasks t
      where t.assignee_id = ${p.id} and t.status in ('open','doing','blocked')
      order by t.priority asc, t.due_at asc nulls last limit 10`),
    // the store refused an update sent from here: someone has to retry it or fix it in Shopify
    careLike || canSee(p, 'shipping') || canSee(p, 'financeQueue')
      ? db.execute<{ id: string; order_id: string; number: string; message: string; at: string }>(sql`
          select e.id, e.order_id, o.number, e.message, e.at::text as at from events e join orders o on o.id = e.order_id
          where ${so} and e.kind = 'sync' and (e.data->>'failed') = 'true' and e.at > now() - interval '48 hours'
          order by e.at desc limit 10`)
      : Promise.resolve({ rows: [] as { id: string; order_id: string; number: string; message: string; at: string }[] }),
  ]);

  const late: Note[] = [
    ...lateOrders.rows.map((o) => ({ id: `lo:${o.id}`, tone: 'critical' as const, title: `${o.number} · ${hoursText(o.hours)} late`, detail: ORDER_STAGE[o.stage as OrderStage]?.label ?? o.stage, href: `/orders/${o.id}`, at: '' })),
    ...lateReturns.rows.map((r) => ({ id: `lr:${r.id}`, tone: 'critical' as const, title: `${r.number} · ${hoursText(r.hours)} late`, detail: `Return ${RETURN_STAGE[r.stage as ReturnStage]?.label.toLowerCase() ?? r.stage}`, href: `/returns/${r.id}`, at: '' })),
  ];

  const recent: Note[] = [
    ...arrivedOrders.rows.map((e) => ({ id: `ao:${e.id}`, tone: 'info' as const, title: `${e.number} → ${ORDER_STAGE[e.to_stage as OrderStage]?.label ?? e.to_stage}`, detail: `by ${e.actor}`, href: `/orders/${e.order_id}`, at: e.at })),
    ...arrivedReturns.rows.map((r) => ({ id: `ar:${r.id}:${r.stage}`, tone: (r.stage === 'requested' || r.stage === 'refund_pending' ? 'warn' : 'info') as Note['tone'], title: `${r.number} · ${RETURN_STAGE[r.stage as ReturnStage]?.label ?? r.stage}`, detail: r.reason ? r.reason.replace(/_/g, ' ') : 'Return', href: `/returns/${r.id}`, at: r.at })),
    ...store.rows.map((e) => ({ id: `sf:${e.id}`, tone: 'critical' as const, title: `${e.number} · Shopify did not take it`, detail: e.message.replace(/^Shopify failed · /, ''), href: `/orders/${e.order_id}`, at: e.at })),
    ...problems.rows.map((o) => ({ id: `pb:${o.id}:${o.exception ?? o.hold}`, tone: (o.exception ? 'critical' : 'warn') as Note['tone'], title: `${o.number} · ${o.exception ? 'courier problem' : 'on hold'}`, detail: o.exception ?? o.hold ?? '', href: `/orders/${o.id}`, at: o.at })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 25);

  const mineNotes: Note[] = [
    ...assigned.rows.map((o) => ({ id: `as:${o.id}`, tone: 'info' as const, title: `${o.number} is yours`, detail: ORDER_STAGE[o.stage as OrderStage]?.label ?? o.stage, href: `/orders/${o.id}`, at: o.at })),
    ...tasks.rows.map((t) => ({ id: `tk:${t.id}`, tone: (t.priority <= 1 || (t.due_at && Date.parse(t.due_at) < Date.now()) ? 'warn' : 'info') as Note['tone'], title: t.title, detail: `${t.number}${t.status === 'blocked' ? ' · blocked' : t.status === 'doing' ? ' · in hand' : ''}`, href: '/stock/warehouse', at: t.due_at ?? '' })),
  ];

  return { late, lateTotal: counts.rows[0]?.n ?? 0, recent, mine: mineNotes };
}
