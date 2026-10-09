import { describe, expect, it } from 'vitest';
import { CHANNEL } from '../../channels';
import { appOrderNumber, mapMedusaOrder, medusaPaymentMethod, medusaPaymentStatus, MEDUSA_ORDER_FIELDS, type MedusaOrder } from '../medusa-map';
import { mapShopifyOrder, type ShopifyOrderNode } from '../shopify-map';

const labesnyApp = CHANNEL['labesny-app'];
const figApp = CHANNEL['fig-app'];

// Medusa v2 admin list shape: money in major units, `subtotal` includes shipping, statuses computed by the list workflow.
const labesnyCod: MedusaOrder = {
  id: 'order_01JB2X8K3MZQ7Y6V5T4R3E2W1Q',
  display_id: 88,
  created_at: '2026-10-03T18:22:05.123Z',
  updated_at: '2026-10-03T18:22:09.000Z',
  canceled_at: null,
  status: 'pending',
  payment_status: 'authorized',
  fulfillment_status: 'not_fulfilled',
  currency_code: 'kwd',
  email: 'dana@example.com',
  total: 24.75,
  subtotal: 24.75,
  item_subtotal: 23.5,
  shipping_total: 1.25,
  discount_total: 0,
  metadata: { cash_to_collect: 24.75 },
  items: [
    {
      title: 'S',
      subtitle: 'Ribbed Knit Top',
      product_title: 'Ribbed Knit Top',
      variant_title: 'S',
      quantity: 2,
      unit_price: 7.25,
      thumbnail: 'https://cdn.labesny.com/top.jpg',
      variant_sku: 'LB-RKT-S',
      variant_barcode: '6291041509988',
      product_type: null,
      product_collection: 'Labesny Basics',
      variant_option_values: null,
      variant: { options: [{ value: 'S', option: { title: 'Size' } }, { value: 'Ivory', option: { title: 'Colour' } }], product: { metadata: { brand: 'Labesny', product_type: 'Tops' } } },
    },
    {
      title: 'One Size',
      product_title: 'Leather Belt',
      variant_title: 'One Size',
      quantity: 1,
      unit_price: 9,
      thumbnail: null,
      variant_sku: 'LB-BELT',
      variant_barcode: null,
      product_type: 'Accessories',
      product_collection: 'Labesny',
      variant_option_values: { Size: 'One Size' },
      variant: null,
    },
  ],
  shipping_address: {
    first_name: 'Dana',
    last_name: 'Al-Mutairi',
    address_1: 'Block 2, Street 5, House 14',
    address_2: '',
    city: 'Jabriya',
    province: 'Hawalli',
    postal_code: '',
    country_code: 'kw',
    phone: '+96569990001',
  },
  customer: { first_name: 'Dana', last_name: 'M', email: 'dana@example.com', phone: null },
  payment_collections: [
    {
      status: 'authorized',
      payments: [],
      payment_sessions: [
        { provider_id: 'pp_paymob_paymob', status: 'pending' },
        { provider_id: 'pp_system_default', status: 'authorized' },
      ],
    },
  ],
  fulfillments: [],
};

const figPaid: MedusaOrder = {
  id: 'order_01JBFIG0000000000000000001',
  display_id: 312,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-04T09:00:00.000Z',
  status: 'completed',
  payment_status: 'captured',
  currency_code: 'egp',
  email: 'omar@example.com',
  total: 1795.5,
  item_subtotal: 1995.5,
  shipping_total: 0,
  discount_total: 200,
  items: [{ product_title: 'Oxford Shirt', variant_title: 'L / Blue', quantity: 1, unit_price: 1995.5, variant_sku: '6223000000017', variant_option_values: { Size: 'L', Colour: 'Blue' } }],
  shipping_address: { first_name: 'Omar', last_name: 'Fathy', address_1: '9 Road 233', city: 'Maadi', province: 'Cairo', country_code: 'eg', phone: '01000000001' },
  payment_collections: [{ status: 'completed', payments: [{ provider_id: 'pp_paymob_paymob' }] }],
  fulfillments: [
    { created_at: '2026-10-02T08:00:00.000Z', canceled_at: '2026-10-02T08:30:00.000Z', provider_id: 'aramex_aramex', labels: [{ tracking_number: '11111111111' }] },
    {
      created_at: '2026-10-02T09:00:00.000Z',
      shipped_at: '2026-10-02T15:00:00.000Z',
      delivered_at: '2026-10-03T12:00:00.000Z',
      provider_id: 'aramex_aramex',
      labels: [{ tracking_number: '50907347411', tracking_url: 'https://www.aramex.com/eg/en/track/results?ShipmentNumber=50907347411' }],
    },
  ],
};

describe('Medusa order mapping', () => {
  const o = mapMedusaOrder(labesnyApp, labesnyCod);

  it('converts major-unit numbers to fils and uses item_subtotal, not shipping-inclusive subtotal', () => {
    expect(o.currency).toBe('KWD');
    expect(o).toMatchObject({ subtotal: 23500, shipping: 1250, discount: 0, total: 24750 });
    expect(o.items.map((i) => i.unitPrice)).toEqual([7250, 9000]);
  });

  it('numbers app orders with the app prefix', () => {
    expect(o.number).toBe('LBAPP-88');
    expect(o.externalId).toBe('order_01JB2X8K3MZQ7Y6V5T4R3E2W1Q');
    expect(o.source).toBe('medusa');
    expect(mapMedusaOrder(figApp, figPaid).number).toBe('FIGAPP-312');
  });

  it('maps the customer and address', () => {
    expect(o.customerName).toBe('Dana Al-Mutairi');
    expect(o.phone).toBe('+96569990001');
    expect(o.email).toBe('dana@example.com');
    expect(o.address).toEqual({ name: 'Dana Al-Mutairi', line1: 'Block 2, Street 5, House 14', city: 'Jabriya', region: 'Hawalli', country: 'KW', phone: '+96569990001' });
  });

  it('reads size, brand and category from options and product metadata', () => {
    expect(o.items[0]).toEqual({
      sku: 'LB-RKT-S',
      barcode: '6291041509988',
      title: 'Ribbed Knit Top',
      variant: 'S',
      size: 'S',
      brand: 'Labesny',
      category: 'Tops',
      image: 'https://cdn.labesny.com/top.jpg',
      quantity: 2,
      unitPrice: 7250,
    });
    expect(o.items[1]).toMatchObject({ size: 'One Size', brand: 'Labesny', category: 'Accessories' });
  });

  it('treats the system provider as cash due, not an abandoned card attempt', () => {
    expect(o.paymentMethod).toBe('cod');
    expect(o.paymentStatus).toBe('cod_due');
    expect(o.platform).toBeUndefined();
  });

  it('maps a captured Paymob order with its Aramex fulfilment, skipping the cancelled one', () => {
    const f = mapMedusaOrder(figApp, figPaid);
    expect(f).toMatchObject({ currency: 'EGP', subtotal: 199550, discount: 20000, total: 179550, paymentMethod: 'card', paymentStatus: 'paid' });
    expect(f.items[0].size).toBe('L');
    expect(f.platform).toEqual({
      fulfilled: { at: new Date('2026-10-02T15:00:00.000Z'), tracking: '50907347411', company: 'Aramex', url: 'https://www.aramex.com/eg/en/track/results?ShipmentNumber=50907347411' },
      delivered: { at: new Date('2026-10-03T12:00:00.000Z') },
    });
  });

  it('records cancellation', () => {
    const c = mapMedusaOrder(figApp, { ...figPaid, status: 'canceled', canceled_at: '2026-10-05T00:00:00.000Z', fulfillments: [], payment_status: 'canceled' });
    expect(c.platform).toEqual({ cancelled: { at: new Date('2026-10-05T00:00:00.000Z'), reason: null } });
    expect(c.paymentStatus).toBe('voided');
  });
});

describe('Medusa payments', () => {
  const cases: [MedusaOrder['payment_collections'], string][] = [
    [[{ payments: [{ provider_id: 'pp_paymob_paymob' }] }], 'card'],
    [[{ payments: [{ provider_id: 'pp_myfatoorah_myfatoorah' }] }], 'knet'],
    [[{ payments: [{ provider_id: 'pp_system_default' }] }], 'cod'],
    [[{ payments: [], payment_sessions: [{ provider_id: 'pp_paymob_paymob', status: 'authorized' }] }], 'card'],
    [[], 'cod'],
  ];
  it.each(cases)('%j → %s', (cols, method) => {
    expect(medusaPaymentMethod({ payment_collections: cols })).toBe(method);
  });

  it('maps statuses', () => {
    expect(medusaPaymentStatus('captured', 'cod')).toBe('paid');
    expect(medusaPaymentStatus('authorized', 'cod')).toBe('cod_due');
    expect(medusaPaymentStatus('authorized', 'card')).toBe('pending');
    expect(medusaPaymentStatus('partially_refunded', 'card')).toBe('partially_refunded');
    expect(medusaPaymentStatus('refunded', 'knet')).toBe('refunded');
  });

  it('asks for the relations the mapper reads', () => {
    for (const f of ['item_subtotal', '*items', '*shipping_address', 'payment_collections.payments.provider_id', '*fulfillments.labels']) {
      expect(MEDUSA_ORDER_FIELDS.split(',')).toContain(f);
    }
  });
});

describe('one order, two routes', () => {
  it('the Shopify copy of an app order and the Medusa original share channel, id and number', () => {
    const fromMedusa = mapMedusaOrder(figApp, figPaid);
    const copy: ShopifyOrderNode = {
      id: 'gid://shopify/Order/6200000000777',
      name: '#1090',
      processedAt: '2026-10-01T10:00:00Z',
      sourceName: 'fig-app',
      currentTotalPriceSet: { shopMoney: { amount: '1795.50', currencyCode: 'EGP' } },
      customAttributes: [
        { key: 'medusa_order_id', value: figPaid.id },
        { key: 'app_order_number', value: String(figPaid.display_id) },
      ],
      lineItems: { nodes: [] },
    };
    const fromShopify = mapShopifyOrder(CHANNEL['fig-web'], copy);
    expect([fromShopify.channelId, fromShopify.externalId, fromShopify.number]).toEqual([fromMedusa.channelId, fromMedusa.externalId, fromMedusa.number]);
    expect(fromShopify.total).toBe(fromMedusa.total);
  });

  it('falls back to the Medusa id without a display id', () => {
    expect(appOrderNumber('fig-app', null, 'order_x')).toBe('order_x');
  });
});
