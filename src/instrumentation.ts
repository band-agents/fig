// Self-hosted schedule: with RELAY_SYNC_MINUTES set, the server pulls every connected store and asks
// the courier for updates on that cadence. Webhooks still deliver new orders within seconds.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // read the stock range once at start, so the first stock page opens without waiting for it
  setTimeout(() => void import('./lib/stock/facts').then((m) => m.getFacts()).catch(() => {}), 2_000);
  // orders go straight to Pick & pack: anything left waiting in a retired step (a confirmation call,
  // a finance check) is sent on once the server is up, whatever the sync schedule
  setTimeout(() => void import('./lib/engine').then((m) => m.releaseRetired()).catch((e) => console.error('[relay] releasing waiting orders failed', e instanceof Error ? e.message : e)), 8_000);
  const minutes = Number(process.env.RELAY_SYNC_MINUTES ?? 0);
  if (!minutes) return;
  // a store connected since the last start: first its catalogue, stock and orders, then its website
  // listing for Website vs Lucida. One after the other: Shopify runs one bulk read per store at a time.
  setTimeout(
    () =>
      void (async () => {
        await (await import('./lib/stock/live')).importNewStores();
        await (await import('./lib/web-items')).readUnreadWebsites();
      })().catch((e) => console.error('[relay] first reading of a new store failed', e instanceof Error ? e.message : e)),
    60_000,
  );
  const { syncAll, trackCouriers } = await import('./lib/sync');
  const g = globalThis as unknown as { __relaySync?: ReturnType<typeof setInterval> };
  if (g.__relaySync) return;
  const { runPlanner } = await import('./lib/stock/planner');
  const { rollupOnlineSales } = await import('./lib/stock/rollup');
  const { addWeeks, weekOf } = await import('./lib/domain/stock/calendar');
  const { releaseRetired } = await import('./lib/engine');
  // the AI planner reads the whole range every few hours (RELAY_PLAN_MINUTES, default 360): a pass
  // takes about a minute on a large range, and its proposals stay on the board between passes.
  // "Run the planner now" in the stock brief runs one at any time.
  const planEvery = Math.max(30, Number(process.env.RELAY_PLAN_MINUTES ?? 360)) * 60_000;
  let lastPlan = Date.now();
  const tick = async () => {
    try {
      await syncAll();
      await trackCouriers();
      // orders go straight to Pick & pack: anything still waiting in a retired step is sent on
      await releaseRetired();
      // the websites' latest orders into weekly sales, so Finance & analysis and the stock screens read
      // this week's numbers without waiting for the planner's full pass (one cheap upsert)
      await rollupOnlineSales(addWeeks(weekOf(Date.now()), -3));
      if (Date.now() - lastPlan > planEvery) {
        lastPlan = Date.now();
        await runPlanner();
      }
    } catch (e) {
      console.error('[relay] scheduled sync failed', e instanceof Error ? e.message : e);
    }
  };
  setTimeout(tick, 15_000);
  g.__relaySync = setInterval(tick, Math.max(2, minutes) * 60_000);
  // once a night: the stores' catalogues and stock again from Shopify (new styles, prices, seasons), then
  // every branch's stock from Lucida (Reports → Stock by branch; nothing while Lucida has no logins)
  const { maybeReadBranchesTonight } = await import('./lib/branch-stock');
  const { maybeRefreshCataloguesTonight } = await import('./lib/stock/live');
  setInterval(
    () =>
      void (async () => {
        await maybeRefreshCataloguesTonight();
        await maybeReadBranchesTonight(['KW', 'EG']);
      })().catch((e) => console.error('[relay] nightly stock reading failed', e instanceof Error ? e.message : e)),
    30 * 60_000,
  );
}
