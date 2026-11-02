import 'server-only';
// Bosta (Egypt): FIG's courier. Creates deliveries, fetches the air waybill, tracks, terminates.
// BOSTA_ENV says which server the key belongs to: Bosta's staging (stg-app) until the live key is in.
import { fetchRetry } from './http';
import { BostaError, buildDelivery, mapBostaTrack, readBostaAnswer, trackingFrom, type BostaCityDistricts, type BostaOrder, type CreateAnswer, type TrackAnswer } from './bosta-map';
import type { TrackUpdate } from './aramex-map';

export { BostaError, bostaCity, bostaCollected, bostaTrackingUrl, classifyBosta } from './bosta-map';

const env = (name: string) => process.env[name]?.trim() || '';

/**
 * Only Egypt ships with Bosta; the key is the minimum and BOSTA_ENABLED=true is the switch, so a key can sit
 * in the settings while the console books nothing until it is on.
 */
export const bostaConfigured = (country?: string | null) => (!country || country === 'EG') && env('BOSTA_ENABLED').toLowerCase() === 'true' && Boolean(env('BOSTA_API_KEY'));

/** 'staging' unless BOSTA_ENV=live: the console says which account a tracking number came from. */
export const bostaEnv = () => (env('BOSTA_ENV').toLowerCase() === 'live' ? 'live' : 'staging');

/** When an Egypt order gets its delivery: as soon as it is ready to pick (as UPS Kuwait), once packed, or only by hand. */
export const bostaCreateAt = (): 'ready' | 'packed' | 'manual' => {
  const v = env('BOSTA_CREATE_AT').toLowerCase();
  return v === 'packed' || v === 'manual' ? v : 'ready';
};

export const BOSTA_COURIER = 'Bosta';
const EGYPT = '60e4482c7cb7d4bc4849c4d5'; // Bosta's id for Egypt (GET /countries)

const base = () => (env('BOSTA_BASE_URL') || (bostaEnv() === 'live' ? 'https://app.bosta.co' : 'https://stg-app.bosta.co')).replace(/\/+$/, '') + '/api/v2';
const headers = () => ({ Authorization: env('BOSTA_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' });

function assertReady() {
  if (!bostaConfigured()) throw new BostaError('Bosta is not configured: BOSTA_ENABLED=true and BOSTA_API_KEY are needed.');
}

let districtCache: { at: number; list: BostaCityDistricts[] } | null = null;

/** Bosta's districts for every city (public, ~4,000 rows), kept for 12 hours. */
async function districts(): Promise<BostaCityDistricts[]> {
  if (districtCache && Date.now() - districtCache.at < 12 * 3600_000) return districtCache.list;
  const res = await fetchRetry(`${base()}/cities/getAllDistricts?countryId=${EGYPT}`, { headers: { Accept: 'application/json' } }, { label: 'Bosta', tries: 3, timeoutMs: 30_000 });
  const list = readBostaAnswer<BostaCityDistricts[]>(res.status, await res.text());
  if (!Array.isArray(list) || !list.length) throw new BostaError('Bosta sent no district list.');
  districtCache = { at: Date.now(), list };
  return list;
}

/** Creates the delivery and returns Bosta's tracking number. Not retried on a network failure, so no doubles. */
export async function createDelivery(order: BostaOrder): Promise<{ tracking: string; id: string | null }> {
  assertReady();
  const body = buildDelivery(order, {
    districts: await districts(),
    businessLocationId: env('BOSTA_BUSINESS_LOCATION_ID') || undefined,
    webhookUrl: env('BOSTA_WEBHOOK_URL') || undefined,
    webhookAuth: env('BOSTA_WEBHOOK_SECRET') || undefined,
  });
  const res = await fetchRetry(`${base()}/deliveries?apiVersion=1`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }, { label: 'Bosta', tries: 1, timeoutMs: 30_000 });
  const a = readBostaAnswer<CreateAnswer>(res.status, await res.text());
  return { tracking: trackingFrom(a), id: a._id ?? null };
}

/** The air waybill as a PDF (A4 unless BOSTA_AWB=A6 for the Zebra printer). Bosta sends it base64 inside JSON. */
export async function deliveryLabel(tracking: string): Promise<Uint8Array> {
  assertReady();
  const size = env('BOSTA_AWB').toUpperCase() === 'A6' ? 'A6' : 'A4';
  const res = await fetchRetry(
    `${base()}/deliveries/mass-awb`,
    { method: 'POST', headers: headers(), body: JSON.stringify({ trackingNumbers: tracking, requestedAwbType: size, lang: env('BOSTA_AWB_LANG') === 'en' ? 'en' : 'ar' }) },
    { label: 'Bosta', tries: 2, timeoutMs: 30_000 },
  );
  const text = await res.text();
  const data = readBostaAnswer<unknown>(res.status, text);
  const b64 = typeof data === 'string' ? data : ((data as { data?: string; file?: string })?.data ?? (data as { file?: string })?.file ?? '');
  const buf = new Uint8Array(Buffer.from(String(b64).replace(/^data:application\/pdf;base64,/, ''), 'base64'));
  if (String.fromCharCode(...buf.slice(0, 4)) !== '%PDF') throw new BostaError(`Bosta did not send a printable waybill for ${tracking}.`, res.status);
  return buf;
}

/** Each tracking number's current state and history. Unknown numbers are absent. */
export async function trackDeliveries(trackings: string[]): Promise<Map<string, { code: number; type: string | null; updates: TrackUpdate[] }>> {
  assertReady();
  const out = new Map<string, { code: number; type: string | null; updates: TrackUpdate[] }>();
  for (const t of [...new Set(trackings.map((x) => x.trim()).filter(Boolean))]) {
    const res = await fetchRetry(`${base()}/deliveries/business/${encodeURIComponent(t)}`, { headers: headers() }, { label: 'Bosta', tries: 3, timeoutMs: 20_000 });
    const text = await res.text();
    if (res.status === 404 || /"errorCode":\s*1066/.test(text)) continue; // "Delivery not found." (a 400): not this account's
    out.set(t, mapBostaTrack(readBostaAnswer<TrackAnswer>(res.status, text)));
  }
  return out;
}

/** Terminates a delivery Bosta has not picked up yet (needs a Full Access key). */
export async function terminateDelivery(tracking: string): Promise<void> {
  assertReady();
  const res = await fetchRetry(`${base()}/deliveries/business/${encodeURIComponent(tracking)}/terminate`, { method: 'DELETE', headers: headers() }, { label: 'Bosta', tries: 2, timeoutMs: 20_000 });
  readBostaAnswer<unknown>(res.status, await res.text());
}
