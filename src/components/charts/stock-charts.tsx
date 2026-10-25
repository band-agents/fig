'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VELOCITY_COLOR, VELOCITY_LABEL, type Velocity } from '@/lib/domain/stock/classify';

// Stock charts in the house style: 2px lines, thin rounded columns with a surface gap, hairline
// solid grid, text in ink tokens (never the series colour), a legend for two or more series, and a
// hover readout on every plot. Values a tooltip shows are also in the page's tables.

const fmtWeek = (w: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${w}T00:00:00Z`));
/**
 * The drawing's width in real pixels, so text and marks keep their size whatever column the chart
 * sits in. The server renders at the fallback; the browser measures once mounted.
 */
function useWidth(ref: React.RefObject<HTMLDivElement | null>, fallback: number) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Rounded so the server's and the browser's floating point draw the same attribute. */
const r2 = (v: number) => Math.round(v * 100) / 100;
const n0 = (v: number) => new Intl.NumberFormat('en').format(Math.round(v));
const compact = (v: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

function Tip({ x, y, children, align = 'center' }: { x: number; y: number; children: React.ReactNode; align?: 'center' | 'left' | 'right' }) {
  const shift = align === 'center' ? '-50%' : align === 'left' ? '-6%' : '-94%';
  return (
    <div className="pointer-events-none absolute z-10 rounded-lg border border-line-2 bg-elev-3 px-2.5 py-1.5 text-[11.5px] shadow-[var(--shadow-lg)]" style={{ left: `${x}%`, top: y, transform: `translate(${shift}, calc(-100% - 10px))` }}>
      {children}
    </div>
  );
}

const Key = ({ color, dashed = false, faint = false }: { color: string; dashed?: boolean; faint?: boolean }) => (
  <span className="inline-block w-3.5" style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`, opacity: faint ? 0.8 : 1 }} />
);

// ── Sales, forecast and last year ─────────────────────────────────────────────────────────────

export type TrendPoint = { week: string; actual: number | null; forecast: number | null; lastYear: number | null };

export function TrendChart({ points, height = 230, unit = 'pieces' }: { points: TrendPoint[]; height?: number; unit?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 760);
  const H = height;
  const P = { l: 40, r: 10, t: 14, b: 24 };
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(10, ...points.flatMap((p) => [p.actual ?? 0, p.forecast ?? 0, p.lastYear ?? 0])) * 1.12;
  const x = (i: number) => r2(P.l + (i / Math.max(1, points.length - 1)) * (W - P.l - P.r));
  const y = (v: number) => r2(P.t + (1 - v / max) * (H - P.t - P.b));
  const path = (key: 'actual' | 'forecast' | 'lastYear') => {
    let d = '';
    points.forEach((p, i) => {
      const v = p[key];
      if (v == null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    });
    return d;
  };
  const lastActual = points.reduce((a, p, i) => (p.actual != null ? i : a), -1);
  const firstFc = points.findIndex((p) => p.forecast != null);
  const bridge = lastActual >= 0 && firstFc > lastActual ? `M${x(lastActual)} ${y(points[lastActual].actual!)} L${x(firstFc)} ${y(points[firstFc].forecast!)}` : '';
  const area = lastActual >= 0 ? `${path('actual')} L${x(lastActual)} ${y(0)} L${x(0)} ${y(0)} Z` : '';
  const ticks = [0, 0.5, 1].map((t) => Math.round((max / 1.12) * t));
  const months = points.map((p, i) => ({ i, d: new Date(`${p.week}T00:00:00Z`) })).filter((m, k, a) => k === 0 || m.d.getUTCMonth() !== a[k - 1].d.getUTCMonth());
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((rel - P.l) / (W - P.l - P.r)) * (points.length - 1)))));
  };
  const h = hover != null ? points[hover] : null;
  const cur = h ? h.actual ?? h.forecast : null;
  return (
    <div ref={box} className="relative select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Weekly ${unit} sold, the forecast ahead, and the same weeks last year`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={P.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--ink-4)">
              {compact(t)}
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m.i} x={x(m.i)} y={H - 6} textAnchor={m.i === 0 ? 'start' : 'middle'} fontSize="10.5" fill="var(--ink-4)">
            {new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(m.d)}
          </text>
        ))}
        {firstFc > 0 && <rect x={x(firstFc) - 2} y={P.t} width={W - P.r - x(firstFc) + 2} height={H - P.t - P.b} fill="var(--s1)" opacity="0.035" />}
        {firstFc > 0 && (
          <g>
            <line x1={x(firstFc)} x2={x(firstFc)} y1={P.t} y2={H - P.b} stroke="var(--line-3)" />
            <text x={x(firstFc) + 6} y={P.t + 10} fontSize="10.5" fill="var(--ink-3)">
              This week · forecast →
            </text>
          </g>
        )}
        <path d={path('lastYear')} fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={area} fill="var(--s1)" opacity="0.1" />
        <path className="draw" d={path('actual')} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={bridge + path('forecast')} fill="none" stroke="var(--s1)" strokeWidth="2" strokeDasharray="5 5" strokeLinejoin="round" strokeLinecap="round" />
        {lastActual >= 0 && <circle cx={x(lastActual)} cy={y(points[lastActual].actual!)} r="4" fill="var(--s1)" stroke="var(--bg-elev)" strokeWidth="2" />}
        {h && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={P.t} y2={H - P.b} stroke="var(--line-3)" />
            {cur != null && <circle cx={x(hover!)} cy={y(cur)} r="4.5" fill="var(--s1)" stroke="var(--bg-elev)" strokeWidth="2" />}
            {h.lastYear != null && <circle cx={x(hover!)} cy={y(h.lastYear)} r="4" fill="var(--ink-3)" stroke="var(--bg-elev)" strokeWidth="2" />}
          </g>
        )}
      </svg>
      {h && (
        <Tip x={(x(hover!) / W) * 100} y={y(Math.max(cur ?? 0, h.lastYear ?? 0))} align={hover! < 4 ? 'left' : hover! > points.length - 5 ? 'right' : 'center'}>
          <div className="min-w-[170px] space-y-0.5 whitespace-nowrap">
            <div className="text-ink-3">Week of {fmtWeek(h.week)}</div>
            <div className="flex items-center gap-2">
              <Key color="var(--s1)" dashed={h.actual == null} /> {h.actual != null ? 'Sold' : 'Forecast'}
              <b className="ml-auto pl-4 font-mono">{cur == null ? '—' : n0(cur)}</b>
            </div>
            <div className="flex items-center gap-2">
              <Key color="var(--ink-4)" /> Same week last year
              <b className="ml-auto pl-4 font-mono">{h.lastYear == null ? '—' : n0(h.lastYear)}</b>
            </div>
            {cur != null && h.lastYear ? <div className="border-t border-line pt-0.5 text-ink-2">{cur >= h.lastYear ? '+' : ''}{Math.round(((cur - h.lastYear) / h.lastYear) * 100)}% on last year</div> : null}
          </div>
        </Tip>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <Key color="var(--s1)" /> Sold
        </span>
        <span className="flex items-center gap-1.5">
          <Key color="var(--s1)" dashed /> Forecast
        </span>
        <span className="flex items-center gap-1.5">
          <Key color="var(--ink-4)" /> Last year
        </span>
      </div>
    </div>
  );
}

// ── The range map: pace against cover ─────────────────────────────────────────────────────────

export type MapPoint = { id: string; title: string; image: string | null; brand: string; cover: number; rate: number; value: number; velocity: string };

const VELOCITY_SERIES: Record<string, { label: string; color: string }> = Object.fromEntries((Object.keys(VELOCITY_COLOR) as Velocity[]).map((v) => [v, { label: VELOCITY_LABEL[v], color: VELOCITY_COLOR[v] }]));

export function RangeMap({ points, height = 300, money: moneyFmt }: { points: MapPoint[]; height?: number; money?: (v: number) => string }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 760);
  const H = height;
  const P = { l: 46, r: 14, t: 16, b: 26 };
  const [hover, setHover] = useState<number | null>(null);
  const [only, setOnly] = useState<string | null>(null);
  const maxRate = Math.max(4, ...points.map((p) => p.rate));
  const lx = (v: number) => Math.log10(Math.max(0.5, Math.min(104, v)));
  const ly = (v: number) => Math.log10(Math.max(0.05, v));
  const X0 = lx(0.5);
  const X1 = lx(104);
  const Y0 = ly(0.05);
  const Y1 = ly(maxRate * 1.4);
  const x = (v: number) => r2(P.l + ((lx(v) - X0) / (X1 - X0)) * (W - P.l - P.r));
  const y = (v: number) => r2(P.t + (1 - (ly(v) - Y0) / (Y1 - Y0)) * (H - P.t - P.b));
  const maxV = Math.max(1, ...points.map((p) => p.value));
  const r = (v: number) => r2(3 + Math.sqrt(v / maxV) * 9);
  const medRate = useMemo(() => {
    const s = points.map((p) => p.rate).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 1;
  }, [points]);
  const shown = points.map((p, i) => ({ p, i })).filter(({ p }) => !only || p.velocity === only);
  const onMove = (e: React.PointerEvent) => {
    const b = box.current!.getBoundingClientRect();
    const mx = ((e.clientX - b.left) / b.width) * W;
    const my = ((e.clientY - b.top) / b.height) * H;
    let best: number | null = null;
    let bd = 22 * 22;
    for (const { p, i } of shown) {
      const d = (x(p.cover) - mx) ** 2 + (y(p.rate) - my) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    setHover(best);
  };
  const h = hover != null ? points[hover] : null;
  const coverTicks = [1, 4, 12, 26, 52, 104];
  const rateTicks = [0.1, 1, 10, 100].filter((t) => t <= maxRate * 1.4);
  return (
    <div>
      <div ref={box} className="relative select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={() => h && router.push(`/stock/inventory/${h.id}`)} style={{ cursor: h ? 'pointer' : 'default' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Every style plotted by weekly sales against weeks of stock left">
          {/* quadrants: the action a style in each corner needs */}
          <rect x={P.l} y={P.t} width={x(12) - P.l} height={y(medRate) - P.t} fill="var(--t-red)" opacity="0.045" />
          <rect x={x(12)} y={y(medRate)} width={W - P.r - x(12)} height={H - P.b - y(medRate)} fill="var(--t-amber)" opacity="0.06" />
          {coverTicks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={P.t} y2={H - P.b} stroke="var(--line)" />
              <text x={x(t)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="var(--ink-4)">
                {t === 104 ? '2y+' : `${t}w`}
              </text>
            </g>
          ))}
          {rateTicks.map((t) => (
            <g key={t}>
              <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={P.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--ink-4)">
                {t}/wk
              </text>
            </g>
          ))}
          <line x1={x(12)} x2={x(12)} y1={P.t} y2={H - P.b} stroke="var(--line-3)" />
          <line x1={P.l} x2={W - P.r} y1={y(medRate)} y2={y(medRate)} stroke="var(--line-3)" />
          <text x={P.l + 8} y={P.t + 14} fontSize="11" fill="var(--ink-2)" fontWeight="500">
            Reorder · selling fast, little left
          </text>
          <text x={W - P.r - 8} y={P.t + 14} textAnchor="end" fontSize="11" fill="var(--ink-2)" fontWeight="500">
            Stars · selling, well stocked
          </text>
          <text x={P.l + 8} y={H - P.b - 8} fontSize="11" fill="var(--ink-3)">
            Lean · slow, little left
          </text>
          <text x={W - P.r - 8} y={H - P.b - 8} textAnchor="end" fontSize="11" fill="var(--ink-2)" fontWeight="500">
            Clear · slow, too much stock
          </text>
          {shown.map(({ p, i }) => (
            <circle key={p.id} cx={x(p.cover)} cy={y(p.rate)} r={r(p.value)} fill={VELOCITY_SERIES[p.velocity]?.color ?? 'var(--ink-3)'} fillOpacity={hover === i ? 0.95 : 0.62} stroke="var(--bg-elev)" strokeWidth="1.5" />
          ))}
          {h && <circle cx={x(h.cover)} cy={y(h.rate)} r={r(h.value) + 3} fill="none" stroke="var(--ink)" strokeWidth="1.5" />}
        </svg>
        {h && (
          <Tip x={(x(h.cover) / W) * 100} y={y(h.rate) - r(h.value)} align={x(h.cover) < 140 ? 'left' : x(h.cover) > W - 140 ? 'right' : 'center'}>
            <div className="flex max-w-[280px] gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {h.image && <img src={h.image} alt="" className="h-14 w-11 shrink-0 rounded-md object-cover" />}
              <div className="min-w-0">
                <div className="truncate font-medium">{h.title}</div>
                <div className="text-ink-3">{h.brand}</div>
                <div className="mt-1 font-mono text-[11px]">
                  {h.rate < 0.1 ? 'under 0.1' : h.rate.toFixed(h.rate < 10 ? 1 : 0)}/wk · {h.cover >= 104 ? '2y+' : `${h.cover.toFixed(h.cover < 10 ? 1 : 0)} wks`}
                  {moneyFmt ? ` · ${moneyFmt(h.value)}` : ''}
                </div>
              </div>
            </div>
          </Tip>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
        {Object.entries(VELOCITY_SERIES).map(([k, s]) => (
          <button key={k} onClick={() => setOnly(only === k ? null : k)} className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition ${only && only !== k ? 'opacity-40' : ''} hover:bg-elev-2`}>
            <span className="size-2.5 rounded-full" style={{ background: s.color }} /> {s.label}
          </button>
        ))}
        <span className="ml-auto text-ink-4">Dot size = stock value · click a dot to open it</span>
      </div>
    </div>
  );
}

// ── Months, this year against last ────────────────────────────────────────────────────────────

export type MonthBar = { label: string; thisYear: number | null; lastYear: number | null; forecast?: boolean; highlight?: boolean };

export function MonthCompare({ months, height = 220, format = n0, showForecast = true }: { months: MonthBar[]; height?: number; format?: (v: number) => string; showForecast?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 760);
  const H = height;
  const P = { l: 44, r: 8, t: 14, b: 24 };
  const [hover, setHover] = useState<number | null>(null);
  const hatch = `fc${useId().replace(/:/g, '')}`;
  const max = Math.max(1, ...months.flatMap((m) => [m.thisYear ?? 0, m.lastYear ?? 0])) * 1.12;
  const band = (W - P.l - P.r) / months.length;
  const bw = Math.min(16, band * 0.3);
  const y = (v: number) => r2(P.t + (1 - v / max) * (H - P.t - P.b));
  const bar = (cx: number, v: number, fill: string, opacity = 1, hatched = false) => {
    const top = y(v);
    const base = H - P.b;
    const h = Math.max(0, base - top);
    if (h < 0.5) return null;
    const rr = Math.min(4, h / 2, bw / 2);
    const d = `M${cx} ${base} V${top + rr} Q${cx} ${top} ${cx + rr} ${top} H${cx + bw - rr} Q${cx + bw} ${top} ${cx + bw} ${top + rr} V${base} Z`;
    return <path className="grow" d={d} fill={hatched ? `url(#${hatch})` : fill} opacity={opacity} stroke={hatched ? fill : 'none'} strokeWidth={hatched ? 1 : 0} />;
  };
  const ticks = [0, 0.5, 1].map((t) => (max / 1.12) * t);
  return (
    <div ref={box} className="relative select-none" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Units by month, this year against last year">
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="color-mix(in oklab, var(--s1) 18%, transparent)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--s1)" strokeWidth="1.6" opacity="0.6" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={P.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--ink-4)">
              {compact(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = P.l + i * band + band / 2;
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect x={P.l + i * band} y={P.t} width={band} height={H - P.t - P.b} fill={hover === i ? 'var(--line)' : m.highlight ? 'color-mix(in oklab, var(--s1) 7%, transparent)' : 'transparent'} rx="6" />
              {m.lastYear != null && bar(cx - bw - 1, m.lastYear, 'var(--ink-4)', 0.55)}
              {m.thisYear != null && bar(cx + 1, m.thisYear, 'var(--s1)', 1, m.forecast)}
              <text x={cx} y={H - 7} textAnchor="middle" fontSize="10.5" fill={m.highlight ? 'var(--ink)' : 'var(--ink-4)'} fontWeight={m.highlight ? 600 : 400}>
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tip x={((P.l + hover * band + band / 2) / W) * 100} y={y(Math.max(months[hover].thisYear ?? 0, months[hover].lastYear ?? 0))} align={hover < 2 ? 'left' : hover > months.length - 3 ? 'right' : 'center'}>
          <div className="min-w-[150px] space-y-0.5 whitespace-nowrap">
            <div className="text-ink-3">{months[hover].label}</div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-sm bg-[var(--s1)]" /> {months[hover].forecast ? 'Forecast' : 'This year'} <b className="ml-auto pl-4 font-mono">{months[hover].thisYear == null ? '—' : format(months[hover].thisYear!)}</b>
            </div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-sm bg-[var(--ink-4)]" /> Last year <b className="ml-auto pl-4 font-mono">{months[hover].lastYear == null ? '—' : format(months[hover].lastYear!)}</b>
            </div>
          </div>
        </Tip>
      )}
      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--s1)]" /> This year
        </span>
        {showForecast && (
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden>
              <rect width="10" height="10" rx="2" fill={`url(#${hatch})`} stroke="var(--s1)" />
            </svg>
            Forecast
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--ink-4)] opacity-60" /> Last year
        </span>
      </div>
    </div>
  );
}

// ── When each category sells: a single-hue heat grid ──────────────────────────────────────────

export function SeasonHeat({ rows, months, highlight }: { rows: { label: string; values: number[] }[]; months: string[]; highlight?: number }) {
  const max = Math.max(1.5, ...rows.flatMap((r) => r.values));
  const [tip, setTip] = useState<{ r: number; c: number } | null>(null);
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `minmax(110px, 150px) repeat(12, minmax(0,1fr))` }} onPointerLeave={() => setTip(null)}>
        <div />
        {months.map((m, c) => (
          <div key={m} className={`pb-1 text-center text-[10.5px] ${c === highlight ? 'font-semibold text-ink' : 'text-ink-4'}`}>
            {m}
          </div>
        ))}
        {rows.map((row, r) => (
          <div key={row.label} className="contents">
            <div className="truncate pr-2 text-[11.5px] leading-[26px] text-ink-2">{row.label}</div>
            {row.values.map((v, c) => (
              <div
                key={c}
                onPointerEnter={() => setTip({ r, c })}
                className={`h-[26px] rounded-[5px] ${tip?.r === r && tip?.c === c ? 'ring-1 ring-ink' : ''} ${c === highlight ? 'outline outline-1 outline-offset-1 outline-line-3' : ''}`}
                style={{ background: `color-mix(in oklab, var(--s1) ${Math.round(6 + Math.min(1, v / max) * 86)}%, var(--bg-elev-2))` }}
                aria-label={`${row.label}, ${months[c]}: ${v.toFixed(2)}× an average month`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-3 text-[11px] text-ink-3">
        {tip ? (
          <span>
            {rows[tip.r].label} in {months[tip.c]} sells <b className="font-mono text-ink">{rows[tip.r].values[tip.c].toFixed(1)}×</b> an average month
          </span>
        ) : (
          <>
            <span>Quieter</span>
            <span className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--s1) 8%, var(--bg-elev-2)), var(--s1))' }} />
            <span>Busier than an average month</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── A shift, hour by hour ─────────────────────────────────────────────────────────────────────

export type ShiftBlock = { start: number; end: number; tint: string; title: string; doing?: boolean };

export function ShiftStrip({ from, to, blocks, now }: { from: number; to: number; blocks: ShiftBlock[]; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.max(1, to - from);
  const pctOf = (t: number) => Math.max(0, Math.min(100, ((t - from) / span) * 100));
  const hours: number[] = [];
  for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t <= to; t += 3_600_000) hours.push(t);
  const fmt = (t: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' }).format(new Date(t));
  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <div className="relative h-7 overflow-hidden rounded-md bg-elev-2">
        {hours.map((t) => (
          <span key={t} className="absolute top-0 h-full w-px bg-line" style={{ left: `${pctOf(t)}%` }} />
        ))}
        {now > from && now < to && <span className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,transparent_0_5px,var(--line)_5px_6px)]" style={{ left: `${pctOf(now)}%` }} />}
        {blocks.map((b, i) => (
          <span
            key={i}
            data-tint={b.tint}
            onPointerEnter={() => setHover(i)}
            className={`absolute top-1 bottom-1 rounded-[3px] bg-[var(--tint)] ${b.doing ? 'animate-pulse' : ''} ${hover === i ? 'ring-2 ring-ink' : ''}`}
            style={{ left: `calc(${pctOf(b.start)}% + 1px)`, width: `max(3px, calc(${pctOf(b.end) - pctOf(b.start)}% - 2px))`, opacity: hover == null || hover === i ? 0.9 : 0.55 }}
          />
        ))}
        {now > from && now < to && <span className="absolute -top-0.5 bottom-[-2px] w-[2px] bg-signal" style={{ left: `${pctOf(now)}%` }} />}
      </div>
      <div className="relative mt-1 h-3.5">
        {hours.filter((_, i) => i % 2 === 0).map((t) => (
          <span key={t} className="absolute -translate-x-1/2 font-mono text-[9.5px] text-ink-4" style={{ left: `${pctOf(t)}%` }}>
            {fmt(t).slice(0, 2)}
          </span>
        ))}
      </div>
      {hover != null && (
        <Tip x={pctOf((blocks[hover].start + blocks[hover].end) / 2)} y={0}>
          <div className="max-w-[260px]">
            <div className="truncate font-medium">{blocks[hover].title}</div>
            <div className="font-mono text-[11px] text-ink-3">
              {fmt(blocks[hover].start)}–{blocks[hover].doing ? 'now' : fmt(blocks[hover].end)} · {Math.round((blocks[hover].end - blocks[hover].start) / 60_000)} min
            </div>
          </div>
        </Tip>
      )}
    </div>
  );
}

// ── A single share, as a ring ─────────────────────────────────────────────────────────────────

export function Ring({ value, size = 56, stroke = 6, label, sub, progress = false }: { value: number | null; size?: number; stroke?: number; label?: string; sub?: string; progress?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  // a share judged good or bad is tinted by it; progress is always sage
  const tint = value == null ? 'neutral' : progress ? 'green' : v >= 0.72 ? 'green' : v >= 0.55 ? 'amber' : 'red';
  return (
    <div className="flex items-center gap-2.5" data-tint={tint}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? 'Share'}: ${value == null ? 'not enough data' : `${Math.round(v * 100)}%`}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in oklab, var(--tint) 16%, var(--bg-elev-2))" strokeWidth={stroke} />
        {value != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tint)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.26} fontWeight="600" fill="var(--ink)">
          {value == null ? '—' : `${Math.round(v * 100)}`}
          {value != null && (
            <tspan fontSize={size * 0.15} fill="var(--ink-3)">
              %
            </tspan>
          )}
        </text>
      </svg>
      {(label || sub) && (
        <div className="min-w-0">
          {label && <div className="text-[12px] text-ink">{label}</div>}
          {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
        </div>
      )}
    </div>
  );
}

// ── Weekly units, websites and shops stacked, with the forecast after ─────────────────────────

export type WeekStack = { week: string; online: number; stores: number; forecast?: number; stockout?: number };

export function WeekStacks({ weeks, height = 200 }: { weeks: WeekStack[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 760);
  const H = height;
  const P = { l: 34, r: 6, t: 12, b: 22 };
  const [hover, setHover] = useState<number | null>(null);
  const hatch = `ws${useId().replace(/:/g, '')}`;
  const totals = weeks.map((w) => (w.forecast != null ? w.forecast : w.online + w.stores));
  const max = Math.max(4, ...totals) * 1.12;
  const band = (W - P.l - P.r) / weeks.length;
  const bw = Math.min(14, Math.max(2, band - 2));
  const y = (v: number) => r2((v / max) * (H - P.t - P.b));
  const ticks = [0, 0.5, 1].map((t) => Math.round((max / 1.12) * t));
  return (
    <div ref={box} className="relative select-none" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Units sold each week, websites and shops, then the forecast">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={H - P.b - y(t)} y2={H - P.b - y(t)} stroke="var(--line)" />
            <text x={P.l - 6} y={H - P.b - y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-4)">
              {compact(t)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x = P.l + i * band + (band - bw) / 2;
          const base = H - P.b;
          const first = i === 0 || new Date(`${w.week}T00:00:00Z`).getUTCMonth() !== new Date(`${weeks[i - 1].week}T00:00:00Z`).getUTCMonth();
          return (
            <g key={w.week} onPointerEnter={() => setHover(i)}>
              <rect x={P.l + i * band} y={P.t} width={band} height={H - P.t - P.b} fill={hover === i ? 'var(--line)' : 'transparent'} />
              {w.stockout ? <rect x={P.l + i * band} y={P.t} width={band} height={H - P.t - P.b} fill="var(--t-red)" opacity={0.05 + (w.stockout / 7) * 0.12} /> : null}
              {w.forecast != null ? (
                <rect x={x} y={base - y(w.forecast)} width={bw} height={Math.max(0, y(w.forecast))} rx={Math.min(3, bw / 2)} fill={`url(#${hatch})`} stroke="var(--s1)" strokeWidth="0.8" />
              ) : (
                <>
                  {w.online > 0 && <rect className="grow" x={x} y={base - y(w.online)} width={bw} height={Math.max(0, y(w.online) - (w.stores ? 1 : 0))} rx={w.stores ? 1 : Math.min(3, bw / 2)} fill="var(--s1)" />}
                  {w.stores > 0 && <rect className="grow" x={x} y={base - y(w.online + w.stores)} width={bw} height={Math.max(0, y(w.stores) - 1)} rx={Math.min(3, bw / 2)} fill="var(--s6)" />}
                </>
              )}
              {first && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-4)">
                  {new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${w.week}T00:00:00Z`))}
                </text>
              )}
            </g>
          );
        })}
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="color-mix(in oklab, var(--s1) 14%, transparent)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--s1)" strokeWidth="1.4" opacity="0.55" />
          </pattern>
        </defs>
      </svg>
      {hover != null && (
        <Tip x={((P.l + hover * band + band / 2) / W) * 100} y={H - P.b - y(totals[hover])} align={hover < 6 ? 'left' : hover > weeks.length - 7 ? 'right' : 'center'}>
          <div className="min-w-[150px] space-y-0.5 whitespace-nowrap">
            <div className="text-ink-3">Week of {fmtWeek(weeks[hover].week)}</div>
            {weeks[hover].forecast != null ? (
              <div className="flex items-center gap-2">
                <Key color="var(--s1)" dashed /> Forecast <b className="ml-auto pl-4 font-mono">{n0(weeks[hover].forecast!)}</b>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-sm bg-[var(--s1)]" /> Websites <b className="ml-auto pl-4 font-mono">{n0(weeks[hover].online)}</b>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-sm bg-[var(--s6)]" /> Shops <b className="ml-auto pl-4 font-mono">{n0(weeks[hover].stores)}</b>
                </div>
              </>
            )}
            {weeks[hover].stockout ? <div className="text-critical">Sold out {weeks[hover].stockout} of 7 days</div> : null}
          </div>
        </Tip>
      )}
      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--s1)]" /> Websites
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--s6)]" /> Shops
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <rect width="10" height="10" rx="2" fill={`url(#${hatch})`} stroke="var(--s1)" />
          </svg>
          Forecast
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--t-red)] opacity-25" /> Sold out
        </span>
      </div>
    </div>
  );
}

// ── Size curve: what sells against what is on the shelf ───────────────────────────────────────

export function SizeCurve({ rows }: { rows: { size: string; sales: number; stock: number }[] }) {
  const max = Math.max(0.01, ...rows.flatMap((r) => [r.sales, r.stock]));
  return (
    <div>
      <div className="flex h-[130px] items-end gap-3">
        {rows.map((r) => (
          <div key={r.size} className="flex flex-1 flex-col items-center gap-1.5" title={`${r.size}: ${Math.round(r.sales * 100)}% of sales, ${Math.round(r.stock * 100)}% of stock`}>
            <div className="flex h-[104px] w-full items-end justify-center gap-[2px]">
              <span className="w-[min(14px,40%)] rounded-t-[3px] bg-[var(--s1)]" style={{ height: `${(r.sales / max) * 100}%` }} />
              <span className="w-[min(14px,40%)] rounded-t-[3px] bg-[var(--s4)]" style={{ height: `${(r.stock / max) * 100}%` }} />
            </div>
            <span className="font-mono text-[11px] text-ink-3">{r.size}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--s1)]" /> Share of sales
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--s4)]" /> Share of stock
        </span>
      </div>
    </div>
  );
}
