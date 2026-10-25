// Access = a job preset + a per-area level, plus an optional channel scope (e.g. the Kuwait team) and an
// optional brand scope (e.g. a brand manager who looks after Etam only).
// Pure module: read by the server for every check and by client screens to hide what can't be done.
import { sameBrand } from './branches';

export const AREAS = [
  'overview', // the whole floor: the Command centre and the Pipeline
  'orders', // see orders at all
  'intake', // confirm orders with customers (Customer care)
  'finance', // payment checks, COD settlements, refunds
  'fulfilment', // pick & pack
  'shipping', // waybills, courier handover, delivery exceptions, RTO
  'returns', // the returns desk: receive, inspect, restock
  'customers', // personal data: 0 masked · 1 name + city · 2 full contact
  'money', // amounts: 0 hidden · 1 order totals · 2 payments & settlements · 3 act on refunds
  'insights', // analytics
  'channels', // store connections & sync
  'team', // staff accounts & access
  'settings', // SLA targets, autopilot rules
  'stock', // inventory: 1 see stock · 2 adjust & count · 3 manage (plans, locations, AI rules)
  'procurement', // buying: 1 see POs · 2 draft & send POs · 3 approve & manage suppliers
  'warehouse', // warehouse work: 1 see · 2 do tasks & transfers · 3 assign, rebalance, see everyone's work
  'merch', // website placements: 1 see · 2 propose & edit · 3 publish to the websites
  'production', // contract manufacturing: 1 see · 2 update steps, samples & inspections · 3 place orders, agree costs, manage factories
] as const;
export type Area = (typeof AREAS)[number];

export const LEVELS = { none: 0, view: 1, act: 2, manage: 3 } as const;
export type Level = 0 | 1 | 2 | 3;
export type Scopes = Partial<Record<Area, Level>>;

export const AREA_LABEL: Record<Area, string> = {
  overview: 'Command centre',
  orders: 'Orders',
  intake: 'Confirmation',
  finance: 'Finance',
  fulfilment: 'Pick & pack',
  shipping: 'Shipping',
  returns: 'Returns desk',
  customers: 'Customer data',
  money: 'Money',
  insights: 'Insights',
  channels: 'Channels',
  team: 'Team',
  settings: 'Rules & SLAs',
  stock: 'Stock & inventory',
  procurement: 'Purchasing',
  warehouse: 'Warehouse work',
  merch: 'Merchandising',
  production: 'Production',
};

export const LEVEL_LABEL: Record<Area, [string, string, string, string]> = {
  overview: ['Hidden', 'View', 'View', 'View'],
  orders: ['Hidden', 'View', 'View & note', 'Manage'],
  intake: ['Hidden', 'View', 'Confirm & cancel', 'Manage'],
  finance: ['Hidden', 'View', 'Approve', 'Manage'],
  fulfilment: ['Hidden', 'View', 'Pick & pack', 'Manage'],
  shipping: ['Hidden', 'View', 'Ship & track', 'Manage'],
  returns: ['Hidden', 'View', 'Process', 'Manage'],
  customers: ['Masked', 'Name & city', 'Full contact', 'Full contact'],
  money: ['Hidden', 'Totals', 'Payments', 'Refunds'],
  insights: ['Hidden', 'View', 'View', 'Manage'],
  channels: ['Hidden', 'View', 'Sync', 'Manage'],
  team: ['Hidden', 'View', 'Invite', 'Manage'],
  settings: ['Hidden', 'View', 'Edit', 'Manage'],
  stock: ['Hidden', 'View', 'Adjust & count', 'Manage'],
  procurement: ['Hidden', 'View', 'Draft & send', 'Approve'],
  warehouse: ['Hidden', 'View', 'Do tasks', 'Run the floor'],
  merch: ['Hidden', 'View', 'Propose', 'Publish'],
  production: ['Hidden', 'View', 'Update steps & QC', 'Place & manage'],
};

// Need-to-know: each job sees the pages its work happens on and nothing else. A whole-floor view
// (Command centre, Pipeline) is for the people who run the floor; a queue's people get their queue,
// the orders they open from it, and the stock screens their work touches.
export const ROLES = {
  admin: {
    label: 'Admin',
    blurb: 'Everything, including staff access and store connections.',
    scopes: Object.fromEntries(AREAS.map((a) => [a, 3])) as Scopes,
  },
  ops: {
    label: 'Operations manager',
    blurb: 'Runs the floor: every stage, every queue, the rules and the numbers.',
    scopes: { overview: 1, orders: 3, intake: 3, finance: 2, fulfilment: 3, shipping: 3, returns: 3, customers: 2, money: 2, insights: 3, channels: 2, team: 1, settings: 3, stock: 2, procurement: 1, warehouse: 3, merch: 1, production: 1 },
  },
  supply: {
    label: 'Head of supply chain',
    blurb: 'Owns stock, buying and the warehouse: approves purchase orders and sees everyone’s work.',
    scopes: { overview: 1, orders: 1, fulfilment: 1, shipping: 1, returns: 1, customers: 0, money: 2, insights: 2, channels: 1, settings: 2, stock: 3, procurement: 3, warehouse: 3, merch: 2, production: 3 },
  },
  planner: {
    label: 'Stock planner',
    blurb: 'Reads the forecasts, accepts or rejects the AI’s proposals, balances stock between stores.',
    scopes: { customers: 0, money: 2, insights: 2, stock: 3, procurement: 2, warehouse: 1, merch: 1, production: 1 },
  },
  buyer: {
    label: 'Buyer',
    blurb: 'Turns the reorder plan into purchase orders, chases suppliers, books deliveries.',
    scopes: { customers: 0, money: 2, stock: 1, procurement: 2, warehouse: 1, production: 3 },
  },
  warehouse: {
    label: 'Warehouse operative',
    blurb: 'Picks, receives, puts away, counts and moves stock. Sees units, never the money.',
    scopes: { orders: 1, fulfilment: 2, customers: 0, money: 0, stock: 1, warehouse: 2 },
  },
  merchandiser: {
    label: 'E-commerce merchandiser',
    blurb: 'Decides what the websites push: cross-sells, upsells and pop-ups the AI proposes.',
    scopes: { customers: 0, money: 1, insights: 1, stock: 1, merch: 3 },
  },
  care: {
    label: 'Customer care',
    blurb: 'Confirms orders with customers, opens returns, keeps people informed.',
    scopes: { orders: 2, intake: 2, returns: 2, customers: 2, money: 1 },
  },
  finance: {
    label: 'Finance',
    blurb: 'Clears payments, reconciles courier cash, issues refunds, sees what is owed to suppliers.',
    scopes: { orders: 2, finance: 3, returns: 1, customers: 1, money: 3, insights: 2, procurement: 1, production: 1 },
  },
  fulfilment: {
    label: 'Fulfilment',
    blurb: 'Picks and packs. Sees what to pick and where it goes, not the money.',
    scopes: { orders: 1, fulfilment: 2, shipping: 1, customers: 1, money: 0, stock: 1, warehouse: 2 },
  },
  shipping: {
    label: 'Shipping',
    blurb: 'Waybills, courier handover, delivery exceptions and refusals.',
    scopes: { orders: 2, shipping: 2, returns: 1, customers: 2, money: 1, insights: 1 },
  },
  returns: {
    label: 'Returns desk',
    blurb: 'Receives returned parcels, inspects them and restocks what passes.',
    scopes: { orders: 1, shipping: 1, returns: 2, customers: 1, money: 1, stock: 1, warehouse: 1 },
  },
  marketing: {
    label: 'Marketing',
    blurb: 'Reads the numbers and proposes what the websites push. Never sees customer names.',
    scopes: { customers: 0, money: 1, insights: 1, stock: 1, merch: 2 },
  },
  // Dan, 25 Oct: brand managers follow their brands' sales (the shops first), stock and buying, and read
  // the websites' numbers; the websites' order handling (queues, couriers, returns desk, listings) is not theirs
  brand: {
    label: 'Brand manager',
    blurb: 'Their brands’ sales, stock and buying, and the websites’ numbers. No order handling; changes nothing.',
    scopes: { overview: 0, orders: 0, intake: 0, finance: 0, fulfilment: 0, shipping: 0, returns: 0, customers: 0, money: 2, insights: 1, channels: 0, team: 0, settings: 0, stock: 1, procurement: 1, warehouse: 0, merch: 0, production: 0 },
  },
  viewer: {
    label: 'Management (read-only)',
    blurb: 'Sees everything, changes nothing.',
    scopes: Object.fromEntries(AREAS.map((a) => [a, a === 'customers' || a === 'money' ? 2 : 1])) as Scopes,
  },
} as const satisfies Record<string, { label: string; blurb: string; scopes: Scopes }>;
export type Role = keyof typeof ROLES;

/**
 * The pages, and who sees each one. The menu, the phone tabs, the command palette and every page's
 * own guard read this one table, so what someone is offered and what opens for them never differ.
 * A page's data still checks its areas (money, customer data, acting on a stage) on its own.
 */
export const PAGES = {
  home: { label: 'Command centre', href: '/', see: (l: Lv) => l('overview') >= 1 },
  orders: { label: 'Orders', href: '/orders', see: (l: Lv) => l('orders') >= 1 && (l('overview') >= 1 || l('intake') >= 1 || l('finance') >= 1 || l('shipping') >= 2) },
  pipeline: { label: 'Pipeline', href: '/pipeline', see: (l: Lv) => l('overview') >= 1 },
  financeQueue: { label: 'Finance', href: '/queue/finance', see: (l: Lv) => l('finance') >= 1 },
  pick: { label: 'Pick & pack', href: '/queue/fulfilment', see: (l: Lv) => l('fulfilment') >= 1 },
  shipping: { label: 'Shipping', href: '/queue/shipping', see: (l: Lv) => l('shipping') >= 1 },
  couriers: { label: 'Courier assignment', href: '/couriers', see: (l: Lv) => l('shipping') >= 2 || (l('overview') >= 1 && l('money') >= 2) },
  returns: { label: 'Returns', href: '/returns', see: (l: Lv) => l('returns') >= 1 },
  // Dan, 24 Oct: brand managers, buying, stock, merchandising and management read brands (sales, movers, price tiers)
  brands: { label: 'Brands', href: '/brands', see: (l: Lv) => l('procurement') >= 1 || l('merch') >= 1 || l('stock') >= 2 || l('overview') >= 1 },
  // the report library: the brand people, finance and whoever runs the floor (each report checks money, cost, names itself)
  analytics: { label: 'Reports', href: '/analytics', see: (l: Lv) => l('procurement') >= 1 || l('merch') >= 1 || l('stock') >= 2 || l('overview') >= 1 || l('finance') >= 1 },
  stockBrief: { label: 'Stock brief', href: '/stock', see: (l: Lv) => l('stock') >= 2 || l('procurement') >= 2 || l('merch') >= 2 || l('warehouse') >= 3 },
  inventory: { label: 'Inventory', href: '/stock/inventory', see: (l: Lv) => l('stock') >= 1 },
  planning: { label: 'Planning', href: '/stock/planning', see: (l: Lv) => l('stock') >= 1 && l('procurement') >= 1 },
  purchasing: { label: 'Purchasing', href: '/stock/purchasing', see: (l: Lv) => l('procurement') >= 1 },
  warehouse: { label: 'Warehouse', href: '/stock/warehouse', see: (l: Lv) => l('warehouse') >= 1 },
  merch: { label: 'Website merch', href: '/stock/merch', see: (l: Lv) => l('merch') >= 1 },
  webItems: { label: 'Website vs Lucida', href: '/stock/web-items', see: (l: Lv) => l('merch') >= 1 || l('stock') >= 2 || l('procurement') >= 3 },
  teamPulse: { label: 'Team pulse', href: '/stock/team', see: (l: Lv) => l('warehouse') >= 3 || l('procurement') >= 3 || l('merch') >= 3 },
  production: { label: 'Production', href: '/production', see: (l: Lv) => l('production') >= 1 },
  insights: { label: 'Insights', href: '/insights', see: (l: Lv) => l('insights') >= 1 },
  financials: { label: 'Finance & analysis', href: '/financials', see: (l: Lv) => (l('finance') >= 1 || l('overview') >= 1) && l('money') >= 2 },
  cash: { label: 'Cash & refunds', href: '/finance', see: (l: Lv) => l('finance') >= 1 && l('money') >= 2 },
  channels: { label: 'Channels', href: '/channels', see: (l: Lv) => l('channels') >= 1 },
  team: { label: 'Team & access', href: '/team', see: (l: Lv) => l('team') >= 1 },
  rules: { label: 'Rules & SLAs', href: '/rules', see: (l: Lv) => l('settings') >= 1 || l('stock') >= 3 },
} as const satisfies Record<string, { label: string; href: string; see: (l: Lv) => boolean }>;
export type Page = keyof typeof PAGES;
type Lv = (a: Area) => number;

/** The jobs that look and never change anything, whatever their levels say. */
export const READ_ONLY_ROLES: string[] = ['viewer', 'brand'];

/** A brand manager's pages: their brands, the reports, stock and buying. Nothing from the order floor. */
export const BRAND_PAGES: Page[] = ['brands', 'analytics', 'insights', 'financials', 'stockBrief', 'inventory', 'planning', 'purchasing'];

/**
 * Whether this person is offered (and may open) a page. Management read-only sees every page but the
 * team-pulse board, which is for the people who assign work; a brand manager sees their own pages.
 */
export const canSee = (p: { role?: string; scopes: Scopes } | null | undefined, page: Page): boolean =>
  Boolean(p) &&
  (PAGES[page].see((a) => p!.scopes?.[a] ?? 0) ||
    (p!.role === 'viewer' && page !== 'teamPulse') ||
    (p!.role === 'brand' && BRAND_PAGES.includes(page)));

/**
 * Whether someone works the websites' orders (a queue, or the whole floor). The process side of a page
 * (deadlines, cash on delivery, couriers, refunds, who did what) is for them; anyone else who opens the
 * same page reads its numbers only.
 */
export const worksOrders = (p: Pick<Principal, 'scopes'> | null | undefined) => canAny(p, ['overview', 'intake', 'finance', 'fulfilment', 'shipping', 'returns']);

/** Where someone lands after signing in: their job's own page, or the Command centre if they run the floor, or the first page they can open. */
const JOB_LANDING: Partial<Record<Role, Page>> = { brand: 'brands', care: 'orders', finance: 'financeQueue', fulfilment: 'pick', shipping: 'shipping', returns: 'returns', warehouse: 'warehouse', buyer: 'purchasing', planner: 'stockBrief', merchandiser: 'merch', marketing: 'insights' };
const LANDING: Page[] = ['home', 'orders', 'financeQueue', 'pick', 'shipping', 'returns', 'warehouse', 'brands', 'stockBrief', 'purchasing', 'merch', 'insights', 'inventory', 'orders', 'cash', 'team', 'channels', 'rules'];
export const landingFor = (p: { role?: string; scopes: Scopes }) => {
  const own = JOB_LANDING[p.role as Role];
  const page = own && canSee(p, own) ? own : LANDING.find((pg) => canSee(p, pg));
  return page ? PAGES[page].href : null;
};

/** What to store for a teammate: only where their access differs from their job's preset, so a better preset reaches them. */
export const overridesFor = (role: Role, wanted: Scopes): Scopes =>
  Object.fromEntries((Object.entries(wanted) as [Area, Level][]).filter(([a, l]) => (l ?? 0) !== ((ROLES[role].scopes as Scopes)[a] ?? 0))) as Scopes;

export type Principal = {
  id: string;
  name: string;
  role: Role;
  scopes: Scopes;
  channels: string[]; // empty = every channel
  brands?: string[]; // empty or missing = every brand
};

export const level = (p: Pick<Principal, 'scopes'> | null | undefined, area: Area): Level => (p?.scopes?.[area] ?? 0) as Level;
export const can = (p: Pick<Principal, 'scopes'> | null | undefined, area: Area, min: Level = 1) => level(p, area) >= min;
export const canAny = (p: Pick<Principal, 'scopes'> | null | undefined, areas: Area[], min: Level = 1) => areas.some((a) => can(p, a, min));

export const seesChannel = (p: Pick<Principal, 'channels'>, channelId: string) => !p.channels.length || p.channels.includes(channelId);

/** Whether someone limited to brands may see a record holding pieces of these brands (any one is enough). */
export const seesBrands = (p: Pick<Principal, 'brands'>, brands: (string | null | undefined)[]) =>
  !p.brands?.length || brands.some((b) => b && p.brands!.some((x) => sameBrand(x, b)));

/** Whether a single brand is inside someone's brand scope. */
export const seesBrand = (p: Pick<Principal, 'brands'>, brand: string | null | undefined) => seesBrands(p, [brand]);

/** A scope set never exceeds the editor's own, area by area. */
export const within = (editor: Scopes, wanted: Scopes) =>
  (Object.keys(wanted) as Area[]).every((a) => (wanted[a] ?? 0) <= (editor[a] ?? 0));

export const scopesFor = (role: Role, overrides?: Scopes): Scopes => ({ ...ROLES[role].scopes, ...(overrides ?? {}) });

/**
 * What a person can actually do: their job's preset, overlaid with what was saved for them.
 * An area added after someone's access was saved takes the job's default rather than reading as
 * hidden, so a new module reaches the right people the day it ships.
 */
export const effectiveScopes = (role: string, saved: Scopes): Scopes => ({ ...(ROLES[role as Role]?.scopes ?? {}), ...saved });

/** Cost prices and margins: money at the payments level, or a buyer's own need to see them. */
export const seesCost = (p: Pick<Principal, 'scopes'> | null | undefined) => can(p, 'money', 2) || can(p, 'procurement', 2);

/** Masks a name for anyone without customer access: "Salma Mostafa" → "S. M." */
export function maskName(name: string | null | undefined) {
  if (!name) return 'Customer';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => `${w[0]?.toUpperCase()}.`)
    .join(' ');
}

export function maskPhone(phone: string | null | undefined) {
  if (!phone) return '';
  return phone.replace(/\d(?=\d{2})/g, '•');
}
