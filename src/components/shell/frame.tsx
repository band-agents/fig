'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, LogOut, Moon, Sun, X } from 'lucide-react';
import { setTheme, signOut } from '@/app/actions';
import type { Badges } from '@/lib/queries';
import { isActive, sectionsFor, type Me } from './nav';
import { FULL } from './instant-links';

/**
 * The frame, as the Ghattas clinic admin (Payload's default template): a side menu that the header's
 * hamburger opens and closes, remembered per browser in a cookie so the page never jumps. On a wide
 * screen it sits beside the page; below 960px it opens over the page, full width, and any page you
 * pick closes it.
 */
const NAV_COOKIE = 'dh_nav';
const GROUPS_COOKIE = 'dh_navg';
const year = 60 * 60 * 24 * 365;
const keep = (name: string, value: string) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${year}; samesite=lax`;
};

type Ctx = { open: boolean; phone: boolean; toggle: () => void; close: () => void };
const NavCtx = createContext<Ctx>({ open: true, phone: false, toggle: () => {}, close: () => {} });
export const useNav = () => useContext(NavCtx);

const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 959px)').matches;

export function NavProvider({ initialOpen, children }: { initialOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  const [phone, setPhone] = useState(false);
  const pathname = usePathname();
  // a page picked from the phone menu closes it
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (phone) setPhone(false);
  }
  useEffect(() => {
    document.documentElement.style.overflow = phone ? 'hidden' : '';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [phone]);
  const value = useMemo<Ctx>(
    () => ({
      open,
      phone,
      toggle: () => {
        if (narrow()) return setPhone((p) => !p);
        setOpen((o) => {
          keep(NAV_COOKIE, o ? '0' : '1');
          return !o;
        });
      },
      close: () => {
        if (narrow()) return setPhone(false);
        keep(NAV_COOKIE, '0');
        setOpen(false);
      },
    }),
    [open, phone],
  );
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}

/** The menu: the desk (the everyday pages, with icons) above Payload's groups of plain links. */
export function SideNav({ me, badges, initialCollapsed, initialTheme }: { me: Me; badges: Badges; initialCollapsed: string[]; initialTheme: 'dark' | 'light' }) {
  const pathname = usePathname();
  const router = useRouter();
  const { open, phone, close } = useNav();
  const [collapsed, setCollapsed] = useState(() => new Set(initialCollapsed));
  const [theme, setThemeState] = useState(initialTheme);
  const sections = useMemo(() => sectionsFor(me), [me]);
  const desk = sections.find((s) => s.key === 'main');
  const groups = sections.filter((s) => s.key !== 'main');
  // the one entry that is lit: the longest address that holds this page
  const current = useMemo(
    () =>
      sections
        .flatMap((s) => s.items)
        .filter((i) => isActive(pathname, i.href))
        .sort((a, b) => b.href.length - a.href.length)[0]?.href,
    [sections, pathname],
  );

  const flipGroup = (key: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      keep(GROUPS_COOKIE, [...n].join(','));
      return n;
    });
  const flipTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    void setTheme(next);
  };
  const count = (badge?: keyof Badges) => {
    const b = badge ? badges[badge] : null;
    if (!b || !b.n) return null;
    return (
      <span className="app-count" data-late={b.late > 0 ? 'true' : undefined} title={b.late ? `${b.n} waiting, ${b.late} late` : `${b.n} waiting`}>
        {b.n > 99 ? '99+' : b.n}
      </span>
    );
  };
  const warm = (href: string) => router.prefetch(href, FULL);

  return (
    <aside className="app-nav" data-open={open ? 'true' : 'false'} data-phone={phone ? 'true' : 'false'} aria-label="Menu">
      <div className="app-nav-head">
        <button onClick={close} className="app-burger" aria-label="Close the menu">
          {phone ? <X className="size-4" strokeWidth={1.6} /> : <ChevronLeft className="size-4" strokeWidth={1.6} />}
        </button>
      </div>
      <div className="app-nav-scroll">
        {desk && (
          <nav className="app-desk" aria-label="Desk">
            <div className="app-desk-title">Operations desk</div>
            {desk.items.map((i) => {
              const Icon = i.icon;
              return (
                <Link key={i.href} href={i.href} aria-current={current === i.href ? 'page' : undefined} onPointerDown={() => warm(i.href)} title={i.hint}>
                  <Icon strokeWidth={1.6} />
                  <span className="min-w-0 flex-1 truncate">{i.label}</span>
                  {count(i.badge)}
                </Link>
              );
            })}
          </nav>
        )}
        {groups.map((g) => {
          const shut = collapsed.has(g.key);
          return (
            <div key={g.key} className="app-group" data-collapsed={shut ? 'true' : 'false'}>
              <button className="app-group-toggle" onClick={() => flipGroup(g.key)} aria-expanded={!shut}>
                <span>{g.label}</span>
                <ChevronDown strokeWidth={1.6} />
              </button>
              <div className="app-group-links">
                {g.items.map((i) => (
                  <Link key={i.href} href={i.href} className="app-link" aria-current={current === i.href ? 'page' : undefined} onPointerDown={() => warm(i.href)} title={i.hint}>
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    {count(i.badge)}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
        <div className="app-nav-foot">
          <form action={signOut}>
            <button aria-label="Sign out" title="Sign out">
              <LogOut className="size-[18px]" strokeWidth={1.6} />
            </button>
          </form>
          <button onClick={flipTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? <Sun className="size-[17px]" strokeWidth={1.6} /> : <Moon className="size-[17px]" strokeWidth={1.6} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
