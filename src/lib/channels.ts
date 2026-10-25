// Every storefront the console listens to. Credentials never live here: each channel reads its own
// RELAY_<PREFIX>_* variables (see .env.example), and a channel without them runs on demo data.
// The list below ships with the code; more are added from Setup → Channels and kept in the
// channels table (custom = true), then registered into the same list at start-up.

export type Platform = 'shopify' | 'medusa' | 'woo';
export type Country = 'EG' | 'KW' | 'JO' | 'SA' | 'AE' | 'QA' | 'BH' | 'OM';
export type Currency = 'EGP' | 'KWD' | 'JOD' | 'SAR' | 'AED' | 'QAR' | 'BHD' | 'OMR';

export const COUNTRIES: { code: Country; name: string; currency: Currency }[] = [
  { code: 'EG', name: 'Egypt', currency: 'EGP' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD' },
  { code: 'JO', name: 'Jordan', currency: 'JOD' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'QA', name: 'Qatar', currency: 'QAR' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD' },
  { code: 'OM', name: 'Oman', currency: 'OMR' },
];

export type ChannelDef = {
  id: string;
  envPrefix: string;
  brand: string; // FIG · Labesny · Women'secret · any brand added later
  name: string; // "Women'secret Egypt"
  surface: 'Website' | 'App';
  platform: Platform;
  country: Country;
  currency: Currency;
  company?: 'DH' | 'DCO' | 'FIG';
  domain?: string; // the public address, for the merchandising embed
  custom?: boolean; // added from the console
  store?: string; // Shopify handle (<store>.myshopify.com)
  baseUrl?: string; // Medusa / Woo base
  warehouse: string; // a location id: fig-cairo, dh-kuwait, or one added later
  carrier: string;
  parked?: boolean; // known but intentionally not wired yet
  readOnly?: boolean; // read from, never written to, whatever RELAY_WRITE_BACK says (RELAY_<PREFIX>_WRITE_BACK=true opens it)
  notes?: string;
};

export const CHANNELS: ChannelDef[] = [
  {
    id: 'fig-web',
    envPrefix: 'FIG_WEB',
    brand: 'FIG',
    name: 'FIG',
    surface: 'Website',
    platform: 'shopify',
    country: 'EG',
    currency: 'EGP',
    store: 'ujvi0q-ga',
    warehouse: 'fig-cairo',
    carrier: 'Aramex',
    // Dan, 25 Oct: FIG joins read-only; what the floor does here stays out of FIG's Shopify until he says
    readOnly: true,
    notes: 'The new FIG Shopify store. App orders pushed here carry the fig-app source and are filed under the FIG app.',
  },
  {
    id: 'fig-app',
    envPrefix: 'FIG_APP',
    brand: 'FIG',
    name: 'FIG',
    surface: 'App',
    platform: 'medusa',
    country: 'EG',
    currency: 'EGP',
    baseUrl: 'https://fig-fashion-app.medusajs.app',
    warehouse: 'fig-cairo',
    carrier: 'Aramex',
  },
  {
    id: 'fig-woo',
    envPrefix: 'FIG_WOO',
    brand: 'FIG',
    name: 'figeg.com (legacy)',
    surface: 'Website',
    platform: 'woo',
    country: 'EG',
    currency: 'EGP',
    baseUrl: 'https://figeg.com',
    warehouse: 'fig-cairo',
    carrier: 'Aramex',
    notes: 'The WooCommerce site still trading until the Shopify store launches.',
  },
  {
    id: 'ws-eg',
    envPrefix: 'WS_EG',
    brand: "Women'secret",
    name: "Women'secret Egypt",
    surface: 'Website',
    platform: 'shopify',
    country: 'EG',
    currency: 'EGP',
    store: 'gcrmsf-rh',
    warehouse: 'fig-cairo',
    carrier: 'Aramex',
    notes: "Sells from FIG's stock pool: a sale here and on FIG competes for the same units.",
  },
  {
    id: 'labesny-web',
    envPrefix: 'LABESNY_WEB',
    brand: 'Labesny',
    name: 'Labesny',
    surface: 'Website',
    platform: 'shopify',
    country: 'KW',
    currency: 'KWD',
    store: 'szk0ey-ns',
    warehouse: 'dh-kuwait',
    carrier: 'Aramex KW',
  },
  {
    id: 'labesny-app',
    envPrefix: 'LABESNY_APP',
    brand: 'Labesny',
    name: 'Labesny',
    surface: 'App',
    platform: 'medusa',
    country: 'KW',
    currency: 'KWD',
    baseUrl: 'https://labesny-app.medusajs.app',
    warehouse: 'dh-kuwait',
    carrier: 'Aramex KW',
  },
  {
    id: 'ws-kw',
    envPrefix: 'WS_KW',
    brand: "Women'secret",
    name: "Women'secret Kuwait",
    surface: 'Website',
    platform: 'shopify',
    country: 'KW',
    currency: 'KWD',
    store: 'qxc3f7-2n',
    warehouse: 'dh-kuwait',
    carrier: 'Aramex KW',
  },
  {
    id: 'ws-jo',
    envPrefix: 'WS_JO',
    brand: "Women'secret",
    name: "Women'secret Jordan",
    surface: 'Website',
    platform: 'shopify',
    country: 'JO',
    currency: 'JOD',
    store: 'd0kb1v-p9',
    warehouse: 'dh-kuwait',
    carrier: 'Aramex JO',
    notes: 'Paid by card through HyperPay or cash on delivery; Aramex Amman delivers inside Jordan on its own account (ARAMEX_JO_*). The stock source is not decided yet, so fulfilment still points at the Kuwait warehouse.',
  },
];

export const CHANNEL = Object.fromEntries(CHANNELS.map((c) => [c.id, c])) as Record<string, ChannelDef>;

/**
 * Adds storefronts defined in the database to the shipped list, in place, so every lookup in the
 * codebase sees them. Idempotent; a definition already present is refreshed. Runs on the server when
 * the database opens and in the browser from the console layout.
 */
export function registerChannels(defs: ChannelDef[]) {
  for (const d of defs) {
    const def = { ...d, custom: true };
    const at = CHANNELS.findIndex((c) => c.id === d.id);
    if (at >= 0) CHANNELS[at] = def;
    else CHANNELS.push(def);
    CHANNEL[d.id] = def;
  }
}

/** RELAY_<PREFIX>_* for a storefront id: "etam-kw" reads RELAY_ETAM_KW_TOKEN and friends. */
export const envPrefixFor = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

export const channelLabel = (id: string) => {
  const c = CHANNEL[id];
  if (!c) return id;
  return c.surface === 'App' ? `${c.name} App` : c.name;
};

export const WAREHOUSES: Record<string, { label: string; country: Country; tz: string }> = {
  'fig-cairo': { label: 'FIG warehouse · New Cairo', country: 'EG', tz: 'Africa/Cairo' },
  'dh-kuwait': { label: 'D&H warehouse · Kuwait', country: 'KW', tz: 'Asia/Kuwait' },
};

export const warehouseLabel = (id: string) => WAREHOUSES[id]?.label ?? id;

export const BRAND_TINT: Record<string, string> = {
  FIG: '#EB3638',
  Labesny: '#F2A7B0',
  "Women'secret": '#C9B8A6',
};

/** A brand's dot: the known ones keep their colour, a new one gets a stable hue from its name. */
export function brandTint(brand: string) {
  if (BRAND_TINT[brand]) return BRAND_TINT[brand];
  let h = 0;
  for (const ch of brand) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `oklch(0.7 0.11 ${h})`;
}

/** Reads a channel's credentials from the environment. Nothing is ever logged or sent to the client. */
export function channelEnv(c: ChannelDef) {
  const v = (k: string) => process.env[`RELAY_${c.envPrefix}_${k}`]?.trim() || undefined;
  return {
    token: v('TOKEN'),
    clientId: v('CLIENT_ID'),
    clientSecret: v('CLIENT_SECRET'),
    webhookSecret: v('WEBHOOK_SECRET'),
    url: v('URL') ?? c.baseUrl,
    key: v('KEY'),
    secret: v('SECRET'),
  };
}

/**
 * What the console sends to this store: its own RELAY_<PREFIX>_WRITE_BACK when set, else nothing for a
 * read-only store, else RELAY_WRITE_BACK. true = live, dry = read and record without sending.
 */
export function storeWriteBack(c: Pick<ChannelDef, 'envPrefix' | 'readOnly'>, env: Record<string, string | undefined> = process.env): 'live' | 'dry' | 'off' {
  const v = env[`RELAY_${c.envPrefix}_WRITE_BACK`]?.trim() || (c.readOnly ? 'off' : env.RELAY_WRITE_BACK?.trim());
  return v === 'true' ? 'live' : v === 'dry' ? 'dry' : 'off';
}

export function channelConfigured(c: ChannelDef) {
  if (c.parked) return false;
  const e = channelEnv(c);
  if (c.platform === 'shopify') return Boolean(e.token || (e.clientId && e.clientSecret));
  if (c.platform === 'medusa') return Boolean(e.key);
  if (c.platform === 'woo') return Boolean(e.key && e.secret);
  return false;
}
