import 'server-only';
// Aramex, FIG's courier: waybill tracking (≤ 50 per call) and CreateShipments drafts. Nothing here
// creates a shipment; Relay sends a draft only after explicit approval, with credentials attached then.
import { COUNTRIES } from '../channels';
import { fetchRetry } from './http';
import {
  AramexError,
  buildShipmentDraft,
  mapTrackingResults,
  readAramexAnswer,
  type ShipmentDraft,
  type ShipmentOrder,
  type ShipperAccount,
  type TrackResponse,
  type TrackUpdate,
} from './aramex-map';

export { AramexError, aramexTrackingUrl, classifyUpdate } from './aramex-map';
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

// fig-app's ARAMEX_BASE_URL already ends in /ShippingAPI.V2; accept either form.
const base = () => (env('ARAMEX_BASE_URL') || 'https://ws.aramex.net').replace(/\/+$/, '').replace(/\/ShippingAPI\.V2$/i, '');

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

async function call<T extends { HasErrors?: boolean }>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetchRetry(
    `${base()}/ShippingAPI.V2/${path}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
    { label: 'Aramex', tries: 3, timeoutMs: 30_000 },
  );
  return readAramexAnswer<T>(res.status, await res.text());
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
