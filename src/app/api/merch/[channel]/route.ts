import { placementsFor, seen } from '@/lib/stock/merch-public';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

/**
 * The live cross-sells, upgrades and pop-up for one storefront, for the page the shopper is on:
 *
 *   GET /api/merch/labesny-web?product=<product-handle>
 *
 * Public by design (the embed on the shop calls it) and read-only: it returns product titles,
 * pictures and prices the shop already shows. Cached briefly so a busy product page costs little.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/merch/[channel]'>) {
  const limit = await rateLimit(req, 'merch-read', { max: 240, windowMs: 60_000 });
  if (!limit.ok) return Response.json({ error: 'too_many' }, { status: 429, headers: { ...CORS, 'Retry-After': String(limit.retryAfterSec) } });
  const { channel } = await ctx.params;
  const product = new URL(req.url).searchParams.get('product');
  const out = await placementsFor(channel, { product: product?.slice(0, 160) ?? null });
  if (!out) return Response.json({ error: 'unknown_store' }, { status: 404, headers: CORS });
  void seen(channel);
  return Response.json(out, { headers: { ...CORS, 'Cache-Control': 'public, max-age=60' } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
