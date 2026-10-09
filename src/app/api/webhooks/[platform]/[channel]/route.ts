import { eq } from 'drizzle-orm';
import { CHANNEL } from '@/lib/channels';
import { connectorFor } from '@/lib/connectors';
import { ingestOrder } from '@/lib/engine';
import { getDb, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/webhooks/shopify/fig-web, /api/webhooks/woo/fig-woo …
// Fails closed: no secret or a bad signature is a 401, and nothing is written.
export async function POST(req: Request, ctx: RouteContext<'/api/webhooks/[platform]/[channel]'>) {
  const { platform, channel } = await ctx.params;
  const c = CHANNEL[channel];
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
