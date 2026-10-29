'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleUserRound, LogOut, Menu, Moon, Search, Sun } from 'lucide-react';
import { BrandLockup } from '@/components/brand';
import { setTheme, signOut } from '@/app/actions';
import type { Business, BusinessView } from '@/lib/business';
import type { Badges } from '@/lib/queries';
import type { Notifications } from '@/lib/notifications';
import { isActive, NAV, waitingQueues, type Me } from './nav';
import { BusinessSwitch } from './business-switch';
import { Bell } from './bell';
import { useLive } from './live';
import { useNav } from './frame';

const SITE = ' · DH & DCO';

/**
 * Payload's app header: the hamburger when the menu is closed, the logo, then where you are
 * ("Orders / #1042"). On the right: FIG or Labesny (drawn as Ghattas's language switch), search,
 * the bell and the account.
 */
export function AppHeader({ me, badges, notes, businesses, business, demo }: { me: Me; badges: Badges; notes: Notifications; businesses: Business[]; business: BusinessView; demo: boolean }) {
  const pathname = usePathname();
  const { open, toggle } = useNav();
  const { openPalette, connected } = useLive();
  const item = useMemo(
    () =>
      NAV.flatMap((g) => g.items)
        .filter((i) => isActive(pathname, i.href))
        .sort((a, b) => b.href.length - a.href.length)[0],
    [pathname],
  );
  // a page below a menu entry (an order, a style, a brand) adds its own name from the page title
  const [title, setTitle] = useState('');
  useEffect(() => {
    const read = () => setTitle(document.title.endsWith(SITE) ? document.title.slice(0, -SITE.length) : '');
    read();
    const el = document.querySelector('title');
    if (!el) return;
    const mo = new MutationObserver(read);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => mo.disconnect();
  }, [pathname]);
  const deep = item && pathname !== item.href && title && title !== item.label ? title : null;

  return (
    <header className="app-header gutter">
      {/* the frame's classes sit outside Tailwind's layers, so visibility goes on a wrapper */}
      <span className={`flex-none ${open ? 'min-[960px]:hidden' : ''}`}>
        <button onClick={toggle} className="app-burger" aria-label="Open the menu">
          <Menu className="size-4" strokeWidth={1.6} />
        </button>
      </span>
      <nav className="app-crumbs" aria-label="Breadcrumb">
        <Link href="/" aria-label="DH & DCO home" className="flex-none">
          <BrandLockup height={15} />
        </Link>
        {item && item.href !== '/' && (
          <>
            <span className="sep">/</span>
            {deep ? (
              <Link href={item.href} className="hidden truncate sm:inline">
                {item.label}
              </Link>
            ) : (
              <span className="now">{item.label}</span>
            )}
          </>
        )}
        {item?.href === '/' && (
          <>
            <span className="sep">/</span>
            <span className="now">Dashboard</span>
          </>
        )}
        {deep && (
          <>
            <span className="sep hidden sm:inline">/</span>
            <span className="now">{deep}</span>
          </>
        )}
      </nav>
      <div className="ml-auto flex flex-none items-center gap-2.5">
        <span className="hidden md:inline-flex">
          <BusinessSwitch businesses={businesses} current={business} />
        </span>
        <span className="hidden xl:block">
          <button onClick={openPalette} className="search-pill w-[220px] text-left" aria-label="Search">
            <Search className="size-4 flex-none" strokeWidth={1.6} />
            <span className="flex-1 truncate">Search</span>
            <span className="kbd">Ctrl K</span>
          </button>
        </span>
        <span className="xl:hidden">
          <button onClick={openPalette} className="icon-btn" aria-label="Search">
            <Search className="size-4" strokeWidth={1.6} />
          </button>
        </span>
        <Bell userId={me.id} notes={notes} queues={waitingQueues(me, badges)} />
        <Account me={me} demo={demo} connected={connected} businesses={businesses} business={business} />
      </div>
    </header>
  );
}

function Account({ me, demo, connected, businesses, business }: { me: Me; demo: boolean; connected: boolean; businesses: Business[]; business: BusinessView }) {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<'dark' | 'light'>('light');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    void setTheme(next);
  };
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setThemeState(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
          setOpen((o) => !o);
        }}
        className="app-avatar relative"
        aria-label="Account"
        aria-expanded={open}
      >
        <CircleUserRound className="size-[26px]" strokeWidth={1.2} />
        <span className={`absolute bottom-0 right-0 size-2 rounded-full ring-2 ring-[var(--bg)] ${connected ? 'bg-[var(--live)]' : 'bg-ink-4'}`} title={connected ? 'Live' : 'Reconnecting…'} />
      </button>
      {open && (
        <div className="app-menu" role="menu">
          <div className="border-b border-line px-3.5 py-3">
            <div className="truncate text-[13px] font-semibold">{me.name}</div>
            <div className="truncate text-[12px] text-ink-3">{me.email}</div>
            <div className="mt-1.5 text-[12px] text-ink-2">
              {me.roleLabel}
              {me.channels.length > 0 ? ` · ${me.channels.length} store${me.channels.length > 1 ? 's' : ''}` : ''}
            </div>
            {demo && <div className="mt-1.5 text-[11.5px] text-ink-4">Demo floor · fictional customers, real products</div>}
          </div>
          {businesses.length > 1 && (
            <div className="border-b border-line px-3.5 py-2.5 md:hidden">
              <BusinessSwitch businesses={businesses} current={business} compact />
            </div>
          )}
          <div className="py-1">
            <button onClick={flip} role="menuitem">
              {theme === 'dark' ? <Sun className="size-4 text-ink-3" strokeWidth={1.6} /> : <Moon className="size-4 text-ink-3" strokeWidth={1.6} />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <form action={signOut}>
              <button role="menuitem">
                <LogOut className="size-4 text-ink-3" strokeWidth={1.6} /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
