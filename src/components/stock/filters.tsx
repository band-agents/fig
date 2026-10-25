'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Loader2, Search, X } from 'lucide-react';

export type Select = { key: string; label: string; value?: string; options: { value: string; label: string }[] };

/** One row of filters above everything it scopes; the address bar holds the state, so links work. */
export function ParamFilters({ q, placeholder, selects }: { q?: string; placeholder: string; selects: Select[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(q ?? '');
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
      if ((q ?? '') !== text) set({ q: text || undefined });
    }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const active = selects.filter((s) => s.value).length + (q ? 1 : 0);
  const sel = 'field !h-9 !w-auto min-w-0 !rounded-lg !pr-8 text-[12.5px]';
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <label className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className="field !h-9 !pl-9" data-editing={text ? 'true' : undefined} />
        {pending && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" />}
      </label>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {selects.map((s) => (
          <select key={s.key} className={sel} value={s.value ?? ''} onChange={(e) => set({ [s.key]: e.target.value || undefined })} aria-label={s.label}>
            <option value="">{s.label}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {active > 0 && (
          <button
            onClick={() => {
              setText('');
              set({ q: undefined, ...Object.fromEntries(selects.map((s) => [s.key, undefined])) });
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
