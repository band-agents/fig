import { sql } from 'drizzle-orm';
import { currentUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { scope } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Live updates where the server does not stay up between requests (Vercel): each open tab asks every
 * few seconds for a version of what it can see (its orders, the timeline, returns), and refreshes the
 * page when that version moves. The always-on server uses the /api/stream push instead.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('signed out', { status: 401 });
  const db = await getDb();
  const r = await db.execute<{ orders: string | null; events: number; returns: string | null }>(sql`
    select (select max(o.updated_at) from orders o where ${scope(user, sql`o.channel_id`, sql`o.id`)})::text as orders,
      (select count(*) from events)::int as events,
      (select max(r.stage_at) from returns r)::text as returns`);
  const x = r.rows[0];
  return Response.json({ v: `${x?.orders ?? ''}|${x?.events ?? 0}|${x?.returns ?? ''}` }, { headers: { 'Cache-Control': 'no-store' } });
}
