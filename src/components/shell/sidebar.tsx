'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { useLocal } from '@/lib/hooks';
import { RelayMark } from '@/components/brand';
import type { Badges } from '@/lib/queries';
import { allowed, isActive, NAV, type Me } from './nav';
import { useLive } from './live';

export function Sidebar({ me, badges, demo }: { me: Me; badges: Badges; demo: boolean }) {
  const pathname = usePathname();
  const [slim, setSlim] = useLocal('relay:slim', false);
  const { openCopilot } = useLive();
  const toggle = () => setSlim(!slim);

  return (
    <aside className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-bg/60 backdrop-blur-xl transition-[width] duration-300 lg:flex ${slim ? 'w-[68px]' : 'w-[244px]'}`}>
      <div className={`flex h-14 items-center ${slim ? 'justify-center' : 'justify-between px-4'}`}>
        <Link href="/" className="flex items-center gap-2" aria-label="Relay home">
          <RelayMark size={22} />
          {!slim && (
            <span className="font-display text-[21px] leading-none">
              Relay
            </span>
          )}
        </Link>
        {!slim && (
          <button onClick={toggle} className="btn btn-ghost btn-sm !h-7 !px-1.5" aria-label="Collapse sidebar">
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-2.5 pb-4 pt-2">
        {NAV.map((g) => {
          const items = g.items.filter((i) => allowed(me, i));
          if (!items.length) return null;
          return (
            <div key={g.group ?? 'main'}>
              {g.group && !slim && <div className="eyebrow mb-1.5 px-2.5 text-[10px]">{g.group}</div>}
              {g.group && slim && <div className="mx-auto mb-2 h-px w-6 bg-line" />}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = isActive(pathname, item.href);
                  const b = item.badge ? badges[item.badge] : null;
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={slim ? item.label : undefined}
                        data-tint={item.tint}
                        className={`group relative flex h-9 items-center gap-3 rounded-[10px] text-[13.5px] transition ${slim ? 'justify-center' : 'px-2.5'} ${
                          active ? 'bg-elev-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]' : 'text-ink-2 hover:bg-elev hover:text-ink'
                        }`}
                      >
                        {active && <span className="absolute -left-2.5 top-2 h-5 w-[3px] rounded-r bg-[var(--tint,var(--ink))]" />}
                        <Icon className={`size-[17px] shrink-0 ${active ? 'text-[var(--tint,var(--ink))]' : ''}`} strokeWidth={1.7} />
                        {!slim && <span className="truncate">{item.label}</span>}
                        {b && b.n > 0 && !slim && (
                          <span className={`ml-auto flex items-center gap-1 font-mono text-[11px] ${b.late ? 'text-critical' : 'text-ink-3'}`}>
                            {b.late > 0 && <span className="size-1.5 rounded-full bg-signal" />}
                            {b.n}
                          </span>
                        )}
                        {b && b.late > 0 && slim && <span className="absolute right-2.5 top-2 size-1.5 rounded-full bg-signal" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-line p-2.5">
        <button onClick={() => openCopilot()} className={`flex h-9 w-full items-center gap-3 rounded-[10px] text-[13.5px] text-ink-2 transition hover:bg-elev hover:text-ink ${slim ? 'justify-center' : 'px-2.5'}`} title="Ask Relay">
          <Sparkles className="size-[17px]" strokeWidth={1.7} />
          {!slim && (
            <>
              <span>Ask Relay</span>
              <span className="ml-auto flex gap-0.5">
                <span className="kbd">⌘</span>
                <span className="kbd">J</span>
              </span>
            </>
          )}
        </button>
        {slim ? (
          <button onClick={toggle} className="btn btn-ghost btn-sm mx-auto flex !h-8" aria-label="Expand sidebar">
            <PanelLeftOpen className="size-4" />
          </button>
        ) : (
          demo && <div className="rounded-lg border border-dashed border-line-2 px-2.5 py-2 text-[11.5px] leading-snug text-ink-3">Demo floor · fictional customers, real products</div>
        )}
      </div>
    </aside>
  );
}
