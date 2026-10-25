// npm run import:live [channel-id] — reads each live Shopify store's whole catalogue, stock and orders
// into the stock module, then lets the AI planner read the range. Read-only towards the stores.
// Run it once after go-live (and whenever a store is connected); the schedule keeps it fresh after that.
// The server and this script share one database: on PGlite stop the server first; on Postgres it is safe.
import { CHANNELS, channelConfigured } from '../src/lib/channels';
import { importShopifyStock } from '../src/lib/stock/live';

const only = process.argv[2];
const live = CHANNELS.filter((c) => c.platform === 'shopify' && channelConfigured(c) && (!only || c.id === only));

(async () => {
  if (!live.length) {
    console.error(only ? `No live Shopify store called ${only}.` : 'No live Shopify store is connected yet: add its keys to the environment first.');
    process.exit(1);
  }
  for (const c of live) {
    const t = Date.now();
    console.log(`── ${c.name} (${c.id})`);
    try {
      const r = await importShopifyStock(c.id, { log: (m) => console.log(`   ${m}`) });
      console.log(`   done in ${Math.round((Date.now() - t) / 1000)}s: ${r.products} styles, ${r.pieces} pieces, ${r.orders} orders`);
    } catch (e) {
      console.error(`   skipped: ${e instanceof Error ? e.message : e}`);
    }
  }
  process.exit(0);
})();
