'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { BrandLockup } from '@/components/brand';
import type { Business, BusinessView } from '@/lib/business';
import type { Badges } from '@/lib/queries';
import type { Notifications } from '@/lib/notifications';
import type { Me } from './nav';
import { Bell } from './bell';
import { waitingQueues } from './top-actions';
import { BusinessSwitch } from './business-switch';
import { useLive } from './live';

/**
 * Phones and tablets: the logos, the business switch (FIG / Labesny) and a round search button. The
 * sections, the AI and the account live in the floating toolbar at the foot (mobile-nav.tsx); wide
 * screens use the side menu.
 */
export function Topbar({ businesses, business, me, badges, notes }: { businesses: Business[]; business: BusinessView; me: Me; badges: Badges; notes: Notifications }) {
  const { openPalette } = useLive();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] px-4 backdrop-blur-xl sm:px-6 lg:hidden">
      <Link href="/" aria-label="DH & DCO home">
        <BrandLockup height={13} />
      </Link>
      <div className="flex items-center gap-2">
        <BusinessSwitch businesses={businesses} current={business} compact />
        <button onClick={openPalette} className="icon-btn !size-10" aria-label="Search">
          <Search className="size-[17px]" strokeWidth={1.8} />
        </button>
        <Bell userId={me.id} notes={notes} queues={waitingQueues(me, badges)} />
      </div>
    </header>
  );
}
