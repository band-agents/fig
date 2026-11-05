import 'server-only';
// Aramex: waybill tracking (≤ 50 per call) and, for FIG in Egypt, booking: CreateShipments, the label from
// PrintLabel. ARAMEX_ENABLED=true is the booking switch, so an account can sit in the settings for tracking
// while the console books nothing. ARAMEX_ENV=uat points every call at Aramex's test server (ws.sbx).
import { COUNTRIES } from '../channels';
import { fetchRetry } from './http';
import {
  AramexError,
  buildShipmentDraft,
  labelBytes,
  readCreatedShipment,
  type CreateShipmentsResponse,
  type PrintLabelResponse,
  mapTrackingResults,
  readAramexAnswer,
  type ShipmentDraft,
  type ShipmentOrder,
  type ShipperAccount,
  type TrackResponse,
  type TrackUpdate,
} from './aramex-map';

export { AramexError, aramexCollected, aramexTrackingUrl, classifyUpdate } from './aramex-map';
export type { ShipmentDraft, ShipmentOrder, TrackClass, TrackUpdate } from './aramex-map';

const env = (name: string) => process.env[name]?.trim() || '';

// Accounts: ARAMEX_* is the default (FIG, Egypt). A country with its own Aramex account sets the same
// names with its code, ARAMEX_JO_USERNAME and friends for Jordan; a country without one uses the default.
const DEFAULT = 'ARAMEX_';
const prefixFor = (country?: string | null) => (country && env(`ARAMEX_${country}_USERNAME`) ? `ARAMEX_${country}_` : DEFAULT);
const countryCode = (p: string) => env(`${p}ACCOUNT_COUNTRY_CODE`) || env(`${p}COUNTRY_CODE`);
const ready = (p: string) =>
  Boolean(env(`${p}USERNAME`) && env(`${p}PASSWORD`) && env(`${p}ACCOUNT_NUMBER`) && env(`${p}ACCOUNT_PIN`) && env(`${p}ACCOUNT_ENTITY`) && countryCode(p));

/** With a country: whether its parcels can be tracked (own account, or the default). Without: any account. */
export const aramexConfigured = (country?: string | null) =>
  country ? ready(prefixFor(country)) : ready(DEFAULT) || COUNTRIES.some((c) => ready(`ARAMEX_${c.code}_`));

/** The countries that have an Aramex account of their own. */
export const aramexOwnAccounts = () => COUNTRIES.filter((c) => ready(`ARAMEX_${c.code}_`)).map((c) => c.code);

/** 'live' unless ARAMEX_ENV=uat: the console says which server a waybill came from. */
export const aramexEnv = () => (env('ARAMEX_ENV').toLowerCase() === 'uat' ? 'uat' : 'live');

/** Booking, not just tracking: the default (FIG) account plus the switch. Only Egypt books with Aramex. */
export const aramexBookingConfigured = (country?: string | null) => (!country || country === 'EG') && env('ARAMEX_ENABLED').toLowerCase() === 'true' && ready(DEFAULT);

/** When an Egypt order gets its waybill if Aramex is the automatic courier: ready to pick (as Bosta), packed, or only by hand. */
export const aramexCreateAt = (): 'ready' | 'packed' | 'manual' => {
  const v = env('ARAMEX_CREATE_AT').toLowerCase();
  return v === 'packed' || v === 'manual' ? v : 'ready';
};

// fig-app's ARAMEX_BASE_URL already ends in /ShippingAPI.V2; accept either form.
const base = () => (env('ARAMEX_BASE_URL') || (aramexEnv() === 'uat' ? 'https://ws.sbx.aramex.net' : 'https://ws.aramex.net')).replace(/\/+$/, '').replace(/\/ShippingAPI\.V2$/i, '');

const clientInfo = (p: string) => ({
  UserName: env(`${p}USERNAME`),
  Password: env(`${p}PASSWORD`),
  Version: 'v1.0',
  AccountNumber: env(`${p}ACCOUNT_NUMBER`),
  AccountPin: env(`${p}ACCOUNT_PIN`),
  AccountEntity: env(`${p}ACCOUNT_ENTITY`),
  AccountCountryCode: countryCode(p),
  Source: 24,
});

/** Aramex answers 400 with an HTML page unless all five references are present, even empty. */
const transaction = (reference: string) => ({ Reference1: reference, Reference2: '', Reference3: '', Reference4: '', Reference5: '' });

async function post(path: string, body: Record<string, unknown>, tries = 3) {
  const res = await fetchRetry(
    `${base()}/ShippingAPI.V2/${path}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
    { label: 'Aramex', tries, timeoutMs: 30_000 },
  );
  return { status: res.status, text: await res.text() };
}

async function call<T extends { HasErrors?: boolean }>(path: string, body: Record<string, unknown>, tries = 3): Promise<T> {
  const { status, text } = await post(path, body, tries);
  return readAramexAnswer<T>(status, text);
}

/** Each waybill's scans, oldest first, asked with the country's account. Waybills Aramex does not know are absent. */
export async function trackShipments(waybills: string[], country?: string | null): Promise<Map<string, TrackUpdate[]>> {
  const p = prefixFor(country);
  const out = new Map<string, TrackUpdate[]>();
  const unique = [...new Set(waybills.map((w) => w.trim()).filter(Boolean))];
  if (!unique.length) return out;
  if (!ready(p)) throw new AramexError(`Aramex is not configured: the ${p}* settings are missing.`);
  for (let i = 0; i < unique.length; i += 50) {
    const res = await call<TrackResponse>('Tracking/Service_1_0.svc/json/TrackShipments', {
      ClientInfo: clientInfo(p),
      Shipments: unique.slice(i, i + 50),
      GetLastTrackingUpdateOnly: false,
      Transaction: transaction('relay-tracking'),
    });
    for (const [awb, updates] of mapTrackingResults(res)) out.set(awb, updates);
  }
  return out;
}

/** FIG's warehouse as figeg.com's Aramex plugin sends it. */
const FIG_SHIPPER: ShipperAccount['shipper'] = {
  name: 'Fashion International Group',
  company: 'Fashion International Group',
  phone: '+201000018694',
  email: 'cs@figeg.com',
  line1: 'الالف مصنع منطقه الخرسانه آمام شركه السويدي للخراسانه الجاهزه قطعه رقم ٢',
  city: 'New Cairo',
  state: 'Cairo',
};

/** A country account's own pickup point, from ARAMEX_<CC>_SHIPPER_*; the FIG warehouse is only the default's. */
function shipperFor(p: string): ShipperAccount['shipper'] {
  if (p === DEFAULT) return FIG_SHIPPER;
  const name = env(`${p}SHIPPER_NAME`);
  return {
    name,
    company: env(`${p}SHIPPER_COMPANY`) || name,
    phone: env(`${p}SHIPPER_PHONE`),
    email: env(`${p}SHIPPER_EMAIL`),
    line1: env(`${p}SHIPPER_ADDRESS`),
    city: env(`${p}SHIPPER_CITY`),
    state: env(`${p}SHIPPER_STATE`),
  };
}

/** Builds (never sends) the CreateShipments body: service CDS, COD collected through CODS. */
export function createShipmentDraft(
  order: ShipmentOrder,
  opts: { country?: string | null; shipper?: Partial<ShipperAccount['shipper']>; now?: Date } = {},
): ShipmentDraft {
  const p = prefixFor(opts.country);
  const account: ShipperAccount = {
    accountNumber: env(`${p}ACCOUNT_NUMBER`),
    countryCode: countryCode(p) || opts.country || 'EG',
    reportId: Number(env(`${p}REPORT_ID`)) || 9839,
    productType: 'CDS',
    kgPerPiece: 0.5,
    shipper: { ...shipperFor(p), ...opts.shipper },
  };
  return buildShipmentDraft(order, account, opts.now);
}

/** The approved draft with the country's credentials attached, ready for CreateShipments. Never store or log the result. */
export const withClientInfo = (draft: ShipmentDraft, country?: string | null) => ({ ClientInfo: clientInfo(prefixFor(country)), ...draft });

export const ARAMEX_COURIER = 'Aramex';

function assertBooking() {
  if (!aramexBookingConfigured('EG')) throw new AramexError('Aramex booking is not set up: ARAMEX_ENABLED=true and the ARAMEX_* account settings are needed.');
}

/**
 * Creates the order's shipment with FIG's account and returns its waybill. Sent once, never retried on a
 * network failure, so a slow answer cannot book the parcel twice.
 */
export async function createShipment(order: ShipmentOrder, now = new Date()): Promise<{ awb: string; labelUrl: string | null }> {
  assertBooking();
  const { status, text } = await post('Shipping/Service_1_0.svc/json/CreateShipments', withClientInfo(createShipmentDraft(order, { country: 'EG', now }), 'EG'), 1);
  let parsed: CreateShipmentsResponse | null = null;
  try {
    parsed = JSON.parse(text) as CreateShipmentsResponse;
  } catch {
    // not JSON: readAramexAnswer says what came back
  }
  // the shipment's own errors say more than the envelope's HasErrors
  if (parsed?.Shipments?.length) return readCreatedShipment(parsed);
  return readCreatedShipment(readAramexAnswer<CreateShipmentsResponse>(status, text));
}

/** The waybill label as a PDF, asked fresh each time (Aramex keeps it; nothing is stored here). */
export async function shipmentLabel(awb: string): Promise<Uint8Array> {
  assertBooking();
  const res = await call<PrintLabelResponse>(
    'Shipping/Service_1_0.svc/json/PrintLabel',
    {
      ClientInfo: clientInfo(DEFAULT),
      ShipmentNumber: awb,
      ProductGroup: 'DOM',
      OriginEntity: env(`${DEFAULT}ACCOUNT_ENTITY`),
      LabelInfo: { ReportID: Number(env(`${DEFAULT}REPORT_ID`)) || 9839, ReportType: 'RPT' },
      Transaction: transaction('relay-label'),
    },
    2,
  );
  const pdf = labelBytes(res.ShipmentLabel);
  if (pdf) return pdf;
  // some accounts only answer with a link to the label
  const url = res.ShipmentLabel?.LabelURL?.trim();
  if (url) {
    const r = await fetchRetry(url, {}, { label: 'Aramex', tries: 2, timeoutMs: 30_000 });
    const buf = new Uint8Array(await r.arrayBuffer());
    if (String.fromCharCode(...buf.slice(0, 4)) === '%PDF') return buf;
  }
  throw new AramexError(`Aramex did not send a printable label for ${awb}.`);
}
