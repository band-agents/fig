import 'server-only';
// UPS Kuwait (GMTC, on Shipsy): Labesny's domestic courier. Creates consignments, fetches the label,
// tracks, cancels. GMTC_ENV says which account the key belongs to: staging until GMTC issues the live key.
import { fetchRetry } from './http';
import {
  buildConsignment,
  GmtcError,
  mapTrack,
  readGmtcAnswer,
  waybillFrom,
  type CreateAnswer,
  type GmtcAccount,
  type GmtcOrder,
  type TrackAnswer,
} from './gmtc-map';
import type { TrackUpdate } from './aramex-map';

export { classifyGmtc, GmtcError } from './gmtc-map';

const env = (name: string) => process.env[name]?.trim() || '';

/**
 * Only Kuwait ships with GMTC; a key and our customer code are the minimum, and GMTC_ENABLED=true is the
 * switch: the key can sit in .env.local for staging while the live console books nothing until it is on.
 */
export const gmtcConfigured = (country?: string | null) =>
  (!country || country === 'KW') && env('GMTC_ENABLED').toLowerCase() === 'true' && Boolean(env('GMTC_API_KEY') && env('GMTC_CUSTOMER_CODE'));

/** 'staging' unless GMTC_ENV=live: the console says which account a waybill came from. */
export const gmtcEnv = () => (env('GMTC_ENV').toLowerCase() === 'live' ? 'live' : 'staging');

/** When a Kuwait order gets its consignment: as soon as it is ready to pick (Dan, 25 Oct), or once packed. */
export const gmtcCreateAt = (): 'ready' | 'packed' | 'manual' => {
  const v = env('GMTC_CREATE_AT').toLowerCase();
  return v === 'packed' || v === 'manual' ? v : 'ready';
};

export const GMTC_COURIER = 'UPS Kuwait'; // not plain "UPS": Shopify would build a ups.com link that does not know GMTC's DNH numbers

const base = () => (env('GMTC_BASE_URL') || 'https://app.shipsy.in').replace(/\/+$/, '');
const path = (p: string) => `${base()}/api/customer/integration/consignment/${p}`;

function account(): GmtcAccount {
  return {
    customerCode: env('GMTC_CUSTOMER_CODE'),
    hubCode: env('GMTC_HUB_CODE') || 'KUWAITCITY01',
    serviceType: env('GMTC_SERVICE') || 'NEXT DAY',
    movementType: env('GMTC_MOVEMENT_TYPE') || 'con',
    consignmentType: env('GMTC_CONSIGNMENT_TYPE') || 'FORWARD',
    destinationPincode: env('GMTC_DESTINATION_PINCODE') || 'Dajeej',
    origin: {
      name: env('GMTC_SHIPPER_NAME') || 'D&H International - Labesny',
      phone: env('GMTC_SHIPPER_PHONE') || '96522649224',
      line1: env('GMTC_SHIPPER_ADDRESS') || 'D&H Warehouse',
      line2: env('GMTC_SHIPPER_ADDRESS_2'),
      pincode: env('GMTC_ORIGIN_PINCODE') || 'Dajeej',
      city: env('GMTC_SHIPPER_CITY') || 'Dajeej',
      state: env('GMTC_SHIPPER_STATE') || 'Farwaniya',
    },
  };
}

const headers = () => ({ 'api-key': env('GMTC_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' });

function assertReady() {
  if (!gmtcConfigured()) throw new GmtcError('UPS (GMTC) is not configured: GMTC_API_KEY and GMTC_CUSTOMER_CODE are missing.');
}

/** Creates the consignment and returns GMTC's waybill (DNH…). One call; never retried, so no doubles. */
export async function createConsignment(order: GmtcOrder, opts: { service?: string } = {}): Promise<{ waybill: string; service: string }> {
  assertReady();
  const acc = account();
  if (opts.service) acc.serviceType = opts.service;
  const body = buildConsignment(order, acc);
  const res = await fetchRetry(path('upload/softdata/v2'), { method: 'POST', headers: headers(), body: JSON.stringify(body) }, { label: 'UPS (GMTC)', tries: 1, timeoutMs: 30_000 });
  try {
    return { waybill: waybillFrom(readGmtcAnswer<CreateAnswer>(res.status, await res.text())), service: acc.serviceType };
  } catch (e) {
    if (e instanceof GmtcError && /DESTINATION_HUB_NOT_FOUND/.test(e.message))
      throw new GmtcError(`UPS (GMTC) does not recognise the area "${body.destination_details.city}" on ${order.number}. Correct the area in the address, then book again.`, e.status);
    throw e;
  }
}

/** The A4 label PDF. Shipsy sends it without a content type, so the bytes are checked instead. */
export async function consignmentLabel(waybill: string): Promise<Uint8Array> {
  assertReady();
  const res = await fetchRetry(path(`shippinglabel/stream?reference_number=${encodeURIComponent(waybill)}`), { headers: { 'api-key': env('GMTC_API_KEY') } }, { label: 'UPS (GMTC)', tries: 2, timeoutMs: 30_000 });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok || String.fromCharCode(...buf.slice(0, 4)) !== '%PDF') readGmtcAnswer(res.status || 500, new TextDecoder().decode(buf.slice(0, 500)));
  return buf;
}

/** Each waybill's history (oldest first) and current status. Unknown waybills are absent. */
export async function trackConsignments(waybills: string[]): Promise<Map<string, { status: string; updates: TrackUpdate[] }>> {
  assertReady();
  const out = new Map<string, { status: string; updates: TrackUpdate[] }>();
  for (const w of [...new Set(waybills.map((x) => x.trim()).filter(Boolean))]) {
    const res = await fetchRetry(path(`track?reference_number=${encodeURIComponent(w)}`), { headers: { 'api-key': env('GMTC_API_KEY') } }, { label: 'UPS (GMTC)', tries: 3, timeoutMs: 20_000 });
    if (res.status === 400) continue; // "Reference number is not valid": not GMTC's (or another account's)
    const a = readGmtcAnswer<TrackAnswer>(res.status, await res.text());
    out.set(w, { status: a.status ?? '', updates: mapTrack(a) });
  }
  return out;
}

/** Cancels a consignment that has not been picked up. */
export async function cancelConsignment(waybill: string): Promise<void> {
  assertReady();
  const res = await fetchRetry(path('cancel'), { method: 'POST', headers: headers(), body: JSON.stringify({ AWBNo: [waybill], customerCode: env('GMTC_CUSTOMER_CODE') }) }, { label: 'UPS (GMTC)', tries: 2, timeoutMs: 20_000 });
  const a = readGmtcAnswer<{ success?: boolean; failedConsignments?: { message?: string }[] }>(res.status, await res.text());
  if (!a.success) throw new GmtcError(`UPS (GMTC) did not cancel ${waybill}: ${a.failedConsignments?.[0]?.message ?? 'no reason given'}`);
}
