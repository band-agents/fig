'use client';

import { useId } from 'react';

/** A row of thin rounded bars that grow from the floor, the last one darkest: a week at a glance. */
export function MiniBars({ data, height = 34, color = 'var(--s1)' }: { data: number[]; height?: number; color?: string }) {
  const max = Math.max(1, ...data);
  const n = data.length;
  const W = n * 7 - 3;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width={W * 1.4} height={height} aria-hidden>
      {data.map((v, i) => {
        const h = Math.max(3, (v / max) * height);
        return <rect key={i} className="grow" x={i * 7} y={height - h} width={4} height={h} rx={2} fill={color} opacity={i === n - 1 ? 1 : 0.35 + (0.55 * i) / Math.max(1, n - 1)} />;
      })}
    </svg>
  );
}

/** A half-circle gauge in sage, its arc drawing in, the share printed in the middle. */
export function Gauge({ value, label, size = 150 }: { value: number | null; label?: string; size?: number }) {
  const id = useId().replace(/:/g, '');
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const len = Math.PI * r;
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 14}`} width="100%" style={{ maxWidth: size }} aria-label={label}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="var(--sage-deep)" />
          <stop offset="1" stopColor="var(--sage)" />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="var(--bg-elev-3)" strokeWidth="14" strokeLinecap="round" />
      <path d={arc} fill="none" stroke={`url(#g${id})`} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${len * v} ${len}`} style={{ animation: 'gaugeIn .5s var(--ease-out-expo) both', ['--len' as string]: `${len}` }} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="650" fill="var(--ink)">
        {value == null ? '—' : `${Math.round(v * 100)}%`}
      </text>
    </svg>
  );
}
