import { openReturn } from '@/lib/engine';
import { isReturnReason, lookupOrder, quoteRefund } from '@/lib/returns-portal';
import type { RefundMethod } from '@/lib/domain/refund-methods';
import { httpError, invalid } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { readPhotos, savePhotos } from '@/lib/return-photos';

export const dynamic = 'force-dynamic';

/**
 * Opens a return the customer asked for themselves.
 *
 * The order is looked up again from the number and contact rather than trusted from the request, so
 * a reply from the lookup cannot be replayed against someone else's order. The refund amount is
 * priced from the order's own lines and the bonus decided by the engine; the body says which method
 * the customer chose and nothing about what it is worth.
 *
 * It lands at `requested`, which is where customer care picks it up. Nothing is approved here and
 * no money moves.
 */
export async function POST(req: Request) {
  const limit = await rateLimit(req, 'returns-create', { max: 6, windowMs: 10 * 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: 'too_many', message: 'Too many attempts. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  let body: {
    number?: string;
    email?: string;
    phone?: string;
    contact?: string;
    items?: { orderItemId: string; quantity: number }[];
    reason?: string;
    note?: string;
    photos?: unknown;
    refundMethod?: RefundMethod;
    branch?: string;
    via?: 'portal' | 'app';
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request', message: 'Send a JSON body.' }, { status: 400 });
  }

  try {
    const order = await lookupOrder({
      number: body.number ?? '',
      email: body.email,
      phone: body.phone,
      contact: body.contact,
    });

    const picked = (body.items ?? []).filter((i) => i && i.quantity > 0);
    if (!picked.length) throw invalid('Choose at least one item to return.');

    /* Every line is checked against the order: that it exists, that it may be returned, and that
       the quantity is one the customer still holds. */
    for (const p of picked) {
      const line = order.items.find((i) => i.id === p.orderItemId);
      if (!line) throw invalid('One of those items is not on this order.');
      if (!line.returnable) throw invalid(`${line.title} cannot be returned. ${line.why ?? ''}`.trim());
      if (p.quantity > line.available) {
        throw invalid(`You can return ${line.available} of ${line.title}, not ${p.quantity}.`);
      }
    }

    const reason = body.reason ?? '';
    if (!isReturnReason(reason)) throw invalid('Choose a reason for the return.');

    /* Read before the return is opened, so a photograph that cannot be stored is refused while
       there is still nothing to undo. */
    const photos = readPhotos(body.photos, { required: true });

    const refundMethod: RefundMethod = body.refundMethod ?? 'original';
    /* Checked here so the customer is told plainly, rather than meeting the engine's exception. */
    const { options } = quoteRefund(order, picked);
    const chosen = options.find((o) => o.method === refundMethod);
    if (!chosen) throw invalid('Choose how you would like to be refunded.');
    if (!chosen.available) throw invalid(chosen.why ?? 'That refund method is not available for this order.');

    /* Coming to a shop means saying which shop — as long as that market's branches are known. */
    const branch = order.branches.find((b) => b.id === body.branch) ?? null;
    const comingToABranch = refundMethod === 'cash_at_store' || order.storeOnly;
    if (comingToABranch && order.branches.length && !branch) {
      throw invalid('Choose the branch you would like to come to.');
    }

    const ret = await openReturn(
      /* No id and no principal: there is no user record behind a customer, and leaving the
         principal off is what tells the engine to skip the staff permission checks. The name is
         what the timeline shows, so it says plainly that this was not opened by an agent. */
      { id: null, name: `Customer (self-service · ${order.number})`, dept: null },
      order.id,
      {
        items: picked.map((p) => ({ orderItemId: p.orderItemId, quantity: p.quantity })),
        reason,
        note: body.note?.trim() || undefined,
        refundMethod,
        branch: branch?.id ?? null,
        openedVia: body.via === 'app' ? 'app' : 'portal',
      }
    );

    await savePhotos(ret.id, photos);

    return Response.json({
      ok: true,
      return: {
        number: ret.number,
        stage: ret.stage,
        amount: ret.amount,
        bonus: ret.bonus,
        currency: ret.currency,
        refundMethod: ret.refundMethod,
        method: ret.method,
        branch: branch?.name ?? null,
      },
    });
  } catch (e) {
    const { status, body: payload } = httpError(e);
    return Response.json(payload, { status });
  }
}
