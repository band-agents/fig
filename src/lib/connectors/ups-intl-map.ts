// UPS international (developer.ups.com, app "Labesny Console", shipper account 2C0G62): Labesny's parcels
// leaving Kuwait. Pure request/answer mapping, no I/O, so it can be tested. UPS Kuwait (GMTC, gmtc-map.ts)
// stays the domestic courier; this one only ever books an address outside Kuwait.
import type { Address, Order, OrderItem } from '../db/schema';
import type { TrackUpdate } from './aramex-map';

export class UpsIntlError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'UpsIntlError';
  }
}

export type UpsIntlOrder = Pick<Order, 'number' | 'customerName' | 'phone' | 'email' | 'address' | 'currency' | 'total'> & {
  lines: Pick<OrderItem, 'title' | 'quantity' | 'unitPrice'>[];
};

export type UpsIntlShipper = {
  account: string; // UPS shipper number (2C0G62); also who pays the freight
  name: string;
  attention: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  country: string; // KW
};

/** Worldwide Saver unless told otherwise: the service UPS quoted for Kuwait → Lebanon (with 08 Expedited). */
export const UPS_INTL_SERVICES: Record<string, string> = { '07': 'Worldwide Express', '08': 'Worldwide Expedited', '65': 'Worldwide Saver', '54': 'Worldwide Express Plus' };

const KG_PER_PIECE = 0.5;
const MIN_KG = 0.5;

/** Money is kept in the currency's minor unit (fils for KWD: 3 decimals). UPS takes it as a decimal string. */
export function upsMoney(minor: number, currency: string) {
  const dp = ['KWD', 'BHD', 'OMR', 'JOD'].includes(currency.toUpperCase()) ? 3 : 2;
  return (minor / 10 ** dp).toFixed(2);
}

/** A parcel's weight from its pieces: half a kilo each (the same estimate as the GMTC booking). */
export function weightOf(lines: { quantity: number }[]) {
  const pieces = lines.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  return Math.max(MIN_KG, Math.round(pieces * KG_PER_PIECE * 10) / 10);
}

/** Digits only, international form kept: UPS wants 7–15 digits and refuses letters and symbols. */
export function upsPhone(raw: string | null | undefined) {
  return (raw ?? '').replace(/^\s*\+/, '').replace(/\D/g, '').replace(/^00/, '').slice(0, 15);
}

const cut = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** UPS refuses a shipment to Kuwait from this account (that is GMTC's job) and needs a country and a street. */
export function checkDestination(a: Address | null | undefined): string | null {
  const country = (a?.country ?? '').trim().toUpperCase();
  if (!country) return 'The address has no country.';
  if (country === 'KW') return 'This address is in Kuwait: UPS Kuwait (GMTC) books it, not UPS international.';
  if (!cut(a?.line1, 35)) return 'The address has no street line.';
  if (!cut(a?.city, 30)) return 'The address has no city.';
  return null;
}

/** "Clothing" plus the first titles: what customs reads on the label and the invoice. */
export function describeGoods(lines: { title: string }[]) {
  const first = lines.map((l) => l.title.trim()).filter(Boolean)[0] ?? '';
  return cut(first ? `Clothing - ${first}` : 'Clothing and accessories', 35);
}

/** The Shipping API (ShipmentRequest) body for one parcel, billed to our account, label as GIF. */
export function buildShipRequest(order: UpsIntlOrder, shipper: UpsIntlShipper, opts: { service: string; at?: Date }) {
  const a = order.address!;
  const country = a.country.trim().toUpperCase();
  const ref = order.number.replace(/^#/, '');
  const weight = weightOf(order.lines);
  const value = upsMoney(order.total, order.currency);
  const shipTo = {
    Name: cut(a.name || order.customerName, 35),
    AttentionName: cut(a.name || order.customerName, 35),
    Phone: { Number: upsPhone(a.phone || order.phone) || '0000000' },
    ...(order.email ? { EMailAddress: cut(order.email, 50) } : {}),
    Address: {
      AddressLine: [cut(a.line1, 35), cut(a.line2, 35), cut(a.area, 35)].filter(Boolean).slice(0, 3),
      City: cut(a.city, 30),
      ...(a.region ? { StateProvinceCode: cut(a.region, 5) } : {}),
      CountryCode: country,
    },
  };
  const from = {
    Name: cut(shipper.name, 35),
    AttentionName: cut(shipper.attention, 35),
    Phone: { Number: upsPhone(shipper.phone) },
    Address: { AddressLine: [cut(shipper.line1, 35), cut(shipper.line2, 35)].filter(Boolean), City: cut(shipper.city, 30), CountryCode: shipper.country },
  };
  return {
    ShipmentRequest: {
      Request: { RequestOption: 'nonvalidate', TransactionReference: { CustomerContext: ref } },
      Shipment: {
        Description: describeGoods(order.lines),
        Shipper: { ...from, ShipperNumber: shipper.account },
        ShipFrom: from,
        ShipTo: shipTo,
        PaymentInformation: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: shipper.account } }] },
        Service: { Code: opts.service, Description: UPS_INTL_SERVICES[opts.service] ?? opts.service },
        // customs value of the goods, needed for every non-document parcel leaving Kuwait
        InvoiceLineTotal: { CurrencyCode: order.currency.toUpperCase(), MonetaryValue: value },
        ReferenceNumber: [{ Value: ref }],
        Package: [
          {
            Description: describeGoods(order.lines),
            Packaging: { Code: '02', Description: 'Package' },
            PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: weight.toFixed(1) },
          },
        ],
      },
      LabelSpecification: { LabelImageFormat: { Code: 'GIF' }, LabelStockSize: { Height: '6', Width: '4' } },
    },
  };
}

type ShipAnswer = {
  ShipmentResponse?: {
    Response?: { ResponseStatus?: { Code?: string; Description?: string } };
    ShipmentResults?: {
      ShipmentIdentificationNumber?: string;
      ShipmentCharges?: { TotalCharges?: { MonetaryValue?: string; CurrencyCode?: string } };
      NegotiatedRateCharges?: { TotalCharge?: { MonetaryValue?: string; CurrencyCode?: string } };
      PackageResults?: PackageResult | PackageResult[];
    };
  };
};
type PackageResult = { TrackingNumber?: string; ShippingLabel?: { ImageFormat?: { Code?: string }; GraphicImage?: string } };

/** UPS errors come as { response: { errors: [{ code, message }] } }; anything else is passed on short. */
export function readUpsAnswer<T>(status: number, text: string): T {
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: an HTML error page or a proxy message
  }
  const errs = (body as { response?: { errors?: { code?: string; message?: string }[] } } | null)?.response?.errors;
  if (status >= 400 || errs?.length) {
    const msg = errs?.length ? errs.map((e) => `${e.message ?? 'error'}${e.code ? ` (${e.code})` : ''}`).join('; ') : text.replace(/\s+/g, ' ').slice(0, 200) || `HTTP ${status}`;
    throw new UpsIntlError(`UPS refused it: ${msg}`, status);
  }
  return body as T;
}

/** The tracking number (1Z…), the label image and what UPS charged, from a ShipmentResponse. */
export function readShipment(a: ShipAnswer) {
  const r = a.ShipmentResponse?.ShipmentResults;
  const pkg = [r?.PackageResults ?? []].flat()[0];
  const tracking = pkg?.TrackingNumber || r?.ShipmentIdentificationNumber;
  if (!tracking) throw new UpsIntlError('UPS answered without a tracking number.');
  const charge = r?.NegotiatedRateCharges?.TotalCharge ?? r?.ShipmentCharges?.TotalCharges;
  return {
    tracking,
    shipmentId: r?.ShipmentIdentificationNumber ?? tracking,
    label: pkg?.ShippingLabel?.GraphicImage ?? null, // base64
    labelFormat: (pkg?.ShippingLabel?.ImageFormat?.Code ?? 'GIF').toUpperCase(),
    charge: charge?.MonetaryValue ? `${charge.MonetaryValue} ${charge.CurrencyCode ?? ''}`.trim() : null,
  };
}

type TrackActivity = { date?: string; time?: string; location?: { address?: { city?: string; countryCode?: string } }; status?: { type?: string; code?: string; description?: string } };
export type UpsTrackAnswer = {
  trackResponse?: { shipment?: { package?: { trackingNumber?: string; activity?: TrackActivity[]; currentStatus?: { code?: string; description?: string; type?: string } }[]; warnings?: { message?: string }[] }[] };
};

const whenOf = (d?: string, t?: string) => {
  if (!d || d.length !== 8) return new Date();
  const tt = (t ?? '000000').padEnd(6, '0');
  return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${tt.slice(0, 2)}:${tt.slice(2, 4)}:${tt.slice(4, 6)}Z`);
};

/** One package's scans, oldest first, and its latest status type (M, P, I, O, D, X, RS…). */
export function mapUpsTrack(a: UpsTrackAnswer): { type: string; description: string; updates: TrackUpdate[] } | null {
  const pkg = a.trackResponse?.shipment?.[0]?.package?.[0];
  if (!pkg) return null;
  const acts = [...(pkg.activity ?? [])].reverse(); // UPS lists newest first
  const updates: TrackUpdate[] = acts.map((x) => ({
    at: whenOf(x.date, x.time),
    code: `${x.status?.type ?? ''}${x.status?.code ? `-${x.status.code}` : ''}`,
    description: x.status?.description?.trim() ?? '',
    location: [x.location?.address?.city, x.location?.address?.countryCode].filter(Boolean).join(', '),
    comment: '',
  }));
  const latest = pkg.activity?.[0]?.status;
  return { type: (latest?.type ?? pkg.currentStatus?.type ?? '').toUpperCase(), description: latest?.description ?? pkg.currentStatus?.description ?? '', updates };
}

export type UpsIntlClass = 'awaiting' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'returned' | 'exception' | 'info';

/** UPS status types: M label only, P picked up, I in transit, O out for delivery, D delivered, X exception, RS returned. */
export function classifyUpsIntl(type: string, description = ''): UpsIntlClass {
  const t = type.toUpperCase();
  if (t === 'D') return 'delivered';
  if (t === 'RS' || /returned to (the )?(shipper|sender)/i.test(description)) return 'returned';
  if (t === 'X') return 'exception';
  if (t === 'O' || /out for delivery/i.test(description)) return 'out_for_delivery';
  if (t === 'P') return 'picked_up';
  if (t === 'I') return 'in_transit';
  if (t === 'M' || t === 'MV') return 'awaiting';
  return 'info';
}

/** When UPS first had the parcel in hand: the first scan that is not "label created". */
export function upsCollectedAt(updates: TrackUpdate[]): Date | null {
  const u = updates.find((x) => !/^M/i.test(x.code ?? '') && x.code);
  return u?.at ?? null;
}

export const upsTrackingUrl = (tracking: string) => `https://www.ups.com/track?tracknum=${encodeURIComponent(tracking)}`;
