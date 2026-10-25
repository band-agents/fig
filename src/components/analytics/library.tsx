'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';

export type LibraryItem = { href: string; title: string; blurb: string; group: string; for: string[]; page?: boolean };

const AUDIENCE = [
  { key: '', label: 'Everyone' },
  { key: 'finance', label: 'Finance' },
  { key: 'brand', label: 'Brand managers' },
  { key: 'ops', label: 'Operations' },
  { key: 'management', label: 'Management' },
];
const FOR_LABEL: Record<string, string> = { finance: 'Finance', brand: 'Brands', ops: 'Operations', management: 'Management' };

/** Every report this person may open, grouped, with a search and a "who is it for" switch. */
export function ReportLibrary({ groups, items }: { groups: { key: string; label: string; sub: string }[]; items: LibraryItem[] }) {
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => (!who || i.for.includes(who)) && (!t || `${i.title} ${i.blurb}`.toLowerCase().includes(t)));
  }, [items, q, who]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report: margin, size, courier, refunds…" className="field !pl-9" />
        </label>
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {AUDIENCE.map((a) => (
            <button key={a.key} onClick={() => setWho(a.key)} className={`flex h-8 shrink-0 items-center rounded-lg px-3 text-[12.5px] transition ${who === a.key ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {groups.map((g) => {
        const list = shown.filter((i) => i.group === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key}>
            <div className="mb-2.5 flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold">{g.label}</h2>
              <span className="text-[12px] text-ink-3">{g.sub}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((i) => (
                <Link key={i.href} href={i.href} className="panel group flex flex-col gap-1.5 p-4 transition hover:-translate-y-px hover:shadow-[var(--card-shadow)]">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13.5px] font-semibold leading-snug">{i.title}</span>
                    <ArrowUpRight className="size-4 shrink-0 text-ink-4 transition group-hover:text-ink" />
                  </div>
                  <p className="text-[12px] leading-relaxed text-ink-3">{i.blurb}</p>
                  <div className="mt-auto flex flex-wrap gap-1 pt-1">
                    {i.for.map((f) => (
                      <span key={f} className="rounded-full bg-elev-2 px-2 py-0.5 text-[10.5px] text-ink-3">
                        {FOR_LABEL[f] ?? f}
                      </span>
                    ))}
                    {i.page && <span className="rounded-full bg-elev-2 px-2 py-0.5 text-[10.5px] text-ink-3">Page</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      {!shown.length && <p className="panel px-6 py-12 text-center text-[13px] text-ink-3">No report matches “{q}”.</p>}
    </div>
  );
}
