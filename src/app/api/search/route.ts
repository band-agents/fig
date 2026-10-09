import { sql } from 'drizzle-orm';
import { currentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { scope } from '@/lib/queries';
import { can, maskName } from '@/lib/domain/perms';
import { channelLabel } from '@/lib/channels';
import { ORDER_STAGE, type OrderStage } from '@/lib/domain/stages';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'signed_out' }, { status: 401 });
  if (!can(user, 'orders', 1)) return Response.json({ orders: [] });
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return Response.json({ orders: [] });
  const db = await getDb();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const digits = q.replace(/\D/g, '');
  const pii = can(user, 'customers', 1);
  const r = await db.execute<{ id: string; number: string; channel_id: string; stage: string; customer_name: string; placed_at: string; kind: string; rma: string | null; return_id: string | null }>(sql`
    select o.id, o.number, o.channel_id, o.stage, o.customer_name, o.placed_at, 'order' as kind, null as rma, null as return_id
    from orders o
    where ${scope(user, sql`o.channel_id`)} and (
      o.number ilike ${like} or o.tracking ilike ${like}
      ${pii ? sql`or o.customer_name ilike ${like} or o.email ilike ${like}` : sql``}
      ${pii && digits.length >= 6 ? sql`or o.phone like ${'%' + digits.slice(-9) + '%'}` : sql``}
    )
    union all
    select o.id, o.number, o.channel_id, r.stage, o.customer_name, r.requested_at, 'return', r.number, r.id
    from returns r join orders o on o.id = r.order_id
    where ${scope(user, sql`r.channel_id`)} and (r.number ilike ${like} or r.tracking ilike ${like})
    order by placed_at desc limit 10`);
  return Response.json({
    orders: r.rows.map((o) => ({
      id: o.kind === 'return' ? o.return_id : o.id,
      kind: o.kind,
      number: o.kind === 'return' ? `${o.rma} · ${o.number}` : o.number,
      channel: channelLabel(o.channel_id),
      stage: o.kind === 'order' ? ORDER_STAGE[o.stage as OrderStage]?.label ?? o.stage : o.stage,
      tint: o.kind === 'order' ? ORDER_STAGE[o.stage as OrderStage]?.tint : 'rose',
      customer: can(user, 'customers', 1) ? o.customer_name : maskName(o.customer_name),
    })),
  });
}
