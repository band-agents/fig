'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import type { OrderFilters } from '@/lib/order-query';

export function FilterBar({ filters, channels, stages }: { filters: OrderFilters; channels: { id: string; label: string }[]; stages: { id: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q ?? '');
  const [pending, start] = useTransition();

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? '') !== q) set({ q: q || undefined });
    }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = [filters.channel, filters.stage, filters.pay, filters.risk, filters.q].filter(Boolean).length;
  const sel = 'field !h-9 !w-auto min-w-0 !rounded-[10px] !pr-8 text-[13px]';
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <label className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders, customers, phones, SKUs, waybills…" className="field !h-9 !pl-9" data-editing={q ? 'true' : undefined} />
        {pending && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" />}
      </label>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        <select className={sel} value={filters.channel ?? ''} onChange={(e) => set({ channel: e.target.value || undefined })} aria-label="Storefront">
          <option value="">All storefronts</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select className={sel} value={filters.stage ?? ''} onChange={(e) => set({ stage: e.target.value || undefined })} aria-label="Stage">
          <option value="">Any stage</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select className={sel} value={filters.pay ?? ''} onChange={(e) => set({ pay: e.target.value || undefined })} aria-label="Payment">
          <option value="">Any payment</option>
          <option value="cod">Cash on delivery</option>
          <option value="card">Card</option>
          <option value="knet">KNET</option>
          <option value="wallet">Wallet</option>
          <option value="instapay">InstaPay</option>
        </select>
        <select className={sel} value={filters.risk ?? ''} onChange={(e) => set({ risk: e.target.value || undefined })} aria-label="Risk">
          <option value="">Any risk</option>
          <option value="high">High risk</option>
          <option value="medium">Medium risk</option>
          <option value="low">Low risk</option>
        </select>
        <select className={sel} value={filters.sort ?? ''} onChange={(e) => set({ sort: e.target.value || undefined })} aria-label="Sort">
          <option value="">Newest first</option>
          <option value="due">Most urgent</option>
          <option value="old">Oldest first</option>
          <option value="value">Highest value</option>
          <option value="risk">Highest risk</option>
        </select>
        {active > 0 && (
          <button
            onClick={() => {
              setQ('');
              set({ channel: undefined, stage: undefined, pay: undefined, risk: undefined, q: undefined });
            }}
            className="btn btn-ghost btn-sm !h-9 shrink-0"
          >
            <X className="size-3.5" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
