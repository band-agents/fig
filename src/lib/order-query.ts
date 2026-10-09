import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import { scope } from './queries';
import { can, maskName, type Principal } from './domain/perms';

export type OrderFilters = {
  view?: string; // open | attention | late | held | risk | cod | delivered | closed | all
  q?: string;
  channel?: string;
  stage?: string;
  pay?: string;
  risk?: string;
  sla?: string;
  sort?: string; // new | old | due | value | risk
  page?: number;
  limit?: number;
};

export const VIEWS = [
  { key: 'open', label: 'In motion' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'risk', label: 'High risk' },
  { key: 'cod', label: 'Cash on delivery' },
  { key: 'held', label: 'On hold' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'Everything' },
] as const;

export function filterSql(p: Principal, f: OrderFilters): SQL {
  const parts: SQL[] = [scope(p, sql`o.channel_id`)];
  switch (f.view ?? 'open') {
    case 'open':
      parts.push(sql`o.stage not in ('settled','cancelled','rto_closed','delivered')`);
      break;
    case 'attention':
      parts.push(sql`o.stage not in ('settled','cancelled','rto_closed') and (o.on_hold or o.exception is not null or (o.due_at < now() and not o.on_hold) or (o.risk_level = 'high' and o.stage in ('new','confirming','finance')))`);
      break;
    case 'late':
      parts.push(sql`not o.on_hold and o.due_at < now() and o.stage not in ('settled','cancelled','rto_closed')`);
      break;
    case 'held':
      parts.push(sql`o.on_hold`);
      break;
    case 'risk':
      parts.push(sql`o.risk_level in ('high','medium') and o.stage not in ('settled','cancelled','rto_closed')`);
      break;
    case 'cod':
      parts.push(sql`o.payment_method = 'cod' and o.stage not in ('settled','cancelled','rto_closed')`);
      break;
    case 'delivered':
      parts.push(sql`o.stage = 'delivered'`);
      break;
    case 'closed':
      parts.push(sql`o.stage in ('settled','cancelled','rto_closed')`);
      break;
  }
  if (f.channel) parts.push(sql`o.channel_id = ${f.channel}`);
  if (f.stage) parts.push(sql`o.stage = ${f.stage}`);
  if (f.pay) parts.push(sql`o.payment_method = ${f.pay}`);
  if (f.risk) parts.push(sql`o.risk_level = ${f.risk}`);
  if (f.sla === 'late') parts.push(sql`not o.on_hold and o.due_at < now()`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_]/g, '')}%`;
    const digits = f.q.replace(/\D/g, '');
    const pii = can(p, 'customers', 1);
    parts.push(sql`(o.number ilike ${like} or o.tracking ilike ${like}
      ${pii ? sql`or o.customer_name ilike ${like} or o.email ilike ${like} or o.address->>'city' ilike ${like} or o.address->>'region' ilike ${like}` : sql``}
      ${pii && digits.length >= 6 ? sql`or o.phone like ${`%${digits.slice(-9)}%`}` : sql``}
      or exists (select 1 from order_items i where i.order_id = o.id and (i.title ilike ${like} or i.sku ilike ${like} or i.brand ilike ${like})))`);
  }
  return sql.join(parts, sql` and `);
}

const SORT: Record<string, SQL> = {
  new: sql`o.placed_at desc`,
  old: sql`o.placed_at asc`,
  due: sql`o.on_hold asc, o.due_at asc nulls last`,
  value: sql`o.total desc`,
  risk: sql`o.risk desc, o.placed_at desc`,
};

export type OrderRow = {
  id: string;
  number: string;
  channelId: string;
  placedAt: Date;
  customer: string;
  city: string | null;
  phone: string | null;
  currency: string;
  total: number | null;
  paymentMethod: string;
  paymentStatus: string;
  stage: string;
  stageAt: Date;
  dueAt: Date | null;
  onHold: boolean;
  holdReason: string | null;
  exception: string | null;
  risk: number;
  riskLevel: string;
  riskReasons: { code: string; label: string; weight: number }[];
  items: number;
  images: (string | null)[];
  lines: { title: string; size: string | null; image: string | null; quantity: number; sku: string | null; brand: string | null }[];
  tracking: string | null;
  courier: string | null;
  assignee: string | null;
  vip: boolean;
  history: { orders: number; delivered: number; refused: number; returned: number } | null;
};

export async function listOrders(p: Principal, f: OrderFilters) {
  const db = await getDb();
  const where = filterSql(p, f);
  const limit = Math.min(f.limit ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  const order = SORT[f.sort ?? (f.view === 'attention' ? 'due' : 'new')] ?? SORT.new;
  const [rows, count] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select o.*, u.name as assignee_name, c.vip, c.orders as c_orders, c.delivered as c_delivered, c.refused as c_refused, c.returned as c_returned,
        coalesce((select json_agg(json_build_object('title', i.title, 'size', i.size, 'image', i.image, 'quantity', i.quantity, 'sku', i.sku, 'brand', i.brand) order by i.id) from order_items i where i.order_id = o.id), '[]') as lines
      from orders o
      left join users u on u.id = o.assignee_id
      left join customers c on c.id = o.customer_id
      where ${where} order by ${order} limit ${limit} offset ${(page - 1) * limit}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from orders o where ${where}`),
  ]);
  const pii = can(p, 'customers', 1);
  const contact = can(p, 'customers', 2);
  const seesMoney = can(p, 'money', 1);
  const out: OrderRow[] = rows.rows.map((r) => {
    const lines = (typeof r.lines === 'string' ? JSON.parse(r.lines) : r.lines) as OrderRow['lines'];
    const address = r.address as { city?: string } | null;
    return {
      id: r.id as string,
      number: r.number as string,
      channelId: r.channel_id as string,
      placedAt: new Date(r.placed_at as string),
      customer: pii ? (r.customer_name as string) : maskName(r.customer_name as string),
      city: pii ? (address?.city ?? null) : null,
      phone: contact ? ((r.phone as string) ?? null) : null,
      currency: r.currency as string,
      total: seesMoney ? Number(r.total) : null,
      paymentMethod: r.payment_method as string,
      paymentStatus: r.payment_status as string,
      stage: r.stage as string,
      stageAt: new Date(r.stage_at as string),
      dueAt: r.due_at ? new Date(r.due_at as string) : null,
      onHold: Boolean(r.on_hold),
      holdReason: (r.hold_reason as string) ?? null,
      exception: (r.exception as string) ?? null,
      risk: Number(r.risk),
      riskLevel: r.risk_level as string,
      riskReasons: (r.risk_reasons as OrderRow['riskReasons']) ?? [],
      items: Number(r.items),
      images: lines.map((l) => l.image),
      lines,
      tracking: (r.tracking as string) ?? null,
      courier: (r.courier as string) ?? null,
      assignee: (r.assignee_name as string) ?? null,
      vip: Boolean(r.vip),
      history: r.c_orders != null ? { orders: Number(r.c_orders), delivered: Number(r.c_delivered), refused: Number(r.c_refused), returned: Number(r.c_returned) } : null,
    };
  });
  return { rows: out, total: count.rows[0].n, page, limit };
}

export async function viewCounts(p: Principal) {
  const db = await getDb();
  const s = scope(p, sql`o.channel_id`);
  const r = await db.execute<Record<string, number>>(sql`
    select
      count(*) filter (where o.stage not in ('settled','cancelled','rto_closed','delivered'))::int as open,
      count(*) filter (where o.stage not in ('settled','cancelled','rto_closed') and (o.on_hold or o.exception is not null or (o.due_at < now() and not o.on_hold) or (o.risk_level = 'high' and o.stage in ('new','confirming','finance'))))::int as attention,
      count(*) filter (where o.risk_level in ('high','medium') and o.stage not in ('settled','cancelled','rto_closed'))::int as risk,
      count(*) filter (where o.payment_method = 'cod' and o.stage not in ('settled','cancelled','rto_closed'))::int as cod,
      count(*) filter (where o.on_hold)::int as held,
      count(*) filter (where o.stage = 'delivered')::int as delivered,
      count(*) filter (where o.stage in ('settled','cancelled','rto_closed'))::int as closed,
      count(*)::int as all
    from orders o where ${s}`);
  return r.rows[0];
}
