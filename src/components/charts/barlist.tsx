/** Horizontal bars with the label and value always printed, so nothing hides behind a hover. */
export function BarList({
  rows,
  format = (v) => String(v),
  color = 'var(--s1)',
  max,
  mark,
}: {
  rows: { label: React.ReactNode; value: number; sub?: React.ReactNode; tone?: 'alert' }[];
  format?: (v: number) => string;
  color?: string;
  max?: number;
  mark?: { value: number; label: string };
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={i} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-ink">{r.label}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              {r.sub && <span className="text-[11.5px] text-ink-3">{r.sub}</span>}
              <span className={`font-mono text-[12.5px] ${r.tone === 'alert' ? 'text-critical' : 'text-ink-2'}`}>{format(r.value)}</span>
            </span>
          </div>
          <div className="relative h-1.5 rounded-full bg-elev-3">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(1.5, (r.value / top) * 100)}%`, background: r.tone === 'alert' ? 'var(--t-red)' : color }} />
            {mark && <div className="absolute -top-1 h-3.5 w-px bg-ink-3" style={{ left: `${(mark.value / top) * 100}%` }} title={mark.label} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
