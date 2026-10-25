import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL, CHANNELS, channelLabel } from './channels';
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
 * to be careful.
 *
 * The portal signs a customer in with the email or phone they order with and lists their orders,
 * as Labesny asked on 9 October. That makes the contact the whole credential: anyone who knows a
 * customer's email or phone can see what they bought. What keeps that small:
 *
 *   The list shows what a return needs and nothing more — the order number, dates, the pieces and
 *   their brands. No address, no name, no payment details.
 *
 *   It is scoped to the storefront's own brand, so labesny.com lists Labesny orders only.
 *
 *   Every later step re-checks that the order belongs to that contact, so an order id from the
 *   list cannot be replayed under someone else's email.
 *
 *   It is rate limited per address at the route.
 *
 * The proper fix is a one-time code sent to that email or phone before the list is shown. Relay
 * has no mail or SMS sender yet; when it does, it belongs in `listOrders`.
 *
 * The older path — order number plus contact — still works, because the mobile apps use it.
 */

export const RETURN_REASON_LIST = Object.entries(RETURN_REASONS).map(([value, label]) => ({ value, label }));

export type PortalItem = {
  id: string;
  title: string;
  /** The label on the piece (Etam, La vie en rose …). Labesny sells many, and the shops are per brand. */
  brand: string | null;
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
  /** Either the order number the customer typed, or the id of an order picked from their list. */
  number?: string;
  orderId?: string;
  /** The email on the order, or the phone on it. One of the two; the email is the better match. */
  email?: string;
  phone?: string;
  /** What a single field collected, when the caller has not worked out which it is. */
  contact?: string;
};

type Contact = { email: string; tail: string | null };

/** The email or the phone, from whichever the customer typed. */
export function readContact(input: { email?: string; phone?: string; contact?: string }): Contact {
  const typed = (input.contact ?? '').trim();
  const email = normaliseEmail(input.email ?? (looksLikeEmail(typed) ? typed : ''));
  const phone = (input.phone ?? (looksLikeEmail(typed) ? '' : typed)).trim();
  const tail = phone ? phoneTail(phone) : null;
  if (!email && !phone) throw invalid('Enter the email or phone number you order with.');
  if (!email && !tail) throw invalid('Enter the whole phone number you order with.');
  return { email, tail };
}

/** The SQL that says an order was placed with this contact. */
export const contactMatches = ({ email, tail }: Contact) =>
  email
    ? sql`lower(${schema.orders.email}) = ${email}`
    : sql`right(regexp_replace(coalesce(${schema.orders.phone}, ''), '[^0-9]', '', 'g'), 8) = ${tail}`;

/**
 * Finds one order for a customer: by its number (what the apps send) or by the id the portal's list
 * gave them, and in both cases only if the email or phone matches too.
 *
 * The same `notFound` comes back for an order that does not exist, a contact that does not match
 * it, and an order on a channel we do not serve.
 */
export async function lookupOrder(input: LookupInput): Promise<PortalOrder> {
  const number = normaliseOrderNumber(input.number ?? '');
  const orderId = (input.orderId ?? '').trim();
  if (!number && !orderId) throw invalid('Choose the order you would like to return from.');
  const contact = readContact(input);

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        orderId ? eq(schema.orders.id, orderId) : sql`lower(replace(${schema.orders.number}, '#', '')) = ${number}`,
        contactMatches(contact)
      )
    )
    .limit(1);

  const o = rows[0];
  // Deliberately the same message for every kind of miss.
  if (!o) throw notFound('We could not find an order with that number and contact.');
  return portalOrder(o);
}

export type PortalOrderSummary = {
  id: string;
  number: string;
  placedAt: Date;
  deliveredAt: Date | null;
  currency: string;
  total: number;
  storeLabel: string;
  itemCount: number;
  /** Up to four thumbnails, so a customer recognises the order before opening it. */
  images: string[];
  brands: string[];
  canReturn: boolean;
  why: string;
  daysLeft: number | null;
};

/**
 * Every order this customer placed on this brand's storefronts, newest first, so they can pick the
 * one to return from. Orders that cannot be returned are listed too, with the reason, so a customer
 * looking for last month's order is told why it is greyed out rather than wondering where it went.
 *
 * Nothing found is an empty list. See the note at the top of the file on what that does and does not
 * give away.
 */
export async function listOrders(input: {
  email?: string;
  phone?: string;
  contact?: string;
  brand: string;
}): Promise<PortalOrderSummary[]> {
  const contact = readContact(input);
  const channels = CHANNELS.filter((c) => c.brand === input.brand).map((c) => c.id);
  if (!channels.length) return [];

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        sql`${schema.orders.channelId} in (${sql.join(
          channels.map((c) => sql`${c}`),
          sql`, `
        )})`,
        contactMatches(contact)
      )
    )
    .orderBy(desc(schema.orders.placedAt))
    .limit(30);

  const out: PortalOrderSummary[] = [];
  for (const o of rows) {
    const p = await portalOrder(o);
    out.push({
      id: p.id,
      number: p.number,
      placedAt: p.placedAt,
      deliveredAt: p.deliveredAt,
      currency: p.currency,
      total: o.total,
      storeLabel: p.storeLabel,
      itemCount: p.items.reduce((a, i) => a + i.quantity, 0),
      images: p.items.map((i) => i.image).filter((x): x is string => Boolean(x)).slice(0, 4),
      brands: [...new Set(p.items.map((i) => i.brand).filter((b): b is string => Boolean(b)))],
      canReturn: p.canReturn,
      why: p.why,
      daysLeft: p.daysLeft,
    });
  }
  return out;
}

/** Everything the portal shows about one order, from its row. */
async function portalOrder(o: typeof schema.orders.$inferSelect): Promise<PortalOrder> {
  const db = await getDb();
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
      brand: l.brand,
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
): { amount: number; options: RefundOption[]; branches: Branch[] } {
  const amount = picked.reduce((sum, p) => {
    const line = order.items.find((i) => i.id === p.orderItemId);
    if (!line || !line.returnable) return sum;
    return sum + line.unitPrice * Math.min(Math.max(0, p.quantity), line.available);
  }, 0);

  /* The shops for what is actually going back, not for the whole order: a customer returning only
     the Etam piece from an Etam-and-Celio order is shown the Etam counters and nothing else. */
  const channel = CHANNEL[order.channelId];
  const pickedBrands = [
    ...new Set(
      picked
        .filter((p) => p.quantity > 0)
        .map((p) => order.items.find((i) => i.id === p.orderItemId)?.brand)
        .filter((b): b is string => Boolean(b))
    ),
  ];
  const branches = branchesForReturn(channel?.brand ?? 'FIG', channel?.country ?? 'EG', pickedBrands);

  return {
    amount,
    branches,
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
