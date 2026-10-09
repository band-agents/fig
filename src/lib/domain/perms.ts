// Access = a job preset + a per-area level, plus an optional channel scope (e.g. the Kuwait team).
// Pure module: read by the server for every check and by client screens to hide what can't be done.

export const AREAS = [
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
] as const;
export type Area = (typeof AREAS)[number];

export const LEVELS = { none: 0, view: 1, act: 2, manage: 3 } as const;
export type Level = 0 | 1 | 2 | 3;
export type Scopes = Partial<Record<Area, Level>>;

export const AREA_LABEL: Record<Area, string> = {
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
};

export const LEVEL_LABEL: Record<Area, [string, string, string, string]> = {
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
};

export const ROLES = {
  admin: {
    label: 'Admin',
    blurb: 'Everything, including staff access and store connections.',
    scopes: Object.fromEntries(AREAS.map((a) => [a, 3])) as Scopes,
  },
  ops: {
    label: 'Operations manager',
    blurb: 'Runs the floor: every stage, every queue, the rules and the numbers.',
    scopes: { orders: 3, intake: 3, finance: 2, fulfilment: 3, shipping: 3, returns: 3, customers: 2, money: 2, insights: 3, channels: 2, team: 1, settings: 3 },
  },
  care: {
    label: 'Customer care',
    blurb: 'Confirms orders with customers, opens returns, keeps people informed.',
    scopes: { orders: 2, intake: 2, finance: 0, fulfilment: 1, shipping: 1, returns: 2, customers: 2, money: 1, insights: 1 },
  },
  finance: {
    label: 'Finance',
    blurb: 'Clears payments, reconciles courier cash, issues refunds.',
    scopes: { orders: 2, intake: 1, finance: 3, fulfilment: 1, shipping: 1, returns: 1, customers: 1, money: 3, insights: 2 },
  },
  fulfilment: {
    label: 'Fulfilment',
    blurb: 'Picks and packs. Sees what to pick and where it goes, not the money.',
    scopes: { orders: 1, fulfilment: 2, shipping: 1, returns: 1, customers: 1, money: 0 },
  },
  shipping: {
    label: 'Shipping',
    blurb: 'Waybills, courier handover, delivery exceptions and refusals.',
    scopes: { orders: 2, fulfilment: 1, shipping: 2, returns: 1, customers: 2, money: 1, insights: 1 },
  },
  returns: {
    label: 'Returns desk',
    blurb: 'Receives returned parcels, inspects them and restocks what passes.',
    scopes: { orders: 1, fulfilment: 1, shipping: 1, returns: 2, customers: 1, money: 1 },
  },
  marketing: {
    label: 'Marketing',
    blurb: 'Reads the numbers. Never sees customer names or contact details.',
    scopes: { orders: 1, customers: 0, money: 1, insights: 1 },
  },
  viewer: {
    label: 'Management (read-only)',
    blurb: 'Sees everything, changes nothing.',
    scopes: Object.fromEntries(AREAS.map((a) => [a, a === 'customers' ? 2 : 1])) as Scopes,
  },
} as const satisfies Record<string, { label: string; blurb: string; scopes: Scopes }>;
export type Role = keyof typeof ROLES;

export type Principal = {
  id: string;
  name: string;
  role: Role;
  scopes: Scopes;
  channels: string[]; // empty = every channel
};

export const level = (p: Pick<Principal, 'scopes'> | null | undefined, area: Area): Level => (p?.scopes?.[area] ?? 0) as Level;
export const can = (p: Pick<Principal, 'scopes'> | null | undefined, area: Area, min: Level = 1) => level(p, area) >= min;
export const canAny = (p: Pick<Principal, 'scopes'> | null | undefined, areas: Area[], min: Level = 1) => areas.some((a) => can(p, a, min));

export const seesChannel = (p: Pick<Principal, 'channels'>, channelId: string) => !p.channels.length || p.channels.includes(channelId);

/** A scope set never exceeds the editor's own, area by area. */
export const within = (editor: Scopes, wanted: Scopes) =>
  (Object.keys(wanted) as Area[]).every((a) => (wanted[a] ?? 0) <= (editor[a] ?? 0));

export const scopesFor = (role: Role, overrides?: Scopes): Scopes => ({ ...ROLES[role].scopes, ...(overrides ?? {}) });

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
