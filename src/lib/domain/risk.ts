// Delivery-risk score (0–100) for every order, with the reasons spelled out. Cash-on-delivery refusals
// are the most expensive failure in this business: a packed, shipped, returned parcel earns nothing.
// Pure and explainable by design; every point comes from a named reason staff can read.
import type { RiskReason } from '../db/schema';

export type RiskInput = {
  paymentMethod: string;
  total: number; // minor units
  currency: string;
  phone?: string | null;
  email?: string | null;
  country: string;
  address?: { line1?: string; line2?: string; city?: string; region?: string } | null;
  placedAt: Date;
  items: { sku?: string | null; title: string; size?: string | null; quantity: number }[];
  history?: { orders: number; delivered: number; refused: number; returned: number } | null;
  recentSamePhone?: number; // other orders from the same phone in the last 24h
  channelMedian?: number; // median order total for the channel, minor units
  regionRtoRate?: number | null; // 0..1 share of COD orders refused in this region (learned)
  baselineRtoRate?: number | null;
};

const EG_MOBILE = /^\+20(10|11|12|15)\d{8}$/;
const KW_MOBILE = /^\+965[569]\d{7}$/;
const JO_MOBILE = /^\+9627[789]\d{7}$/;

export function phoneLooksValid(phone: string | null | undefined, country: string) {
  if (!phone) return false;
  if (country === 'EG') return EG_MOBILE.test(phone);
  if (country === 'KW') return KW_MOBILE.test(phone);
  if (country === 'JO') return JO_MOBILE.test(phone);
  return /^\+\d{8,15}$/.test(phone);
}

/** Normalises the many ways customers type a phone into E.164. */
export function normalisePhone(raw: string | null | undefined, country: string): string | null {
  if (!raw) return null;
  let d = raw.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (d.startsWith('+')) return d;
  if (country === 'EG') {
    if (d.startsWith('20') && d.length === 12) return `+${d}`;
    if (d.startsWith('0') && d.length === 11) return `+20${d.slice(1)}`;
    if (d.length === 10 && d.startsWith('1')) return `+20${d}`;
  }
  if (country === 'KW') {
    if (d.startsWith('965') && d.length === 11) return `+${d}`;
    if (d.length === 8) return `+965${d}`;
  }
  if (country === 'JO') {
    if (d.startsWith('962')) return `+${d}`;
    if (d.startsWith('0') && d.length === 10) return `+962${d.slice(1)}`;
  }
  return d.length >= 8 ? `+${d}` : null;
}

/** Same product in several sizes in one basket: the classic try-at-home-and-send-back pattern. */
export function sizeBracketing(items: RiskInput['items']) {
  const byProduct = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.size) continue;
    const key = (it.sku ?? '').replace(/[-_ ]?(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})$/i, '') || it.title;
    const set = byProduct.get(key) ?? new Set<string>();
    set.add(it.size);
    byProduct.set(key, set);
  }
  let worst = 0;
  for (const s of byProduct.values()) worst = Math.max(worst, s.size);
  return worst;
}

export function scoreRisk(input: RiskInput): { score: number; level: 'low' | 'medium' | 'high'; reasons: RiskReason[] } {
  const reasons: RiskReason[] = [];
  const add = (code: string, label: string, weight: number) => reasons.push({ code, label, weight });
  const cod = input.paymentMethod === 'cod';
  const h = input.history;

  if (cod) add('cod', 'Cash on delivery', 12);
  if (!h || h.orders === 0) add('first_order', 'First order with us', cod ? 10 : 4);
  if (h && h.refused > 0) add('refused_before', `Refused ${h.refused} parcel${h.refused > 1 ? 's' : ''} before`, Math.min(40, 22 * h.refused));
  if (h && h.orders >= 3 && h.returned / h.orders >= 0.4) add('serial_returner', `Returns ${Math.round((h.returned / h.orders) * 100)}% of orders`, 10);
  if (h && h.delivered >= 3 && h.refused === 0) add('loyal', `${h.delivered} delivered orders, never refused`, -18);

  if (!phoneLooksValid(input.phone, input.country)) add('phone', 'Phone number looks invalid', 24);
  const line = `${input.address?.line1 ?? ''} ${input.address?.line2 ?? ''}`.trim();
  if (line.length < 12) add('address', 'Address too short to deliver', 12);
  if (!input.email || /@(mailinator|tempmail|guerrillamail|yopmail)\./i.test(input.email)) add('email', 'No usable email', 3);

  if (input.recentSamePhone && input.recentSamePhone > 0) add('duplicate', `${input.recentSamePhone} other order${input.recentSamePhone > 1 ? 's' : ''} from this phone today`, 14);

  if (input.channelMedian && input.total > input.channelMedian * 5) add('value_xl', 'Basket 5× the usual size', cod ? 20 : 8);
  else if (input.channelMedian && input.total > input.channelMedian * 2.5) add('value_l', 'Basket well above the usual', cod ? 10 : 4);

  const bracket = sizeBracketing(input.items);
  if (bracket >= 2) add('bracketing', `Same item in ${bracket} sizes`, bracket >= 3 ? 14 : 8);

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: input.country === 'EG' ? 'Africa/Cairo' : 'Asia/Kuwait' }).format(input.placedAt));
  if (hour >= 1 && hour < 5) add('night', 'Placed between 1 and 5 am', 4);

  if (cod && input.regionRtoRate != null && input.baselineRtoRate && input.regionRtoRate > input.baselineRtoRate * 1.5) {
    add('region', `Refusals in ${input.address?.region ?? 'this area'} run ${Math.round(input.regionRtoRate * 100)}%`, 8);
  }

  const score = Math.max(0, Math.min(100, reasons.reduce((s, r) => s + r.weight, 0)));
  const level = score >= 55 ? 'high' : score >= 30 ? 'medium' : 'low';
  reasons.sort((a, b) => b.weight - a.weight);
  return { score, level, reasons };
}
