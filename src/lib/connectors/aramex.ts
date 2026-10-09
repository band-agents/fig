import 'server-only';
// Aramex, FIG's courier: waybill tracking (≤ 50 per call) and CreateShipments drafts. Nothing here
// creates a shipment; Relay sends a draft only after explicit approval, with credentials attached then.
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
const countryCode = () => env('ARAMEX_ACCOUNT_COUNTRY_CODE') || env('ARAMEX_COUNTRY_CODE');

export const aramexConfigured = () =>
  Boolean(env('ARAMEX_USERNAME') && env('ARAMEX_PASSWORD') && env('ARAMEX_ACCOUNT_NUMBER') && env('ARAMEX_ACCOUNT_PIN') && env('ARAMEX_ACCOUNT_ENTITY') && countryCode());

// fig-app's ARAMEX_BASE_URL already ends in /ShippingAPI.V2; accept either form.
const base = () => (env('ARAMEX_BASE_URL') || 'https://ws.aramex.net').replace(/\/+$/, '').replace(/\/ShippingAPI\.V2$/i, '');

const clientInfo = () => ({
  UserName: env('ARAMEX_USERNAME'),
  Password: env('ARAMEX_PASSWORD'),
  Version: 'v1.0',
  AccountNumber: env('ARAMEX_ACCOUNT_NUMBER'),
  AccountPin: env('ARAMEX_ACCOUNT_PIN'),
  AccountEntity: env('ARAMEX_ACCOUNT_ENTITY'),
  AccountCountryCode: countryCode(),
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

/** Each waybill's scans, oldest first. Waybills Aramex does not know are absent from the map. */
export async function trackShipments(waybills: string[]): Promise<Map<string, TrackUpdate[]>> {
  const out = new Map<string, TrackUpdate[]>();
  const unique = [...new Set(waybills.map((w) => w.trim()).filter(Boolean))];
  if (!unique.length) return out;
  if (!aramexConfigured()) throw new AramexError('Aramex is not configured: the ARAMEX_* settings are missing.');
  for (let i = 0; i < unique.length; i += 50) {
    const res = await call<TrackResponse>('Tracking/Service_1_0.svc/json/TrackShipments', {
      ClientInfo: clientInfo(),
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

/** Builds (never sends) the CreateShipments body: service CDS, COD collected through CODS. */
export function createShipmentDraft(order: ShipmentOrder, opts: { shipper?: Partial<ShipperAccount['shipper']>; now?: Date } = {}): ShipmentDraft {
  const account: ShipperAccount = {
    accountNumber: env('ARAMEX_ACCOUNT_NUMBER'),
    countryCode: countryCode() || 'EG',
    reportId: 9839,
    productType: 'CDS',
    kgPerPiece: 0.5,
    shipper: { ...FIG_SHIPPER, ...opts.shipper },
  };
  return buildShipmentDraft(order, account, opts.now);
}

/** The approved draft with credentials attached, ready for CreateShipments. Never store or log the result. */
export const withClientInfo = (draft: ShipmentDraft) => ({ ClientInfo: clientInfo(), ...draft });
