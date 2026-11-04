'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { Mark, Shot } from '@/lib/kb/types';

// where a note sits from its point, as a share of the picture: far enough to leave the point clear
const OFF = { left: [-24, -6], right: [8, -6], top: [-10, -17], bottom: [-10, 9] } as const;

const sideOf = (m: Mark): keyof typeof OFF => m.side ?? (m.x > 60 ? 'left' : 'right');

/** A screen with numbered red points, each with a short note and an arrow from the note to the point. */
export function AnnotatedShot({ shot, n }: { shot: Shot; n: number }) {
  const [big, setBig] = useState(false);
  return (
    <figure className="space-y-2.5">
      <div className="kb-shot">
        <div className="kb-chrome">
          <i />
          <i />
          <i />
          <span className="ml-3 truncate text-[11px] text-ink-4">console.dagher-hinnawi.com</span>
          <button onClick={() => setBig(true)} className="ml-auto text-ink-3 hover:text-ink" aria-label="Open large">
            <Maximize2 className="size-3.5" />
          </button>
        </div>
        <Canvas shot={shot} />
      </div>
      <figcaption className="text-[12.5px] text-ink-3">
        <span className="font-medium text-ink-2">Figure {n}.</span> {shot.caption}
      </figcaption>
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {shot.marks.map((m, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px] text-ink-2">
            <span className="mt-px grid size-5 flex-none place-items-center rounded-full bg-[#e5484d] text-[10.5px] font-bold text-white">{i + 1}</span>
            {m.label}
          </li>
        ))}
      </ol>
      {big && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onClick={() => setBig(false)} role="dialog" aria-modal>
          <button className="absolute right-5 top-5 text-white/80 hover:text-white" aria-label="Close">
            <X className="size-6" />
          </button>
          <div className="kb-shot w-full max-w-[1400px]" onClick={(e) => e.stopPropagation()}>
            <Canvas shot={shot} />
          </div>
        </div>
      )}
    </figure>
  );
}

function Canvas({ shot }: { shot: Shot }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shot.src} alt={shot.caption} />
      {size.w > 0 && (
        <svg className="kb-arrows pointer-events-none absolute inset-0 z-[2]" width={size.w} height={size.h} aria-hidden>
          <defs>
            <marker id="kb-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#e5484d" />
            </marker>
          </defs>
          {shot.marks.map((m, i) => {
            const [dx, dy] = OFF[sideOf(m)];
            const nx = clamp(m.x + dx, 1, 74);
            const ny = clamp(m.y + dy, 1, 92);
            // from the note's nearest edge to just short of the point
            const fx = ((sideOf(m) === 'left' ? nx + 22 : sideOf(m) === 'right' ? nx : nx + 10) / 100) * size.w;
            const fy = ((sideOf(m) === 'top' ? ny + 7 : sideOf(m) === 'bottom' ? ny : ny + 3) / 100) * size.h;
            const tx = (m.x / 100) * size.w;
            const ty = (m.y / 100) * size.h;
            const len = Math.hypot(tx - fx, ty - fy) || 1;
            const ex = tx - ((tx - fx) / len) * 16;
            const ey = ty - ((ty - fy) / len) * 16;
            const cx = (fx + ex) / 2 + (ey - fy) * 0.15;
            const cy = (fy + ey) / 2 - (ex - fx) * 0.15;
            return <path key={i} d={`M${fx},${fy} Q${cx},${cy} ${ex},${ey}`} fill="none" stroke="#e5484d" strokeWidth="2.25" strokeLinecap="round" markerEnd="url(#kb-head)" />;
          })}
        </svg>
      )}
      {shot.marks.map((m, i) => {
        const [dx, dy] = OFF[sideOf(m)];
        return (
          <div key={i}>
            <span className="kb-pin" style={{ left: `${m.x}%`, top: `${m.y}%` }}>
              {i + 1}
            </span>
            <span className="kb-note" style={{ left: `${clamp(m.x + dx, 1, 74)}%`, top: `${clamp(m.y + dy, 1, 92)}%`, width: '22%' }}>
              <b>{i + 1}</b>
              {m.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
