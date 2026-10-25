'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, CornerDownLeft, History, LogOut, Moon, Search, Sun, X } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { Avatar } from '@/components/ui/avatar';
import { setTheme, signOut } from '@/app/actions';
import type { Badges } from '@/lib/queries';
import { isActive, sectionsFor, type Me, type NavItem } from './nav';
import { useLive } from './live';
import { FULL } from './instant-links';

type Section = ReturnType<typeof sectionsFor>[number];
const RECENT_KEY = 'relay.recent';

const readRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * The menu: a floating white pill with one icon per section. Nothing opens on hover (Dan, 25 Oct): a
 * click opens the section as a glass panel beside the menu, with each page's live state (waiting, late,
 * all clear) or what it is for, what needs attention first, a search across every page, the pages
 * opened last, and keys (1–9 opens, ← → changes section, Esc closes). A one-page section goes
 * straight to its page. The theme, sign out and the person's own avatar sit at its foot.
 */
export function Rail({ me, badges, demo, initialTheme }: { me: Me; badges: Badges; demo: boolean; initialTheme: 'dark' | 'light' }) {
  const pathname = usePathname();
  const router = useRouter();
  const { connected } = useLive();
  const [theme, setThemeState] = useState(initialTheme);
  // both remember the page they were opened on, so moving to another page closes them
  const [accountOn, setAccountOn] = useState<string | null>(null);
  const [panelOn, setPanel] = useState<{ key: string; path: string } | null>(null);
  const panel = panelOn && panelOn.path === pathname ? panelOn : null;
  const account = accountOn === pathname;
  const setAccount = (on: boolean | ((o: boolean) => boolean)) => setAccountOn((cur) => ((typeof on === 'function' ? on(cur === pathname) : on) ? pathname : null));
  const accRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => sectionsFor(me), [me]);
  const all = useMemo(() => sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label }))), [sections]);

  // the pages opened last, kept in this browser only, for "Jump back": written when the page changes,
  // read by the panel when it opens
  useEffect(() => {
    const hit = all.find((i) => isActive(pathname, i.href));
    const list = readRecent();
    const next = hit ? [hit.href, ...list.filter((h) => h !== hit.href)].slice(0, 8) : list;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
  }, [pathname, all]);

  // a click outside the account card closes it
  useEffect(() => {
    if (!account) return;
    const down = (e: MouseEvent) => !accRef.current?.contains(e.target as Node) && setAccountOn(null);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [account]);

  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    void setTheme(next);
  };
  const waiting = (s: Section) => {
    let n = 0;
    let late = 0;
    for (const i of s.items) {
      const b = i.badge ? badges[i.badge] : null;
      if (b) {
        n += b.n;
        late += b.late;
      }
    }
    return { n, late };
  };
  const open = panel ? sections.find((s) => s.key === panel.key) : null;

  return (
    <aside className="sticky top-0 hidden h-dvh w-[52px] shrink-0 flex-col items-center gap-4 py-4 lg:flex" style={{ zIndex: open ? 75 : 40 }}>
      <Link href="/" className="grid size-[46px] shrink-0 place-items-center rounded-2xl transition active:scale-95" aria-label="DH & DCO home">
        <BrandMark height={15} />
      </Link>
      <nav className="rail flex w-[52px] flex-col items-center gap-1.5 py-2.5" style={{ animation: 'railGrow .18s var(--ease-out-expo) both' }} aria-label="Sections">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = s.items.some((i) => isActive(pathname, i.href));
          const w = waiting(s);
          const count = w.n > 0 && (
            <span className="rail-count" data-late={w.late > 0 ? 'true' : undefined}>
              {w.n > 99 ? '99+' : w.n}
            </span>
          );
          if (s.items.length === 1) {
            const only = s.items[0];
            return (
              <Link key={s.key} href={only.href} className="rail-item" data-active={active ? 'true' : undefined} aria-label={only.label} onPointerDown={() => router.prefetch(only.href, FULL)}>
                <Icon className="size-[18px]" strokeWidth={1.8} />
                {count}
              </Link>
            );
          }
          return (
            <button
              key={s.key}
              className="rail-item"
              data-active={active ? 'true' : undefined}
              data-open={panel?.key === s.key ? 'true' : undefined}
              aria-label={s.label}
              aria-expanded={panel?.key === s.key}
              aria-haspopup="dialog"
              onClick={() => setPanel(panel?.key === s.key ? null : { key: s.key, path: pathname })}
            >
              <Icon className="size-[18px]" strokeWidth={1.8} />
              {count}
            </button>
          );
        })}
        <span className="my-1 h-px w-5 bg-line-2" />
        <button onClick={flip} className="rail-item" aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? <Sun className="size-[17px]" strokeWidth={1.8} /> : <Moon className="size-[17px]" strokeWidth={1.8} />}
        </button>
        <form action={signOut}>
          <button className="rail-item" aria-label="Sign out">
            <LogOut className="size-[17px]" strokeWidth={1.8} />
          </button>
        </form>
        <div className="relative mt-1" ref={accRef}>
          {account && (
            <div className="absolute bottom-0 left-[calc(100%+14px)] z-[70] w-[240px] overflow-hidden rounded-[20px] bg-elev text-ink shadow-[var(--shadow-lg)]" style={{ animation: 'flyIn .12s var(--ease-out-expo)' }}>
              <div className="px-4 py-3.5">
                <div className="truncate text-[13px] font-semibold">{me.name}</div>
                <div className="truncate text-[11.5px] text-ink-3">{me.email}</div>
                <div className="mt-2 text-[11.5px] text-ink-2">
                  {me.roleLabel}
                  {me.channels.length > 0 ? ` · ${me.channels.length} store${me.channels.length > 1 ? 's' : ''}` : ''}
                </div>
                {demo && <div className="mt-2 text-[11px] text-ink-4">Demo floor · fictional customers, real products</div>}
              </div>
            </div>
          )}
          <button onClick={() => setAccount((o) => !o)} className="relative grid size-[38px] place-items-center rounded-full" aria-label="Account">
            <Avatar name={me.name} hue={me.hue} size={34} />
            <span className={`absolute bottom-0 right-0 size-2.5 rounded-full ring-2 ring-[var(--bg-elev)] ${connected ? 'bg-[var(--live)]' : 'bg-ink-4'}`} title={connected ? 'Live' : 'Reconnecting…'} />
          </button>
        </div>
      </nav>

      {open && createPortal(<SectionPanel key={open.key} section={open} sections={sections} all={all} badges={badges} pathname={pathname} waiting={waiting} onSwitch={(key) => setPanel({ key, path: pathname })} onClose={() => setPanel(null)} />, document.body)}
    </aside>
  );
}

type Item = NavItem & { section: string };

function SectionPanel({
  section,
  sections,
  all,
  badges,
  pathname,
  waiting,
  onSwitch,
  onClose,
}: {
  section: Section;
  sections: Section[];
  all: Item[];
  badges: Badges;
  pathname: string;
  waiting: (s: Section) => { n: number; late: number };
  onSwitch: (key: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [recent] = useState(readRecent);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const t = q.trim().toLowerCase();
  const found = t ? all.filter((i) => `${i.label} ${i.hint ?? ''} ${i.section}`.toLowerCase().includes(t)) : null;
  const list: Item[] = found ?? section.items.map((i) => ({ ...i, section: section.label }));
  const urgent = section.items.filter((i) => i.badge && badges[i.badge]?.late);
  const jump = recent.filter((h) => !isActive(pathname, h)).map((h) => all.find((i) => i.href === h)).filter((i): i is Item => Boolean(i)).slice(0, 4);
  const w = waiting(section);
  const multi = sections.filter((s) => s.items.length > 1);
  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  // keys while the panel is open: 1–9 open a page, ← → change section, Enter opens the first match, Esc closes
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      const typing = Boolean(input.current && document.activeElement === input.current && input.current.value);
      if (!typing && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const hit = list[Number(e.key) - 1];
        if (hit) {
          e.preventDefault();
          go(hit.href);
        }
        return;
      }
      if (!typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const i = multi.findIndex((s) => s.key === section.key);
        const next = multi[(i + (e.key === 'ArrowRight' ? 1 : multi.length - 1)) % multi.length];
        if (next) {
          e.preventDefault();
          onSwitch(next.key);
        }
      }
    };
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (box.current?.contains(el) || el.closest('.rail')) return;
      onClose();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', down);
    };
  });

  const Icon = section.icon;
  const lineOf = (i: Item) => {
    const b = i.badge ? badges[i.badge] : null;
    if (b) return b.n ? { text: `${b.n} waiting${b.late ? ` · ${b.late} late` : ''}`, tone: b.late ? 'late' : 'busy' } : { text: 'All clear', tone: 'clear' };
    return { text: i.hint ?? '', tone: 'hint' };
  };

  return (
    <>
      <div className="drawer-scrim" aria-hidden onMouseDown={onClose} />
      <div ref={box} role="dialog" aria-label={section.label} className="drawer">
        <div className="drawer-sheen" aria-hidden />
        {/* the section, its live state, and the other sections one click away */}
        <div className="relative flex items-start gap-3 px-5 pt-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-inv text-inv-ink shadow-[0_10px_24px_-12px_rgb(0_0_0/0.6)]">
            <Icon className="size-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[17px] font-semibold tracking-tight">{section.label}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">
              {w.n ? (
                <>
                  <b className="font-semibold text-ink">{w.n}</b> waiting
                  {w.late > 0 && (
                    <>
                      {' · '}
                      <b className="font-semibold text-[var(--signal)]">{w.late}</b> late
                    </>
                  )}
                </>
              ) : (
                `${section.items.length} pages`
              )}
            </div>
          </div>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-full text-ink-3 transition hover:bg-elev-2 hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {multi.length > 1 && (
          <div className="relative mx-5 mt-4 flex gap-1 rounded-2xl bg-elev-2/70 p-1">
            {multi.map((s) => {
              const SIcon = s.icon;
              const on = s.key === section.key;
              const sw = waiting(s);
              return (
                <button key={s.key} onClick={() => onSwitch(s.key)} className={`relative flex h-9 flex-1 items-center justify-center rounded-xl transition ${on ? 'bg-elev text-ink shadow-[var(--card-shadow)]' : 'text-ink-3 hover:text-ink'}`} aria-label={s.label} aria-pressed={on}>
                  <SIcon className="size-[17px]" strokeWidth={1.8} />
                  {sw.late > 0 && <span className="absolute top-1.5 right-[calc(50%-14px)] size-1.5 rounded-full bg-[var(--signal)]" />}
                </button>
              );
            })}
          </div>
        )}

        <label className="relative mx-5 mt-3 block">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-4" />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && list[0]) go(list[0].href);
            }}
            placeholder="Find any page…"
            className="h-10 w-full rounded-2xl bg-elev-2/70 pr-3 pl-10 text-[13px] outline-none ring-1 ring-transparent transition placeholder:text-ink-4 focus:bg-elev focus:ring-line-3"
          />
        </label>

        <div className="scroll-thin relative mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {!found && urgent.length > 0 && (
            <div className="drawer-row mx-2 mb-3 rounded-2xl bg-[color-mix(in_oklab,var(--signal)_9%,transparent)] p-3" style={{ '--i': 0 } as React.CSSProperties}>
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--signal)] uppercase">
                <span className="drawer-pulse" /> Needs you now
              </div>
              {urgent.map((i) => (
                <button key={i.href} onClick={() => go(i.href)} className="flex w-full items-center justify-between gap-3 rounded-xl px-1.5 py-1.5 text-left text-[12.5px] transition hover:bg-[color-mix(in_oklab,var(--signal)_10%,transparent)]">
                  <span className="font-medium">{i.label}</span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
                    {badges[i.badge!]!.late} late <ArrowRight className="size-3.5" />
                  </span>
                </button>
              ))}
            </div>
          )}

          {found && <div className="px-2 pb-1.5 text-[11px] text-ink-4">{found.length ? `${found.length} page${found.length > 1 ? 's' : ''}` : 'No page by that name'}</div>}
          <ul>
            {list.map((i, n) => {
              const PIcon = i.icon;
              const on = isActive(pathname, i.href);
              const line = lineOf(i);
              return (
                <li key={i.href} className="drawer-row" style={{ '--i': n + 1 } as React.CSSProperties}>
                  <Link
                    href={i.href}
                    onClick={onClose}
                    onPointerDown={() => router.prefetch(i.href, FULL)}
                    className={`group flex items-center gap-3 rounded-[18px] px-2.5 py-2.5 transition ${on ? 'bg-inv text-inv-ink' : 'hover:bg-elev-2/80'}`}
                  >
                    <span className={`grid size-10 shrink-0 place-items-center rounded-[14px] transition ${on ? 'bg-white/15' : 'bg-elev-2 group-hover:bg-elev'}`}>
                      <PIcon className="size-[18px]" strokeWidth={1.7} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-semibold">{i.label}</span>
                        {found && <span className={`shrink-0 text-[10.5px] ${on ? 'opacity-60' : 'text-ink-4'}`}>{i.section}</span>}
                      </span>
                      <span className={`mt-0.5 flex items-center gap-1 truncate text-[11.5px] ${on ? 'opacity-70' : line.tone === 'late' ? 'text-[var(--signal)]' : line.tone === 'clear' ? 'text-good' : 'text-ink-3'}`}>
                        {line.tone === 'clear' && <Check className="size-3" strokeWidth={2.4} />}
                        {line.text}
                      </span>
                    </span>
                    {n < 9 && <kbd className={`grid size-6 shrink-0 place-items-center rounded-lg text-[10.5px] font-semibold ${on ? 'bg-white/15' : 'bg-elev-2 text-ink-3 group-hover:bg-elev'}`}>{n + 1}</kbd>}
                  </Link>
                </li>
              );
            })}
          </ul>

          {!found && jump.length > 0 && (
            <div className="drawer-row mt-3 px-2" style={{ '--i': list.length + 1 } as React.CSSProperties}>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-4 uppercase">
                <History className="size-3.5" /> Jump back
              </div>
              <div className="flex flex-wrap gap-1.5">
                {jump.map((i) => {
                  const JIcon = i.icon;
                  return (
                    <Link key={i.href} href={i.href} onClick={onClose} onPointerDown={() => router.prefetch(i.href, FULL)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-elev-2/80 px-3 text-[12px] font-medium text-ink-2 transition hover:bg-elev-3 hover:text-ink">
                      <JIcon className="size-3.5" strokeWidth={1.8} /> {i.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="relative flex items-center gap-3 border-t border-line px-5 py-3 text-[10.5px] text-ink-4">
          <span className="flex items-center gap-1">
            <kbd className="drawer-kbd">1–9</kbd> open
          </span>
          {multi.length > 1 && (
            <span className="flex items-center gap-1">
              <kbd className="drawer-kbd">←</kbd>
              <kbd className="drawer-kbd">→</kbd> sections
            </span>
          )}
          <span className="flex items-center gap-1">
            <kbd className="drawer-kbd">
              <CornerDownLeft className="size-2.5" />
            </kbd>{' '}
            first match
          </span>
          <span className="ml-auto flex items-center gap-1">
            <kbd className="drawer-kbd">Esc</kbd>
          </span>
        </div>
      </div>
    </>
  );
}
