'use client';

import { Search } from 'lucide-react';
import type { Badges } from '@/lib/queries';
import type { Notifications } from '@/lib/notifications';
import { allowed, NAV, type Me } from './nav';
import { useLive } from './live';
import { Bell } from './bell';

/** The queues this person can open, with what waits in each, for the foot of the bell. */
export const waitingQueues = (me: Me, badges: Badges) =>
  NAV.flatMap((g) => g.items)
    .filter((i) => i.badge && allowed(me, i))
    .map((i) => ({ label: i.label, href: i.href, n: badges[i.badge!]?.n ?? 0, late: badges[i.badge!]?.late ?? 0 }))
    .filter((q) => q.n > 0);

/**
 * The header's right side: the search pill and the bell with what needs this person (bell.tsx).
 */
export function TopActions({ me, badges, notes }: { me: Me; badges: Badges; notes: Notifications }) {
  const { openPalette } = useLive();
  return (
    <div className="hidden items-center gap-2.5 lg:flex" style={{ animation: 'fadeIn .15s ease-out both' }}>
      <button onClick={openPalette} className="search-pill w-[300px] text-left transition hover:text-ink-2">
        <span className="flex-1 truncate">Search orders, styles, people…</span>
        <span className="kbd">Ctrl K</span>
        <span className="go">
          <Search className="size-4" />
        </span>
      </button>
      <Bell userId={me.id} notes={notes} queues={waitingQueues(me, badges)} />
    </div>
  );
}
