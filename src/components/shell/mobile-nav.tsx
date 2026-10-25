'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LayoutGrid, LogOut, Moon, Search, Sun, X } from 'lucide-react';
import type { Badges } from '@/lib/queries';
import { Avatar } from '@/components/ui/avatar';
import { setTheme, signOut } from '@/app/actions';
import { isActive, sectionsFor, type Me } from './nav';
import { useLive } from './live';
import { FULL } from './instant-links';

type Section = ReturnType<typeof sectionsFor>[number];

/**
 * Phone: a floating toolbar at the foot of the screen. The first sections on either side, the AI orb
 * raised in the middle, "More" at the end for the rest and the account. A section with one page goes
 * straight there; one with several slides up as a sheet of tiles, the work waiting on each.
 */
export function MobileNav({ me, badges, initialTheme }: { me: Me; badges: Badges; initialTheme: 'dark' | 'light' }) {
  const pathname = usePathname();
  const { openPalette } = useLive();
  // the sheet remembers the page it was opened on, so moving to another page closes it
  const [sheetOn, setSheetOn] = useState<{ key: string; path: string } | null>(null);
  const sheet = sheetOn && sheetOn.path === pathname ? sheetOn.key : null;
  const open = (key: string | null) => setSheetOn(key ? { key, path: pathname } : null);
  const sections = sectionsFor(me);
  const bar = sections.slice(0, 3);
  const more = sections.slice(3);
  const left = bar.slice(0, 2);
  const right = bar.slice(2);
  const waiting = (s: Section) => s.items.reduce((a, i) => ({ n: a.n + (i.badge ? badges[i.badge]?.n ?? 0 : 0), late: a.late + (i.badge ? badges[i.badge]?.late ?? 0 : 0) }), { n: 0, late: 0 });
  const current = sections.find((s) => s.items.some((i) => isActive(pathname, i.href)))?.key;
  const shown = sheet === 'more' ? null : sections.find((s) => s.key === sheet);

  const tab = (s: Section) => {
    const Icon = s.icon;
    const active = current === s.key;
    const w = waiting(s);
    const inner = (
      <>
        <span className={`relative grid h-8 w-12 place-items-center rounded-full transition ${active ? 'bg-inv text-inv-ink shadow-[0_6px_14px_-6px_rgb(0_0_0/0.5)]' : sheet === s.key ? 'bg-elev-2 text-ink' : 'text-ink-2'}`}>
          <Icon className="size-[19px]" strokeWidth={1.8} />
          {w.n > 0 && <span className={`absolute -right-0.5 -top-1 h-4 min-w-4 rounded-full px-1 text-center text-[9px] font-semibold leading-4 ring-2 ring-[var(--bg-elev)] ${w.late ? 'bg-[var(--signal)] text-white' : 'bg-elev-3 text-ink-2'}`}>{w.n > 99 ? '99+' : w.n}</span>}
        </span>
        <span className={`text-[10px] leading-none ${active ? 'font-semibold text-ink' : 'text-ink-3'}`}>{s.items.length === 1 && s.key !== 'main' ? s.items[0].label : s.short}</span>
      </>
    );
    const cls = 'flex w-[62px] flex-col items-center gap-1 py-1';
    return s.items.length === 1 ? (
      <Link key={s.key} href={s.items[0].href} className={cls} aria-label={s.items[0].label}>
        {inner}
      </Link>
    ) : (
      <button key={s.key} onClick={() => open(sheet === s.key ? null : s.key)} className={cls} aria-label={s.label} aria-expanded={sheet === s.key}>
        {inner}
      </button>
    );
  };

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] lg:hidden" aria-label="Menu" style={{ animation: 'barUp .2s var(--ease-out-expo) both' }}>
        <div className="mx-auto flex h-[66px] max-w-[460px] items-center justify-between rounded-[26px] bg-[color-mix(in_oklab,var(--bg-elev)_88%,transparent)] px-1.5 shadow-[0_18px_40px_-14px_rgb(0_0_0/0.35),0_0_0_1px_rgb(0_0_0/0.04)] backdrop-blur-xl">
          {left.map(tab)}
          <button onClick={openPalette} className="relative -mt-9 grid size-[62px] place-items-center rounded-full bg-bg p-1.5" aria-label="Search">
            <span className="grid size-[50px] place-items-center rounded-full bg-inv text-inv-ink shadow-[0_10px_24px_-8px_rgb(0_0_0/0.55)]">
              <Search className="size-5" strokeWidth={2} />
            </span>
          </button>
          {right.map(tab)}
          <button onClick={() => open(sheet === 'more' ? null : 'more')} className="flex w-[62px] flex-col items-center gap-1 py-1" aria-label="More" aria-expanded={sheet === 'more'}>
            <span className={`grid h-8 w-12 place-items-center rounded-full ${sheet === 'more' ? 'bg-elev-2' : ''}`}>
              {more.length ? <LayoutGrid className="size-[19px] text-ink-2" strokeWidth={1.8} /> : <Avatar name={me.name} hue={me.hue} size={26} />}
            </span>
            <span className="text-[10px] leading-none text-ink-3">More</span>
          </button>
        </div>
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal>
          <button className="absolute inset-0 bg-black/35 backdrop-blur-[3px]" style={{ animation: 'fadeIn .12s ease both' }} onClick={() => open(null)} aria-label="Close" />
          <div className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto rounded-t-[30px] bg-elev px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2.5 shadow-[var(--shadow-lg)]" style={{ animation: 'sheetUp .22s var(--ease-out-expo) both' }}>
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-3" />
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[17px] font-semibold tracking-tight">{shown ? shown.label : 'More'}</span>
              <button className="grid size-9 place-items-center rounded-full bg-elev-2 text-ink-2" onClick={() => open(null)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            {shown ? (
              <Tiles s={shown} badges={badges} pathname={pathname} close={() => open(null)} />
            ) : (
              <div className="space-y-5">
                {more.map((s) => (
                  <div key={s.key}>
                    <div className="mb-2 px-1 text-[12px] font-medium text-ink-3">{s.label}</div>
                    <Tiles s={s} badges={badges} pathname={pathname} close={() => open(null)} />
                  </div>
                ))}
                <Account me={me} initialTheme={initialTheme} close={() => open(null)} onSearch={openPalette} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Tiles({ s, badges, pathname, close }: { s: Section; badges: Badges; pathname: string; close: () => void }) {
  const router = useRouter();
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {s.items.map((i) => {
        const Icon = i.icon;
        const active = isActive(pathname, i.href);
        const b = i.badge ? badges[i.badge] : null;
        return (
          <Link
            key={i.href}
            href={i.href}
            // the page starts loading as the finger lands, so it is ready when it lifts
            onPointerDown={() => router.prefetch(i.href, FULL)}
            onClick={close}
            className={`relative flex h-[92px] flex-col justify-between rounded-[20px] p-3.5 transition active:scale-[0.98] ${active ? 'bg-inv text-inv-ink' : 'bg-elev-2 text-ink'}`}
          >
            <span className={`grid size-9 place-items-center rounded-full ${active ? 'bg-white/15' : 'bg-elev shadow-[var(--card-shadow)]'}`}>
              <Icon className="size-[18px]" strokeWidth={1.8} />
            </span>
            <span className="text-[13px] font-semibold leading-tight">{i.label}</span>
            {b && b.n > 0 && (
              <span className={`absolute right-3 top-3 rounded-full px-2 text-[11px] font-semibold leading-[20px] ${b.late ? 'bg-[var(--signal)] text-white' : active ? 'bg-white/20' : 'bg-elev text-ink-2'}`}>
                {b.n}
                {b.late ? ` · ${b.late} late` : ''}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function Account({ me, initialTheme, close, onSearch }: { me: Me; initialTheme: 'dark' | 'light'; close: () => void; onSearch: () => void }) {
  const { connected } = useLive();
  const [theme, setThemeState] = useState(initialTheme);
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    void setTheme(next);
  };
  const row = 'flex h-12 w-full items-center gap-3 px-3.5 text-left text-[13px] font-medium';
  return (
    <div>
      <div className="mb-2 px-1 text-[12px] font-medium text-ink-3">You</div>
      <div className="flex items-center gap-3 rounded-[20px] bg-elev-2 p-3.5">
        <Avatar name={me.name} hue={me.hue} size={44} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{me.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
            <span className={`size-1.5 rounded-full ${connected ? 'bg-[var(--live)]' : 'bg-ink-4'}`} />
            {me.roleLabel}
            {me.channels.length > 0 ? ` · ${me.channels.length} store${me.channels.length > 1 ? 's' : ''}` : ''}
          </div>
        </div>
      </div>
      <div className="mt-2.5 divide-y divide-[var(--line)] overflow-hidden rounded-[20px] bg-elev-2">
        <button
          className={row}
          onClick={() => {
            close();
            onSearch();
          }}
        >
          <Search className="size-[18px] text-ink-2" strokeWidth={1.8} /> Search
        </button>
        <button className={row} onClick={flip}>
          {theme === 'dark' ? <Sun className="size-[18px] text-ink-2" strokeWidth={1.8} /> : <Moon className="size-[18px] text-ink-2" strokeWidth={1.8} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <form action={signOut}>
          <button className={row}>
            <LogOut className="size-[18px] text-ink-2" strokeWidth={1.8} /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
