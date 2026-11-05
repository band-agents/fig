import { describe, expect, it } from 'vitest';
import { AramexError, aramexCollected, labelBytes, readCreatedShipment } from '../aramex-map';

const pdf = Buffer.from('%PDF-1.4 label');

describe('readCreatedShipment', () => {
  it('returns the waybill and label link of a created shipment', () => {
    expect(readCreatedShipment({ HasErrors: false, Shipments: [{ ID: ' 50907347411 ', HasErrors: false, ShipmentLabel: { LabelURL: 'https://ws.aramex.net/label/1.pdf' } }] })).toEqual({ awb: '50907347411', labelUrl: 'https://ws.aramex.net/label/1.pdf' });
  });
  it("throws the shipment's own reasons when the envelope gives none", () => {
    const res = { HasErrors: true, Notifications: [], Shipments: [{ ID: '', HasErrors: true, Notifications: [{ Code: 'ERR06', Message: 'Consignee City is invalid' }] }] };
    expect(() => readCreatedShipment(res)).toThrow(AramexError);
    expect(() => readCreatedShipment(res)).toThrow(/ERR06 Consignee City is invalid/);
  });
  it('throws when no shipment or no waybill comes back', () => {
    expect(() => readCreatedShipment({ HasErrors: false, Shipments: [] })).toThrow(/no shipment/);
    expect(() => readCreatedShipment({ HasErrors: false, Shipments: [{ ID: null, HasErrors: false }] })).toThrow(/no waybill/);
  });
});

describe('labelBytes', () => {
  it('reads base64 text and number arrays, and only a PDF', () => {
    expect(labelBytes({ LabelFileContents: pdf.toString('base64') })?.length).toBe(pdf.length);
    expect(labelBytes({ LabelFileContents: [...pdf] })?.length).toBe(pdf.length);
    expect(labelBytes({ LabelFileContents: Buffer.from('<html>').toString('base64') })).toBeNull();
    expect(labelBytes({ LabelURL: 'x' })).toBeNull();
    expect(labelBytes(null)).toBeNull();
  });
});

describe('aramexCollected', () => {
  it('is false before the pickup and true once the driver has the parcel', () => {
    expect(aramexCollected({ code: 'SH014', description: 'Record Created' })).toBe(false);
    expect(aramexCollected({ code: 'SH047', description: 'Collected' })).toBe(true);
    expect(aramexCollected({ code: 'SH003', description: 'Out for Delivery' })).toBe(true);
    expect(aramexCollected({ code: 'SH005', description: 'Delivered' })).toBe(true);
  });
});
