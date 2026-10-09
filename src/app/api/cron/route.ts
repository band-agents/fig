import { runStockRule } from '@/lib/stock-rule';
import { syncAll, trackCouriers } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// For a scheduler (system cron, Railway/Render cron, Vercel cron): POST with
// `Authorization: Bearer $RELAY_CRON_SECRET`. Self-hosted Node can use RELAY_SYNC_MINUTES instead.
export async function POST(req: Request) {
  const secret = process.env.RELAY_CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('unauthorised', { status: 401 });
  const [stores, couriers] = await Promise.all([syncAll(), trackCouriers()]);
  /* After the pull, not beside it: the rule should judge stock as it stands once the stores have
     been read, and it writes to the same Shopify API the sync is talking to. It is a no-op unless
     RELAY_STOCK_RULE says otherwise. */
  const stock = await runStockRule();
  return Response.json({ stores, couriers, stock });
}
