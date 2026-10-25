'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarRange, Loader2, X } from 'lucide-react';

type Opt = { value: string; label: string };

/**
 * A report's filters: the period (a preset or two dates), what to compare with, and the store, brand,
 * category or branch lists the report takes. Every choice is in the address, so a filtered report can
 * be bookmarked or sent, and its export reads the same filters.
 */
export function ReportFilters({
  presets,
  snapshot,
  lists,
}: {
  presets: { key: string; label: string }[];
  snapshot: boolean;
  lists: { key: 'channel' | 'brand' | 'category' | 'branch'; label: string; options: Opt[] }[];
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const period = sp.get('period') ?? '30';
  const [custom, setCustom] = useState(period === 'custom');
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('to') ?? '');

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    start(() => router.push(`${path}${next.size ? `?${next}` : ''}`, { scroll: false }));
  };
  const active = lists.filter((l) => sp.get(l.key));

  return (
    <div className="panel space-y-2.5 p-3">
      {!snapshot && (
        <div className="flex flex-wrap items-center gap-1">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => (setCustom(false), go({ period: p.key === '30' ? null : p.key, from: null, to: null }))}
              className={`flex h-8 shrink-0 items-center rounded-lg px-3 text-[12.5px] transition ${period === p.key && !custom ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}
            >
              {p.label}
            </button>
          ))}
          <button onClick={() => setCustom(true)} className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] transition ${custom ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
            <CalendarRange className="size-3.5" /> Dates
          </button>
          {custom && (
            <form
              className="flex flex-wrap items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (from && to) go({ period: 'custom', from, to });
              }}
            >
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="field !h-8 !w-[150px] text-[12px]" aria-label="From" />
              <span className="text-[12px] text-ink-3">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="field !h-8 !w-[150px] text-[12px]" aria-label="To" />
              <button disabled={!from || !to || from > to} className="btn btn-quiet btn-sm">
                Show
              </button>
            </form>
          )}
          <div className="ml-auto flex items-center gap-2">
            {pending && <Loader2 className="size-3.5 animate-spin text-ink-3" />}
            <select value={sp.get('compare') ?? 'prev'} onChange={(e) => go({ compare: e.target.value === 'prev' ? null : e.target.value })} className="field !h-8 !w-auto text-[12px]" aria-label="Compare with">
              <option value="prev">vs the period before</option>
              <option value="ly">vs the same dates last year</option>
            </select>
          </div>
        </div>
      )}
      {lists.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {lists.map((l) => (
            <select key={l.key} value={sp.get(l.key) ?? ''} onChange={(e) => go({ [l.key]: e.target.value || null })} className="field !h-8 !w-auto max-w-[220px] text-[12px]" aria-label={l.label}>
              <option value="">{`All ${l.label.toLowerCase()}`}</option>
              {l.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
          {active.length > 0 && (
            <button onClick={() => go(Object.fromEntries(active.map((l) => [l.key, null])))} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-ink-3 hover:bg-elev-2 hover:text-ink">
              <X className="size-3.5" /> Clear
            </button>
          )}
          {snapshot && pending && <Loader2 className="size-3.5 animate-spin text-ink-3" />}
        </div>
      )}
    </div>
  );
}
