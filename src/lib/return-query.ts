import 'server-only';
import type { ReturnReview, ReviewContext } from './domain/return-review';
import { policyFor } from './domain/returns-policy';
import { CHANNEL } from './channels';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import { scope } from './queries';
import { can, maskName, type Principal } from './domain/perms';

export const RETURN_VIEWS = [
  { key: 'open', label: 'Open' },
  { key: 'requested', label: 'To approve' },
  { key: 'pickups', label: 'Coming back' },
  { key: 'desk', label: 'At the desk' },
  { key: 'refund', label: 'Refund pending' },
  { key: 'closed', label: 'Closed' },
] as const;

const VIEW_SQL: Record<string, SQL> = {
  open: sql`r.stage not in ('refunded','closed','rejected')`,
  requested: sql`r.stage = 'requested'`,
  pickups: sql`r.stage in ('approved','pickup','in_transit')`,
  desk: sql`r.stage in ('received','inspected')`,
  refund: sql`r.stage = 'refund_pending'`,
  closed: sql`r.stage in ('refunded','closed','rejected')`,
  all: sql`true`,
};

export type ReturnRow = {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  channelId: string;
  customer: string;
  city: string | null;
  phone: string | null;
  reason: string;
  reasonNote: string | null;
  resolution: string;
  method: string;
  amount: number | null;
  currency: string;
  stage: string;
  stageAt: Date;
  dueAt: Date | null;
  requestedAt: Date;
  inspection: string | null;
  tracking: string | null;
  items: { title: string; size: string | null; image: string | null; quantity: number; brand: string | null }[];
  /** What the desk recorded when it approved or declined. */
  review: ReturnReview | null;
  refundMethod: string;
  deliveredAt: Date | null;
  photos: number;
};

/** What the review form needs to know about a return: its value, how it pays back, the window, the photos. */
export function reviewContext(r: Pick<ReturnRow, 'amount' | 'currency' | 'resolution' | 'refundMethod' | 'deliveredAt' | 'requestedAt' | 'photos' | 'channelId'>): ReviewContext | null {
  if (r.amount == null) return null;
  const c = CHANNEL[r.channelId];
  const window = policyFor(c?.brand ?? 'FIG', c?.country ?? 'EG').windowDays;
  const daysLeft = r.deliveredAt ? Math.ceil(window - (r.requestedAt.getTime() - r.deliveredAt.getTime()) / 86_400_000) : null;
  return { amount: r.amount, currency: r.currency, resolution: r.resolution, refundMethod: r.refundMethod, daysLeft, photos: r.photos };
}

export async function listReturns(p: Principal, f: { view?: string; q?: string; channel?: string; limit?: number; page?: number }) {
  const db = await getDb();
  const parts: SQL[] = [scope(p, sql`r.channel_id`, sql`r.order_id`), VIEW_SQL[f.view ?? 'open'] ?? VIEW_SQL.open];
  if (f.channel) parts.push(sql`r.channel_id = ${f.channel}`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    parts.push(sql`(r.number ilike ${like} or o.number ilike ${like} or r.tracking ilike ${like} ${can(p, 'customers', 1) ? sql`or o.customer_name ilike ${like}` : sql``})`);
  }
  const where = sql.join(parts, sql` and `);
  const limit = Math.min(f.limit ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  const [rows, count] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select r.*, o.number as order_number, o.customer_name, o.address, o.phone, o.delivered_at as order_delivered_at,
        (select count(*) from return_photos ph where ph.return_id = r.id)::int as photo_count,
        coalesce((select json_agg(json_build_object('title', i.title, 'size', i.size, 'image', i.image, 'quantity', ri.quantity, 'brand', i.brand))
          from return_items ri join order_items i on i.id = ri.order_item_id where ri.return_id = r.id), '[]') as items
      from returns r join orders o on o.id = r.order_id
      where ${where}
      order by case when r.stage in ('refunded','closed','rejected') then 1 else 0 end, r.due_at asc nulls last, r.requested_at desc
      limit ${limit} offset ${(page - 1) * limit}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from returns r join orders o on o.id = r.order_id where ${where}`),
  ]);
  const pii = can(p, 'customers', 1);
  const seesMoney = can(p, 'money', 1);
  return {
    rows: rows.rows.map(
      (r): ReturnRow => ({
        id: r.id as string,
        number: r.number as string,
        orderId: r.order_id as string,
        orderNumber: r.order_number as string,
        channelId: r.channel_id as string,
        customer: pii ? (r.customer_name as string) : maskName(r.customer_name as string),
        city: pii ? ((r.address as { city?: string } | null)?.city ?? null) : null,
        phone: can(p, 'customers', 2) ? ((r.phone as string) ?? null) : null,
        reason: r.reason as string,
        reasonNote: (r.reason_note as string) ?? null,
        resolution: r.resolution as string,
        method: r.method as string,
        amount: seesMoney ? Number(r.amount) : null,
        currency: r.currency as string,
        stage: r.stage as string,
        stageAt: new Date(r.stage_at as string),
        dueAt: r.due_at ? new Date(r.due_at as string) : null,
        requestedAt: new Date(r.requested_at as string),
        inspection: (r.inspection as string) ?? null,
        tracking: (r.tracking as string) ?? null,
        items: (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) as ReturnRow['items'],
        review: (typeof r.review === 'string' ? JSON.parse(r.review) : (r.review ?? null)) as ReturnReview | null,
        refundMethod: (r.refund_method as string) ?? 'original',
        deliveredAt: r.order_delivered_at ? new Date(r.order_delivered_at as string) : null,
        photos: Number(r.photo_count ?? 0),
      }),
    ),
    total: count.rows[0].n,
    page,
    limit,
  };
}

export async function returnViewCounts(p: Principal) {
  const db = await getDb();
  const r = await db.execute<Record<string, number>>(sql`
    select
      count(*) filter (where r.stage not in ('refunded','closed','rejected'))::int as open,
      count(*) filter (where r.stage = 'requested')::int as requested,
      count(*) filter (where r.stage in ('approved','pickup','in_transit'))::int as pickups,
      count(*) filter (where r.stage in ('received','inspected'))::int as desk,
      count(*) filter (where r.stage = 'refund_pending')::int as refund,
      count(*) filter (where r.stage in ('refunded','closed','rejected'))::int as closed
    from returns r where ${scope(p, sql`r.channel_id`, sql`r.order_id`)}`);
  return r.rows[0];
}
