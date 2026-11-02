// Bosta (Egypt): FIG's courier from Nov 2026 (Moody, 1 Nov: "Bosta and Mylerz since they are lower in
// price"). The delivery body and the tracking answer. Pure: no env, no network.
// Shapes from docs.bosta.co (Nov 2026): POST /deliveries?apiVersion=1 with type 10 (Deliver), the city by
// Bosta's own name, COD in pounds. Answers are { success, message, errorCode, data }.
import type { Address, Order, OrderItem } from '../db/schema';
import { toMajor } from '../format';
import type { TrackClass, TrackUpdate } from './aramex-map';

export class BostaError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'BostaError';
  }
}

/** Bosta's cities (GET /cities, 2 Nov 2026), keyed by every way a Shopify or Medusa address names the governorate. */
const CITY: Record<string, string> = {};
const add = (city: string, ...names: string[]) => [city, ...names].forEach((n) => (CITY[fold(n)] = city));
function fold(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٟ]/g, '') // Arabic diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/^(al|el)[\s-]+/, '')
    .replace(/governorate|محافظة/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, '')
    .replace(/^ال/, '');
}
add('Cairo', 'القاهرة', 'Helwan', 'حلوان', 'New Cairo', 'Nasr City', 'Heliopolis', 'Maadi', 'C');
add('Giza', 'الجيزة', '6th of October', 'October', '6 October', 'السادس من أكتوبر', 'Sheikh Zayed', 'GZ', 'SU');
add('Alexandria', 'الإسكندرية', 'Alex', 'ALX');
add('Assuit', 'Asyut', 'Assiut', 'أسيوط', 'AST');
add('Aswan', 'أسوان', 'ASN');
add('Bani Suif', 'Beni Suef', 'Bani Sweif', 'بني سويف', 'BNS');
add('Behira', 'Beheira', 'Buhayrah', 'البحيرة', 'BH');
add('Dakahlia', 'Dakahliya', 'الدقهلية', 'Mansoura', 'DK');
add('Damietta', 'دمياط', 'DT');
add('El Kalioubia', 'Qalyubia', 'Qaliubiya', 'Kalyoubia', 'القليوبية', 'KB');
add('Fayoum', 'Faiyum', 'Fayum', 'الفيوم', 'FYM');
add('Gharbia', 'Gharbiya', 'الغربية', 'Tanta', 'GH');
add('Ismailia', 'Ismailiya', 'الإسماعيلية', 'IS');
add('Kafr Alsheikh', 'Kafr el-Sheikh', 'Kafr El Sheikh', 'كفر الشيخ', 'KFS');
add('Luxor', 'الأقصر', 'LX');
add('Matrouh', 'Marsa Matrouh', 'Matruh', 'مطروح', 'مرسى مطروح', 'MT');
add('Menya', 'Minya', 'Minia', 'المنيا', 'MN');
add('Monufia', 'Menofia', 'Menoufia', 'المنوفية', 'MNF');
add('New Valley', 'الوادي الجديد', 'WAD');
add('North Coast', 'Sahel', 'الساحل الشمالي');
add('North Sinai', 'شمال سيناء', 'SIN');
add('Port Said', 'بورسعيد', 'بور سعيد', 'PTS');
add('Qena', 'Qina', 'قنا', 'KN');
add('Red Sea', 'البحر الأحمر', 'Hurghada', 'الغردقة', 'BA');
add('Sharqia', 'Al Sharqia', 'Sharkia', 'الشرقية', 'Zagazig', 'SHR');
add('Sohag', 'Suhag', 'سوهاج', 'SHG');
add('South Sinai', 'جنوب سيناء', 'Sharm El Sheikh', 'JS');
add('Suez', 'السويس', 'SUZ');

/** Bosta's city for the address: the governorate (Shopify's province) first, then the city the customer typed. */
export function bostaCity(a: Pick<Address, 'region' | 'city' | 'area'> | null | undefined): string | null {
  for (const v of [a?.region, a?.city, a?.area]) {
    const hit = v && CITY[fold(v)];
    if (hit) return hit;
  }
  return null;
}

/** Egyptian mobiles as Bosta wants them: 01xxxxxxxxx. Anything else is left as digits. */
export function egyptPhone(raw: string | null | undefined) {
  const d = (raw ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (/^201\d{9}$/.test(d)) return `0${d.slice(2)}`;
  if (/^1\d{9}$/.test(d)) return `0${d}`;
  return d;
}

export type BostaOrder = Pick<Order, 'number' | 'customerName' | 'phone' | 'email' | 'address' | 'currency' | 'total' | 'paymentMethod' | 'paymentStatus'> & {
  lines: Pick<OrderItem, 'title' | 'quantity'>[];
};

/** Cash the courier collects: whatever an unpaid order still owes (a failed card then COD is COD, #1159); 0 once paid. */
export function bostaCod(o: Pick<Order, 'paymentStatus' | 'total' | 'currency'>): number {
  if (!['cod_due', 'pending'].includes(o.paymentStatus)) return 0;
  return toMajor(o.total, o.currency);
}

export function buildDelivery(o: BostaOrder, opts: { businessLocationId?: string; webhookUrl?: string; webhookAuth?: string } = {}) {
  const a = o.address;
  const line1 = [a?.line1, a?.area].filter((x) => x?.trim()).join(', ').trim();
  if (!a || !line1) throw new BostaError(`${o.number} has no delivery address.`);
  if (line1.length <= 5) throw new BostaError(`${o.number}: the address "${line1}" is too short for Bosta (more than 5 characters). Complete it, then book again.`);
  const city = bostaCity(a);
  if (!city) throw new BostaError(`${o.number}: Bosta does not know the governorate "${a.region || a.city || 'nothing'}". Correct the governorate in the address, then book again.`);
  const name = (a.name || o.customerName || '').trim() || 'Customer';
  const [firstName, ...rest] = name.split(/\s+/);
  const pieces = Math.max(1, o.lines.reduce((n, l) => n + l.quantity, 0));
  const titles = o.lines.map((l) => (l.quantity > 1 ? `${l.quantity} x ${l.title}` : l.title)).join(', ');
  const ref = o.number.replace(/^#/, '');
  return {
    type: 10, // Deliver
    specs: { packageType: 'Parcel', size: pieces > 4 ? 'MEDIUM' : 'SMALL', packageDetails: { itemsCount: pieces, description: titles.slice(0, 250) || 'Clothing' } },
    notes: [a.notes, `FIG ${o.number}`].filter(Boolean).join(' · ').slice(0, 200),
    cod: bostaCod(o),
    allowToOpenPackage: false, // opening needs product photos sent with the order (Bosta error 2150)
    dropOffAddress: {
      city,
      firstLine: line1.slice(0, 250),
      secondLine: [a.line2, a.city && a.city !== a.region ? a.city : null].filter(Boolean).join(', ').slice(0, 250) || undefined,
    },
    receiver: { firstName: firstName.slice(0, 50), lastName: (rest.join(' ') || firstName).slice(0, 50), phone: egyptPhone(a.phone || o.phone), ...(o.email ? { email: o.email } : {}) },
    businessReference: `FIG-${ref}`,
    ...(opts.businessLocationId ? { businessLocationId: opts.businessLocationId } : {}),
    ...(opts.webhookUrl ? { webhookUrl: opts.webhookUrl, ...(opts.webhookAuth ? { webhookCustomHeaders: { Authorization: opts.webhookAuth } } : {}) } : {}),
  };
}

export type Delivery = ReturnType<typeof buildDelivery>;

type Envelope<T> = { success?: boolean; message?: string; errorCode?: number; data?: T };

/** Reads a Bosta answer: { success, message, errorCode, data }; a refusal throws with Bosta's own words. */
export function readBostaAnswer<T>(status: number, text: string): T {
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new BostaError(`Bosta answered ${status}: ${text.slice(0, 200) || 'an empty body'}`, status);
  }
  if (status >= 400 || parsed.success === false) {
    const why = parsed.message || 'no reason given';
    if (status === 401 || parsed.errorCode === 1028) throw new BostaError(`Bosta refused the API key: ${why}`, status, parsed.errorCode);
    throw new BostaError(`Bosta refused it: ${why}${parsed.errorCode ? ` (${parsed.errorCode})` : ''}`, status, parsed.errorCode);
  }
  return (parsed.data ?? (parsed as unknown)) as T;
}

export type CreateAnswer = { _id?: string; trackingNumber?: string | number };

export function trackingFrom(a: CreateAnswer): string {
  const t = a.trackingNumber != null ? String(a.trackingNumber).trim() : '';
  if (!t) throw new BostaError('Bosta did not return a tracking number.');
  return t;
}

/** The public tracking page Shopify's shipping email links to. */
export const bostaTrackingUrl = (tracking: string) => `https://bosta.co/tracking-shipments?shipment-number=${encodeURIComponent(tracking)}`;

/** Bosta's state codes (docs: "Bosta States"), for a Deliver (SEND) order. */
export const BOSTA_STATES: Record<number, string> = {
  10: 'Pickup requested',
  11: 'Waiting for route',
  20: 'Route assigned',
  21: 'Picked up from business',
  24: 'Received at warehouse',
  30: 'In transit between hubs',
  41: 'Out for delivery',
  45: 'Delivered',
  46: 'Returned to business',
  47: 'Exception',
  48: 'Terminated',
  49: 'Cancelled',
  60: 'Returned to stock',
  100: 'Lost',
  101: 'Damaged',
  102: 'Investigation',
  103: 'Awaiting your action',
  104: 'Archived',
  105: 'On hold',
};

/**
 * Bosta state → what the console does. 21 (picked up from us) is the collection that ships the order;
 * 10/11/20 are before the driver came. A SEND order going back to us (RTO) reports 46 when it arrives.
 */
export function classifyBosta(code: number, type?: string | null): TrackClass | 'cancelled' | 'awaiting' {
  if (type && /rto|return/i.test(type) && ![48, 49].includes(code)) return 'returned'; // a refused parcel turns into an RTO on its way back
  if (code === 48 || code === 49) return 'cancelled';
  if (code === 10 || code === 11 || code === 20) return 'awaiting';
  if (code === 45) return 'delivered';
  if (code === 41) return 'out_for_delivery';
  if (code === 46 || code === 60) return 'returned';
  if (code === 47 || code === 100 || code === 101 || code === 103) return 'exception';
  if (code === 21 || code === 24 || code === 30) return 'picked_up';
  return 'info';
}

/** True once Bosta has the parcel in hand: picked up from us or any later step (#1155: never a pre-pickup scan). */
export const bostaCollected = (code: number) => [21, 24, 30, 41, 45, 46, 47, 60].includes(code);

type RawState = { code?: number; value?: string; exception?: { code?: number; reason?: string } };
type RawTimeline = { code?: number; value?: string; date?: string; done?: boolean };
export type TrackAnswer = { trackingNumber?: string | number; type?: string | { value?: string }; state?: RawState; timeline?: RawTimeline[]; businessReference?: string; numberOfAttempts?: number; updatedAt?: string };

const at = (s?: string | number | null) => {
  const d = s != null ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** A delivery's current state and the steps it went through, oldest first. */
export function mapBostaTrack(a: TrackAnswer, now = new Date()): { code: number; type: string | null; updates: TrackUpdate[] } {
  const code = Number(a.state?.code ?? 0);
  const type = typeof a.type === 'string' ? a.type : (a.type?.value ?? null);
  const updates: TrackUpdate[] = (a.timeline ?? [])
    .filter((t) => t.done !== false && t.date && at(t.date))
    .map((t) => ({ code: String(t.code ?? t.value ?? ''), description: t.value || BOSTA_STATES[Number(t.code)] || String(t.code), at: at(t.date)! }));
  updates.sort((x, y) => x.at.getTime() - y.at.getTime());
  if (code) {
    const last = updates.at(-1);
    const reason = a.state?.exception?.reason;
    if (!last || last.code !== String(code) || reason)
      updates.push({ code: String(code), description: a.state?.value || BOSTA_STATES[code] || `State ${code}`, at: at(a.updatedAt) ?? last?.at ?? now, comment: reason });
  }
  return { code, type, updates };
}
