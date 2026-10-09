// Aramex Shipping Services API shapes: tracking answers and the CreateShipments body. Pure: no env, no network.
// Dates are WCF's "/Date(ms+zone)/"; the ms are UTC and the zone is only how Aramex's server displays it.
import type { Order, OrderItem } from '../db/schema';
import { decimalsFor, toMajor } from '../format';

export type TrackUpdate = { code: string; description: string; location?: string; at: Date; comment?: string };

export type TrackClass = 'delivered' | 'out_for_delivery' | 'in_transit' | 'exception' | 'returned' | 'picked_up' | 'info';

type Notification = { Code?: string; Message?: string };

export type AramexRawUpdate = {
  WaybillNumber?: string;
  UpdateCode?: string;
  UpdateDescription?: string;
  UpdateDateTime?: string;
  UpdateLocation?: string;
  Comments?: string;
};

export type TrackResponse = {
  HasErrors?: boolean;
  Notifications?: Notification[];
  TrackingResults?: { Key: string; Value?: AramexRawUpdate[] | null }[] | null;
  NonExistingWaybills?: string[] | null;
};

export class AramexError extends Error {
  constructor(
    message: string,
    readonly notifications: Notification[] = [],
  ) {
    super(message);
    this.name = 'AramexError';
  }
}

export const aramexDate = (when: Date) => `/Date(${when.getTime()})/`;

export function parseAramexDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const m = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(v);
  const d = m ? new Date(Number(m[1])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const describe = (notes: Notification[] | undefined) => (notes ?? []).map((n) => `${n.Code ?? ''} ${n.Message ?? ''}`.trim()).join('; ');

/**
 * Reads an Aramex answer. A malformed request comes back as an HTML page (often 400), and a refused
 * login (ERR75) as HTTP 200 with HasErrors: both throw, with what Aramex said.
 */
export function readAramexAnswer<T extends { HasErrors?: boolean; Notifications?: Notification[] }>(status: number, text: string): T {
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    const plain = text
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    throw new AramexError(`Aramex answered ${status}: ${plain.slice(0, 300) || 'an empty body'}`);
  }
  if (parsed.HasErrors) throw new AramexError(`Aramex refused it: ${describe(parsed.Notifications) || 'no reason given'}`, parsed.Notifications ?? []);
  if (status >= 400) throw new AramexError(`Aramex answered ${status}: ${describe(parsed.Notifications) || 'no reason given'}`, parsed.Notifications ?? []);
  return parsed;
}

/** Each waybill's history, oldest first. Waybills Aramex has no record of are absent. */
export function mapTrackingResults(res: TrackResponse): Map<string, TrackUpdate[]> {
  const out = new Map<string, TrackUpdate[]>();
  for (const r of res.TrackingResults ?? []) {
    const updates = (r.Value ?? []).map((u) => {
      const t: TrackUpdate = {
        code: (u.UpdateCode ?? '').trim(),
        description: (u.UpdateDescription ?? '').trim(),
        // An unreadable date sorts first rather than dropping a scan that may say "Delivered".
        at: parseAramexDate(u.UpdateDateTime) ?? new Date(0),
      };
      if (u.UpdateLocation?.trim()) t.location = u.UpdateLocation.trim();
      if (u.Comments?.trim()) t.comment = u.Comments.trim();
      return t;
    });
    updates.sort((a, b) => a.at.getTime() - b.at.getTime());
    out.set(String(r.Key), updates);
  }
  return out;
}

/** The only codes FIG's own waybills have confirmed: delivered, and collected by the consignee. */
const DELIVERED_CODES = new Set(['SH005', 'SH006']);

const RETURNED = /return(ed|ing)?\s+to\s+(shipper|origin|sender)|\brto\b/;
const FAILED =
  /not delivered|undeliver|attempt|unable|failed|refus|not home|not available|unavailable|no answer|not answering|unreachable|wrong (address|number|phone)|incorrect (address|phone|number)|address (issue|problem|incomplete)|incomplete address|reschedul|on hold|\bheld\b|consignee (moved|not)|damaged|\blost\b|(office|shop|premises) closed/;
const DELIVERED = /(^|\W)(delivered|collected by consignee)(\W|$)/;
const OUT_FOR_DELIVERY = /out for delivery|with delivery courier|with (the )?courier for delivery|on (the|its) way to (the )?consignee/;
const BEFORE_PICKUP = /pickup (scheduled|requested)|record created|shipment created|data received|information received|\bcreated\b/;
const PICKED_UP = /picked up|\bcollected\b|pickup (done|completed|successful)|received at origin/;
const IN_TRANSIT = /transit|departed|arrived|received at|forwarded|transferred|processed|sorting|facility|\bhub\b/;

/** What one scan means. Known codes first, then Aramex's own wording, which is what its tracking page shows. */
export function classifyUpdate(u: Pick<TrackUpdate, 'code' | 'description'> & { comment?: string }): TrackClass {
  const text = `${u.description ?? ''} ${u.comment ?? ''}`.toLowerCase();
  if (RETURNED.test(text)) return 'returned';
  if (DELIVERED_CODES.has((u.code ?? '').toUpperCase())) return 'delivered';
  if (FAILED.test(text)) return 'exception';
  if (DELIVERED.test(text)) return 'delivered';
  if (OUT_FOR_DELIVERY.test(text)) return 'out_for_delivery';
  if (BEFORE_PICKUP.test(text)) return 'info';
  if (PICKED_UP.test(text)) return 'picked_up';
  if (IN_TRANSIT.test(text)) return 'in_transit';
  return 'info';
}

export const aramexTrackingUrl = (awb: string, country: string = 'eg') =>
  `https://www.aramex.com/${country.toLowerCase()}/en/track/results?ShipmentNumber=${encodeURIComponent(awb)}`;

// ── CreateShipments ────────────────────────────────────────────────────────────────────────────

export type ShipmentOrder = Pick<Order, 'id' | 'number' | 'customerName' | 'phone' | 'email' | 'address' | 'currency' | 'total' | 'paymentMethod' | 'paymentStatus'> & {
  lines?: Pick<OrderItem, 'title' | 'quantity'>[];
};

export type ShipperAccount = {
  accountNumber: string;
  countryCode: string;
  reportId: number;
  productType: string; // CDS: e-commerce delivery, as figeg.com's plugin sends
  kgPerPiece: number;
  shipper: { name: string; company: string; phone: string; email: string; line1: string; city: string; state: string };
};

/** What the courier collects, in major units: the whole total for an unpaid COD order, otherwise nothing. */
export function codAmount(order: Pick<Order, 'paymentMethod' | 'paymentStatus' | 'total' | 'currency'>) {
  if (order.paymentMethod !== 'cod' || ['paid', 'cod_collected', 'refunded', 'voided'].includes(order.paymentStatus)) return 0;
  const d = decimalsFor(order.currency);
  return Math.round(toMajor(order.total, order.currency) * 10 ** d) / 10 ** d;
}

const transaction = (reference: string) => ({ Reference1: reference, Reference2: '', Reference3: '', Reference4: '', Reference5: '' });

/**
 * The CreateShipments body for one order, minus ClientInfo: credentials are attached only at send
 * time, so a draft can be stored or shown for approval without carrying them.
 */
export function buildShipmentDraft(order: ShipmentOrder, account: ShipperAccount, now = new Date()) {
  const a = order.address;
  const cod = codAmount(order);
  const units = (order.lines ?? []).reduce((s, l) => s + l.quantity, 0) || 1;
  const description =
    (order.lines ?? [])
      .map((l) => `${l.quantity > 1 ? `${l.quantity}x ` : ''}${l.title}`)
      .join(', ')
      .slice(0, 100) || 'Clothing';
  const phone = order.phone ?? a?.phone ?? '';
  const from = account.shipper;
  return {
    LabelInfo: { ReportID: account.reportId, ReportType: 'URL' },
    Shipments: [
      {
        Reference1: order.number,
        Reference2: order.id,
        Reference3: '',
        Shipper: {
          Reference1: '',
          Reference2: '',
          AccountNumber: account.accountNumber,
          PartyAddress: { Line1: from.line1, Line2: '', Line3: '', City: from.city, StateOrProvinceCode: from.state, PostCode: '', CountryCode: account.countryCode },
          Contact: { PersonName: from.name, CompanyName: from.company, PhoneNumber1: from.phone, CellPhone: from.phone, EmailAddress: from.email },
        },
        Consignee: {
          Reference1: '',
          Reference2: '',
          AccountNumber: '',
          PartyAddress: {
            Line1: a?.line1 ?? '',
            Line2: a?.line2 ?? '',
            Line3: [a?.area, a?.region].filter(Boolean).join(', '),
            City: a?.city || a?.region || '',
            StateOrProvinceCode: '',
            PostCode: '',
            CountryCode: (a?.country || account.countryCode).toUpperCase(),
          },
          Contact: {
            PersonName: a?.name ?? order.customerName,
            CompanyName: a?.name ?? order.customerName,
            PhoneNumber1: phone,
            CellPhone: phone,
            EmailAddress: order.email ?? '',
          },
        },
        ShippingDateTime: aramexDate(now),
        DueDate: aramexDate(now),
        Comments: a?.notes ?? '',
        Details: {
          Dimensions: null,
          ActualWeight: { Unit: 'KG', Value: Math.max(units * account.kgPerPiece, 0.1) },
          ChargeableWeight: null,
          DescriptionOfGoods: description,
          GoodsOriginCountry: account.countryCode,
          NumberOfPieces: 1,
          ProductGroup: 'DOM',
          ProductType: account.productType,
          PaymentType: 'P',
          PaymentOptions: '',
          CustomsValueAmount: null,
          CashOnDeliveryAmount: cod > 0 ? { CurrencyCode: order.currency, Value: cod } : null,
          InsuranceAmount: null,
          CashAdditionalAmount: null,
          CollectAmount: null,
          Services: cod > 0 ? 'CODS' : '',
          Items: [],
        },
      },
    ],
    Transaction: transaction(order.number),
  };
}

export type ShipmentDraft = ReturnType<typeof buildShipmentDraft>;
