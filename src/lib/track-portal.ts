import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL, channelLabel } from './channels';
import {
  aramexTrackingUrl,
  BOSTA_COURIER,
  bostaTrackingUrl,
  GMTC_COURIER,
  trackConsignments,
  trackDeliveries,
  trackShipments,
  trackUpsIntl,
  UPS_INTL_COURIER,
  upsIntlEnv,
  upsTrackingUrl,
  type TrackUpdate,
} from './connectors';
import { normaliseOrderNumber } from './domain/contact';
import { contactMatches, readContact } from './returns-portal';
import { invalid, notFound } from './errors';
import { trackTokenOk } from './track-link';

export { trackLink } from './track-link';

/*
 * "Where is my order?" for the customer.
 *
 * The shipping email links here instead of to the courier's own site: UPS Kuwait (GMTC) has no public
 * tracking page at all, and a Shopify fulfilment without a link leaves the customer with nothing but
 * "View your order". So the console, which already reads every courier's scans, shows them on one
 * page that wears the shop's own clothes, and still offers the courier's site where one exists.
 *
 * Two ways in, both public:
 *   - the signed link in the email (order id + an HMAC of it): opens straight on the order;
 *   - the order number + the email or phone on it, typed on the page (rate limited, like returns).
 */

type OrderRow = typeof schema.orders.$inferSelect;

/** Our own page's address, so a link Shopify echoes back is never offered as "the courier's site". */
const isOurs = (url: string) => /[?&]t=/.test(url) && /[?&]o=/.test(url);

export type TrackStatus = 'preparing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'problem' | 'cancelled' | 'returned';

export type PortalTrack = {
  number: string;
  brand: string;
  storeLabel: string;
  placedAt: Date;
  status: TrackStatus;
  steps: { key: string; label: string; at: Date | null; done: boolean; current: boolean }[];
  courier: { name: string; tracking: string; url: string | null } | null;
  /** Newest first, as a customer reads them. */
  updates: { at: Date; text: string; place: string | null }[];
  items: { title: string; variant: string | null; image: string | null; quantity: number }[];
  destination: string;
  eta: string | null;
  note: string | null;
};

function statusOf(o: OrderRow): TrackStatus {
  if (o.stage === 'cancelled') return 'cancelled';
  if (o.stage === 'rto' || o.stage === 'rto_closed') return 'returned';
  if (o.stage === 'delivered' || o.stage === 'settled') return 'delivered';
  if (o.exception) return 'problem';
  if (o.stage === 'delivering') return 'out_for_delivery';
  if (o.stage === 'shipped') return 'shipped';
  return 'preparing';
}

const RANK: Record<TrackStatus, number> = { cancelled: 0, preparing: 1, shipped: 2, problem: 2, returned: 2, out_for_delivery: 3, delivered: 4 };

/** What a courier scan says, in the page's words. Null for an ordinary in-transit scan. */
function scanStatus(u: TrackUpdate): TrackStatus | null {
  const s = `${u.code} ${u.description}`.toLowerCase().replace(/[_-]+/g, ' ');
  if (/(un|not )delivered|undeliver|attempt/.test(s)) return null;
  if (/delivered/.test(s)) return 'delivered';
  if (/out ?for ?delivery/.test(s)) return 'out_for_delivery';
  if (/picked ?up|pickup ?completed|in transit|reached ?at ?hub|arrived|departed/.test(s)) return 'shipped';
  return null;
}

/** The name the customer knows: "UPS", not our internal "UPS Kuwait" / "UPS international". */
function courierName(c: string): string {
  if (c === GMTC_COURIER || c === UPS_INTL_COURIER || /^ups\b/i.test(c)) return 'UPS';
  if (/aramex/i.test(c)) return 'Aramex';
  if (c === BOSTA_COURIER || /bosta/i.test(c)) return 'Bosta';
  return c;
}

/** The courier's own tracking page, where one exists. GMTC (UPS Kuwait) has none. */
function courierUrl(o: OrderRow): string | null {
  const c = o.courier ?? '';
  const n = o.tracking ?? '';
  if (!n) return null;
  if (c === UPS_INTL_COURIER) return upsIntlEnv() === 'live' ? upsTrackingUrl(n) : null;
  if (c === GMTC_COURIER) return null;
  if (c === BOSTA_COURIER || /bosta/i.test(c)) return bostaTrackingUrl(n);
  if (/aramex/i.test(c)) return aramexTrackingUrl(n, o.address?.country || 'kw');
  if (/^ups\b/i.test(c)) return upsTrackingUrl(n);
  return o.trackingUrl && !isOurs(o.trackingUrl) ? o.trackingUrl : null;
}

/* Live scans, kept for a few minutes so a customer refreshing the page does not hit the courier each time. */
const cache = new Map<string, { at: number; updates: TrackUpdate[] }>();
const FRESH_MS = 5 * 60_000;

async function liveUpdates(o: OrderRow): Promise<TrackUpdate[]> {
  const c = o.courier ?? '';
  const n = o.tracking ?? '';
  if (!n) return [];
  const key = `${c}|${n}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.updates;
  let updates: TrackUpdate[] = [];
  try {
    if (c === GMTC_COURIER) updates = (await trackConsignments([n])).get(n)?.updates ?? [];
    else if (c === UPS_INTL_COURIER) updates = upsIntlEnv() === 'live' ? ((await trackUpsIntl([n])).get(n)?.updates ?? []) : [];
    else if (c === BOSTA_COURIER) updates = (await trackDeliveries([n])).get(n)?.updates ?? [];
    else if (/aramex/i.test(c)) updates = (await trackShipments([n], o.address?.country)).get(n) ?? [];
  } catch (e) {
    console.error('[track] courier lookup failed', o.number, c, e instanceof Error ? e.message : e);
    return hit?.updates ?? [];
  }
  cache.set(key, { at: Date.now(), updates });
  return updates;
}

/** Plain words for a scan: couriers write "pickup_awaited" and "PKG ARRIVED AT FACILITY". */
function scanText(u: TrackUpdate): string {
  const raw = (u.description || u.code || '').trim();
  const words = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return '';
  const lower = words === words.toUpperCase() ? words.toLowerCase() : words;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Scans a customer should not see: the booking itself and our own system's notes. */
const quiet = (u: TrackUpdate) => /^(pickup_?awaited|softdata|created|manifest|label|order ?information|shipment information received)/i.test((u.code || u.description || '').trim());

function etaFor(country: string, status: TrackStatus): string | null {
  if (status === 'delivered' || status === 'cancelled' || status === 'returned') return null;
  const c = country.toUpperCase();
  if (c === 'KW') return 'Delivery in Kuwait usually takes 1–2 days from dispatch.';
  if (c === 'EG') return 'Delivery in Egypt usually takes 2–5 working days from dispatch.';
  if (['AE', 'BH', 'JO', 'LB', 'OM', 'QA', 'SA'].includes(c)) return 'Delivery to your country usually takes 5–7 working days from dispatch.';
  return 'International delivery usually takes 5–10 working days from dispatch.';
}

const COUNTRY: Record<string, string> = { KW: 'Kuwait', EG: 'Egypt', LB: 'Lebanon', AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', BH: 'Bahrain', OM: 'Oman', JO: 'Jordan' };

async function build(o: OrderRow): Promise<PortalTrack> {
  const db = await getDb();
  const [items, stageEvents, scans] = await Promise.all([
    db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id)),
    db
      .select({ to: schema.events.toStage, at: schema.events.at })
      .from(schema.events)
      .where(and(eq(schema.events.orderId, o.id), eq(schema.events.kind, 'stage')))
      .orderBy(asc(schema.events.at)),
    liveUpdates(o),
  ]);

  const firstAt = (stages: string[]) => stageEvents.find((e) => e.to && stages.includes(e.to))?.at ?? null;
  /* The courier's latest scan can be ahead of the console (it moves the order on its next sync). */
  const byStage = statusOf(o);
  const latest = scans.filter((u) => !quiet(u)).at(-1);
  const scanSays = latest ? scanStatus(latest) : null;
  const status: TrackStatus =
    scanSays && ['preparing', 'shipped', 'out_for_delivery'].includes(byStage) && RANK[scanSays] > RANK[byStage] ? scanSays : byStage;
  const scanAt = (want: TrackStatus) => (scanSays === want && status === want ? latest!.at : null);
  const shippedAt = firstAt(['shipped', 'delivering', 'delivered', 'settled']);
  const outAt = firstAt(['delivering', 'delivered', 'settled']) ?? scanAt('out_for_delivery');
  const deliveredAt = firstAt(['delivered', 'settled']) ?? scanAt('delivered');
  const packedAt = firstAt(['packed', 'shipped', 'delivering', 'delivered', 'settled']);

  const STEPS = [
    { key: 'placed', label: 'Order placed', at: o.placedAt },
    { key: 'packed', label: 'Packed', at: packedAt },
    { key: 'shipped', label: 'With the courier', at: shippedAt },
    { key: 'out', label: 'Out for delivery', at: outAt },
    { key: 'delivered', label: 'Delivered', at: deliveredAt },
  ];
  const doneUpTo = { delivered: 4, out_for_delivery: 3, shipped: 2, problem: 2, returned: 2, preparing: o.stage === 'packed' ? 1 : 0, cancelled: 0 }[status];
  const steps = STEPS.map((s, i) => ({ ...s, done: i <= doneUpTo, current: i === doneUpTo && status !== 'delivered' }));

  const updates = scans
    .filter((u) => !quiet(u))
    .map((u) => ({ at: u.at, text: scanText(u), place: u.location?.trim() || null }))
    .filter((u) => u.text)
    .reverse();

  const a = o.address;
  const country = (a?.country ?? CHANNEL[o.channelId]?.country ?? '').toUpperCase();
  const destination = [a?.area || a?.city, COUNTRY[country] ?? country].filter(Boolean).join(', ');

  const note =
    status === 'problem'
      ? 'The courier has flagged a delay on this parcel. Our team is on it and will contact you if anything is needed.'
      : status === 'cancelled'
        ? 'This order was cancelled.'
        : status === 'returned'
          ? 'This parcel is on its way back to us. Our team will contact you.'
          : status === 'preparing'
            ? 'We are preparing your order. You will get an email with tracking as soon as it leaves us.'
            : null;

  return {
    number: o.number.startsWith('#') ? o.number : `#${o.number}`,
    brand: CHANNEL[o.channelId]?.brand ?? 'FIG',
    storeLabel: channelLabel(o.channelId),
    placedAt: o.placedAt,
    status,
    steps,
    courier: o.courier && o.tracking ? { name: courierName(o.courier), tracking: o.tracking, url: courierUrl(o) } : null,
    updates,
    items: items.map((i) => ({ title: i.title, variant: i.variant, image: i.image, quantity: i.quantity })),
    destination,
    eta: etaFor(country, status),
    note,
  };
}

/** From the signed link in the email. */
export async function trackBySignedLink(orderId: string, token: string): Promise<PortalTrack> {
  if (!orderId || !trackTokenOk(orderId, token)) throw notFound('This tracking link is not valid. Enter your order number below instead.');
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o || o.source === 'demo') throw notFound('This tracking link is not valid. Enter your order number below instead.');
  return build(o);
}

/** From the order number and the email or phone the customer typed. */
export async function trackByNumber(input: { number?: string; contact?: string }): Promise<PortalTrack> {
  const number = normaliseOrderNumber(input.number ?? '');
  if (!number) throw invalid('Enter your order number.');
  const contact = readContact({ contact: input.contact });
  const db = await getDb();
  const [o] = await db
    .select()
    .from(schema.orders)
    .where(and(sql`lower(replace(${schema.orders.number}, '#', '')) = ${number}`, contactMatches(contact), sql`${schema.orders.source} <> 'demo'`))
    .limit(1);
  if (!o) throw notFound('We could not find an order with that number and contact.');
  return build(o);
}
