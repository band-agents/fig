import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL, channelLabel } from './channels';
import { eligibility, itemReturnable, policyFor } from './domain/returns-policy';
import { branchesForReturn, type Branch } from './domain/branches';
import { refundOptions, type PaymentMethod, type RefundOption } from './domain/refund-methods';
import { RETURN_REASONS, type ReturnReason } from './domain/stages';
import { looksLikeEmail, normaliseEmail, normaliseOrderNumber, phoneTail } from './domain/contact';
import { invalid, notFound } from './errors';

/**
 * What a customer can do on their own, without an account.
 *
 * Everything in the console goes through `scope(p)` and a principal. A customer has neither, so
 * this is the one place that reads orders without one — and it is therefore the one place that has
 * to be careful. Two rules hold it together:
 *
 *   The order number alone is never enough. It is short, sequential and printed on a parcel, so it
 *   is a name rather than a secret; the email or phone on the order has to match as well.
 *
 *   A failed lookup says the same thing whatever went wrong. Telling someone that an order exists
 *   but the contact is wrong turns a sequential number into a way of harvesting addresses.
 */

export const RETURN_REASON_LIST = Object.entries(RETURN_REASONS).map(([value, label]) => ({ value, label }));

export type PortalItem = {
  id: string;
  title: string;
  variant: string | null;
  size: string | null;
  image: string | null;
  quantity: number;
  /** Still returnable after what has already gone back. */
  available: number;
  unitPrice: number;
  returnable: boolean;
  why?: string;
};

export type PortalOrder = {
  id: string;
  number: string;
  placedAt: Date;
  deliveredAt: Date | null;
  currency: string;
  channelId: string;
  brand: string;
  storeLabel: string;
  payment: PaymentMethod;
  canReturn: boolean;
  why: string;
  daysLeft: number | null;
  policyLabel: string;
  storeOnly: boolean;
  /** The shops this customer may bring it to. Empty while a market's list is not in yet. */
  branches: Branch[];
  items: PortalItem[];
  /** Returns already open on this order, so the customer is not told to start again. */
  existing: { number: string; stage: string; requestedAt: Date }[];
};

export type LookupInput = {
  number: string;
  /** The email on the order, or the phone on it. One of the two; the email is the better match. */
  email?: string;
  phone?: string;
  /** What a single field collected, when the caller has not worked out which it is. */
  contact?: string;
};

/**
 * Finds one order for a customer who has typed its number and the email or phone they ordered with.
 *
 * Both halves have to match. The same `notFound` comes back for a number that does not exist, a
 * contact that does not match it, and an order on a channel we do not serve.
 */
export async function lookupOrder(input: LookupInput): Promise<PortalOrder> {
  const number = normaliseOrderNumber(input.number);
  const typed = (input.contact ?? '').trim();
  const email = normaliseEmail(input.email ?? (looksLikeEmail(typed) ? typed : ''));
  const phone = (input.phone ?? (looksLikeEmail(typed) ? '' : typed)).trim();
  const tail = phone ? phoneTail(phone) : null;

  if (!number || (!email && !phone)) {
    throw invalid('Enter your order number and the email or phone you ordered with.');
  }
  if (!email && !tail) throw invalid('Enter the whole phone number you ordered with.');

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        sql`lower(replace(${schema.orders.number}, '#', '')) = ${number}`,
        email
          ? sql`lower(${schema.orders.email}) = ${email}`
          : sql`right(regexp_replace(coalesce(${schema.orders.phone}, ''), '[^0-9]', '', 'g'), 8) = ${tail}`
      )
    )
    .limit(1);

  const o = rows[0];
  // Deliberately the same message for every kind of miss.
  if (!o) throw notFound('We could not find an order with that number and contact.');

  const channel = CHANNEL[o.channelId];
  const policy = policyFor(channel?.brand ?? 'FIG', channel?.country ?? 'EG');
  const elig = eligibility(policy, o.deliveredAt);

  const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));

  /* How much of each line has already gone back, so a customer cannot return the same shirt twice
     by opening a second request. */
  const priorReturns = await db
    .select()
    .from(schema.returns)
    .where(eq(schema.returns.orderId, o.id))
    .orderBy(desc(schema.returns.requestedAt));
  const open = priorReturns.filter((r) => !['refunded', 'cancelled', 'rejected'].includes(r.stage));
  const returnedByLine = new Map<string, number>();
  if (priorReturns.length) {
    const items = await db
      .select()
      .from(schema.returnItems)
      .where(
        sql`${schema.returnItems.returnId} in (${sql.join(
          priorReturns.map((r) => sql`${r.id}`),
          sql`, `
        )})`
      );
    for (const i of items) returnedByLine.set(i.orderItemId, (returnedByLine.get(i.orderItemId) ?? 0) + i.quantity);
  }

  const items: PortalItem[] = lines.map((l) => {
    const already = returnedByLine.get(l.id) ?? 0;
    const available = Math.max(0, l.quantity - already);
    const allowed = itemReturnable(policy, l) && l.returnable;
    return {
      id: l.id,
      title: l.title,
      variant: l.variant,
      size: l.size,
      image: l.image,
      quantity: l.quantity,
      available,
      unitPrice: l.unitPrice,
      returnable: allowed && available > 0,
      why: !allowed
        ? 'Final sale under this store’s policy'
        : available === 0
          ? already >= l.quantity
            ? 'Already returned'
            : 'Not available to return'
          : undefined,
    };
  });

  return {
    id: o.id,
    number: o.number,
    placedAt: o.placedAt,
    deliveredAt: o.deliveredAt,
    currency: o.currency,
    channelId: o.channelId,
    brand: channel?.brand ?? 'FIG',
    storeLabel: channelLabel(o.channelId),
    payment: o.paymentMethod as PaymentMethod,
    canReturn: elig.ok && items.some((i) => i.returnable),
    why: elig.ok && !items.some((i) => i.returnable) ? 'Nothing on this order can be returned.' : elig.why,
    daysLeft: elig.daysLeft,
    policyLabel: policy.label,
    storeOnly: policy.storeOnly,
    /* Only the counters that carry what is going back: a Kuwait return goes to the brand's own
       shop, so showing all twenty-seven would be a list to search rather than a choice to make. */
    branches: branchesForReturn(
      channel?.brand ?? 'FIG',
      channel?.country ?? 'EG',
      [...new Set(lines.filter((l) => l.returnable).map((l) => l.brand).filter((b): b is string => Boolean(b)))],
    ),
    items,
    existing: open.map((r) => ({ number: r.number, stage: r.stage, requestedAt: r.requestedAt })),
  };
}

/**
 * The refund choices for a basket of items the customer has picked, priced from the order's own
 * lines. The amount is computed here rather than sent, for the obvious reason.
 */
export function quoteRefund(
  order: PortalOrder,
  picked: { orderItemId: string; quantity: number }[]
): { amount: number; options: RefundOption[] } {
  const amount = picked.reduce((sum, p) => {
    const line = order.items.find((i) => i.id === p.orderItemId);
    if (!line || !line.returnable) return sum;
    return sum + line.unitPrice * Math.min(Math.max(0, p.quantity), line.available);
  }, 0);

  return {
    amount,
    options: refundOptions({
      amount,
      currency: order.currency,
      payment: order.payment,
      policy: { storeOnly: order.storeOnly },
      // Nothing to send back to a cash order the courier has not collected on yet.
      settled: true,
    }),
  };
}

export const isReturnReason = (v: string): v is ReturnReason => v in RETURN_REASONS;
