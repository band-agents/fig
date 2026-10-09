import {
  Activity,
  ArrowLeftRight,
  Banknote,
  Boxes,
  ChartNoAxesColumn,
  Headset,
  KanbanSquare,
  ListOrdered,
  PlugZap,
  SlidersHorizontal,
  Truck,
  Undo2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Area, Role, Scopes } from '@/lib/domain/perms';

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

export type NavItem = { href: string; label: string; icon: LucideIcon; area: Area; min?: number; badge?: 'care' | 'finance' | 'fulfilment' | 'shipping' | 'returns'; tint?: string };

export const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [
      { href: '/', label: 'Command centre', icon: Activity, area: 'orders' },
      { href: '/orders', label: 'Orders', icon: ListOrdered, area: 'orders' },
      { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare, area: 'orders' },
    ],
  },
  {
    group: 'Queues',
    items: [
      { href: '/queue/care', label: 'Confirm', icon: Headset, area: 'intake', badge: 'care', tint: 'violet' },
      { href: '/queue/finance', label: 'Finance', icon: Banknote, area: 'finance', badge: 'finance', tint: 'amber' },
      { href: '/queue/fulfilment', label: 'Pick & pack', icon: Boxes, area: 'fulfilment', badge: 'fulfilment', tint: 'blue' },
      { href: '/queue/shipping', label: 'Shipping', icon: Truck, area: 'shipping', badge: 'shipping', tint: 'cyan' },
      { href: '/returns', label: 'Returns', icon: Undo2, area: 'returns', badge: 'returns', tint: 'rose' },
    ],
  },
  {
    group: 'Business',
    items: [
      { href: '/insights', label: 'Insights', icon: ChartNoAxesColumn, area: 'insights' },
      { href: '/finance', label: 'Cash & refunds', icon: ArrowLeftRight, area: 'finance' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { href: '/channels', label: 'Channels', icon: PlugZap, area: 'channels' },
      { href: '/team', label: 'Team & access', icon: Users, area: 'team' },
      { href: '/rules', label: 'Rules & SLAs', icon: SlidersHorizontal, area: 'settings' },
    ],
  },
];

export const allowed = (me: Me, item: NavItem) => (me.scopes[item.area] ?? 0) >= (item.min ?? 1);

export const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
