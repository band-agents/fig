// Medusa v2 admin orders (the FIG and Labesny apps) mapped to IncomingOrder. Pure: no env, no network.
// Medusa sends money in major units as numbers; its `subtotal` includes shipping, so items use item_subtotal.
import type { ChannelDef } from '../channels';
import type { IncomingItem, IncomingOrder } from './types';
import { address, date, fullName, minor, num, SIZE_NAME, str } from './map-util';

/** Order numbers staff say out loud for app orders: FIGAPP-1042, LBAPP-88. */
export const APP_PREFIX: Record<string, string> = { 'fig-app': 'FIGAPP', 'labesny-app': 'LBAPP' };

export const appOrderNumber = (channelId: string, displayId: unknown, fallback: string) => {
  const d = str(displayId);
  const prefix = APP_PREFIX[channelId] ?? channelId.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return d ? `${prefix}-${d}` : fallback;
};

/** The `fields` list for GET /admin/orders. Totals and the two statuses are computed by Medusa's list workflow. */
export const MEDUSA_ORDER_FIELDS = [
  'id',
  'display_id',
  'created_at',
  'updated_at',
  'canceled_at',
  'status',
  'payment_status',
  'fulfillment_status',
  'currency_code',
  'email',
  'total',
  'subtotal',
  'item_subtotal',
  'shipping_total',
  'discount_total',
  'metadata',
  '*items',
  'items.variant.options.value',
  'items.variant.options.option.title',
  'items.variant.product.metadata',
  '*shipping_address',
  '*customer',
  'payment_collections.status',
  'payment_collections.payments.provider_id',
  'payment_collections.payment_sessions.provider_id',
  'payment_collections.payment_sessions.status',
  '*fulfillments',
  '*fulfillments.labels',
].join(',');

type MedusaAddress = {
  first_name?: string | null;
  last_name?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  phone?: string | null;
};

export type MedusaItem = {
  title?: string | null;
  subtitle?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  quantity?: unknown;
  unit_price?: unknown;
  thumbnail?: string | null;
  variant_sku?: string | null;
  variant_barcode?: string | null;
  product_type?: string | null;
  product_collection?: string | null;
  variant_option_values?: Record<string, unknown> | null;
  variant?: {
    options?: { value?: string | null; option?: { title?: string | null } | null }[] | null;
    product?: { metadata?: Record<string, unknown> | null } | null;
  } | null;
};

export type MedusaOrder = {
  id: string;
  display_id?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  canceled_at?: string | null;
  status?: string | null;
  payment_status?: string | null;
  fulfillment_status?: string | null;
  currency_code?: string | null;
  email?: string | null;
  total?: unknown;
  subtotal?: unknown;
  item_subtotal?: unknown;
  shipping_total?: unknown;
  discount_total?: unknown;
  metadata?: Record<string, unknown> | null;
  items?: MedusaItem[] | null;
  shipping_address?: MedusaAddress | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null;
  payment_collections?: {
    status?: string | null;
    payments?: { provider_id?: string | null }[] | null;
    payment_sessions?: { provider_id?: string | null; status?: string | null }[] | null;
  }[] | null;
  fulfillments?: {
    created_at?: string | null;
    shipped_at?: string | null;
    delivered_at?: string | null;
    canceled_at?: string | null;
    provider_id?: string | null;
    labels?: { tracking_number?: string | null; tracking_url?: string | null }[] | null;
  }[] | null;
};

/** Recorded payments decide; an authorised session is the fallback before capture. No provider at all is cash. */
export function medusaPaymentMethod(o: Pick<MedusaOrder, 'payment_collections'>): IncomingOrder['paymentMethod'] {
  const cols = o.payment_collections ?? [];
  const paid = cols.flatMap((c) => c.payments ?? []).map((p) => p.provider_id ?? '');
  const providers = paid.length
    ? paid
    : cols
        .flatMap((c) => c.payment_sessions ?? [])
        .filter((s) => s.status === 'authorized' || s.status === 'captured')
        .map((s) => s.provider_id ?? '');
  const p = providers.join(' ').toLowerCase();
  if (p.includes('paymob')) return 'card';
  if (p.includes('myfatoorah')) return 'knet';
  if (!p.trim() || p.includes('system_default')) return 'cod';
  return 'card';
}

export function medusaPaymentStatus(status: string | null | undefined, method: IncomingOrder['paymentMethod']): IncomingOrder['paymentStatus'] {
  switch (status) {
    case 'captured':
      return 'paid';
    case 'refunded':
      return 'refunded';
    case 'partially_refunded':
      return 'partially_refunded';
    case 'canceled':
      return 'voided';
    default:
      return method === 'cod' ? 'cod_due' : 'pending';
  }
}

function sizeOf(item: MedusaItem): string | null {
  for (const [k, v] of Object.entries(item.variant_option_values ?? {})) if (SIZE_NAME.test(k) && str(v)) return str(v);
  for (const o of item.variant?.options ?? []) if (SIZE_NAME.test(o.option?.title ?? '') && str(o.value)) return str(o.value);
  return null;
}

export function mapMedusaItem(item: MedusaItem, currency: string): IncomingItem {
  const meta = item.variant?.product?.metadata ?? {};
  const qty = num(item.quantity);
  return {
    sku: str(item.variant_sku),
    barcode: str(item.variant_barcode),
    title: str(item.product_title) ?? str(item.subtitle) ?? str(item.title) ?? 'Item',
    variant: str(item.variant_title),
    size: sizeOf(item),
    brand: str(meta.brand) ?? str(item.product_collection),
    category: str(item.product_type) ?? str(meta.product_type),
    image: str(item.thumbnail),
    quantity: Number.isFinite(qty) ? Math.trunc(qty) : 1,
    unitPrice: minor(item.unit_price, currency),
  };
}

export function mapMedusaOrder(c: ChannelDef, o: MedusaOrder): IncomingOrder {
  const currency = (str(o.currency_code) ?? c.currency).toUpperCase();
  const items = (o.items ?? []).map((i) => mapMedusaItem(i, currency)).filter((i) => i.quantity > 0);
  const ship = o.shipping_address ?? {};
  const cust = o.customer ?? {};
  const paymentMethod = medusaPaymentMethod(o);
  const itemSubtotal = num(o.item_subtotal);
  const subtotal = Number.isFinite(itemSubtotal) ? minor(itemSubtotal, currency) : items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const placedAt = date(o.created_at) ?? date(o.updated_at) ?? new Date();

  const platform: NonNullable<IncomingOrder['platform']> = {};
  if (o.status === 'canceled' || o.canceled_at) platform.cancelled = { at: date(o.canceled_at) ?? date(o.updated_at) ?? placedAt, reason: null };
  const live = (o.fulfillments ?? [])
    .filter((f) => !f.canceled_at)
    .sort((a, b) => (date(a.created_at)?.getTime() ?? 0) - (date(b.created_at)?.getTime() ?? 0));
  const first = live[0];
  if (first) {
    const label = live.flatMap((f) => f.labels ?? []).find((l) => str(l.tracking_number));
    platform.fulfilled = {
      at: date(first.shipped_at) ?? date(first.created_at) ?? placedAt,
      tracking: str(label?.tracking_number),
      company: /aramex/i.test(first.provider_id ?? '') ? 'Aramex' : null,
      url: str(label?.tracking_url),
    };
  }
  const delivered = live.map((f) => date(f.delivered_at)).find((d): d is Date => Boolean(d));
  if (delivered) platform.delivered = { at: delivered };
  if (o.payment_status === 'refunded') platform.refunded = true;

  return {
    channelId: c.id,
    externalId: o.id,
    number: appOrderNumber(c.id, o.display_id, o.id),
    source: 'medusa',
    placedAt,
    customerName: fullName(ship.first_name, ship.last_name) ?? fullName(cust.first_name, cust.last_name) ?? str(o.email) ?? str(cust.email) ?? 'App customer',
    phone: str(ship.phone) ?? str(cust.phone),
    email: str(o.email) ?? str(cust.email),
    address: address(
      { name: fullName(ship.first_name, ship.last_name), line1: ship.address_1, line2: ship.address_2, city: ship.city, region: ship.province, country: ship.country_code, phone: ship.phone },
      c.country,
    ),
    currency,
    subtotal,
    shipping: minor(o.shipping_total, currency),
    discount: minor(o.discount_total, currency),
    total: minor(o.total, currency),
    paymentMethod,
    paymentStatus: medusaPaymentStatus(o.payment_status, paymentMethod),
    items,
    note: null,
    tags: [],
    ...(Object.keys(platform).length ? { platform } : {}),
  };
}
