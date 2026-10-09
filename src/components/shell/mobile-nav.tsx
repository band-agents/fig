'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Activity, LayoutGrid, ListOrdered, X } from 'lucide-react';
import type { Badges } from '@/lib/queries';
import { allowed, isActive, NAV, type Me, type NavItem } from './nav';

/** Phone: three fixed tabs (home, orders, my queue) and a sheet with everything else. */
export function MobileNav({ me, badges }: { me: Me; badges: Badges }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const queues = NAV.find((g) => g.group === 'Queues')!.items.filter((i) => allowed(me, i));
  const mine = queues[0];
  const base: NavItem[] = [
    { href: '/', label: 'Home', icon: Activity, area: 'orders' },
    { href: '/orders', label: 'Orders', icon: ListOrdered, area: 'orders' },
  ];
  const tabs = [...base, ...(mine ? [mine] : [])].filter((i) => allowed(me, i));

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <ul className="mx-auto flex max-w-md">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = isActive(pathname, t.href);
            const b = t.badge ? badges[t.badge] : null;
            return (
              <li key={t.href} className="flex-1">
                <Link href={t.href} className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] ${active ? 'text-ink' : 'text-ink-3'}`} data-tint={t.tint}>
                  <Icon className={`size-[21px] ${active ? 'text-[var(--tint,var(--ink))]' : ''}`} strokeWidth={1.7} />
                  {t.label}
                  {b && b.n > 0 && <span className={`absolute right-[calc(50%-22px)] top-2 rounded-full px-1.5 font-mono text-[10px] ${b.late ? 'bg-signal text-white' : 'bg-elev-3 text-ink-2'}`}>{b.n}</span>}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button onClick={() => setOpen(true)} className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] text-ink-3">
              <LayoutGrid className="size-[21px]" strokeWidth={1.7} />
              More
            </button>
          </li>
        </ul>
      </nav>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal>
          <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close" />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl border-t border-line-2 bg-elev p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] rise">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-2xl">Everything</span>
              <button className="btn btn-quiet btn-sm !px-2" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            {NAV.map((g) => {
              const items = g.items.filter((i) => allowed(me, i));
              if (!items.length) return null;
              return (
                <div key={g.group ?? 'main'} className="mb-4">
                  {g.group && <div className="eyebrow mb-2">{g.group}</div>}
                  <div className="grid grid-cols-2 gap-2">
                    {items.map((i) => {
                      const Icon = i.icon;
                      const b = i.badge ? badges[i.badge] : null;
                      return (
                        <Link key={i.href} href={i.href} onClick={() => setOpen(false)} data-tint={i.tint} className="flex h-14 items-center gap-3 rounded-xl border border-line bg-elev-2 px-3 text-[14px]">
                          <Icon className="size-5 text-[var(--tint,var(--ink-2))]" strokeWidth={1.7} />
                          <span className="truncate">{i.label}</span>
                          {b && b.n > 0 && <span className="ml-auto font-mono text-xs text-ink-3">{b.n}</span>}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
