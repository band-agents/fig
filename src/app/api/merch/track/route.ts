import { z } from 'zod';
import { track } from '@/lib/stock/merch-public';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const body = z.object({ placement: z.string().max(64), event: z.enum(['view', 'click', 'add']), store: z.string().max(64) });

/**
 * A shopper saw, clicked or added a placed piece. Sent by the embed with sendBeacon as text/plain,
 * so no preflight. Only counts per placement per day are kept; nothing about the shopper.
 */
export async function POST(req: Request) {
  const limit = await rateLimit(req, 'merch-track', { max: 120, windowMs: 60_000 });
  if (!limit.ok) return new Response(null, { status: 429, headers: CORS });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400, headers: CORS });
  const ok = await track(parsed.data.placement, parsed.data.event, parsed.data.store);
  return new Response(null, { status: ok ? 204 : 404, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
