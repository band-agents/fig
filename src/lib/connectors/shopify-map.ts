// Shopify orders (Admin GraphQL 2025-07 nodes and REST webhook payloads) mapped to IncomingOrder.
// Pure: no env, no network. `subtotal` is before discounts, so subtotal − discount + shipping = total.
import type { ChannelDef, Country } from '../channels';
import type { IncomingItem, IncomingOrder } from './types';
import { appOrderNumber } from './medusa-map';
import { address, date, fullName, hmacBase64Matches, minor, num, SIZE_NAME, str } from './map-util';

// ── Query shapes ───────────────────────────────────────────────────────────────────────────────

/** Shopify refuses any single query whose requested cost exceeds 1000 points. */
const MAX_COST = 900;
const ORDER_COST = 30; // the order, four money bags, customer, address, attributes, five fulfillments, connection overhead
const LINE_COST = 8; // line, image, price bag, variant, options, product

/** How many orders per page and lines per order fit under the cost ceiling. Lines beyond that are fetched per order. */
export function pagePlan(requested: number): { first: number; lines: number } {
  const linesFor = (p: number) => Math.floor((MAX_COST / p - ORDER_COST) / LINE_COST);
  let first = Math.min(100, Math.max(1, Math.trunc(requested) || 1));
  while (first > 1 && linesFor(first) < 5) first--;
  return { first, lines: Math.min(100, Math.max(1, linesFor(first))) };
}

export const LINE_FIELDS =
  'title variantTitle quantity sku vendor image { url } originalUnitPriceSet { shopMoney { amount currencyCode } } variant { barcode selectedOptions { name value } product { productType } }';

const moneyField = (f: string) => `${f} { shopMoney { amount currencyCode } }`;

/** The order selection. `customer` is left out when the token lacks read_customers, which would fail the whole query. */
export function orderSelection(lines: number, withCustomer: boolean) {
  return [
    'id name createdAt processedAt updatedAt cancelledAt cancelReason displayFinancialStatus displayFulfillmentStatus',
    'paymentGatewayNames sourceName tags note email',
    moneyField('currentTotalPriceSet'),
    moneyField('currentSubtotalPriceSet'),
    moneyField('totalShippingPriceSet'),
    moneyField('totalDiscountsSet'),
    withCustomer ? 'customer { id firstName lastName email phone numberOfOrders }' : '',
    'shippingAddress { name firstName lastName phone address1 address2 city province zip country countryCodeV2 }',
    'customAttributes { key value }',
    `lineItems(first: ${lines}) { pageInfo { hasNextPage endCursor } nodes { ${LINE_FIELDS} } }`,
    'fulfillments(first: 5) { status displayStatus createdAt deliveredAt trackingInfo { number company url } }',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Types ──────────────────────────────────────────────────────────────────────────────────────

type MoneyBag = { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null;

export type ShopifyLineNode = {
  title?: string | null;
  variantTitle?: string | null;
  quantity?: number | null;
  sku?: string | null;
  vendor?: string | null;
  image?: { url?: string | null } | null;
  originalUnitPriceSet?: MoneyBag;
  variant?: {
    barcode?: string | null;
    selectedOptions?: { name: string; value: string }[] | null;
    product?: { productType?: string | null } | null;
  } | null;
};

export type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt?: string | null;
  processedAt?: string | null;
  updatedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  paymentGatewayNames?: string[] | null;
  sourceName?: string | null;
  tags?: string[] | null;
  note?: string | null;
  email?: string | null;
  currentTotalPriceSet?: MoneyBag;
  currentSubtotalPriceSet?: MoneyBag;
  totalShippingPriceSet?: MoneyBag;
  totalDiscountsSet?: MoneyBag;
  customer?: { id?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null } | null;
  shippingAddress?: {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
    countryCodeV2?: string | null;
  } | null;
  customAttributes?: { key: string; value?: string | null }[] | null;
  lineItems?: { nodes: ShopifyLineNode[]; pageInfo?: { hasNextPage: boolean; endCursor?: string | null } } | null;
  fulfillments?: {
    status?: string | null;
    displayStatus?: string | null;
    createdAt?: string | null;
    deliveredAt?: string | null;
    trackingInfo?: { number?: string | null; company?: string | null; url?: string | null }[] | null;
  }[] | null;
};

type RestAddress = {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country_code?: string | null;
};

/** The REST order JSON Shopify posts to order webhooks (only the fields Relay reads). */
export type ShopifyRestOrder = {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  created_at?: string;
  processed_at?: string | null;
  updated_at?: string;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  financial_status?: string | null;
  payment_gateway_names?: string[];
  source_name?: string | null;
  tags?: string | null;
  note?: string | null;
  note_attributes?: { name: string; value?: string | null }[];
  email?: string | null;
  contact_email?: string | null;
  currency?: string;
  total_price?: string;
  current_total_price?: string;
  subtotal_price?: string;
  current_subtotal_price?: string;
  total_discounts?: string;
  current_total_discounts?: string;
  total_shipping_price_set?: { shop_money?: { amount?: string } };
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null;
  shipping_address?: RestAddress | null;
  line_items?: {
    title?: string;
    variant_title?: string | null;
    quantity?: number;
    sku?: string | null;
    vendor?: string | null;
    price?: string;
    properties?: { name: string; value?: string | null }[];
  }[];
  fulfillments?: {
    status?: string;
    tracking_number?: string | null;
    tracking_numbers?: string[];
    tracking_company?: string | null;
    tracking_url?: string | null;
    tracking_urls?: string[];
    shipment_status?: string | null;
    created_at?: string;
    updated_at?: string;
  }[];
};

// ── Payment ────────────────────────────────────────────────────────────────────────────────────

export function shopifyPayment(
  gateways: string[] | null | undefined,
  financialStatus: string | null | undefined,
  country: Country,
): Pick<IncomingOrder, 'paymentMethod' | 'paymentStatus'> {
  const g = (gateways ?? []).join(' | ').toLowerCase();
  const fin = (financialStatus ?? '').toUpperCase();
  let method: IncomingOrder['paymentMethod'];
  // Wallets first: "Vodafone Cash" is a wallet, not cash on delivery.
  if (/wallet|vodafone/.test(g)) method = 'wallet';
  else if (/instapay/.test(g)) method = 'instapay';
  else if (/knet|myfatoorah/.test(g)) method = country === 'KW' ? 'knet' : 'card';
  else if (/cash|\bcod\b/.test(g)) method = 'cod';
  else if (/paymob|card|stripe|checkout|shopify_payments/.test(g)) method = 'card';
  else if (!g.trim()) method = fin === 'PENDING' ? 'cod' : 'card';
  else method = 'card';

  let status: IncomingOrder['paymentStatus'];
  if (fin === 'PAID') status = 'paid';
  else if (fin === 'REFUNDED') status = 'refunded';
  else if (fin === 'PARTIALLY_REFUNDED') status = 'partially_refunded';
  else if (fin === 'VOIDED') status = 'voided';
  else status = method === 'cod' ? 'cod_due' : 'pending';
  return { paymentMethod: method, paymentStatus: status };
}

// ── App orders pushed into Shopify ─────────────────────────────────────────────────────────────

/** Which app channel owns the app orders a Shopify store receives. */
const APP_CHANNEL_BY_CHANNEL: Record<string, string> = { 'fig-web': 'fig-app', 'labesny-web': 'labesny-app' };
const APP_CHANNEL_BY_STORE: Record<string, string> = { 'ujvi0q-ga': 'fig-app', 'szk0ey-ns': 'labesny-app' };
const APP_SOURCES = new Set(['fig-app', 'labesny-app']);

/**
 * FIG's apps push every order into Shopify with a `medusa_order_id` attribute (and `app_order_number`).
 * Filing that copy under the app channel with the Medusa id makes it the same Relay order as the one
 * the Medusa connector brings in, whichever arrives first.
 */
export function appOrderOrigin(
  c: Pick<ChannelDef, 'id' | 'store'>,
  o: { sourceName?: string | null; attributes?: { key: string; value?: string | null }[] | null },
): { channelId: string; externalId: string; number: string | null } | null {
  const attr = (k: string) => str((o.attributes ?? []).find((a) => a.key === k)?.value);
  const medusaId = attr('medusa_order_id');
  if (!medusaId) return null;
  const source = (o.sourceName ?? '').trim().toLowerCase();
  const channelId = APP_CHANNEL_BY_CHANNEL[c.id] ?? (c.store ? APP_CHANNEL_BY_STORE[c.store] : undefined) ?? (APP_SOURCES.has(source) ? source : undefined);
  if (!channelId) return null;
  const displayId = attr('app_order_number');
  return { channelId, externalId: medusaId, number: displayId ? appOrderNumber(channelId, displayId, '') : null };
}

// ── Orders ─────────────────────────────────────────────────────────────────────────────────────

const SIZE_TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|\d{2,3}(\.5)?|\d{1,2}-\d{1,2}Y|\d{1,2}Y|ONE SIZE|OS|FREE SIZE)$/i;

/** "M / Black" → "M", for payloads that carry no option names. */
export const sizeFromTitle = (variantTitle: string | null | undefined) =>
  (variantTitle ?? '')
    .split('/')
    .map((p) => p.trim())
    .find((p) => SIZE_TOKEN.test(p)) ?? null;

function lineItem(l: ShopifyLineNode, currency: string): IncomingItem {
  const named = (l.variant?.selectedOptions ?? []).find((o) => SIZE_NAME.test(o.name));
  return {
    sku: str(l.sku),
    barcode: str(l.variant?.barcode),
    title: str(l.title) ?? 'Item',
    variant: str(l.variantTitle),
    size: str(named?.value) ?? sizeFromTitle(l.variantTitle),
    brand: str(l.vendor),
    category: str(l.variant?.product?.productType),
    image: str(l.image?.url),
    quantity: Math.max(0, Math.trunc(num(l.quantity)) || 0),
    unitPrice: minor(l.originalUnitPriceSet?.shopMoney?.amount, currency),
  };
}

export function mapShopifyOrder(c: ChannelDef, n: ShopifyOrderNode): IncomingOrder {
  const currency = (str(n.currentTotalPriceSet?.shopMoney?.currencyCode) ?? c.currency).toUpperCase();
  const amt = (m: MoneyBag | undefined) => minor(m?.shopMoney?.amount, currency);
  const discount = amt(n.totalDiscountsSet);
  const ship = n.shippingAddress ?? null;
  const cust = n.customer ?? null;
  const placedAt = date(n.processedAt) ?? date(n.createdAt) ?? new Date();
  const origin = appOrderOrigin(c, { sourceName: n.sourceName, attributes: n.customAttributes });

  const platform: NonNullable<IncomingOrder['platform']> = {};
  const cancelledAt = date(n.cancelledAt);
  if (cancelledAt) platform.cancelled = { at: cancelledAt, reason: n.cancelReason ? n.cancelReason.toLowerCase() : null };
  const fulfillments = n.fulfillments ?? [];
  const done = fulfillments
    .filter((f) => f.status === 'SUCCESS')
    .sort((a, b) => (date(a.createdAt)?.getTime() ?? 0) - (date(b.createdAt)?.getTime() ?? 0));
  if (done.length) {
    const tracked = done.flatMap((f) => f.trackingInfo ?? []).find((t) => str(t.number)) ?? done[0].trackingInfo?.[0];
    platform.fulfilled = { at: date(done[0].createdAt) ?? placedAt, tracking: str(tracked?.number), company: str(tracked?.company), url: str(tracked?.url) };
  }
  const delivered = fulfillments.find((f) => f.status !== 'CANCELLED' && (f.displayStatus === 'DELIVERED' || date(f.deliveredAt)));
  if (delivered) platform.delivered = { at: date(delivered.deliveredAt) ?? date(delivered.createdAt) ?? placedAt };
  if ((n.displayFinancialStatus ?? '').toUpperCase() === 'REFUNDED') platform.refunded = true;

  return {
    channelId: origin?.channelId ?? c.id,
    externalId: origin?.externalId ?? n.id,
    number: origin?.number ?? n.name,
    source: 'shopify',
    placedAt,
    customerName: str(ship?.name) ?? fullName(ship?.firstName, ship?.lastName) ?? fullName(cust?.firstName, cust?.lastName) ?? str(n.email) ?? 'Customer',
    phone: str(ship?.phone) ?? str(cust?.phone),
    email: str(n.email) ?? str(cust?.email),
    address: ship
      ? address(
          { name: str(ship.name) ?? fullName(ship.firstName, ship.lastName), line1: ship.address1, line2: ship.address2, city: ship.city, region: ship.province, country: ship.countryCodeV2, phone: ship.phone },
          c.country,
        )
      : null,
    currency,
    subtotal: amt(n.currentSubtotalPriceSet) + discount,
    shipping: amt(n.totalShippingPriceSet),
    discount,
    total: amt(n.currentTotalPriceSet),
    ...shopifyPayment(n.paymentGatewayNames, n.displayFinancialStatus, c.country),
    items: (n.lineItems?.nodes ?? []).map((l) => lineItem(l, currency)).filter((i) => i.quantity > 0),
    note: str(n.note),
    tags: n.tags ?? [],
    ...(Object.keys(platform).length ? { platform } : {}),
  };
}

/** The REST webhook payload, mapped to the same IncomingOrder a pull would produce (minus images, barcodes, categories). */
export function mapShopifyRestOrder(c: ChannelDef, p: ShopifyRestOrder): IncomingOrder | null {
  if (!p || typeof p !== 'object') return null;
  const externalId = str(p.admin_graphql_api_id) ?? (str(p.id) ? `gid://shopify/Order/${str(p.id)}` : null);
  if (!externalId) return null;
  const currency = (str(p.currency) ?? c.currency).toUpperCase();
  const discount = minor(p.current_total_discounts ?? p.total_discounts, currency);
  const ship = p.shipping_address ?? null;
  const cust = p.customer ?? null;
  const placedAt = date(p.processed_at) ?? date(p.created_at) ?? new Date();
  const attributes = (p.note_attributes ?? []).map((a) => ({ key: a.name, value: a.value ?? null }));
  const origin = appOrderOrigin(c, { sourceName: p.source_name, attributes });

  const platform: NonNullable<IncomingOrder['platform']> = {};
  const cancelledAt = date(p.cancelled_at);
  if (cancelledAt) platform.cancelled = { at: cancelledAt, reason: str(p.cancel_reason) };
  const fulfillments = p.fulfillments ?? [];
  const done = fulfillments
    .filter((f) => f.status === 'success')
    .sort((a, b) => (date(a.created_at)?.getTime() ?? 0) - (date(b.created_at)?.getTime() ?? 0));
  if (done.length) {
    const tracked = done.find((f) => str(f.tracking_number) || f.tracking_numbers?.length) ?? done[0];
    platform.fulfilled = {
      at: date(done[0].created_at) ?? placedAt,
      tracking: str(tracked.tracking_number) ?? str(tracked.tracking_numbers?.[0]),
      company: str(tracked.tracking_company),
      url: str(tracked.tracking_url) ?? str(tracked.tracking_urls?.[0]),
    };
  }
  const delivered = done.find((f) => f.shipment_status === 'delivered');
  if (delivered) platform.delivered = { at: date(delivered.updated_at) ?? date(delivered.created_at) ?? placedAt };
  if ((p.financial_status ?? '').toLowerCase() === 'refunded') platform.refunded = true;

  const items: IncomingItem[] = (p.line_items ?? [])
    .map((l) => ({
      sku: str(l.sku),
      barcode: null,
      title: str(l.title) ?? 'Item',
      variant: str(l.variant_title),
      size: str((l.properties ?? []).find((x) => SIZE_NAME.test(x.name))?.value) ?? sizeFromTitle(l.variant_title),
      brand: str(l.vendor),
      category: null,
      image: null,
      quantity: Math.max(0, Math.trunc(num(l.quantity)) || 0),
      unitPrice: minor(l.price, currency),
    }))
    .filter((i) => i.quantity > 0);

  return {
    channelId: origin?.channelId ?? c.id,
    externalId: origin?.externalId ?? externalId,
    number: origin?.number ?? str(p.name) ?? externalId,
    source: 'shopify',
    placedAt,
    customerName: str(ship?.name) ?? fullName(ship?.first_name, ship?.last_name) ?? fullName(cust?.first_name, cust?.last_name) ?? str(p.email) ?? 'Customer',
    phone: str(ship?.phone) ?? str(cust?.phone),
    email: str(p.email) ?? str(p.contact_email) ?? str(cust?.email),
    address: ship
      ? address(
          { name: str(ship.name) ?? fullName(ship.first_name, ship.last_name), line1: ship.address1, line2: ship.address2, city: ship.city, region: ship.province, country: ship.country_code, phone: ship.phone },
          c.country,
        )
      : null,
    currency,
    subtotal: minor(p.current_subtotal_price ?? p.subtotal_price, currency) + discount,
    shipping: minor(p.total_shipping_price_set?.shop_money?.amount, currency),
    discount,
    total: minor(p.current_total_price ?? p.total_price, currency),
    ...shopifyPayment(p.payment_gateway_names, p.financial_status, c.country),
    items,
    note: str(p.note),
    tags: (p.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    ...(Object.keys(platform).length ? { platform } : {}),
  };
}

// ── Webhooks, scopes ───────────────────────────────────────────────────────────────────────────

export const ORDER_TOPICS = new Set(['orders/create', 'orders/updated', 'orders/paid', 'orders/cancelled', 'orders/fulfilled', 'orders/partially_fulfilled']);

export const verifyShopifyHmac = (rawBody: string, header: string | null | undefined, secret: string | null | undefined) =>
  hmacBase64Matches(rawBody, header, secret);

export const READ_SCOPES = ['read_orders', 'read_customers', 'read_fulfillments'];

export function scopeReport(granted: string[]) {
  const set = new Set(granted);
  const has = (s: string) => set.has(s) || (s.startsWith('read_') && set.has(`write_${s.slice(5)}`));
  const writeMissing: string[] = [];
  if (!has('write_orders')) writeMissing.push('write_orders');
  if (!has('write_merchant_managed_fulfillment_orders') && !has('write_fulfillments')) writeMissing.push('write_merchant_managed_fulfillment_orders');
  return {
    missing: READ_SCOPES.filter((s) => !has(s)),
    writeMissing,
    allOrders: has('read_all_orders'),
    customers: has('read_customers'),
  };
}

/** True when an order came back with its customer details blanked: Shopify's protected customer data gate. */
export function customerDataHidden(
  probe: { data?: { orders?: { nodes?: Partial<ShopifyOrderNode>[] } } | null; errors?: { message: string }[] } | null,
) {
  if (probe?.errors?.some((e) => /protected customer data|not approved to access/i.test(e.message))) return true;
  const o = probe?.data?.orders?.nodes?.[0];
  if (!o) return false;
  const customerBlank = Boolean(o.customer?.id) && !o.customer?.firstName && !o.customer?.lastName && !o.customer?.email;
  const addressBlank = Boolean(o.shippingAddress) && !o.shippingAddress?.name && !o.shippingAddress?.phone && !o.shippingAddress?.address1;
  return customerBlank || addressBlank;
}

export function checkNote(
  shop: { name?: string; currency?: string; timezone?: string },
  report: ReturnType<typeof scopeReport>,
  hidden: boolean,
) {
  const parts = [`Connected to ${shop.name ?? 'the store'}${shop.currency ? ` (${shop.currency}${shop.timezone ? `, ${shop.timezone}` : ''})` : ''}`];
  if (report.missing.length) parts.push(`missing ${report.missing.join(', ')}`);
  if (hidden) parts.push("customer names and phones come back empty, so the app needs Shopify's protected customer data access");
  if (!report.allOrders) parts.push('orders older than 60 days need read_all_orders');
  parts.push(report.writeMissing.length ? `write-back would also need ${report.writeMissing.join(' and ')}` : 'write-back scopes granted');
  return `${parts.join('; ')}.`;
}
