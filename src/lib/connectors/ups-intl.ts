import 'server-only';
// UPS international (developer.ups.com app "Labesny Console", account 2C0G62): books Labesny parcels whose
// address is outside Kuwait, keeps the label UPS returns, voids and tracks. OAuth client credentials; the
// token is cached until a minute before it expires. UPS_INTL_ENV=live uses onlinetools.ups.com, anything
// else the CIE test system, where nothing is collected or billed.
import { fetchRetry } from './http';
import { buildShipRequest, mapUpsTrack, readShipment, readUpsAnswer, UpsIntlError, type UpsIntlOrder, type UpsIntlShipper, type UpsTrackAnswer } from './ups-intl-map';

export { classifyUpsIntl, checkDestination, upsCollectedAt, upsTrackingUrl, UpsIntlError, UPS_INTL_SERVICES } from './ups-intl-map';

const env = (name: string) => process.env[name]?.trim() || '';

/** Shopify knows "UPS" and links 1Z numbers to ups.com, which is right for these (unlike GMTC's DNH ones). */
export const UPS_INTL_COURIER = 'UPS';

/** UPS_INTL_ENABLED=true is the switch; the client id, secret and account number are the minimum. */
export const upsIntlConfigured = () => env('UPS_INTL_ENABLED').toLowerCase() === 'true' && Boolean(env('UPS_INTL_CLIENT_ID') && env('UPS_INTL_CLIENT_SECRET') && env('UPS_INTL_ACCOUNT'));

export const upsIntlEnv = (): 'test' | 'live' => (env('UPS_INTL_ENV').toLowerCase() === 'live' ? 'live' : 'test');

/** When an order outside Kuwait is booked: when it is ready to pick (like UPS Kuwait), once packed, or only by hand. */
export const upsIntlCreateAt = (): 'ready' | 'packed' | 'manual' => {
  const v = env('UPS_INTL_CREATE_AT').toLowerCase();
  return v === 'ready' || v === 'packed' ? v : 'manual';
};

const base = () => (upsIntlEnv() === 'live' ? 'https://onlinetools.ups.com' : 'https://wwwcie.ups.com');

function shipper(): UpsIntlShipper {
  return {
    account: env('UPS_INTL_ACCOUNT'),
    name: env('UPS_INTL_SHIPPER_NAME') || 'D&H International - Labesny',
    attention: env('UPS_INTL_SHIPPER_ATTENTION') || 'Labesny Online',
    phone: env('UPS_INTL_SHIPPER_PHONE') || env('GMTC_SHIPPER_PHONE') || '96522649224',
    line1: env('UPS_INTL_SHIPPER_ADDRESS') || env('GMTC_SHIPPER_ADDRESS') || 'D&H Warehouse',
    line2: env('UPS_INTL_SHIPPER_ADDRESS_2') || env('GMTC_SHIPPER_ADDRESS_2') || undefined,
    city: env('UPS_INTL_SHIPPER_CITY') || env('GMTC_SHIPPER_CITY') || 'Dajeej',
    country: 'KW',
  };
}

let token: { value: string; until: number; env: string } | null = null;

async function bearer(): Promise<string> {
  if (!upsIntlConfigured()) throw new UpsIntlError('UPS international is not set up: UPS_INTL_ENABLED, UPS_INTL_CLIENT_ID, UPS_INTL_CLIENT_SECRET and UPS_INTL_ACCOUNT are needed.');
  if (token && token.env === upsIntlEnv() && token.until > Date.now()) return token.value;
  const basic = Buffer.from(`${env('UPS_INTL_CLIENT_ID')}:${env('UPS_INTL_CLIENT_SECRET')}`).toString('base64');
  const res = await fetchRetry(`${base()}/security/v1/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-merchant-id': env('UPS_INTL_ACCOUNT'), Authorization: `Basic ${basic}` }, body: 'grant_type=client_credentials' }, { label: 'UPS', tries: 3, timeoutMs: 20_000 });
  const a = readUpsAnswer<{ access_token?: string; expires_in?: string | number }>(res.status, await res.text());
  if (!a.access_token) throw new UpsIntlError('UPS gave no access token.');
  token = { value: a.access_token, until: Date.now() + (Number(a.expires_in) || 3600) * 1000 - 60_000, env: upsIntlEnv() };
  return token.value;
}

const headers = async (ref: string) => ({ Authorization: `Bearer ${await bearer()}`, 'Content-Type': 'application/json', Accept: 'application/json', transId: `${ref}-${Date.now()}`.slice(0, 32), transactionSrc: 'labesny-console' });

/**
 * Books the parcel and returns UPS's tracking number (1Z…) with the label image. Not retried on a
 * network failure, so a parcel is never booked twice.
 */
export async function createUpsIntlShipment(order: UpsIntlOrder, opts: { service?: string } = {}) {
  const service = opts.service || env('UPS_INTL_SERVICE') || '65';
  const body = buildShipRequest(order, shipper(), { service });
  const res = await fetchRetry(`${base()}/api/shipments/v2409/ship`, { method: 'POST', headers: await headers(order.number.replace(/\W/g, '')), body: JSON.stringify(body) }, { label: 'UPS', tries: 1, timeoutMs: 45_000 });
  return { ...readShipment(readUpsAnswer(res.status, await res.text())), service };
}

/** Cancels a shipment UPS has not collected yet (same day or before the first scan). */
export async function voidUpsIntlShipment(shipmentId: string): Promise<void> {
  const res = await fetchRetry(`${base()}/api/shipments/v2409/void/cancel/${encodeURIComponent(shipmentId)}`, { method: 'DELETE', headers: await headers('void') }, { label: 'UPS', tries: 2, timeoutMs: 20_000 });
  const a = readUpsAnswer<{ VoidShipmentResponse?: { Response?: { ResponseStatus?: { Code?: string } } } }>(res.status, await res.text());
  if (a.VoidShipmentResponse?.Response?.ResponseStatus?.Code !== '1') throw new UpsIntlError(`UPS did not void ${shipmentId}.`);
}

/** Each tracking number's latest status type and scans. Numbers UPS does not know are absent. */
export async function trackUpsIntl(numbers: string[]) {
  const out = new Map<string, NonNullable<ReturnType<typeof mapUpsTrack>>>();
  for (const n of [...new Set(numbers.map((x) => x.trim()).filter(Boolean))]) {
    const res = await fetchRetry(`${base()}/api/track/v1/details/${encodeURIComponent(n)}?locale=en_US&returnSignature=false`, { headers: await headers('track') }, { label: 'UPS', tries: 3, timeoutMs: 20_000 });
    if (res.status === 404) continue;
    let a: UpsTrackAnswer;
    try {
      a = readUpsAnswer<UpsTrackAnswer>(res.status, await res.text());
    } catch {
      continue; // "tracking number not found yet" and the like: try again next run
    }
    const m = mapUpsTrack(a);
    if (m) out.set(n, m);
  }
  return out;
}
