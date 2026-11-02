import { describe, expect, it } from 'vitest';
import { bostaCity, bostaCod, bostaCollected, BostaError, buildDelivery, classifyBosta, egyptPhone, mapBostaTrack, readBostaAnswer, trackingFrom, type BostaOrder } from '../bosta-map';

const order: BostaOrder = {
  number: '#1290',
  customerName: 'Mona Adel',
  phone: '+20 100 123 4567',
  email: 'mona@example.com',
  address: { name: 'Mona Adel', line1: '12 Abbas El Akkad St', line2: 'Floor 3, flat 7', city: 'Nasr City', region: 'Cairo', country: 'EG' },
  currency: 'EGP',
  total: 154_000, // 1,540.00 EGP in piastres
  paymentMethod: 'cod',
  paymentStatus: 'cod_due',
  lines: [
    { title: 'Benetton Tank Top', quantity: 2 },
    { title: 'LVR Bra', quantity: 1 },
  ],
};

describe('bostaCity', () => {
  it("maps Shopify's governorates to Bosta's spellings", () => {
    expect(bostaCity({ region: 'Cairo', city: 'x' })).toBe('Cairo');
    expect(bostaCity({ region: '6th of October', city: 'x' })).toBe('Giza');
    expect(bostaCity({ region: 'Helwan', city: 'x' })).toBe('Cairo');
    expect(bostaCity({ region: 'Qalyubia', city: 'x' })).toBe('El Kalioubia');
    expect(bostaCity({ region: 'Al Sharqia', city: 'x' })).toBe('Sharqia');
    expect(bostaCity({ region: 'Asyut', city: 'x' })).toBe('Assuit');
    expect(bostaCity({ region: 'Beni Suef', city: 'x' })).toBe('Bani Suif');
    expect(bostaCity({ region: 'Kafr el-Sheikh', city: 'x' })).toBe('Kafr Alsheikh');
    expect(bostaCity({ region: 'Minya', city: 'x' })).toBe('Menya');
    expect(bostaCity({ region: 'Faiyum', city: 'x' })).toBe('Fayoum');
  });
  it('reads Arabic and falls back to the city the customer typed', () => {
    expect(bostaCity({ region: 'الإسكندرية', city: 'x' })).toBe('Alexandria');
    expect(bostaCity({ region: '', city: 'الجيزة' })).toBe('Giza');
    expect(bostaCity({ region: undefined, city: 'Hurghada' })).toBe('Red Sea');
    expect(bostaCity({ region: 'Atlantis', city: 'Nowhere' })).toBeNull();
  });
});

describe('egyptPhone', () => {
  it('prints 01xxxxxxxxx', () => {
    expect(egyptPhone('+20 100 123 4567')).toBe('01001234567');
    expect(egyptPhone('00201001234567')).toBe('01001234567');
    expect(egyptPhone('01001234567')).toBe('01001234567');
    expect(egyptPhone('1001234567')).toBe('01001234567');
  });
});

describe('bostaCod', () => {
  it('collects what an unpaid order owes, nothing once paid', () => {
    expect(bostaCod(order)).toBe(1540);
    expect(bostaCod({ ...order, paymentStatus: 'pending' })).toBe(1540); // a failed card then COD is COD (#1159)
    expect(bostaCod({ ...order, paymentStatus: 'paid' })).toBe(0);
  });
});

describe('buildDelivery', () => {
  const body = buildDelivery(order);
  it('is a Deliver order with Bosta city, COD and our reference', () => {
    expect(body.type).toBe(10);
    expect(body.cod).toBe(1540);
    expect(body.dropOffAddress).toMatchObject({ city: 'Cairo', firstLine: '12 Abbas El Akkad St', secondLine: 'Floor 3, flat 7, Nasr City' });
    expect(body.receiver).toEqual({ firstName: 'Mona', lastName: 'Adel', phone: '01001234567', email: 'mona@example.com' });
    expect(body.businessReference).toBe('FIG-1290');
    expect(body.specs.packageDetails).toEqual({ itemsCount: 3, description: '2 x Benetton Tank Top, LVR Bra' });
    expect(body.allowToOpenPackage).toBe(false);
  });
  it('refuses an address Bosta cannot route, with the reason', () => {
    expect(() => buildDelivery({ ...order, address: { ...order.address!, region: 'Atlantis', city: 'Nowhere' } })).toThrow(/does not know the governorate "Atlantis"/);
    expect(() => buildDelivery({ ...order, address: { ...order.address!, line1: 'x' } })).toThrow(BostaError);
    expect(() => buildDelivery({ ...order, address: null })).toThrow(/no delivery address/);
  });
  it('sends the webhook and pickup location only when set', () => {
    expect(body).not.toHaveProperty('webhookUrl');
    const b = buildDelivery(order, { businessLocationId: 'loc1', webhookUrl: 'https://c/x', webhookAuth: 's' });
    expect(b).toMatchObject({ businessLocationId: 'loc1', webhookUrl: 'https://c/x', webhookCustomHeaders: { Authorization: 's' } });
  });
});

describe('readBostaAnswer', () => {
  it('unwraps data and throws Bosta\'s own words', () => {
    expect(trackingFrom(readBostaAnswer(200, '{"success":true,"data":{"_id":"a","trackingNumber":77873113}}'))).toBe('77873113');
    expect(() => readBostaAnswer(401, '{"success":false,"message":"Invalid authorization token or API key.","errorCode":1028}')).toThrow(/API key/);
    expect(() => readBostaAnswer(400, '{"success":false,"message":"City Not Found","errorCode":3001}')).toThrow(/City Not Found \(3001\)/);
    expect(() => readBostaAnswer(502, '<html>')).toThrow(/answered 502/);
  });
});

describe('classifyBosta', () => {
  it('only a pickup from us ships the order', () => {
    for (const c of [10, 11, 20]) expect(classifyBosta(c)).toBe('awaiting');
    expect(classifyBosta(21)).toBe('picked_up');
    expect(bostaCollected(20)).toBe(false);
    expect(bostaCollected(21)).toBe(true);
  });
  it('maps delivery, refusal, cancel and exceptions', () => {
    expect(classifyBosta(41)).toBe('out_for_delivery');
    expect(classifyBosta(45)).toBe('delivered');
    expect(classifyBosta(47)).toBe('exception');
    expect(classifyBosta(48)).toBe('cancelled');
    expect(classifyBosta(49)).toBe('cancelled');
    expect(classifyBosta(41, 'RTO')).toBe('returned');
    expect(classifyBosta(46)).toBe('returned');
  });
});

describe('mapBostaTrack', () => {
  it('keeps the steps oldest first and adds the exception reason', () => {
    const t = mapBostaTrack({
      type: 'SEND',
      state: { code: 47, value: 'Exception', exception: { reason: 'Customer is not answering.' } },
      timeline: [
        { code: 21, value: 'Picked up', date: '2026-11-03T10:00:00Z', done: true },
        { code: 10, value: 'Created', date: '2026-11-02T18:00:00Z', done: true },
        { code: 45, value: 'Delivered', date: undefined, done: false },
      ],
      updatedAt: '2026-11-04T09:00:00Z',
    });
    expect(t.code).toBe(47);
    expect(t.type).toBe('SEND');
    expect(t.updates.map((u) => u.code)).toEqual(['10', '21', '47']);
    expect(t.updates.at(-1)?.comment).toBe('Customer is not answering.');
  });
});
