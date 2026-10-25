import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { CHANNELS } from '../channels';
import { normaliseOrderNumber } from '../domain/contact';
import { contactMatches, readContact } from '../returns-portal';
import type { Identity } from './identity';

export { verifyCustomer, type Identity } from './identity';

/**
 * A customer's own orders and details, for the client advisor.
 *
 * Who is asking decides what can be read:
 *
 *   A customer signed in on the storefront arrives with their email and Shopify customer id,
 *   signed by the theme with a secret only the theme and Relay hold (Liquid's `hmac_sha256`). A
 *   valid signature means the shop vouches for them, so they may see every order placed with that
 *   email and their profile, without being asked anything.
 *
 *   A guest can see one order at a time, and only by giving its number together with the email or
 *   phone it was placed with — the returns portal's rule. Every kind of miss gets the same answer.
 *
 * What comes back is the customer's own record in full — items, sizes, prices, the delivery
 * address, payment, tracking, returns — and nothing about how the warehouse handled it.
 */

/** The floor's stages in a customer's words. Internal hand-offs collapse into "being prepared". */
const ORDER_STATUS: Record<string, string> = {
  new: 'Received — we are confirming it',
  confirming: 'Received — we are confirming it',
  finance: 'Confirmed — being prepared',
  ready: 'Confirmed — being prepared',
  picking: 'Being prepared in our warehouse',
  packed: 'Packed — waiting for the courier',
  shipped: 'With the courier',
  delivering: 'Out for delivery today',
  delivered: 'Delivered',
  settled: 'Delivered',
  cancelled: 'Cancelled',
  rto: 'Delivery was not completed — the parcel is coming back to us',
  rto_closed: 'Delivery was not completed — the parcel came back to us',
};

const RETURN_STATUS: Record<string, string> = {
  requested: 'Requested — we are reviewing it',
  approved: 'Approved',
  pickup: 'Collection booked',
  in_transit: 'On its way back to us',
  received: 'Received at our warehouse',
  inspected: 'Checked — refund being prepared',
  refund_pending: 'Refund being issued',
  refunded: 'Refunded',
  closed: 'Closed',
  rejected: 'Not accepted',
  cancelled: 'Cancelled',
};

const PAYMENT: Record<string, string> = {
  cod: 'Cash on delivery',
  card: 'Card',
  knet: 'KNET',
  wallet: 'Wallet',
  instapay: 'InstaPay',
  store_credit: 'Account credit',
  mixed: 'Card and other',
};

const PAYMENT_STATUS: Record<string, string> = {
  pending: 'Awaiting payment',
  paid: 'Paid',
  cod_due: 'To be paid on delivery',
  cod_collected: 'Paid on delivery',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
  voided: 'Cancelled',
};

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Kuwait' }).format(d) : null);

function money(minor: number, currency: string) {
  const decimals = currency === 'KWD' || currency === 'JOD' ? 3 : 2;
  return `${currency} ${(minor / 10 ** decimals).toFixed(decimals)}`;
}

const channelsOf = (brand: string) => CHANNELS.filter((c) => c.brand === brand).map((c) => c.id);

export type OrderSummary = {
  number: string;
  placed: string;
  status: string;
  total: string;
  items: string[];
  tracking: string | null;
};

export type OrderDetail = {
  number: string;
  placed: string;
  status: string;
  courierNote: string | null;
  items: { name: string; brand: string | null; size: string | null; quantity: number; price: string }[];
  subtotal: string;
  delivery: string;
  discount: string | null;
  total: string;
  payment: string;
  paymentStatus: string;
  deliverTo: string | null;
  contactOnOrder: { name: string; email: string | null; phone: string | null };
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shipped: string | null;
  delivered: string | null;
  cancelReason: string | null;
  returns: { number: string; status: string; requested: string; amount: string }[];
};

/** Every order a signed-in customer placed on this brand's storefronts, newest first. */
export async function myOrders(who: Identity, brand: string, limit = 20): Promise<OrderSummary[]> {
  const channels = channelsOf(brand);
  if (!channels.length) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.channelId, channels), sql`lower(${schema.orders.email}) = ${who.email}`))
    .orderBy(desc(schema.orders.placedAt))
    .limit(limit);
  if (!rows.length) return [];
  const lines = await db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, rows.map((o) => o.id)));
  return rows.map((o) => ({
    number: o.number,
    placed: day(o.placedAt)!,
    status: ORDER_STATUS[o.stage] ?? 'Being prepared',
    total: money(o.total, o.currency),
    items: lines.filter((l) => l.orderId === o.id).map((l) => `${l.quantity > 1 ? `${l.quantity} × ` : ''}${l.title}${l.size ? ` (${l.size})` : ''}`),
    tracking: o.tracking,
  }));
}

/**
 * One order in full. A signed-in customer needs only the number (it must be theirs); a guest must
 * also give the email or phone it was placed with.
 */
export async function orderDetail(input: { number: string; contact?: string; who: Identity | null; brand: string }): Promise<OrderDetail | null> {
  const number = normaliseOrderNumber(input.number);
  const channels = channelsOf(input.brand);
  if (!number || !channels.length) return null;

  let owner;
  if (input.who) owner = sql`lower(${schema.orders.email}) = ${input.who.email}`;
  else if (input.contact) owner = contactMatches(readContact({ contact: input.contact }));
  else return null;

  const db = await getDb();
  const [o] = await db
    .select()
    .from(schema.orders)
    .where(and(sql`lower(replace(${schema.orders.number}, '#', '')) = ${number}`, inArray(schema.orders.channelId, channels), owner))
    .limit(1);
  if (!o) return null;

  const [lines, rets] = await Promise.all([
    db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id)),
    db.select().from(schema.returns).where(eq(schema.returns.orderId, o.id)).orderBy(desc(schema.returns.requestedAt)),
  ]);
  const a = o.address;

  return {
    number: o.number,
    placed: day(o.placedAt)!,
    status: ORDER_STATUS[o.stage] ?? 'Being prepared',
    courierNote: ['shipped', 'delivering', 'rto'].includes(o.stage) ? o.exception : null,
    items: lines.map((l) => ({ name: l.title, brand: l.brand, size: l.size, quantity: l.quantity, price: money(l.unitPrice, o.currency) })),
    subtotal: money(o.subtotal, o.currency),
    delivery: o.shipping ? money(o.shipping, o.currency) : 'Free',
    discount: o.discount ? money(o.discount, o.currency) : null,
    total: money(o.total, o.currency),
    payment: PAYMENT[o.paymentMethod] ?? o.paymentMethod,
    paymentStatus: PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus,
    deliverTo: a ? [a.name, a.line1, a.line2, a.area, a.city, a.region, a.country].filter(Boolean).join(', ') : null,
    contactOnOrder: { name: o.customerName, email: o.email, phone: o.phone },
    courier: o.courier,
    trackingNumber: o.tracking,
    trackingUrl: o.trackingUrl,
    shipped: day(o.shippedAt),
    delivered: day(o.deliveredAt),
    cancelReason: o.stage === 'cancelled' ? o.cancelReason : null,
    returns: rets.map((r) => ({ number: r.number, status: RETURN_STATUS[r.stage] ?? r.stage, requested: day(r.requestedAt)!, amount: money(r.amount, o.currency) })),
  };
}

/** A signed-in customer's own profile, as the shop knows it. */
export async function myProfile(who: Identity, brand: string) {
  const channels = channelsOf(brand);
  const db = await getDb();
  const rows = await db
    .select({ name: schema.orders.customerName, phone: schema.orders.phone, address: schema.orders.address, placedAt: schema.orders.placedAt, total: schema.orders.total, currency: schema.orders.currency })
    .from(schema.orders)
    .where(and(inArray(schema.orders.channelId, channels), sql`lower(${schema.orders.email}) = ${who.email}`))
    .orderBy(desc(schema.orders.placedAt));
  if (!rows.length) return { email: who.email, orders: 0 };
  const latest = rows[0];
  const a = latest.address;
  return {
    name: latest.name,
    email: who.email,
    phone: latest.phone,
    lastDeliveryAddress: a ? [a.line1, a.line2, a.area, a.city, a.country].filter(Boolean).join(', ') : null,
    orders: rows.length,
    customerSince: day(rows[rows.length - 1].placedAt),
    spent: money(rows.reduce((s, r) => s + r.total, 0), latest.currency),
  };
}
