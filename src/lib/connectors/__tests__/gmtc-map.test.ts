import { describe, expect, it } from 'vitest';
import { buildConsignment, classifyGmtc, gmtcCod, GmtcError, kuwaitPhone, mapTrack, readGmtcAnswer, serviceAt, waybillFrom, type GmtcAccount, type GmtcOrder } from '../gmtc-map';

const acc: GmtcAccount = {
  customerCode: 'D&H',
  hubCode: 'KUWAITCITY01',
  serviceType: 'NEXT DAY',
  movementType: 'con',
  consignmentType: 'FORWARD',
  destinationPincode: 'Dajeej',
  origin: { name: 'D&H International - Labesny', phone: '96522649224', line1: 'D&H Warehouse', pincode: 'Dajeej', city: 'Dajeej', state: 'Farwaniya' },
};

const order: GmtcOrder = {
  number: '#1150',
  customerName: 'Noura A.',
  phone: '+965 5000 0000',
  address: { line1: 'Block 1, Street 2, House 3', area: 'Salmiya', city: 'Hawalli', region: 'Hawalli', country: 'KW' },
  currency: 'KWD',
  total: 25_500, // 25.500 KWD in fils
  paymentMethod: 'card',
  paymentStatus: 'paid',
  lines: [
    { title: 'Logo Tee', quantity: 2, unitPrice: 9_750 },
    { title: 'Robe', quantity: 1, unitPrice: 6_000 },
  ],
};

describe('buildConsignment', () => {
  const body = buildConsignment(order, acc);

  it('never sends reference_number: GMTC numbers the consignment and refuses ours', () => {
    expect(body).not.toHaveProperty('reference_number');
    expect(body.customer_reference_number).toBe('1150');
  });

  it('carries the account codes GMTC gave us', () => {
    expect(body).toMatchObject({ customer_code: 'D&H', hub_code: 'KUWAITCITY01', service_type_id: 'NEXT DAY', movement_type: 'con', consignment_type: 'FORWARD', action_type: 'single_pickup' });
    expect(body.origin_details.pincode).toBe('Dajeej');
  });

  it('sends pincode Dajeej with the area as the city, and a 965 phone', () => {
    expect(body.destination_details).toMatchObject({ pincode: 'Dajeej', city: 'Salmiya', phone: '96550000000', address_line_1: 'Block 1, Street 2, House 3' });
  });

  it('values the parcel in KWD with fils, and leaves COD blank when paid', () => {
    expect(body.declared_value).toBe(25.5);
    expect(body.cod_amount).toBe('');
    expect(body).not.toHaveProperty('cod_collection_mode');
    expect(body.description).toBe('2 x Logo Tee, Robe');
  });

  it('asks the courier to collect an unpaid cash-on-delivery order', () => {
    const cod = buildConsignment({ ...order, paymentMethod: 'cod', paymentStatus: 'cod_due' }, acc);
    expect(cod.cod_amount).toBe('25.5');
    expect(cod).toMatchObject({ cod_collection_mode: 'cash' });
  });

  it('refuses an order without an address or area', () => {
    expect(() => buildConsignment({ ...order, address: null }, acc)).toThrow(GmtcError);
    expect(() => buildConsignment({ ...order, address: { line1: 'Block 1', city: '', country: 'KW' } }, acc)).toThrow(/area/);
  });
});

describe('gmtcCod / kuwaitPhone', () => {
  it('collects nothing once cash is in', () => {
    expect(gmtcCod({ paymentMethod: 'cod', paymentStatus: 'cod_collected', total: 1000, currency: 'KWD' })).toBe('');
  });
  it('normalises Kuwaiti numbers', () => {
    expect(kuwaitPhone('5000 0000')).toBe('96550000000');
    expect(kuwaitPhone('+965 5000 0000')).toBe('96550000000');
    expect(kuwaitPhone('0096550000000')).toBe('96550000000');
  });
});

describe('answers', () => {
  it('reads the waybill from a created consignment (staging answer, 25 Oct)', () => {
    const a = readGmtcAnswer<{ success: boolean; reference_number: string }>(200, '{"success":true,"reference_number":"DNH000001","courier_account":"SELF","customer_reference_number":"LAB-TEST-551185"}');
    expect(waybillFrom(a)).toBe('DNH000001');
  });
  it('throws what Shipsy said on a refusal', () => {
    expect(() => readGmtcAnswer(400, '{"error":{"message":"INVALID REFERENCE NUMBER","statusCode":400,"reason":"WRONG_INPUT"}}')).toThrow(/INVALID REFERENCE NUMBER \(WRONG_INPUT\)/);
    expect(() => readGmtcAnswer(401, '{"error":{"message":"Wrong api key","reason":"WRONG_API_KEY"}}')).toThrow(GmtcError);
  });
  it('maps tracking events oldest first and adds the current status', () => {
    const u = mapTrack({ status: 'pickup_awaited', events: [{ type: 'assigned_courier_partner', event_time: 1792912552923, hub_name: 'Kuwait City Hub' }, { type: 'softdata_upload', event_time: 1792912552000 }] });
    expect(u.map((x) => x.code)).toEqual(['softdata_upload', 'assigned_courier_partner', 'pickup_awaited']);
    expect(u[1].location).toBe('Kuwait City Hub');
  });
});

describe('classifyGmtc', () => {
  it.each([
    ['pickup_awaited', 'awaiting'],
    ['softdata_upload', 'awaiting'],
    ['pickup_completed', 'picked_up'],
    ['inscan_at_hub', 'picked_up'],
    ['outfordelivery', 'out_for_delivery'],
    ['delivered', 'delivered'],
    ['attempted', 'exception'],
    ['undelivered', 'exception'],
    ['rto', 'returned'],
    ['rto_delivered', 'returned'],
    ['cancelled', 'cancelled'],
  ])('%s → %s', (status, cls) => expect(classifyGmtc(status)).toBe(cls));
});

describe('serviceAt (same day before the 2 pm pickup, Kuwait time)', () => {
  it('books SAME DAY before 14:00 Kuwait and the usual service from 14:00', () => {
    expect(serviceAt(new Date('2026-10-31T10:59:00Z'), '14:00', 'NEXT DAY')).toBe('SAME DAY'); // 13:59 Kuwait
    expect(serviceAt(new Date('2026-10-31T11:00:00Z'), '14:00', 'NEXT DAY')).toBe('NEXT DAY'); // 14:00 Kuwait
    expect(serviceAt(new Date('2026-10-31T21:30:00Z'), '14:00', 'NEXT DAY')).toBe('SAME DAY'); // 00:30 next day, Kuwait
  });
  it('without a cutoff, always the usual service', () => {
    expect(serviceAt(new Date('2026-10-31T06:00:00Z'), '', 'NEXT DAY')).toBe('NEXT DAY');
    expect(serviceAt(new Date('2026-10-31T06:00:00Z'), 'off', 'NEXT DAY')).toBe('NEXT DAY');
  });
});
