// Points every connected Shopify store's order webhooks at this console (RELAY_PUBLIC_URL), then takes
// away the ones still aimed at an older address of ours. Run it where the console now lives, after a
// move (1 Nov: the PC's tailnet link → console.dagher-hinnawi.com on Google Cloud).
//
//   npx tsx --conditions=react-server scripts/order-webhooks.ts            dry run: what each store has
//   npx tsx --conditions=react-server scripts/order-webhooks.ts --apply    register, then retire the old
//
// Each store gets the new address for every topic first; an old one is removed only when the new address
// already receives every topic, so no order slips between the two.
import { CHANNELS, channelConfigured } from '../src/lib/channels';
import { registerOrderWebhooks, retireOrderWebhooks } from '../src/lib/connectors/shopify';

const apply = process.argv.includes('--apply');
const site = process.env.RELAY_PUBLIC_URL?.replace(/\/$/, '');

(async () => {
  if (!site?.startsWith('https://')) throw new Error('Set RELAY_PUBLIC_URL to the console’s https address first.');
  const stores = CHANNELS.filter((c) => c.platform === 'shopify' && channelConfigured(c));
  if (!stores.length) throw new Error('No Shopify store is connected.');
  for (const c of stores) {
    const address = `${site}/api/webhooks/shopify/${c.id}`;
    const reg = await registerOrderWebhooks(c, address, apply);
    const ret = await retireOrderWebhooks(c, address, apply);
    console.log(`\n${c.name} (${c.id}) → ${address}`);
    for (const w of reg.have) console.log(`  had   ${w.topic.padEnd(18)} ${w.uri}`);
    console.log(apply ? `  added ${reg.created.join(', ') || 'nothing (already there)'}` : `  would add ${reg.missing.join(', ') || 'nothing'}`);
    console.log(apply ? `  removed ${ret.removed.length ? ret.removed.join('; ') : 'nothing'}` : `  would remove ${ret.old.map((w) => `${w.topic} ${w.uri}`).join('; ') || 'nothing'}`);
  }
  if (!apply) console.log('\ndry run: nothing changed (add --apply)');
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
