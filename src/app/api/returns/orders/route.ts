import { CHANNELS } from '@/lib/channels';
import { listOrders } from '@/lib/returns-portal';
import { httpError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Signs a customer in to the returns portal with the email or phone they order with, and lists
 * their orders on that storefront's brand. Public: no session, no API key.
 *
 * The contact is the whole credential here (see `returns-portal.ts`), so this is limited harder
 * than the single-order lookup: ten tries per address in ten minutes is plenty for someone who
 * mistyped their own email and too few to walk a list of other people's.
 */
export async function POST(req: Request) {
  const limit = await rateLimit(req, 'returns-orders', { max: 10, windowMs: 10 * 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: 'too_many', message: 'Too many attempts. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  let body: { email?: string; phone?: string; contact?: string; brand?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request', message: 'Send a JSON body.' }, { status: 400 });
  }

  /* Only a brand Relay serves. Anything else would list nothing anyway; refusing it says so. */
  const brand = CHANNELS.some((c) => c.brand === body.brand) ? body.brand! : 'FIG';

  try {
    const orders = await listOrders({ email: body.email, phone: body.phone, contact: body.contact, brand });
    return Response.json({ orders });
  } catch (e) {
    const { status, body: payload } = httpError(e);
    return Response.json(payload, { status });
  }
}
