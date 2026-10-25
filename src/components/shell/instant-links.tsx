'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Fired when the live feed refreshes the page, which also empties the pages kept in memory. */
export const REFRESHED = 'relay:refreshed';

type Prefetch = ReturnType<typeof useRouter>['prefetch'];
/**
 * The whole page, data included. router.prefetch alone loads only a dynamic page's outline (24 Oct:
 * the click still went to the server); "full" is Next's own PrefetchKind.FULL, the enum's string value.
 */
export const FULL = { kind: 'full' } as unknown as Parameters<Prefetch>[1];

/**
 * Dan, 24 Oct: a page must open "as fast as I touch the mouse to click". Two things make that so:
 *
 * - Any link in the console (menu, tables, tabs, filters, chips) starts loading its page the moment
 *   the pointer rests on it (50 ms) or the button goes down, so by the time the click lands the page
 *   is already here. One listener on the document does it for every link.
 * - After a page opens and the console is idle, the menu pages this person can open are loaded in the
 *   background, one at a time, so a menu click never waits. Again after each live refresh, which
 *   empties what was kept.
 *
 * Exports, templates and the API are never loaded ahead: those are downloads, not pages.
 */
export function InstantLinks({ warm }: { warm: string[] }) {
  const router = useRouter();
  const pages = warm.join('|');

  useEffect(() => {
    const recent = new Map<string, number>();
    const ahead = (href: string) => {
      const t = recent.get(href);
      if (t && Date.now() - t < 3000) return;
      recent.set(href, Date.now());
      router.prefetch(href, FULL);
    };
    const hrefOf = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return null;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || /^\/api\/|\/(export|template)(\/|$)/.test(u.pathname)) return null;
      if (u.pathname === location.pathname && u.search === location.search) return null;
      return u.pathname + u.search;
    };
    let rest: ReturnType<typeof setTimeout> | undefined;
    const over = (e: PointerEvent) => {
      clearTimeout(rest);
      const h = hrefOf(e);
      if (h) rest = setTimeout(() => ahead(h), 50);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const h = hrefOf(e);
      if (h) ahead(h);
    };
    const refreshed = () => recent.clear();
    document.addEventListener('pointerover', over, { passive: true });
    document.addEventListener('pointerdown', down, { passive: true, capture: true });
    window.addEventListener(REFRESHED, refreshed);
    return () => {
      clearTimeout(rest);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener(REFRESHED, refreshed);
    };
  }, [router]);

  // the menu pages, in the background, once the console is idle
  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    // at most every two minutes: on a busy day the live feed refreshes often, and the one database is
    // shared with everyone's real clicks (hover loading covers the time in between)
    let last = 0;
    const stop = () => {
      for (const t of timers) clearTimeout(t);
      timers = [];
    };
    const run = () => {
      if (Date.now() - last < 120_000) return;
      last = Date.now();
      stop();
      const list = pages.split('|').filter((h) => h && h !== location.pathname);
      timers.push(
        setTimeout(() => {
          list.forEach((h, i) => timers.push(setTimeout(() => document.visibilityState === 'visible' && router.prefetch(h, FULL), i * 300)));
        }, 1500),
      );
    };
    run();
    window.addEventListener(REFRESHED, run);
    // kept pages last 5 minutes: load them again a little before, while the console is open
    const again = setInterval(run, 4 * 60_000);
    return () => {
      stop();
      clearInterval(again);
      window.removeEventListener(REFRESHED, run);
    };
  }, [router, pages]);

  return null;
}
