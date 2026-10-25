'use client';

import { useId, useRef, useState } from 'react';

// Small SVG charts in the dataviz house style: 2px lines, thin rounded bars with a 2px surface gap,
// recessive grid, text in ink tokens (never the series colour), and a hover layer on every plot.

export function Sparkline({ data, color = 'var(--ink-2)', height = 32, fill = true }: { data: number[]; color?: string; height?: number; fill?: boolean }) {
  const w = 120;
  const id = `sp${useId().replace(/:/g, '')}`;
  if (data.length < 2) return <svg width="100%" height={height} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - 3 - ((v - min) / (max - min || 1)) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L${w} ${height} L0 ${height} Z`} fill={`url(#${id})`} />}
      <path className="draw" d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="2.2" fill={color} />
    </svg>
  );
}

type Tip = { x: number; y: number; content: React.ReactNode } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line-2 bg-elev-3 px-2.5 py-1.5 text-[11.5px] shadow-[var(--shadow-lg)]" style={{ left: `${tip.x}%`, top: tip.y - 10 }}>
      {tip.content}
    </div>
  );
}

/** Orders per hour today against the usual for this hour. */
export function HourArea({ today, usual, nowHour, label = 'Orders' }: { today: number[]; usual: number[]; nowHour: number; label?: string }) {
  const W = 720;
  const H = 180;
  const P = { l: 28, r: 8, t: 10, b: 22 };
  const max = Math.max(4, ...today, ...usual) * 1.15;
  const x = (i: number) => P.l + (i / 23) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const line = (arr: number[], upto = 23) => arr.slice(0, upto + 1).map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const ticks = [0, 6, 12, 18, 23];
  const grid = [0, 0.5, 1].map((f) => Math.round(max * f * 0.87));
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(23, Math.round(((rel - P.l) / (W - P.l - P.r)) * 23))));
  };
  return (
    <div ref={box} className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${label} per hour today compared with the usual`}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={P.l} x2={W - P.r} y1={y(g)} y2={y(g)} stroke="var(--line)" />
            <text x={P.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="var(--ink-4)">
              {g}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-4)">
            {String(t).padStart(2, '0')}:00
          </text>
        ))}
        <path d={line(usual)} fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeDasharray="3 4" />
        <path d={`${line(today, nowHour)} L${x(nowHour)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="var(--s1)" opacity="0.14" />
        <path className="draw" d={line(today, nowHour)} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinejoin="round" />
        <circle cx={x(nowHour)} cy={y(today[nowHour] ?? 0)} r="4" fill="var(--s1)" stroke="var(--bg-elev)" strokeWidth="2" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--line-3)" />
            {hover <= nowHour && <circle cx={x(hover)} cy={y(today[hover])} r="4" fill="var(--s1)" stroke="var(--bg-elev)" strokeWidth="2" />}
            <circle cx={x(hover)} cy={y(usual[hover])} r="3.5" fill="var(--ink-3)" stroke="var(--bg-elev)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover != null && (
        <Tooltip
          tip={{
            x: (x(hover) / W) * 100,
            y: (y(Math.max(today[hover] ?? 0, usual[hover])) / H) * H,
            content: (
              <div className="space-y-0.5 whitespace-nowrap">
                <div className="text-ink-3">
                  {String(hover).padStart(2, '0')}:00 – {String(hover).padStart(2, '0')}:59
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded bg-[var(--s1)]" /> Today <b className="ml-auto pl-3 font-mono">{hover <= nowHour ? today[hover] : '—'}</b>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded border-t border-dashed border-ink-3" /> Usual <b className="ml-auto pl-3 font-mono">{usual[hover].toFixed(1)}</b>
                </div>
              </div>
            ),
          }}
        />
      )}
      <div className="mt-1 flex items-center gap-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded bg-[var(--s1)]" /> Today
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 border-t border-dashed border-ink-3" /> Usual for the hour (last 7 days)
        </span>
      </div>
    </div>
  );
}

/** Stacked daily bars by series (≤3 series: brands). */
export function StackedDays({ days, series }: { days: { label: string; values: number[] }[]; series: { name: string; color: string }[] }) {
  const W = 720;
  const H = 200;
  const P = { l: 30, r: 6, t: 10, b: 22 };
  const totals = days.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals) * 1.1;
  const bw = (W - P.l - P.r) / days.length;
  const y = (v: number) => (v / max) * (H - P.t - P.b);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Orders per day by brand">
        {[0, 0.5, 1].map((f) => {
          const v = Math.round(max * f * 0.9);
          const yy = H - P.b - y(v);
          return (
            <g key={f}>
              <line x1={P.l} x2={W - P.r} y1={yy} y2={yy} stroke="var(--line)" />
              <text x={P.l - 6} y={yy + 3} textAnchor="end" fontSize="10" fill="var(--ink-4)">
                {v}
              </text>
            </g>
          );
        })}
        {days.map((d, i) => {
          let acc = 0;
          const x = P.l + i * bw + bw * 0.18;
          const w = bw * 0.64;
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect x={P.l + i * bw} y={P.t} width={bw} height={H - P.t - P.b} fill="transparent" />
              {hover === i && <rect x={P.l + i * bw} y={P.t} width={bw} height={H - P.t - P.b} fill="var(--line)" rx="4" />}
              {d.values.map((v, k) => {
                if (!v) return null;
                const h = y(v);
                const top = H - P.b - acc - h;
                acc += h;
                const isTop = d.values.slice(k + 1).every((z) => !z);
                return <rect key={k} className="grow" x={x} y={top + (k ? 0 : 0)} width={w} height={Math.max(0, h - 2)} rx={isTop ? 3 : 1} fill={series[k].color} />;
              })}
              {(i % Math.ceil(days.length / 8) === 0 || i === days.length - 1) && (
                <text x={x + w / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-4)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tooltip
          tip={{
            x: ((P.l + hover * bw + bw / 2) / W) * 100,
            y: Math.max(14, H - P.b - y(totals[hover])),
            content: (
              <div className="min-w-[130px] space-y-0.5">
                <div className="text-ink-3">{days[hover].label}</div>
                {series.map((s, k) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: s.color }} /> {s.name}
                    <b className="ml-auto pl-3 font-mono">{days[hover].values[k]}</b>
                  </div>
                ))}
                <div className="flex border-t border-line pt-0.5 text-ink-2">
                  Total <b className="ml-auto font-mono">{totals[hover]}</b>
                </div>
              </div>
            ),
          }}
        />
      )}
      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-ink-3">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Weekday × hour heatmap, single hue (sequential). */
export function Heatmap({ grid, rows }: { grid: number[][]; rows: string[] }) {
  const max = Math.max(1, ...grid.flat());
  const [tip, setTip] = useState<{ r: number; c: number } | null>(null);
  return (
    <div className="relative">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `36px repeat(24, minmax(0,1fr))` }} onPointerLeave={() => setTip(null)}>
        {grid.map((row, r) => (
          <div key={r} className="contents">
            <div className="pr-2 text-right text-[10.5px] leading-[18px] text-ink-3">{rows[r]}</div>
            {row.map((v, c) => (
              <div
                key={c}
                onPointerEnter={() => setTip({ r, c })}
                className={`h-[18px] rounded-[3px] ${tip?.r === r && tip?.c === c ? 'ring-1 ring-ink' : ''}`}
                style={{ background: v ? `color-mix(in oklab, var(--s1) ${Math.round(12 + (v / max) * 88)}%, var(--bg-elev-2))` : 'var(--bg-elev-2)' }}
                aria-label={`${rows[r]} ${c}:00, ${v} orders`}
              />
            ))}
          </div>
        ))}
        <div />
        {Array.from({ length: 24 }, (_, c) => (
          <div key={c} className="text-center text-[9.5px] text-ink-4">
            {c % 3 === 0 ? String(c).padStart(2, '0') : ''}
          </div>
        ))}
      </div>
      {tip && (
        <div className="mt-2 text-[11.5px] text-ink-2">
          {rows[tip.r]} {String(tip.c).padStart(2, '0')}:00 · <b className="font-mono">{grid[tip.r][tip.c]}</b> orders
        </div>
      )}
      {!tip && <div className="mt-2 text-[11.5px] text-ink-4">Darker = more orders. Hover a cell for the count.</div>}
    </div>
  );
}
