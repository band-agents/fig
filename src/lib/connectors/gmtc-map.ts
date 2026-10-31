// UPS Kuwait (GMTC) on Shipsy: the consignment body and the tracking answer. Pure: no env, no network.
// Shapes proved on GMTC's staging account, 25 Oct 2026: the body must NOT carry reference_number (Shipsy
// answers "INVALID REFERENCE NUMBER" and numbers the consignment itself, DNH000001…); our order number
// rides in customer_reference_number. Prepaid orders send cod_amount blank (Marissa, GMTC, 12 Oct).
import type { Address, Order, OrderItem } from '../db/schema';
import { toMajor } from '../format';
import type { TrackClass, TrackUpdate } from './aramex-map';
import { areaFromAddress } from './kuwait-areas';

export class GmtcError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'GmtcError';
  }
}

/**
 * The service for a consignment booked at `at`. GMTC collects once a day at 2 pm and only that pickup
 * delivers the same day (Mohamed Alaa, 31 Oct; Moody wants same day): booked before the cutoff (Kuwait
 * time, "HH:MM") → SAME DAY, after it → the usual service. No cutoff → always the usual service.
 */
export function serviceAt(at: Date, cutoff: string, usual: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(cutoff.trim());
  if (!m) return usual;
  const kuwait = (at.getUTCHours() * 60 + at.getUTCMinutes() + 180) % 1440; // UTC+3, no daylight saving
  return kuwait < Number(m[1]) * 60 + Number(m[2]) ? 'SAME DAY' : usual;
}

/** The account side of a consignment: GMTC's codes for us and the pickup point (the D&H warehouse). */
export type GmtcAccount = {
  customerCode: string;
  hubCode: string;
  serviceType: string; // "NEXT DAY" | "SAME DAY"
  movementType: string; // "con"
  consignmentType: string; // "FORWARD"
  /** GMTC's live account (Marissa, 29 Oct): every destination pincode is "Dajeej"; the area goes in the city. */
  destinationPincode: string;
  origin: { name: string; phone: string; line1: string; line2?: string; pincode: string; city: string; state?: string };
};

export type GmtcOrder = Pick<Order, 'number' | 'customerName' | 'phone' | 'address' | 'currency' | 'total' | 'paymentMethod' | 'paymentStatus'> & {
  lines: Pick<OrderItem, 'title' | 'quantity' | 'unitPrice'>[];
};

const KG_PER_PIECE = 0.5;

/**
 * The Kuwait area for the destination city. A known area anywhere in the address wins, spelled GMTC's way;
 * otherwise what the customer typed goes as it is (GMTC keeps no fixed list, Marissa 29 Oct), unless it
 * names no area at all ("Kuwait"), which is refused here with the reason.
 */
export function areaOf(a: Address | null | undefined): string {
  const known = areaFromAddress(a);
  if (known) return known;
  const raw = (a?.area || a?.city || '').trim();
  return /^(kuwait|الكويت|kw|state of kuwait)$/i.test(raw) ? '' : raw;
}

/** Kuwaiti numbers as GMTC prints them: 965 + 8 digits, no plus. Anything else is left as digits. */
export function kuwaitPhone(raw: string | null | undefined) {
  const d = (raw ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (d.length === 8) return `965${d}`;
  return d;
}

/** Cash the courier collects: only an unpaid cash-on-delivery order; blank otherwise, as GMTC asked. */
export function gmtcCod(o: Pick<Order, 'paymentMethod' | 'paymentStatus' | 'total' | 'currency'>): string {
  if (o.paymentMethod !== 'cod' || ['paid', 'cod_collected', 'refunded'].includes(o.paymentStatus)) return '';
  return String(toMajor(o.total, o.currency));
}

export function buildConsignment(o: GmtcOrder, acc: GmtcAccount) {
  const a = o.address;
  if (!a?.line1?.trim()) throw new GmtcError(`${o.number} has no delivery address.`);
  const area = areaOf(a);
  if (!area) throw new GmtcError(`${o.number}: the address names no Kuwait area (the customer wrote "${(a.area || a.city || '').trim() || 'nothing'}"). Add the area, then book again.`);
  const pieces = Math.max(1, o.lines.reduce((n, l) => n + l.quantity, 0));
  const weight = String(Math.round(pieces * KG_PER_PIECE * 10) / 10);
  const value = toMajor(o.total, o.currency);
  const cod = gmtcCod(o);
  const titles = o.lines.map((l) => (l.quantity > 1 ? `${l.quantity} x ${l.title}` : l.title)).join(', ');
  const ref = o.number.replace(/^#/, '');
  return {
    action_type: 'single_pickup',
    consignment_type: acc.consignmentType,
    movement_type: acc.movementType,
    load_type: 'NON-DOCUMENT',
    description: titles.slice(0, 250) || 'Clothing',
    customer_code: acc.customerCode,
    customer_reference_number: ref,
    service_type_id: acc.serviceType,
    hub_code: acc.hubCode,
    dimension_unit: 'cm',
    length: '30',
    width: '25',
    height: String(Math.min(40, 5 + pieces * 3)),
    weight_unit: 'kg',
    weight,
    declared_value: value,
    cod_amount: cod,
    ...(cod ? { cod_collection_mode: 'cash', cod_favor_of: acc.origin.name } : {}),
    num_pieces: 1,
    origin_details: {
      name: acc.origin.name,
      phone: acc.origin.phone,
      address_line_1: acc.origin.line1,
      address_line_2: acc.origin.line2 ?? '',
      pincode: acc.origin.pincode,
      city: acc.origin.city,
      state: acc.origin.state ?? '',
      country: 'Kuwait',
    },
    destination_details: {
      name: (a.name || o.customerName).slice(0, 80),
      phone: kuwaitPhone(a.phone || o.phone),
      address_line_1: a.line1.trim(),
      address_line_2: [a.line2, a.notes].filter(Boolean).join(' · '),
      pincode: acc.destinationPincode,
      city: area,
      state: a.region ?? '',
      country: 'Kuwait',
    },
    pieces_detail: [{ description: titles.slice(0, 120) || 'Clothing', declared_value: value, weight, length: '30', width: '25', height: String(Math.min(40, 5 + pieces * 3)) }],
  };
}

export type Consignment = ReturnType<typeof buildConsignment>;

type ShipsyError = { error?: { message?: string; reason?: string; statusCode?: number } };

/** Reads a Shipsy JSON answer; errors come back as { error: { message, reason } } with a 4xx. */
export function readGmtcAnswer<T>(status: number, text: string): T {
  let parsed: T & ShipsyError;
  try {
    parsed = JSON.parse(text) as T & ShipsyError;
  } catch {
    throw new GmtcError(`UPS (GMTC) answered ${status}: ${text.slice(0, 200) || 'an empty body'}`, status);
  }
  if (status >= 400 || parsed.error) {
    const e = parsed.error ?? {};
    throw new GmtcError(`UPS (GMTC) refused it: ${e.message ?? 'no reason given'}${e.reason ? ` (${e.reason})` : ''}`, status);
  }
  return parsed;
}

export type CreateAnswer = { success?: boolean; reference_number?: string; customer_reference_number?: string };

export function waybillFrom(a: CreateAnswer): string {
  if (!a.success || !a.reference_number) throw new GmtcError('UPS (GMTC) did not return a waybill number.');
  return a.reference_number;
}

type RawEvent = { type?: string; event_time?: number; hub_name?: string; customer_update?: string; failure_reason?: string; notes?: string };
export type TrackAnswer = { reference_number?: string; status?: string; events?: RawEvent[] };

const words = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The consignment's events, oldest first, plus its current status as one more (latest) update. */
export function mapTrack(a: TrackAnswer, now = new Date()): TrackUpdate[] {
  const out: TrackUpdate[] = (a.events ?? [])
    .filter((e) => e.type && e.event_time)
    .map((e) => ({ code: e.type!, description: e.customer_update || words(e.type!), location: e.hub_name, at: new Date(e.event_time!), comment: e.failure_reason || e.notes }));
  out.sort((x, y) => x.at.getTime() - y.at.getTime());
  if (a.status) {
    const last = out.at(-1);
    if (!last || last.code !== a.status) out.push({ code: a.status, description: words(a.status), at: last?.at ?? now });
  }
  return out;
}

/** Shipsy statuses → what the console does with them. Cancelled is its own answer: nothing moves. */
export function classifyGmtc(status: string): TrackClass | 'cancelled' | 'awaiting' {
  const s = status.toLowerCase().replace(/[\s-]/g, '_');
  if (/cancel/.test(s)) return 'cancelled';
  if (/^rto|return/.test(s)) return 'returned';
  if (/^delivered$/.test(s)) return 'delivered';
  if (/out_?for_?delivery/.test(s)) return 'out_for_delivery';
  if (/attempt|undeliver|not_?picked|on_?hold|lost|damage|exception|fail/.test(s)) return 'exception';
  if (/softdata|pickup_awaited|pickup_scheduled|created|assigned|accepted/.test(s)) return 'awaiting';
  if (/pickup_completed|picked|inscan|reached|transit|hub|manifest|dispatch/.test(s)) return 'picked_up';
  return 'info';
}
