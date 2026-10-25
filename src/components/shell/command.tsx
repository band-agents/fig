'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';
import { allowed, NAV, type Me } from './nav';
import { useLive } from './live';

type Hit = { id: string; kind: 'order' | 'return'; number: string; channel: string; stage: string; tint?: string; customer: string };

export function CommandPalette({ me }: { me: Me }) {
  const { paletteOpen } = useLive();
  return paletteOpen ? <Palette me={me} /> : null;
}

function Palette({ me }: { me: Me }) {
  const { closePalette } = useLive();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ q: string; hits: Hit[] }>({ q: '', hits: [] });
  const [i, setI] = useState(0);
  const hits = q.trim().length >= 2 && found.q === q ? found.hits : [];

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => setFound({ q, hits: d.orders ?? [] }))
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const pages = useMemo(() => {
    const all = NAV.flatMap((g) => g.items).filter((x) => allowed(me, x));
    const s = q.trim().toLowerCase();
    return s ? all.filter((p) => p.label.toLowerCase().includes(s)) : all;
  }, [q, me]);

  const rows: { key: string; go: () => void; node: React.ReactNode }[] = [
    ...hits.map((h) => ({
      key: `${h.kind}-${h.id}`,
      go: () => router.push(h.kind === 'return' ? `/returns/${h.id}` : `/orders/${h.id}`),
      node: (
        <>
          <span className="font-mono text-[12.5px]">{h.number}</span>
          <span className="truncate text-ink-3">{h.customer}</span>
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-3">
            {h.channel}
            <span className="pill" data-tint={h.tint ?? 'neutral'}>
              <span className="dot" />
              {h.stage}
            </span>
          </span>
        </>
      ),
    })),
    ...pages.map((p) => ({
      key: p.href,
      go: () => router.push(p.href),
      node: (
        <>
          <p.icon className="size-4 text-ink-3" strokeWidth={1.7} />
          <span>{p.label}</span>
        </>
      ),
    })),
  ];

  const choose = (k: number) => {
    rows[k]?.go();
    closePalette();
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[10vh]" role="dialog" aria-modal aria-label="Search">
      <button className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={closePalette} aria-label="Close" />
      <div className="rise relative w-full max-w-[620px] overflow-hidden rounded-2xl border border-line-2 bg-elev shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setI((x) => Math.min(rows.length - 1, x + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setI((x) => Math.max(0, x - 1));
              } else if (e.key === 'Enter') choose(i);
              else if (e.key === 'Escape') closePalette();
            }}
            placeholder="Order number, customer, phone, waybill, RMA, or a question…"
            className="h-14 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-4"
          />
          <span className="kbd">esc</span>
        </div>
        <ul className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
          {rows.length === 0 && <li className="px-3 py-8 text-center text-sm text-ink-3">Nothing matches.</li>}
          {rows.map((r, k) => (
            <li key={r.key}>
              <button onMouseEnter={() => setI(k)} onClick={() => choose(k)} className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[12.5px] ${k === i ? 'bg-elev-2' : ''}`}>
                {r.node}
                {k === i && <CornerDownLeft className="ml-2 size-3.5 shrink-0 text-ink-3" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
