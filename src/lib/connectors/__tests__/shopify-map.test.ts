import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHANNEL } from '../../channels';
import {
  appOrderOrigin,
  checkNote,
  customerDataHidden,
  mapShopifyOrder,
  mapShopifyRestOrder,
  orderSelection,
  pagePlan,
  scopeReport,
  shopifyPayment,
  sizeFromTitle,
  verifyShopifyHmac,
  type ShopifyOrderNode,
  type ShopifyRestOrder,
} from '../shopify-map';

const figWeb = CHANNEL['fig-web'];
const labesnyWeb = CHANNEL['labesny-web'];
const wsEg = CHANNEL['ws-eg'];

const labesnyNode: ShopifyOrderNode = {
  id: 'gid://shopify/Order/6123456789012',
  name: '#1042',
  createdAt: '2026-10-01T09:14:00Z',
  processedAt: '2026-10-01T09:13:58Z',
  updatedAt: '2026-10-02T11:00:00Z',
  cancelledAt: null,
  cancelReason: null,
  displayFinancialStatus: 'PENDING',
  displayFulfillmentStatus: 'FULFILLED',
  paymentGatewayNames: ['Cash on Delivery (COD)'],
  sourceName: 'web',
  tags: ['vip'],
  note: 'Call before delivery',
  email: 'noura@example.com',
  currentTotalPriceSet: { shopMoney: { amount: '27.750', currencyCode: 'KWD' } },
  currentSubtotalPriceSet: { shopMoney: { amount: '25.750', currencyCode: 'KWD' } },
  totalShippingPriceSet: { shopMoney: { amount: '2.0', currencyCode: 'KWD' } },
  totalDiscountsSet: { shopMoney: { amount: '3.250', currencyCode: 'KWD' } },
  customer: { id: 'gid://shopify/Customer/7001', firstName: 'Noura', lastName: 'Al-Sabah', email: 'noura@example.com', phone: '+96550001234' },
  shippingAddress: {
    name: 'Noura Al-Sabah',
    firstName: 'Noura',
    lastName: 'Al-Sabah',
    phone: '5000 1234',
    address1: 'Block 4, Street 12, House 7',
    address2: null,
    city: 'Salmiya',
    province: 'Hawalli',
    zip: null,
    country: 'Kuwait',
    countryCodeV2: 'KW',
  },
  customAttributes: [],
  lineItems: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [
      {
        title: 'Satin Slip Dress',
        variantTitle: 'M / Champagne',
        quantity: 1,
        sku: 'LB-SD-001-M',
        vendor: 'Labesny',
        image: { url: 'https://cdn.shopify.com/s/files/1/dress.jpg' },
        originalUnitPriceSet: { shopMoney: { amount: '19.500', currencyCode: 'KWD' } },
        variant: { barcode: '6291041500213', selectedOptions: [{ name: 'Color', value: 'Champagne' }, { name: 'Size', value: 'M' }], product: { productType: 'Dresses' } },
      },
      {
        title: 'Silk Scarf',
        variantTitle: null,
        quantity: 1,
        sku: 'LB-SC-9',
        vendor: 'Labesny',
        image: null,
        originalUnitPriceSet: { shopMoney: { amount: '9.500', currencyCode: 'KWD' } },
        variant: { barcode: null, selectedOptions: [{ name: 'Title', value: 'Default Title' }], product: { productType: 'Accessories' } },
      },
    ],
  },
  fulfillments: [
    {
      status: 'SUCCESS',
      displayStatus: 'DELIVERED',
      createdAt: '2026-10-01T15:00:00Z',
      deliveredAt: '2026-10-02T10:30:00Z',
      trackingInfo: [{ number: '44012345678', company: 'Aramex', url: 'https://www.aramex.com/kw/en/track/results?ShipmentNumber=44012345678' }],
    },
  ],
};

const figRest: ShopifyRestOrder = {
  id: 5891234567890,
  admin_graphql_api_id: 'gid://shopify/Order/5891234567890',
  name: '#2210',
  created_at: '2026-10-05T13:20:11+03:00',
  processed_at: '2026-10-05T13:20:10+03:00',
  updated_at: '2026-10-06T10:00:05+03:00',
  cancelled_at: null,
  cancel_reason: null,
  financial_status: 'paid',
  payment_gateway_names: ['Paymob'],
  source_name: 'web',
  tags: 'first-order, ramadan',
  note: null,
  note_attributes: [],
  email: 'mariam@example.com',
  currency: 'EGP',
  total_price: '2145.00',
  subtotal_price: '1995.00',
  total_discounts: '200.00',
  total_shipping_price_set: { shop_money: { amount: '150.00' } },
  customer: { first_name: 'Mariam', last_name: 'Hassan', email: 'mariam@example.com', phone: null },
  shipping_address: {
    first_name: 'Mariam',
    last_name: 'Hassan',
    name: 'Mariam Hassan',
    phone: '01012345678',
    address1: '12 El Nasr St',
    address2: 'Apt 5',
    city: 'Nasr City',
    province: 'Cairo',
    country_code: 'EG',
  },
  line_items: [
    { title: 'Linen Shirt', variant_title: 'L / White', quantity: 1, sku: '6223001234567', vendor: 'FIG', price: '1195.00', properties: [] },
    { title: 'Chino Pants', variant_title: '32 / Beige', quantity: 1, sku: '6223007654321', vendor: 'FIG', price: '1000.00', properties: [] },
  ],
  fulfillments: [
    {
      status: 'success',
      tracking_number: '50907347411',
      tracking_numbers: ['50907347411'],
      tracking_company: 'Aramex',
      tracking_url: 'https://www.aramex.com/eg/en/track/results?ShipmentNumber=50907347411',
      shipment_status: 'in_transit',
      created_at: '2026-10-06T10:00:00+03:00',
      updated_at: '2026-10-06T10:00:00+03:00',
    },
  ],
};

describe('Shopify GraphQL order mapping', () => {
  const o = mapShopifyOrder(labesnyWeb, labesnyNode);

  it('keeps KWD in fils (three decimals) and reports subtotal before discounts', () => {
    expect(o.currency).toBe('KWD');
    expect(o.total).toBe(27750);
    expect(o.discount).toBe(3250);
    expect(o.shipping).toBe(2000);
    expect(o.subtotal).toBe(29000);
    expect(o.subtotal - o.discount + o.shipping).toBe(o.total);
    expect(o.items.map((i) => i.unitPrice)).toEqual([19500, 9500]);
  });

  it('maps identity, customer, phone and address', () => {
    expect(o).toMatchObject({
      channelId: 'labesny-web',
      externalId: 'gid://shopify/Order/6123456789012',
      number: '#1042',
      source: 'shopify',
      customerName: 'Noura Al-Sabah',
      phone: '5000 1234',
      email: 'noura@example.com',
      note: 'Call before delivery',
      tags: ['vip'],
      address: { name: 'Noura Al-Sabah', line1: 'Block 4, Street 12, House 7', city: 'Salmiya', region: 'Hawalli', country: 'KW', phone: '5000 1234' },
    });
    expect(o.address).not.toHaveProperty('line2');
    expect(o.placedAt.toISOString()).toBe('2026-10-01T09:13:58.000Z');
  });

  it('falls back to the customer phone when the address has none', () => {
    const n = { ...labesnyNode, shippingAddress: { ...labesnyNode.shippingAddress, phone: null } };
    expect(mapShopifyOrder(labesnyWeb, n).phone).toBe('+96550001234');
  });

  it('reads size, barcode, image, brand and category off the line', () => {
    expect(o.items[0]).toEqual({
      sku: 'LB-SD-001-M',
      barcode: '6291041500213',
      title: 'Satin Slip Dress',
      variant: 'M / Champagne',
      size: 'M',
      brand: 'Labesny',
      category: 'Dresses',
      image: 'https://cdn.shopify.com/s/files/1/dress.jpg',
      quantity: 1,
      unitPrice: 19500,
    });
    expect(o.items[1]).toMatchObject({ size: null, image: null, barcode: null, category: 'Accessories' });
  });

  it('treats a COD gateway on a pending order as cash due', () => {
    expect(o.paymentMethod).toBe('cod');
    expect(o.paymentStatus).toBe('cod_due');
  });

  it('turns fulfilments into platform facts', () => {
    expect(o.platform?.fulfilled).toEqual({
      at: new Date('2026-10-01T15:00:00Z'),
      tracking: '44012345678',
      company: 'Aramex',
      url: 'https://www.aramex.com/kw/en/track/results?ShipmentNumber=44012345678',
    });
    expect(o.platform?.delivered).toEqual({ at: new Date('2026-10-02T10:30:00Z') });
    expect(o.platform?.cancelled).toBeUndefined();
  });

  it('records cancellation and refunds', () => {
    const n: ShopifyOrderNode = { ...labesnyNode, cancelledAt: '2026-10-03T08:00:00Z', cancelReason: 'CUSTOMER', displayFinancialStatus: 'REFUNDED', fulfillments: [] };
    const c = mapShopifyOrder(labesnyWeb, n);
    expect(c.platform).toEqual({ cancelled: { at: new Date('2026-10-03T08:00:00Z'), reason: 'customer' }, refunded: true });
    expect(c.paymentStatus).toBe('refunded');
  });

  it('ignores cancelled fulfilments', () => {
    const n: ShopifyOrderNode = { ...labesnyNode, fulfillments: [{ status: 'CANCELLED', displayStatus: 'CANCELED', createdAt: '2026-10-01T15:00:00Z', deliveredAt: null, trackingInfo: [] }] };
    expect(mapShopifyOrder(labesnyWeb, n).platform).toBeUndefined();
  });
});

describe('app orders pushed into Shopify', () => {
  const pushed: ShopifyOrderNode = {
    ...labesnyNode,
    id: 'gid://shopify/Order/6200000000001',
    name: '#1077',
    sourceName: 'fig-app',
    currentTotalPriceSet: { shopMoney: { amount: '1995.00', currencyCode: 'EGP' } },
    customAttributes: [
      { key: 'medusa_order_id', value: 'order_01JB2X8K3MZQ' },
      { key: 'channel', value: 'fig-app' },
      { key: 'app_order_number', value: '312' },
    ],
  };

  it('files the FIG store copy under the FIG app with the Medusa id and app number', () => {
    const o = mapShopifyOrder(figWeb, pushed);
    expect(o.channelId).toBe('fig-app');
    expect(o.externalId).toBe('order_01JB2X8K3MZQ');
    expect(o.number).toBe('FIGAPP-312');
    expect(o.currency).toBe('EGP');
  });

  it('picks the app by store, then by source name', () => {
    const attrs = [{ key: 'medusa_order_id', value: 'order_x' }];
    expect(appOrderOrigin(labesnyWeb, { sourceName: 'labesny-app', attributes: attrs })).toEqual({ channelId: 'labesny-app', externalId: 'order_x', number: null });
    expect(appOrderOrigin({ id: 'other', store: 'ujvi0q-ga' }, { sourceName: 'mobile-app', attributes: attrs })?.channelId).toBe('fig-app');
    expect(appOrderOrigin(wsEg, { sourceName: 'fig-app', attributes: attrs })?.channelId).toBe('fig-app');
    expect(appOrderOrigin(wsEg, { sourceName: 'mobile-app', attributes: attrs })).toBeNull();
  });

  it('leaves ordinary orders alone', () => {
    expect(appOrderOrigin(figWeb, { sourceName: 'fig-app', attributes: [] })).toBeNull();
    expect(appOrderOrigin(figWeb, { sourceName: 'web', attributes: [{ key: 'gift_note', value: 'x' }] })).toBeNull();
  });

  it('dedupes the REST webhook copy the same way', () => {
    const o = mapShopifyRestOrder(labesnyWeb, {
      ...figRest,
      source_name: 'labesny-app',
      currency: 'KWD',
      note_attributes: [
        { name: 'medusa_order_id', value: 'order_01LB' },
        { name: 'app_order_number', value: '88' },
      ],
    });
    expect(o).toMatchObject({ channelId: 'labesny-app', externalId: 'order_01LB', number: 'LBAPP-88' });
  });
});

describe('Shopify REST webhook mapping', () => {
  const o = mapShopifyRestOrder(figWeb, figRest)!;

  it('uses the GraphQL id so webhooks and pulls match', () => {
    expect(o.externalId).toBe('gid://shopify/Order/5891234567890');
    expect(o.number).toBe('#2210');
    expect(o.channelId).toBe('fig-web');
  });

  it('maps money in piastres', () => {
    expect(o).toMatchObject({ currency: 'EGP', subtotal: 219500, discount: 20000, shipping: 15000, total: 214500 });
    expect(o.items.map((i) => [i.title, i.size, i.unitPrice])).toEqual([
      ['Linen Shirt', 'L', 119500],
      ['Chino Pants', '32', 100000],
    ]);
  });

  it('maps payment, tags, contact and address', () => {
    expect(o.paymentMethod).toBe('card');
    expect(o.paymentStatus).toBe('paid');
    expect(o.tags).toEqual(['first-order', 'ramadan']);
    expect(o.phone).toBe('01012345678');
    expect(o.customerName).toBe('Mariam Hassan');
    expect(o.address).toEqual({ name: 'Mariam Hassan', line1: '12 El Nasr St', line2: 'Apt 5', city: 'Nasr City', region: 'Cairo', country: 'EG', phone: '01012345678' });
    expect(o.placedAt.toISOString()).toBe('2026-10-05T10:20:10.000Z');
  });

  it('reads fulfilment and delivery from the REST fulfilments', () => {
    expect(o.platform?.fulfilled).toMatchObject({ at: new Date('2026-10-06T07:00:00Z'), tracking: '50907347411', company: 'Aramex' });
    expect(o.platform?.delivered).toBeUndefined();
    const delivered = mapShopifyRestOrder(figWeb, { ...figRest, fulfillments: [{ ...figRest.fulfillments![0], shipment_status: 'delivered', updated_at: '2026-10-07T12:00:00Z' }] });
    expect(delivered?.platform?.delivered).toEqual({ at: new Date('2026-10-07T12:00:00Z') });
  });

  it('builds the GraphQL id when the payload lacks one, and refuses payloads without an id', () => {
    const { admin_graphql_api_id: _, ...bare } = figRest;
    void _;
    expect(mapShopifyRestOrder(figWeb, bare)?.externalId).toBe('gid://shopify/Order/5891234567890');
    expect(mapShopifyRestOrder(figWeb, {})).toBeNull();
  });
});

describe('Shopify payment mapping', () => {
  it.each([
    [['Cash on Delivery (COD)'], 'PENDING', 'EG', 'cod', 'cod_due'],
    [['cod'], 'PAID', 'EG', 'cod', 'paid'],
    [['Vodafone Cash'], 'PAID', 'EG', 'wallet', 'paid'],
    [['KNET'], 'PAID', 'KW', 'knet', 'paid'],
    [['myfatoorah'], 'PENDING', 'KW', 'knet', 'pending'],
    [['myfatoorah'], 'PAID', 'EG', 'card', 'paid'],
    [['Paymob'], 'PAID', 'EG', 'card', 'paid'],
    [['HyperPay'], 'PAID', 'JO', 'card', 'paid'],
    [['HyperPay - Visa / Mastercard'], 'PENDING', 'JO', 'card', 'pending'],
    [['Cash on Delivery (COD)'], 'PENDING', 'JO', 'cod', 'cod_due'],
    [['shopify_payments'], 'PARTIALLY_REFUNDED', 'KW', 'card', 'partially_refunded'],
    [['InstaPay'], 'PENDING', 'EG', 'instapay', 'pending'],
    [[], 'PENDING', 'EG', 'cod', 'cod_due'],
    [[], 'PAID', 'EG', 'card', 'paid'],
    [['manual'], 'AUTHORIZED', 'EG', 'card', 'pending'],
    [['Paymob'], 'REFUNDED', 'EG', 'card', 'refunded'],
    [['Paymob'], 'VOIDED', 'EG', 'card', 'voided'],
  ] as const)('%j %s in %s → %s / %s', (gateways, fin, country, method, status) => {
    expect(shopifyPayment([...gateways], fin, country)).toEqual({ paymentMethod: method, paymentStatus: status });
  });
});

describe('Shopify webhook signatures', () => {
  const secret = 'shpss_test_secret';
  const body = JSON.stringify({ id: 1, name: '#1001', note: 'اتصل قبل التوصيل' });
  const sign = (b: string, s = secret) => createHmac('sha256', s).update(b, 'utf8').digest('base64');

  it('accepts the exact body Shopify signed', () => {
    expect(verifyShopifyHmac(body, sign(body), secret)).toBe(true);
  });

  it('rejects a changed body, a wrong secret, or a missing header', () => {
    expect(verifyShopifyHmac(`${body} `, sign(body), secret)).toBe(false);
    expect(verifyShopifyHmac(body, sign(body, 'other'), secret)).toBe(false);
    expect(verifyShopifyHmac(body, null, secret)).toBe(false);
    expect(verifyShopifyHmac(body, sign(body), undefined)).toBe(false);
    expect(verifyShopifyHmac(body, 'not-base64!!', secret)).toBe(false);
  });
});

describe('query shape and scopes', () => {
  it('keeps every page under Shopify’s 1000-point query cost', () => {
    for (const requested of [1, 5, 10, 25, 50, 100]) {
      const { first, lines } = pagePlan(requested);
      expect(first).toBeLessThanOrEqual(requested);
      expect(first * (30 + lines * 8)).toBeLessThanOrEqual(1000);
      expect(lines).toBeGreaterThanOrEqual(5);
    }
    expect(pagePlan(10)).toEqual({ first: 10, lines: 7 });
  });

  it('never asks for returns, and drops customer without read_customers', () => {
    expect(orderSelection(7, true)).toContain('customer {');
    expect(orderSelection(7, false)).not.toContain('customer {');
    expect(orderSelection(7, true)).toContain('lineItems(first: 7)');
    expect(orderSelection(7, true)).not.toMatch(/returns/);
  });

  it('reports missing read scopes and write-back scopes separately', () => {
    const r = scopeReport(['read_orders', 'read_customers', 'read_fulfillments', 'write_orders']);
    expect(r).toEqual({ missing: [], writeMissing: ['write_merchant_managed_fulfillment_orders'], allOrders: false, customers: true });
    expect(scopeReport(['write_orders', 'read_all_orders']).missing).toEqual(['read_customers', 'read_fulfillments']);
    expect(scopeReport(['write_orders', 'write_customers', 'write_fulfillments', 'read_all_orders'])).toEqual({ missing: [], writeMissing: [], allOrders: true, customers: true });
  });

  it('spots blanked customer data', () => {
    expect(customerDataHidden({ errors: [{ message: 'This app is not approved to access the Customer object.' }] })).toBe(true);
    expect(customerDataHidden({ data: { orders: { nodes: [{ customer: { id: 'gid://shopify/Customer/1', firstName: null, lastName: null, email: null } }] } } })).toBe(true);
    expect(customerDataHidden({ data: { orders: { nodes: [{ customer: { id: 'gid://shopify/Customer/1', firstName: 'Noura' }, shippingAddress: { name: 'Noura' } }] } } })).toBe(false);
    expect(customerDataHidden({ data: { orders: { nodes: [] } } })).toBe(false);
  });

  it('writes one readable note', () => {
    const note = checkNote({ name: 'FIG', currency: 'EGP', timezone: 'Africa/Cairo' }, scopeReport(['read_orders']), false);
    expect(note).toBe(
      'Connected to FIG (EGP, Africa/Cairo); missing read_customers, read_fulfillments; orders older than 60 days need read_all_orders; write-back would also need write_orders and write_merchant_managed_fulfillment_orders.',
    );
  });

  it('pulls a size out of a variant title', () => {
    expect(sizeFromTitle('Black / XL')).toBe('XL');
    expect(sizeFromTitle('38 / Navy')).toBe('38');
    expect(sizeFromTitle('Default Title')).toBeNull();
  });
});
