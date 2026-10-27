import { Activity, ArrowDownUp, Droplets, Goal, ListChecks, PiggyBank, BrainCircuit, CalendarRange, Factory, Gauge, GitCompareArrows, Megaphone, Package, ShoppingCart, Warehouse, ArrowLeftRight, Banknote, Boxes, ChartNoAxesColumn, KanbanSquare, LayoutGrid, Layers, Settings2, Landmark, ListOrdered, PlugZap, SlidersHorizontal, Truck, Undo2, Users, type LucideIcon, Tags, Rabbit, Scale, FileBarChart } from 'lucide-react';
import { canSee, type Page, type Role, type Scopes } from '@/lib/domain/perms';

export type Me = {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  scopes: Scopes;
  channels: string[];
  hue: number;
  title: string | null;
};

export type NavItem = { href: string; label: string; icon: LucideIcon; page: Page; hint?: string; badge?: 'care' | 'finance' | 'fulfilment' | 'shipping' | 'returns' | 'stock' | 'buying' | 'warehouse' | 'merch'; tint?: string };

export const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [
      { href: '/today', label: 'Today', icon: ListChecks, page: 'today', hint: 'What to do now, ranked by the money it is worth', tint: 'green' },
      { href: '/', label: 'Command centre', icon: Activity, page: 'home', hint: 'Today at a glance: sales, late work, what needs you' },
      { href: '/orders', label: 'Orders', icon: ListOrdered, page: 'orders', hint: 'Every order: search, filter, export' },
      { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare, page: 'pipeline', hint: 'Every open order by stage, on one board' },
    ],
  },
  {
    group: 'Queues',
    items: [
      { href: '/queue/finance', label: 'Finance', icon: Banknote, page: 'financeQueue', hint: 'Payments to check, refunds to issue', badge: 'finance', tint: 'amber' },
      { href: '/queue/fulfilment', label: 'Pick & pack', icon: Boxes, page: 'pick', hint: 'Orders to pick, pack and hand over', badge: 'fulfilment', tint: 'blue' },
      { href: '/queue/shipping', label: 'Shipping', icon: Truck, page: 'shipping', hint: 'Waybills, couriers, delivery problems', badge: 'shipping', tint: 'cyan' },
      { href: '/couriers', label: 'Courier assignment', icon: Scale, page: 'couriers', hint: 'The cheapest courier for every open order, and assign it', tint: 'cyan' },
      { href: '/returns', label: 'Returns', icon: Undo2, page: 'returns', hint: 'Every return, from request to refund', badge: 'returns', tint: 'rose' },
    ],
  },
  {
    group: 'Brands',
    items: [
      { href: '/brands', label: 'Brands', icon: Tags, page: 'brands', hint: 'Sales, pace, stock and gaps per brand' },
      { href: '/brands/movers', label: 'Fast & slow movers', icon: Rabbit, page: 'brands', hint: 'Every style by pace and cover' },
      { href: '/brands/prices', label: 'High vs low price', icon: Scale, page: 'brands', hint: 'Which price levels sell more' },
    ],
  },
  {
    group: 'Stock & buying',
    items: [
      { href: '/stock', label: 'Stock brief', icon: BrainCircuit, page: 'stockBrief', hint: 'What to reorder, move or mark down', badge: 'stock', tint: 'violet' },
      { href: '/stock/inventory', label: 'Inventory', icon: Package, page: 'inventory', hint: 'Every style with its stock and cover', tint: 'blue' },
      { href: '/stock/planning', label: 'Planning', icon: CalendarRange, page: 'planning', hint: 'Forecasts and the reorder plan', tint: 'amber' },
      { href: '/stock/purchasing', label: 'Purchasing', icon: ShoppingCart, page: 'purchasing', hint: 'Purchase orders, draft to delivery', badge: 'buying', tint: 'cyan' },
      { href: '/production', label: 'Production', icon: Factory, page: 'production', hint: 'Made-to-order work in progress', tint: 'amber' },
      { href: '/stock/warehouse', label: 'Warehouse', icon: Warehouse, page: 'warehouse', hint: 'Receiving, counts and moves', badge: 'warehouse', tint: 'green' },
      { href: '/stock/merch', label: 'Website merch', icon: Megaphone, page: 'merch', hint: 'What the websites push', badge: 'merch', tint: 'rose' },
      { href: '/stock/web-items', label: 'Website vs Lucida', icon: GitCompareArrows, page: 'webItems', hint: 'Live, sold out, missing photos', tint: 'neutral' },
      { href: '/stock/team', label: 'Team pulse', icon: Gauge, page: 'teamPulse', hint: 'Who is doing what, right now', tint: 'neutral' },
    ],
  },
  {
    group: 'Catalogue',
    items: [{ href: '/catalog', label: 'Import & export', icon: ArrowDownUp, page: 'catalog', hint: 'Products into every website from Excel: dry run, import, undo', tint: 'violet' }],
  },
  {
    group: 'Business',
    items: [
      { href: '/leaks', label: 'Money leaks', icon: Droplets, page: 'leaks', hint: 'What the business loses each week, and where to fix it', tint: 'rose' },
      { href: '/targets', label: 'Targets & pacing', icon: Goal, page: 'targets', hint: 'Each brand’s month against its target, and where it will land', tint: 'amber' },
      { href: '/profit', label: 'True profit', icon: PiggyBank, page: 'profit', hint: 'What each order really leaves, and where it sells at a loss', tint: 'green' },
      { href: '/analytics', label: 'Reports', icon: FileBarChart, page: 'analytics', hint: 'Every report for finance and brands' },
      { href: '/financials', label: 'Finance & analysis', icon: Landmark, page: 'financials', hint: 'The month in money' },
      { href: '/insights', label: 'Insights', icon: ChartNoAxesColumn, page: 'insights', hint: 'Trends, customers and channels' },
      { href: '/finance', label: 'Cash & refunds', icon: ArrowLeftRight, page: 'cash', hint: 'Cash coming in, refunds going out' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { href: '/channels', label: 'Channels', icon: PlugZap, page: 'channels', hint: 'Store connections and syncing' },
      { href: '/team', label: 'Team & access', icon: Users, page: 'team', hint: 'People, jobs and what each sees' },
      { href: '/rules', label: 'Rules & SLAs', icon: SlidersHorizontal, page: 'rules', hint: 'Deadlines and automatic rules' },
    ],
  },
];

/** Each section's own icon and name: the menu shows these, and a section's pages open beside it. */
export const SECTION: Record<string, { label: string; short: string; icon: LucideIcon }> = {
  main: { label: 'Overview', short: 'Overview', icon: LayoutGrid },
  Queues: { label: 'Queues', short: 'Queues', icon: Layers },
  Brands: { label: 'Brands', short: 'Brands', icon: Tags },
  'Stock & buying': { label: 'Stock & buying', short: 'Stock', icon: Package },
  Catalogue: { label: 'Catalogue', short: 'Catalogue', icon: ArrowDownUp },
  Business: { label: 'Business', short: 'Business', icon: Landmark },
  Setup: { label: 'Setup', short: 'Setup', icon: Settings2 },
};
export const sectionKey = (group: string | null) => group ?? 'main';

/** The sections this person can open, each with only the pages they may see. */
export const sectionsFor = (me: Me) =>
  NAV.map((g) => ({ key: sectionKey(g.group), ...SECTION[sectionKey(g.group)], items: g.items.filter((i) => allowed(me, i)) })).filter((g) => g.items.length > 0);

/** Offered in the menu, the phone tabs and the palette exactly when the page itself would open. */
export const allowed = (me: Me, item: NavItem) => canSee(me, item.page);

// "/stock" is a page and a prefix: it lights up for itself only, not for every stock page under it
export const isActive = (pathname: string, href: string) =>
  href === '/' || href === '/stock'
    ? pathname === href
    : href === '/brands'
      ? // a brand's own page is under Brands; the movers and the price pages have their own entries
        pathname === href || (pathname.startsWith('/brands/') && !/^\/brands\/(movers|prices)(\/|$)/.test(pathname))
      : pathname === href || pathname.startsWith(`${href}/`);
