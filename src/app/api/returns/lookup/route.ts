import { lookupOrder, quoteRefund, RETURN_REASON_LIST } from '@/lib/returns-portal';
import { httpError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Finds a customer's order so they can start a return. Public: no session, no API key.
 *
 * The pair of order number and contact is the whole credential, which is thin, so this is rate
 * limited per address. Without it a sequential order number plus a dictionary of emails is an
 * address-harvesting tool rather than a returns portal.
 *
 * `items` is optional. Left out, the quote covers everything returnable, which is what a storefront
 * wants before anything is chosen; sent, the quote is priced for exactly those lines, so the figures
 * on the refund step are the server's and not a ratio worked out in the browser.
 *
 * Used by the web portal and by both mobile apps.
 */
export async function POST(req: Request) {
  const limit = await rateLimit(req, 'returns-lookup', { max: 12, windowMs: 10 * 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: 'too_many', message: 'Too many attempts. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  let body: {
    number?: string;
    orderId?: string;
    email?: string;
    phone?: string;
    contact?: string;
    items?: { orderItemId: string; quantity: number }[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request', message: 'Send a JSON body.' }, { status: 400 });
  }

  try {
    const order = await lookupOrder({
      number: body.number,
      orderId: body.orderId,
      email: body.email,
      phone: body.phone,
      contact: body.contact,
    });
    const picked = (body.items ?? []).filter((i) => i && i.quantity > 0);
    const quote = quoteRefund(
      order,
      picked.length
        ? picked
        : /* Everything returnable, so a storefront can show the best case before anything is chosen. */
          order.items.filter((i) => i.returnable).map((i) => ({ orderItemId: i.id, quantity: i.available }))
    );
    return Response.json({ order, reasons: RETURN_REASON_LIST, quote });
  } catch (e) {
    const { status, body: payload } = httpError(e);
    return Response.json(payload, { status });
  }
}
