import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHANNEL } from '../../channels';
import { mapWooOrder, verifyWooSignature, wooDate, wooPaymentMethod, wooPaymentStatus, type WooOrder } from '../woo-map';

const figWoo = CHANNEL['fig-woo'];

const order: WooOrder = {
  id: 48211,
  number: '48211',
  status: 'processing',
  currency: 'EGP',
  date_created_gmt: '2026-10-04T08:15:30',
  date_modified_gmt: '2026-10-04T08:16:02',
  date_paid_gmt: null,
  date_completed_gmt: null,
  discount_total: '100.00',
  shipping_total: '75.00',
  total: '1870.00',
  customer_note: 'Please call first',
  billing: {
    first_name: 'Ahmed',
    last_name: 'Samir',
    company: '',
    address_1: '5 Tahrir Sq',
    address_2: 'Floor 3',
    city: 'Downtown',
    state: 'EGC',
    postcode: '',
    country: 'EG',
    email: 'ahmed@example.com',
    phone: '01112223334',
  },
  shipping: { first_name: '', last_name: '', company: '', address_1: '', address_2: '', city: '', state: '', postcode: '', country: '' },
  payment_method: 'cod',
  payment_method_title: 'Cash on delivery',
  line_items: [
    {
      name: 'Basic Tee - M',
      quantity: 2,
      sku: 'FIG-TEE-M',
      price: 447.5,
      subtotal: '950.00',
      image: { src: 'https://figeg.com/wp-content/uploads/tee.jpg' },
      meta_data: [{ key: 'pa_size', value: 'm', display_key: 'Size', display_value: 'M' }],
    },
    { name: 'Denim Jacket', quantity: 1, sku: '', price: 900, subtotal: '945.00', image: { src: '' }, meta_data: [] },
  ],
  meta_data: [],
  refunds: [],
};

describe('Woo order mapping', () => {
  const o = mapWooOrder(figWoo, order);

  it('maps identity and GMT dates', () => {
    expect(o).toMatchObject({ channelId: 'fig-woo', externalId: '48211', number: 'WOO-48211', source: 'woo' });
    expect(o.placedAt.toISOString()).toBe('2026-10-04T08:15:30.000Z');
  });

  it('keeps piastres and prices lines before coupons', () => {
    expect(o).toMatchObject({ currency: 'EGP', subtotal: 189500, discount: 10000, shipping: 7500, total: 187000 });
    expect(o.subtotal - o.discount + o.shipping).toBe(o.total);
    expect(o.items).toEqual([
      { sku: 'FIG-TEE-M', barcode: null, title: 'Basic Tee - M', variant: null, size: 'M', brand: null, category: null, image: 'https://figeg.com/wp-content/uploads/tee.jpg', quantity: 2, unitPrice: 47500 },
      { sku: null, barcode: null, title: 'Denim Jacket', variant: null, size: null, brand: null, category: null, image: null, quantity: 1, unitPrice: 94500 },
    ]);
  });

  it('uses the billing phone and falls back to the billing address when shipping is empty', () => {
    expect(o.phone).toBe('01112223334');
    expect(o.customerName).toBe('Ahmed Samir');
    expect(o.address).toEqual({ name: 'Ahmed Samir', line1: '5 Tahrir Sq', line2: 'Floor 3', city: 'Downtown', region: 'EGC', country: 'EG', phone: '01112223334' });
    expect(o.note).toBe('Please call first');
  });

  it('prefers a filled shipping address', () => {
    const s = mapWooOrder(figWoo, { ...order, shipping: { first_name: 'Mona', last_name: 'Samir', address_1: '7 Nile St', city: 'Zamalek', state: 'EGC', country: 'EG' } });
    expect(s.address).toMatchObject({ name: 'Mona Samir', line1: '7 Nile St', city: 'Zamalek', region: 'EGC' });
    expect(s.customerName).toBe('Mona Samir');
    expect(s.phone).toBe('01112223334');
  });

  it('treats processing COD as cash due', () => {
    expect(o.paymentMethod).toBe('cod');
    expect(o.paymentStatus).toBe('cod_due');
    expect(o.platform).toBeUndefined();
  });

  it('turns completed, cancelled and refunded into platform facts', () => {
    const done = mapWooOrder(figWoo, {
      ...order,
      status: 'completed',
      date_completed_gmt: '2026-10-06T12:00:00',
      meta_data: [{ key: '_aramex_awb_no', value: '50907347411' }],
    });
    expect(done.platform).toEqual({ fulfilled: { at: new Date('2026-10-06T12:00:00Z'), tracking: '50907347411', company: null, url: null } });
    expect(done.platform?.delivered).toBeUndefined();
    expect(mapWooOrder(figWoo, { ...order, status: 'cancelled' }).platform?.cancelled).toEqual({ at: new Date('2026-10-04T08:16:02Z'), reason: null });
    expect(mapWooOrder(figWoo, { ...order, status: 'refunded', payment_method: 'paymob_accept' }).platform).toEqual({ refunded: true });
  });
});

describe('Woo payments', () => {
  it.each([
    ['cod', 'cod'],
    ['paymob_accept', 'card'],
    ['paymob-card', 'card'],
    ['kashier', 'card'],
    ['vodafone_cash', 'wallet'],
    ['wallet', 'wallet'],
    ['instapay', 'instapay'],
    ['stripe', 'card'],
  ] as const)('%s → %s', (method, expected) => {
    expect(wooPaymentMethod(method)).toBe(expected);
  });

  it.each([
    ['pending', 'card', 'pending'],
    ['on-hold', 'card', 'pending'],
    ['pending', 'cod', 'cod_due'],
    ['processing', 'card', 'paid'],
    ['processing', 'cod', 'cod_due'],
    ['completed', 'cod', 'cod_due'],
    ['completed', 'card', 'paid'],
    ['cancelled', 'cod', 'voided'],
    ['failed', 'card', 'voided'],
    ['refunded', 'card', 'refunded'],
  ] as const)('%s with %s → %s', (status, method, expected) => {
    expect(wooPaymentStatus({ status, date_paid_gmt: null, refunds: [] }, method)).toBe(expected);
  });

  it('marks a partly refunded order', () => {
    expect(wooPaymentStatus({ status: 'processing', refunds: [{ id: 1, total: '-200.00' }] }, 'card')).toBe('partially_refunded');
  });
});

describe('Woo webhooks and dates', () => {
  it('verifies X-WC-Webhook-Signature over the raw body', () => {
    const secret = 'wc_webhook_secret';
    const body = JSON.stringify(order);
    const sig = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyWooSignature(body, sig, secret)).toBe(true);
    expect(verifyWooSignature(body.replace('48211', '48212'), sig, secret)).toBe(false);
    expect(verifyWooSignature(body, sig, undefined)).toBe(false);
  });

  it('reads zone-less GMT timestamps as UTC and leaves explicit zones alone', () => {
    expect(wooDate('2026-10-04T08:15:30')?.toISOString()).toBe('2026-10-04T08:15:30.000Z');
    expect(wooDate('2026-10-04T08:15:30+02:00')?.toISOString()).toBe('2026-10-04T06:15:30.000Z');
    expect(wooDate(null)).toBeNull();
  });
});
