// Self-hosted schedule: with RELAY_SYNC_MINUTES set, the server pulls every connected store and asks
// the courier for updates on that cadence. Webhooks still deliver new orders within seconds.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const minutes = Number(process.env.RELAY_SYNC_MINUTES ?? 0);
  if (!minutes) return;
  const { syncAll, trackCouriers } = await import('./lib/sync');
  const g = globalThis as unknown as { __relaySync?: ReturnType<typeof setInterval> };
  if (g.__relaySync) return;
  const tick = async () => {
    try {
      await syncAll();
      await trackCouriers();
    } catch (e) {
      console.error('[relay] scheduled sync failed', e instanceof Error ? e.message : e);
    }
  };
  setTimeout(tick, 15_000);
  g.__relaySync = setInterval(tick, Math.max(2, minutes) * 60_000);
}
