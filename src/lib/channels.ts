// Every storefront Relay listens to. Credentials never live here: each channel reads its own
// RELAY_<PREFIX>_* variables (see .env.example), and a channel without them runs on demo data.

export type Platform = 'shopify' | 'medusa' | 'woo';
export type Country = 'EG' | 'KW' | 'JO';

export type ChannelDef = {
  id: string;
  envPrefix: string;
  brand: 'FIG' | 'Labesny' | "Women'secret";
  name: string; // "Women'secret Egypt"
  surface: 'Website' | 'App';
  platform: Platform;
  country: Country;
  currency: 'EGP' | 'KWD' | 'JOD';
  store?: string; // Shopify handle (<store>.myshopify.com)
  baseUrl?: string; // Medusa / Woo base
  warehouse: 'fig-cairo' | 'dh-kuwait';
  carrier: string;
  parked?: boolean; // known but intentionally not wired yet
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
    carrier: '—',
    parked: true,
    notes: 'Parked: no stock source or catalogue decision yet.',
  },
];

export const CHANNEL = Object.fromEntries(CHANNELS.map((c) => [c.id, c])) as Record<string, ChannelDef>;

export const channelLabel = (id: string) => {
  const c = CHANNEL[id];
  if (!c) return id;
  return c.surface === 'App' ? `${c.name} App` : c.name;
};

export const WAREHOUSES = {
  'fig-cairo': { label: 'FIG warehouse · New Cairo', country: 'EG' as Country, tz: 'Africa/Cairo' },
  'dh-kuwait': { label: 'D&H warehouse · Kuwait', country: 'KW' as Country, tz: 'Asia/Kuwait' },
};

export const BRAND_TINT: Record<ChannelDef['brand'], string> = {
  FIG: '#EB3638',
  Labesny: '#F2A7B0',
  "Women'secret": '#C9B8A6',
};

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

export function channelConfigured(c: ChannelDef) {
  if (c.parked) return false;
  const e = channelEnv(c);
  if (c.platform === 'shopify') return Boolean(e.token || (e.clientId && e.clientSecret));
  if (c.platform === 'medusa') return Boolean(e.key);
  if (c.platform === 'woo') return Boolean(e.key && e.secret);
  return false;
}
