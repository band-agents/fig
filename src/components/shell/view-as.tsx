'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, ChevronUp, Eye, Loader2, X } from 'lucide-react';
import { setViewAsAction } from '@/app/actions';
import { ROLES, type Role } from '@/lib/domain/perms';

type Router = ReturnType<typeof useRouter>;

/** The order of a walkthrough: the whole floor, then an order's journey, then stock and the websites. */
const GROUPS: { label: string; roles: Role[] }[] = [
  { label: 'Whole floor', roles: ['admin', 'ops'] },
  { label: 'Orders & queues', roles: ['care', 'finance', 'fulfilment', 'shipping', 'returns'] },
  { label: 'Stock & buying', roles: ['supply', 'planner', 'buyer', 'warehouse'] },
  { label: 'Websites', roles: ['merchandiser', 'marketing'] },
  { label: 'Read-only', roles: ['viewer', 'brand'] },
];
const ORDER = GROUPS.flatMap((g) => g.roles);
const label = (r: Role) => (r === 'admin' ? 'Admin (everything)' : ROLES[r].label);

async function switchTo(role: Role, router: Router, brand?: string | null) {
  const r = await setViewAsAction(role === 'admin' ? null : role, brand);
  router.push(r.href);
  router.refresh();
}

/**
 * Admins only: a floating bar to see the console as each job sees it, one click (or Alt + ← / →)
 * from the next, without signing out. Their own account stays signed in; while viewing as a job
 * nothing can be changed.
 */
export function ViewAs({ current, brand, brands }: { current: Role | null; brand: string | null; brands: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const role: Role = current ?? 'admin';
  const idx = ORDER.indexOf(role);
  const step = (d: number) => ORDER[(idx + d + ORDER.length) % ORDER.length];
  // a brand manager is shown for one brand: the one picked, else the biggest
  const go = (r: Role, b?: string) => {
    setOpen(false);
    start(() => switchTo(r, router, r === 'brand' ? (b ?? brand ?? brands[0] ?? null) : null));
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();
      const next = ORDER[(idx + (e.key === 'ArrowRight' ? 1 : -1) + ORDER.length) % ORDER.length];
      start(() => switchTo(next, router, next === 'brand' ? (brand ?? brands[0] ?? null) : null));
    };
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', key);
    document.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', close);
    };
  }, [idx, router, start, brand, brands]);

  const round = 'grid size-7 shrink-0 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40';
  return (
    <div ref={ref} className="fixed bottom-[100px] left-1/2 z-[45] -translate-x-1/2 lg:bottom-6 lg:ml-[36px]">
      {open && (
        <div className="absolute bottom-12 left-1/2 w-[260px] -translate-x-1/2 overflow-hidden rounded-2xl bg-elev py-1.5 text-ink shadow-[var(--shadow-lg)] rise">
          {GROUPS.map((g) => (
            <div key={g.label} className="px-1.5 py-1">
              <div className="px-2 pb-0.5 text-[11px] font-medium text-ink-3">{g.label}</div>
              {g.roles.map((r) => (
                <button key={r} onClick={() => go(r)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-elev-2 ${r === role ? 'font-semibold' : ''}`}>
                  <span className="flex-1">{label(r)}</span>
                  {r === role && <Check className="size-3.5 text-ink-2" />}
                </button>
              ))}
            </div>
          ))}
          {role === 'brand' && brands.length > 0 && (
            <div className="border-t border-line px-3.5 pb-1.5 pt-2.5">
              <label className="block text-[11px] font-medium text-ink-3">
                Brand
                <select className="field mt-1 !h-8 text-[12px]" value={brand ?? ''} onChange={(e) => go('brand', e.target.value)}>
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      <div className="flex h-10 items-center gap-0.5 rounded-full bg-[#1a1a1a] pl-3 pr-1 text-white shadow-[0_10px_30px_-8px_rgb(0_0_0/0.45),0_0_0_1px_rgb(255_255_255/0.06)]">
        <span className="mr-1 hidden items-center gap-1.5 text-[11.5px] text-white/55 sm:flex">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
          View as
        </span>
        <button onClick={() => go(step(-1))} disabled={pending} className={round} aria-label={`Previous: ${label(step(-1))}`} title={`${label(step(-1))} (Alt + ←)`}>
          <ChevronLeft className="size-4" />
        </button>
        <button onClick={() => setOpen((o) => !o)} className="flex h-8 min-w-[130px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition hover:bg-white/10 sm:min-w-[150px]" aria-haspopup="menu" aria-expanded={open}>
          {label(role)}
          {role === 'brand' && brand ? <span className="font-normal text-white/60">· {brand}</span> : null}
          <ChevronUp className={`size-3.5 text-white/60 transition ${open ? '' : 'rotate-180'}`} />
        </button>
        <button onClick={() => go(step(1))} disabled={pending} className={round} aria-label={`Next: ${label(step(1))}`} title={`${label(step(1))} (Alt + →)`}>
          <ChevronRight className="size-4" />
        </button>
        {current && current !== 'admin' && (
          <>
            <span className="mx-1 hidden h-4 w-px bg-white/15 sm:block" />
            <span className="hidden pr-1 text-[11px] text-[#ffd6a4] sm:inline">read-only</span>
            <button onClick={() => go('admin')} disabled={pending} className={round} aria-label="Back to admin" title="Back to admin">
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
