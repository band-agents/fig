'use client';

import { useEffect, useRef, useState } from 'react';
import { moneyIn, num, TO_EGP } from '@/lib/format';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekLabel = (k: string) => short.format(new Date(`${k}T00:00:00Z`));

/**
 * Weekly bars, stacked by series (price tiers, categories, a single brand), labelled in pieces or in
 * money. Money values are EGP-equivalent minor units, shown in `currency`. Hover any week for the split.
 */
export function WeekBars({ weeks, series, kind, currency = 'EGP', height = 210 }: { weeks: string[]; series: { name: string; color: string; values: number[] }[]; kind: 'pieces' | 'money'; currency?: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<number | null>(null);
  const fmt = (v: number) => (kind === 'money' ? moneyIn(v, currency, { compact: true }) : num(Math.round(v)));
  // the axis carries short numbers (the currency is in the tooltip): "1.2K", not "KWD 1,234.500"
  const axis = (v: number) => (kind === 'money' ? compact.format(v / 100 / (TO_EGP[currency] ?? 1)) : compact.format(Math.round(v)));
  const H = height;
  const P = { l: 40, r: 6, t: 10, b: 22 };
  const totals = weeks.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(kind === 'money' ? 1 : 4, ...totals) * 1.1;
  const band = (W - P.l - P.r) / Math.max(1, weeks.length);
  const bw = Math.min(26, Math.max(3, band * 0.62));
  const y = (v: number) => (v / max) * (H - P.t - P.b);
  const every = Math.ceil(weeks.length / 8);
  return (
    <div ref={box} className="relative" onPointerLeave={() => setHover(null)}>
      <svg width={W} height={H} role="img" aria-label={`Weekly sales in ${kind}`}>
        {[0, 0.5, 1].map((f) => {
          const v = max * f * 0.9;
          const yy = H - P.b - y(v);
          return (
            <g key={f}>
              <line x1={P.l} x2={W - P.r} y1={yy} y2={yy} stroke="var(--line)" />
              <text x={P.l - 6} y={yy + 3} textAnchor="end" fontSize="10" fill="var(--ink-4)">
                {axis(v)}
              </text>
            </g>
          );
        })}
        {weeks.map((k, i) => {
          let acc = 0;
          const x = P.l + i * band + (band - bw) / 2;
          return (
            <g key={k} onPointerEnter={() => setHover(i)}>
              <rect x={P.l + i * band} y={P.t} width={band} height={H - P.t - P.b} fill={hover === i ? 'var(--line)' : 'transparent'} rx="4" />
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                if (!v) return null;
                const h = y(v);
                const top = H - P.b - acc - h;
                acc += h;
                const isTop = series.slice(si + 1).every((z) => !(z.values[i] ?? 0));
                return <rect key={s.name} className="grow" x={x} y={top} width={bw} height={Math.max(0, h - (isTop ? 0 : 2))} rx={isTop ? 3 : 1} fill={s.color} />;
              })}
              {(i % every === 0 || i === weeks.length - 1) && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-4)">
                  {weekLabel(k)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute z-10 min-w-[150px] -translate-x-1/2 rounded-xl bg-[#151515] px-3 py-2 text-[11.5px] text-white shadow-lg" style={{ left: `${((P.l + hover * band + band / 2) / W) * 100}%`, top: Math.max(0, H - P.b - y(totals[hover]) - 18 - series.length * 16) }}>
          <div className="text-white/60">Week of {weekLabel(weeks[hover])}</div>
          {series.length > 1 &&
            series.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: s.color }} /> {s.name}
                <b className="ml-auto pl-3 font-mono">{fmt(s.values[hover] ?? 0)}</b>
              </div>
            ))}
          <div className={`flex ${series.length > 1 ? 'mt-0.5 border-t border-white/15 pt-0.5' : ''}`}>
            Total <b className="ml-auto pl-3 font-mono">{fmt(totals[hover])}</b>
          </div>
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-ink-3">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
