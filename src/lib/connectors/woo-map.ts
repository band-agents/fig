// WooCommerce REST v3 orders (figeg.com, the legacy site) mapped to IncomingOrder. Pure: no env, no network.
// Woo dates ending in _gmt carry no zone marker; amounts are strings in major units.
import type { ChannelDef } from '../channels';
import type { IncomingItem, IncomingOrder } from './types';
import { address, date, fullName, hmacBase64Matches, minor, num, SIZE_NAME, str } from './map-util';

type WooAddress = {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
};

type WooMeta = { key: string; value?: unknown; display_key?: string; display_value?: unknown };

export type WooOrder = {
  id: number;
  number?: string;
  status?: string;
  currency?: string;
  date_created_gmt?: string | null;
  date_modified_gmt?: string | null;
  date_paid_gmt?: string | null;
  date_completed_gmt?: string | null;
  discount_total?: string;
  shipping_total?: string;
  total?: string;
  customer_note?: string;
  billing?: WooAddress;
  shipping?: WooAddress;
  payment_method?: string;
  payment_method_title?: string;
  line_items?: {
    name?: string;
    quantity?: number;
    sku?: string;
    price?: number | string;
    subtotal?: string;
    image?: { src?: string } | null;
    meta_data?: WooMeta[];
  }[];
  meta_data?: WooMeta[];
  refunds?: { id: number; total?: string }[];
};

/** Woo's GMT timestamps come without a zone marker. */
export const wooDate = (v: string | null | undefined) => (v && !/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? date(`${v}Z`) : date(v));

export function wooPaymentMethod(method: string | null | undefined): IncomingOrder['paymentMethod'] {
  const m = (method ?? '').toLowerCase();
  // Wallets first: "vodafone_cash" is a wallet, not cash on delivery.
  if (m.startsWith('vodafone') || m.includes('wallet')) return 'wallet';
  if (m.includes('instapay')) return 'instapay';
  if (m === 'cod' || m.includes('cash')) return 'cod';
  return 'card';
}

export function wooPaymentStatus(o: Pick<WooOrder, 'status' | 'date_paid_gmt' | 'refunds'>, method: IncomingOrder['paymentMethod']): IncomingOrder['paymentStatus'] {
  const unpaid = method === 'cod' ? 'cod_due' : 'pending';
  switch (o.status) {
    case 'processing':
    case 'completed':
      if (o.refunds?.length) return 'partially_refunded';
      return method === 'cod' ? 'cod_due' : 'paid';
    case 'refunded':
      return 'refunded';
    case 'cancelled':
    case 'failed':
      return o.date_paid_gmt ? 'paid' : 'voided';
    default: // pending, on-hold, checkout-draft
      return unpaid;
  }
}

function sizeOf(meta: WooMeta[] | undefined): string | null {
  const m = (meta ?? []).find((x) => SIZE_NAME.test(x.key) || SIZE_NAME.test(x.display_key ?? ''));
  return m ? (str(m.display_value) ?? str(m.value)) : null;
}

/** An AWB if the Aramex plugin or a tracking plugin left one on the order. */
function trackingOf(meta: WooMeta[] | undefined): string | null {
  for (const m of meta ?? []) {
    if (/aramex.*awb|awb_?no|_tracking_number$/i.test(m.key) && str(m.value)) return str(m.value);
    if (m.key === '_wc_shipment_tracking_items' && Array.isArray(m.value)) {
      const t = (m.value as { tracking_number?: string }[]).find((x) => str(x.tracking_number));
      if (t) return str(t.tracking_number);
    }
  }
  return null;
}

export function mapWooOrder(c: ChannelDef, o: WooOrder): IncomingOrder {
  const currency = (str(o.currency) ?? c.currency).toUpperCase();
  const paymentMethod = wooPaymentMethod(o.payment_method);
  const bill = o.billing ?? {};
  const ship = str(o.shipping?.address_1) || str(o.shipping?.city) ? (o.shipping as WooAddress) : bill;
  const placedAt = wooDate(o.date_created_gmt) ?? new Date();
  const modified = wooDate(o.date_modified_gmt) ?? placedAt;

  const items: IncomingItem[] = (o.line_items ?? [])
    .map((l) => {
      const qty = Math.max(0, Math.trunc(num(l.quantity)) || 0);
      const lineSubtotal = num(l.subtotal);
      // Unit price before coupons, like Shopify's originalUnitPrice; `price` is after them.
      const unit = Number.isFinite(lineSubtotal) && qty > 0 ? lineSubtotal / qty : num(l.price);
      return {
        sku: str(l.sku),
        barcode: null,
        title: str(l.name) ?? 'Item',
        variant: null,
        size: sizeOf(l.meta_data),
        brand: null,
        category: null,
        image: str(l.image?.src),
        quantity: qty,
        unitPrice: minor(unit, currency),
      };
    })
    .filter((i) => i.quantity > 0);

  const platform: NonNullable<IncomingOrder['platform']> = {};
  if (o.status === 'cancelled' || o.status === 'failed') platform.cancelled = { at: modified, reason: o.status === 'failed' ? 'payment failed' : null };
  if (o.status === 'completed') platform.fulfilled = { at: wooDate(o.date_completed_gmt) ?? modified, tracking: trackingOf(o.meta_data), company: null, url: null };
  if (o.status === 'refunded') platform.refunded = true;

  return {
    channelId: c.id,
    externalId: String(o.id),
    number: `WOO-${str(o.number) ?? o.id}`,
    source: 'woo',
    placedAt,
    customerName: fullName(ship.first_name, ship.last_name) ?? fullName(bill.first_name, bill.last_name) ?? str(bill.email) ?? 'Customer',
    phone: str(bill.phone) ?? str(o.shipping?.phone),
    email: str(bill.email),
    address: address(
      {
        name: fullName(ship.first_name, ship.last_name),
        line1: ship.address_1,
        line2: ship.address_2,
        city: ship.city,
        region: ship.state,
        country: ship.country,
        phone: str(ship.phone) ?? str(bill.phone),
      },
      c.country,
    ),
    currency,
    subtotal: items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
    shipping: minor(o.shipping_total, currency),
    discount: minor(o.discount_total, currency),
    total: minor(o.total, currency),
    paymentMethod,
    paymentStatus: wooPaymentStatus(o, paymentMethod),
    items,
    note: str(o.customer_note),
    tags: [],
    ...(Object.keys(platform).length ? { platform } : {}),
  };
}

export const WOO_TOPICS = new Set(['order.created', 'order.updated', 'order.restored']);

export const verifyWooSignature = (rawBody: string, header: string | null | undefined, secret: string | null | undefined) =>
  hmacBase64Matches(rawBody, header, secret);
