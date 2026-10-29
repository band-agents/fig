'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Radio } from 'lucide-react';

type Tone = 'ok' | 'error' | 'live';
type Item = { id: number; text: string; tone: Tone };
const listeners = new Set<(i: Item) => void>();
let seq = 0;

export function toast(text: string, opts: { tone?: Tone } = {}) {
  const item = { id: ++seq, text, tone: opts.tone ?? 'ok' };
  listeners.forEach((l) => l(item));
}

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const add = (i: Item) => {
      setItems((s) => [...s.slice(-3), i]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== i.id)), i.tone === 'error' ? 6000 : 3600);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex w-[min(calc(100vw-32px),440px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className="rise pointer-events-auto flex items-center gap-2.5 rounded-[6px] bg-[var(--ink)] px-3.5 py-2.5 text-[13px] text-[var(--bg)] shadow-[0_8px_24px_rgb(0_0_0/0.2)] backdrop-blur">
          {i.tone === 'error' ? <CircleAlert className="size-4 text-[#e34948]" /> : i.tone === 'live' ? <Radio className="size-4 text-[#e34948]" /> : <CheckCircle2 className="size-4 text-[#1baf7a]" />}
          <span>{i.text}</span>
        </div>
      ))}
    </div>
  );
}
