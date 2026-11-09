import { and, eq } from 'drizzle-orm';
import { CHANNEL, registerChannels, type ChannelDef } from '@/lib/channels';
import { connectorFor } from '@/lib/connectors';
import { ingestOrder } from '@/lib/engine';
import { getDb, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * A storefront added from the console lives in the channels table. getDb() registers those once per
 * process, but this route can get its own copy of the channels module, which then never sees them:
 * the Forever 21 store's webhooks answered 404 (9 Nov). So look the channel up here when it is missing.
 */
async function channelFor(id: string) {
  if (CHANNEL[id]) return CHANNEL[id];
  const db = await getDb();
  const [row] = await db.select({ config: schema.channels.config }).from(schema.channels).where(and(eq(schema.channels.id, id), eq(schema.channels.custom, true)));
  if (row?.config) registerChannels([row.config as ChannelDef]);
  return CHANNEL[id];
}

// POST /api/webhooks/shopify/fig-web, /api/webhooks/woo/fig-woo …
// Fails closed: no secret or a bad signature is a 401, and nothing is written.
export async function POST(req: Request, ctx: RouteContext<'/api/webhooks/[platform]/[channel]'>) {
  const { platform, channel } = await ctx.params;
  const c = await channelFor(channel);
  if (!c || c.platform !== platform || c.parked) return new Response('unknown channel', { status: 404 });
  const connector = connectorFor(c);
  if (!connector?.verifyWebhook || !connector.parseWebhook) return new Response('no webhooks for this platform', { status: 404 });
  const raw = await req.text();
  if (!connector.verifyWebhook(c, raw, req.headers)) return new Response('bad signature', { status: 401 });
  const topic = req.headers.get('x-shopify-topic') ?? req.headers.get('x-wc-webhook-topic') ?? '';
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const inc = await connector.parseWebhook(c, topic, payload);
  const db = await getDb();
  await db.update(schema.channels).set({ lastWebhookAt: new Date() }).where(eq(schema.channels.id, c.id));
  if (!inc) return Response.json({ ok: true, ignored: topic });
  const r = await ingestOrder(inc);
  return Response.json({ ok: true, created: r.created });
}
