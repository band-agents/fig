'use client';

import { LogOut, Moon, Search, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RelayMark } from '@/components/brand';
import { Avatar } from '@/components/ui/avatar';
import { setTheme, signOut } from '@/app/actions';
import type { Me } from './nav';
import { useLive } from './live';

export function Topbar({ me, initialTheme }: { me: Me; initialTheme: 'dark' | 'light' }) {
  const { connected, online, openPalette } = useLive();
  const [menu, setMenu] = useState(false);
  const [theme, setThemeState] = useState<'dark' | 'light'>(initialTheme);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setThemeState(next);
    void setTheme(next);
  };
  const others = online.filter((o) => o.id !== me.id);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <span className="lg:hidden">
          <RelayMark size={22} />
        </span>
        <button
          onClick={openPalette}
          className="group flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-elev px-3 text-left text-ink-3 transition hover:border-line-2 sm:max-w-[420px]"
        >
          <Search className="size-4 shrink-0" />
          <span className="truncate text-[13px]">Find an order, phone, waybill…</span>
          <span className="ml-auto hidden gap-0.5 sm:flex">
            <span className="kbd">⌘</span>
            <span className="kbd">K</span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 text-xs text-ink-3 md:flex" title={connected ? 'Live: updates arrive as they happen' : 'Reconnecting…'}>
            {connected ? <span className="live-dot" /> : <span className="size-[7px] rounded-full bg-ink-4" />}
            <span>{connected ? 'Live' : 'Offline'}</span>
          </div>
          {others.length > 0 && (
            <div className="hidden -space-x-1.5 md:flex" title={`${others.map((o) => o.name).join(', ')} online`}>
              {others.slice(0, 4).map((o) => (
                <Avatar key={o.id} name={o.name} hue={o.hue} size={24} ring />
              ))}
              {others.length > 4 && <span className="grid size-6 place-items-center rounded-full bg-elev-3 text-[10px] text-ink-2 ring-2 ring-bg">+{others.length - 4}</span>}
            </div>
          )}
          <button onClick={flip} className="btn btn-ghost btn-sm !h-8 !px-2" aria-label="Switch theme">
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <div className="relative" ref={ref}>
            <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-full" aria-label="Account">
              <Avatar name={me.name} hue={me.hue} size={30} />
            </button>
            {menu && (
              <div className="absolute right-0 top-11 w-64 overflow-hidden rounded-xl border border-line-2 bg-elev-2 shadow-[var(--shadow-lg)] rise">
                <div className="border-b border-line p-3">
                  <div className="font-medium">{me.name}</div>
                  <div className="text-xs text-ink-3">{me.email}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="pill" data-tint="neutral">
                      <span className="dot" />
                      {me.roleLabel}
                    </span>
                    {me.channels.length > 0 && <span className="pill" data-tint="neutral">{me.channels.length} channels</span>}
                  </div>
                </div>
                <form action={signOut}>
                  <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-ink-2 hover:bg-elev-3 hover:text-ink">
                    <LogOut className="size-4" /> Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
