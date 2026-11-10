import { describe, expect, it } from 'vitest';
import { buildShipRequest, checkDestination, classifyUpsIntl, describeGoods, mapUpsTrack, readShipment, readUpsAnswer, upsCollectedAt, UpsIntlError, upsMoney, upsPhone, weightOf, type UpsIntlOrder, type UpsIntlShipper } from '../ups-intl-map';

const shipper: UpsIntlShipper = { account: '2C0G62', name: 'D&H International - Labesny', attention: 'Labesny Online', phone: '+965 2264 9224', line1: 'D&H Warehouse', city: 'Dajeej', country: 'KW' };

const order: UpsIntlOrder = {
  number: '#1301',
  customerName: 'Moody D.',
  phone: '+961 3 732 531',
  email: 'moody@example.com',
  address: { name: 'Moody D.', line1: 'Hamra Street, Building 4', line2: 'Floor 3', city: 'Beirut', country: 'lb' },
  currency: 'KWD',
  total: 41_000, // 41.000 KWD in fils
  lines: [
    { title: 'Kali body - Caviar', quantity: 1, unitPrice: 11_000 },
    { title: 'Relaxed Peanuts Crew Neck Sweat', quantity: 1, unitPrice: 24_000 },
  ],
};

describe('checkDestination', () => {
  it('refuses Kuwait: those parcels are GMTC’s', () => {
    expect(checkDestination({ line1: 'Block 1', city: 'Salmiya', country: 'KW' })).toMatch(/UPS Kuwait/);
  });
  it('needs a country, a street and a city', () => {
    expect(checkDestination({ line1: 'x', city: 'y', country: '' })).toMatch(/no country/);
    expect(checkDestination({ line1: '', city: 'Beirut', country: 'LB' })).toMatch(/street/);
    expect(checkDestination({ line1: 'Hamra', city: '', country: 'LB' })).toMatch(/city/);
  });
  it('accepts an address abroad', () => {
    expect(checkDestination(order.address)).toBeNull();
  });
});

describe('helpers', () => {
  it('turns fils into a 2-decimal string and cents likewise', () => {
    expect(upsMoney(41_000, 'KWD')).toBe('41.00');
    expect(upsMoney(12_345, 'KWD')).toBe('12.35');
    expect(upsMoney(4_999, 'USD')).toBe('49.99');
  });
  it('weighs half a kilo a piece, never under half a kilo', () => {
    expect(weightOf([{ quantity: 1 }])).toBe(0.5);
    expect(weightOf([{ quantity: 2 }, { quantity: 3 }])).toBe(2.5);
    expect(weightOf([])).toBe(0.5);
  });
  it('keeps only digits in phones, without 00', () => {
    expect(upsPhone('+961 3 732 531')).toBe('9613732531');
    expect(upsPhone('00965 6045 5406')).toBe('96560455406');
  });
  it('describes the goods for customs in 35 characters', () => {
    expect(describeGoods(order.lines)).toBe('Clothing - Kali body - Caviar');
    expect(describeGoods([]).length).toBeLessThanOrEqual(35);
  });
});

describe('buildShipRequest', () => {
  const r = buildShipRequest(order, shipper, { service: '65' }).ShipmentRequest;
  it('bills our account and ships from Kuwait', () => {
    expect(r.Shipment.Shipper.ShipperNumber).toBe('2C0G62');
    expect(r.Shipment.PaymentInformation.ShipmentCharge[0]).toEqual({ Type: '01', BillShipper: { AccountNumber: '2C0G62' } });
    expect(r.Shipment.ShipFrom.Address.CountryCode).toBe('KW');
  });
  it('sends to the customer’s country in capitals', () => {
    expect(r.Shipment.ShipTo.Address).toMatchObject({ City: 'Beirut', CountryCode: 'LB', AddressLine: ['Hamra Street, Building 4', 'Floor 3'] });
    expect(r.Shipment.ShipTo.Phone.Number).toBe('9613732531');
  });
  it('declares the order value and the weight', () => {
    expect(r.Shipment.InvoiceLineTotal).toEqual({ CurrencyCode: 'KWD', MonetaryValue: '41.00' });
    expect(r.Shipment.Package[0].PackageWeight).toEqual({ UnitOfMeasurement: { Code: 'KGS' }, Weight: '1.0' });
  });
  it('uses our order number as the reference and asks for a GIF label', () => {
    expect(r.Shipment.ReferenceNumber).toEqual([{ Value: '1301' }]);
    expect(r.Shipment.Service.Code).toBe('65');
    expect(r.LabelSpecification.LabelImageFormat.Code).toBe('GIF');
  });
});

describe('answers', () => {
  it('reads UPS errors into one message', () => {
    expect(() => readUpsAnswer(400, JSON.stringify({ response: { errors: [{ code: '120802', message: 'Address Validation Error on ShipTo address' }] } }))).toThrow(UpsIntlError);
    expect(() => readUpsAnswer(400, JSON.stringify({ response: { errors: [{ code: '120802', message: 'Address Validation Error on ShipTo address' }] } }))).toThrow(/Address Validation Error on ShipTo address \(120802\)/);
  });
  it('reads the tracking number, label and negotiated charge', () => {
    const s = readShipment({
      ShipmentResponse: {
        ShipmentResults: {
          ShipmentIdentificationNumber: '1ZA1B2C30412345678',
          ShipmentCharges: { TotalCharges: { MonetaryValue: '151.41', CurrencyCode: 'KWD' } },
          NegotiatedRateCharges: { TotalCharge: { MonetaryValue: '6.10', CurrencyCode: 'KWD' } },
          PackageResults: { TrackingNumber: '1ZA1B2C30412345678', ShippingLabel: { ImageFormat: { Code: 'GIF' }, GraphicImage: 'R0lGOD' } },
        },
      },
    });
    expect(s).toMatchObject({ tracking: '1ZA1B2C30412345678', label: 'R0lGOD', labelFormat: 'GIF', charge: '6.10 KWD' });
  });
  it('refuses an answer without a tracking number', () => {
    expect(() => readShipment({ ShipmentResponse: { ShipmentResults: {} } })).toThrow(/tracking number/);
  });
});

describe('tracking', () => {
  const answer = {
    trackResponse: {
      shipment: [
        {
          package: [
            {
              trackingNumber: '1Z…',
              activity: [
                { date: '20261114', time: '101500', location: { address: { city: 'Beirut', countryCode: 'LB' } }, status: { type: 'D', code: 'KB', description: 'DELIVERED' } },
                { date: '20261112', time: '183000', location: { address: { city: 'Kuwait', countryCode: 'KW' } }, status: { type: 'I', code: 'OR', description: 'Origin Scan' } },
                { date: '20261112', time: '090000', status: { type: 'M', code: 'MP', description: 'Shipper created a label' } },
              ],
            },
          ],
        },
      ],
    },
  };
  it('puts scans oldest first and keeps the latest type', () => {
    const m = mapUpsTrack(answer)!;
    expect(m.type).toBe('D');
    expect(m.updates.map((u) => u.code)).toEqual(['M-MP', 'I-OR', 'D-KB']);
    expect(m.updates[2].location).toBe('Beirut, LB');
  });
  it('counts the parcel collected at the first scan after the label', () => {
    const m = mapUpsTrack(answer)!;
    expect(upsCollectedAt(m.updates)?.toISOString()).toBe('2026-11-12T18:30:00.000Z');
  });
  it('classifies UPS status types', () => {
    expect(classifyUpsIntl('M')).toBe('awaiting');
    expect(classifyUpsIntl('P')).toBe('picked_up');
    expect(classifyUpsIntl('I')).toBe('in_transit');
    expect(classifyUpsIntl('I', 'Out For Delivery Today')).toBe('out_for_delivery');
    expect(classifyUpsIntl('D')).toBe('delivered');
    expect(classifyUpsIntl('X')).toBe('exception');
    expect(classifyUpsIntl('RS')).toBe('returned');
  });
  it('gives nothing for an empty answer', () => {
    expect(mapUpsTrack({})).toBeNull();
  });
});
