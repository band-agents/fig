import { runStockRule } from '@/lib/stock-rule';
import { syncAll, trackCouriers } from '@/lib/sync';
import { runPlanner } from '@/lib/stock/planner';
import { rollupOnlineSales } from '@/lib/stock/rollup';
import { importNewStores, refreshCatalogues } from '@/lib/stock/live';
import { readUnreadWebsites } from '@/lib/web-items';
import { releaseRetired } from '@/lib/engine';
import { addWeeks, weekOf } from '@/lib/domain/stock/calendar';
import { branchReadCost, readAllBranches } from '@/lib/branch-stock';
import { lucidaConfigured } from '@/lib/connectors/lucida';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The schedule, for a host that does not keep the server running between requests (Vercel): Vercel
 * Cron calls this with `Authorization: Bearer $CRON_SECRET` (vercel.json sets the times). A server
 * that stays up uses RELAY_SYNC_MINUTES in instrumentation.ts instead; never both.
 *
 *   (no job)       every 5 minutes: the stores' orders, couriers, retired steps, this week's sales, the stock rule
 *   ?job=planner   every 6 hours: the AI planner on the stock as it stands
 *   ?job=nightly   once a night: a newly connected store's first reading, every catalogue and its stock
 *                  again, the websites' listings, then every branch's stock from Lucida
 *
 * RELAY_CRON=on is the switch: while the old server still runs the floor, this copy must not pull the
 * stores or write to them, so the schedule answers "paused" until the move is done.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.RELAY_CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('unauthorised', { status: 401 });
  if (process.env.RELAY_CRON !== 'on') return Response.json({ paused: true, why: 'RELAY_CRON is not on' });
  const job = new URL(req.url).searchParams.get('job') ?? 'sync';
  const t0 = Date.now();
  try {
    if (job === 'planner') return Response.json({ job, planner: await runPlanner(), ms: Date.now() - t0 });
    if (job === 'nightly') {
      await importNewStores();
      const catalogues = await refreshCatalogues();
      await readUnreadWebsites();
      const markets = ['KW', 'EG'] as const;
      const cost = lucidaConfigured() ? await branchReadCost([...markets]) : null;
      const branches = cost?.possible ? await readAllBranches([...markets]) : { skipped: cost ? 'not enough Lucida calls left this hour' : 'Lucida not connected' };
      return Response.json({ job, catalogues, branches, ms: Date.now() - t0 });
    }
    const [stores, couriers] = await Promise.all([syncAll(), trackCouriers()]);
    await releaseRetired();
    await rollupOnlineSales(addWeeks(weekOf(Date.now()), -3));
    // after the pull, not beside it: the rule judges stock as it stands once the stores have been read
    const stock = await runStockRule();
    return Response.json({ job: 'sync', stores, couriers, stock, ms: Date.now() - t0 });
  } catch (e) {
    console.error(`[relay] cron ${job} failed`, e instanceof Error ? e.message : e);
    return Response.json({ job, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
