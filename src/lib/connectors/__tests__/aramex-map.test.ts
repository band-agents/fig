import { describe, expect, it } from 'vitest';
import {
  AramexError,
  buildShipmentDraft,
  classifyUpdate,
  codAmount,
  mapTrackingResults,
  parseAramexDate,
  readAramexAnswer,
  type ShipmentOrder,
  type ShipperAccount,
  type TrackResponse,
} from '../aramex-map';

// A TrackShipments answer as the JSON endpoint returns it. Codes other than SH005/SH006 are illustrative.
const track: TrackResponse = {
  HasErrors: false,
  Notifications: [],
  NonExistingWaybills: ['00000000000'],
  TrackingResults: [
    {
      Key: '50907347411',
      Value: [
        { WaybillNumber: '50907347411', UpdateCode: 'SH005', UpdateDescription: 'Delivered', UpdateDateTime: '/Date(1759658400000+0300)/', UpdateLocation: 'Cairo, Egypt', Comments: 'Signed by Mariam' },
        { WaybillNumber: '50907347411', UpdateCode: 'SH003', UpdateDescription: 'Out for Delivery', UpdateDateTime: '/Date(1759640400000+0300)/', UpdateLocation: 'Cairo, Egypt', Comments: '' },
        { WaybillNumber: '50907347411', UpdateCode: 'SH047', UpdateDescription: 'Collected', UpdateDateTime: '/Date(1759560000000+0300)/', UpdateLocation: 'New Cairo, Egypt' },
        { WaybillNumber: '50907347411', UpdateCode: 'SH014', UpdateDescription: 'Record Created', UpdateDateTime: '/Date(1759550000000+0300)/', UpdateLocation: '' },
      ],
    },
    { Key: '50907347422', Value: [] },
  ],
};

describe('Aramex dates', () => {
  it('reads WCF dates as UTC milliseconds, whatever the zone suffix', () => {
    expect(parseAramexDate('/Date(1696000000000+0200)/')?.getTime()).toBe(1696000000000);
    expect(parseAramexDate('/Date(1696000000000-0500)/')?.getTime()).toBe(1696000000000);
    expect(parseAramexDate('/Date(1696000000000)/')?.toISOString()).toBe('2023-09-29T15:06:40.000Z');
  });

  it('accepts ISO strings and refuses junk', () => {
    expect(parseAramexDate('2026-10-01T10:00:00Z')?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(parseAramexDate('yesterday-ish')).toBeNull();
    expect(parseAramexDate('')).toBeNull();
    expect(parseAramexDate(undefined)).toBeNull();
  });
});

describe('Aramex tracking results', () => {
  const map = mapTrackingResults(track);

  it('orders each waybill’s scans oldest first, keeping location and comment', () => {
    const scans = map.get('50907347411')!;
    expect(scans.map((s) => s.description)).toEqual(['Record Created', 'Collected', 'Out for Delivery', 'Delivered']);
    expect(scans[3]).toEqual({ code: 'SH005', description: 'Delivered', at: new Date(1759658400000), location: 'Cairo, Egypt', comment: 'Signed by Mariam' });
    expect(scans[0]).not.toHaveProperty('location');
    expect(map.get('50907347422')).toEqual([]);
    expect(map.has('00000000000')).toBe(false);
  });

  it('classifies the journey', () => {
    expect(map.get('50907347411')!.map(classifyUpdate)).toEqual(['info', 'picked_up', 'out_for_delivery', 'delivered']);
  });
});

describe('classifying one scan', () => {
  const u = (description: string, code = '', comment?: string) => ({ code, description, comment });

  it.each([
    ['Delivered', '', 'delivered'],
    ['Shipment update', 'SH005', 'delivered'],
    ['Shipment update', 'SH006', 'delivered'],
    ['Collected by Consignee', '', 'delivered'],
    ['Out for Delivery', '', 'out_for_delivery'],
    ['With Delivery Courier', '', 'out_for_delivery'],
    ['Not Delivered - Consignee not available', '', 'exception'],
    ['Delivery attempted, customer refused', '', 'exception'],
    ['Consignee not home', '', 'exception'],
    ['Unable to contact consignee', '', 'exception'],
    ['Wrong address - need more details', '', 'exception'],
    ['Returned to Shipper', '', 'returned'],
    ['Return to Origin initiated', '', 'returned'],
    ['Collected', '', 'picked_up'],
    ['Shipment picked up', '', 'picked_up'],
    ['Received at Origin Facility', '', 'picked_up'],
    ['Pickup Scheduled', '', 'info'],
    ['Record Created', '', 'info'],
    ['In Transit', '', 'in_transit'],
    ['Departed Origin Facility', '', 'in_transit'],
    ['Arrived at Destination Facility', '', 'in_transit'],
    ['Customer service note', '', 'info'],
  ] as const)('%s (%s) → %s', (description, code, expected) => {
    expect(classifyUpdate(u(description, code))).toBe(expected);
  });

  it('reads the comment too', () => {
    expect(classifyUpdate(u('Shipment on hold', '', 'Consignee refused - return to shipper'))).toBe('returned');
    expect(classifyUpdate(u('Delivery update', '', 'Customer not answering phone'))).toBe('exception');
  });
});

describe('reading Aramex answers', () => {
  it('surfaces a refused login sent as HTTP 200', () => {
    const body = JSON.stringify({ HasErrors: true, Notifications: [{ Code: 'ERR75', Message: 'Invalid username or password' }], TrackingResults: [] });
    expect(() => readAramexAnswer(200, body)).toThrow(AramexError);
    expect(() => readAramexAnswer(200, body)).toThrow(/ERR75 Invalid username or password/);
  });

  it('turns the HTML error page into a sentence', () => {
    const html = '<html><head><style>body{color:red}</style></head><body><h1>Request Error</h1><p>The server encountered an error processing the request.</p></body></html>';
    expect(() => readAramexAnswer(400, html)).toThrow('Aramex answered 400: Request Error The server encountered an error processing the request.');
  });

  it('returns a clean answer', () => {
    expect(readAramexAnswer<TrackResponse>(200, JSON.stringify(track)).TrackingResults).toHaveLength(2);
  });
});

describe('CreateShipments draft', () => {
  const account: ShipperAccount = {
    accountNumber: '60500304',
    countryCode: 'EG',
    reportId: 9839,
    productType: 'CDS',
    kgPerPiece: 0.5,
    shipper: { name: 'Fashion International Group', company: 'Fashion International Group', phone: '+201000018694', email: 'cs@figeg.com', line1: 'Plot 2', city: 'New Cairo', state: 'Cairo' },
  };
  const cod: ShipmentOrder = {
    id: 'ord_1',
    number: '#2210',
    customerName: 'Mariam Hassan',
    phone: '+201012345678',
    email: 'mariam@example.com',
    address: { name: 'Mariam Hassan', line1: '12 El Nasr St', line2: 'Apt 5', area: 'Nasr City', city: 'Cairo', region: 'Cairo', country: 'EG' },
    currency: 'EGP',
    total: 214550,
    paymentMethod: 'cod',
    paymentStatus: 'cod_due',
    lines: [
      { title: 'Linen Shirt', quantity: 2 },
      { title: 'Chino Pants', quantity: 1 },
    ],
  };
  const now = new Date('2026-10-08T09:00:00Z');

  it('collects the whole total for unpaid COD through CODS', () => {
    const d = buildShipmentDraft(cod, account, now);
    const s = d.Shipments[0];
    expect(s.Details.CashOnDeliveryAmount).toEqual({ CurrencyCode: 'EGP', Value: 2145.5 });
    expect(s.Details.Services).toBe('CODS');
    expect(s.Details).toMatchObject({ ProductGroup: 'DOM', ProductType: 'CDS', PaymentType: 'P', NumberOfPieces: 1, ActualWeight: { Unit: 'KG', Value: 1.5 } });
    expect(s.Details.DescriptionOfGoods).toBe('2x Linen Shirt, Chino Pants');
    expect(s.Reference1).toBe('#2210');
    expect(s.ShippingDateTime).toBe(`/Date(${now.getTime()})/`);
    expect(s.Shipper.Contact.CompanyName).toBe('Fashion International Group');
    expect(s.Shipper.AccountNumber).toBe('60500304');
    expect(s.Consignee.PartyAddress).toMatchObject({ Line1: '12 El Nasr St', Line2: 'Apt 5', Line3: 'Nasr City, Cairo', City: 'Cairo', CountryCode: 'EG' });
    expect(s.Consignee.Contact).toMatchObject({ PersonName: 'Mariam Hassan', PhoneNumber1: '+201012345678', CellPhone: '+201012345678' });
  });

  it('carries no credentials, and all five transaction references', () => {
    const d = buildShipmentDraft(cod, account, now);
    expect(d).not.toHaveProperty('ClientInfo');
    expect(JSON.stringify(d)).not.toMatch(/Password|AccountPin/);
    expect(d.Transaction).toEqual({ Reference1: '#2210', Reference2: '', Reference3: '', Reference4: '', Reference5: '' });
  });

  it('collects nothing for a paid order', () => {
    const d = buildShipmentDraft({ ...cod, paymentMethod: 'card', paymentStatus: 'paid' }, account, now);
    expect(d.Shipments[0].Details.CashOnDeliveryAmount).toBeNull();
    expect(d.Shipments[0].Details.Services).toBe('');
  });

  it('keeps KWD to three decimals', () => {
    expect(codAmount({ paymentMethod: 'cod', paymentStatus: 'cod_due', total: 15250, currency: 'KWD' })).toBe(15.25);
    expect(codAmount({ paymentMethod: 'cod', paymentStatus: 'cod_due', total: 27755, currency: 'KWD' })).toBe(27.755);
    expect(codAmount({ paymentMethod: 'cod', paymentStatus: 'cod_collected', total: 27755, currency: 'KWD' })).toBe(0);
  });
});
