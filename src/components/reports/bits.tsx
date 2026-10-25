import Link from 'next/link';

/**
 * The pieces every report page is built from: a card with its title, controls (Value | Pieces, Export)
 * on the right and the numbers under it; a figure; a change against the period before; link chips for
 * periods and filters. Numbers only, no sentences.
 */
export function Card({ title, sub, right, children, className = '', flush = false }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
          {sub && <p className="mt-0.5 text-[11.5px] text-ink-3">{sub}</p>}
        </div>
        {right && <div className="flex items-center gap-1.5">{right}</div>}
      </div>
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export function Figure({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="panel p-4 sm:p-5">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="mt-1 text-[19px] font-semibold leading-tight tracking-tight sm:text-[22px]">{value}</div>
      {note && <div className={`mt-0.5 text-[11.5px] ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-critical' : 'text-ink-3'}`}>{note}</div>}
    </div>
  );
}

/** +12% / −8% against the period before; nothing when there was nothing before. */
export function Delta({ now, before, className = '' }: { now: number; before: number; className?: string }) {
  if (!before) return now ? <span className={`text-[11px] text-ink-3 ${className}`}>new</span> : <span className={`text-ink-4 ${className}`}>—</span>;
  const d = (now - before) / before;
  const up = d >= 0;
  return <span className={`font-mono text-[11.5px] ${up ? 'text-good' : 'text-critical'} ${className}`}>{`${up ? '+' : '−'}${Math.abs(Math.round(d * 100))}%`}</span>;
}

export const deltaText = (now: number, before: number) => (!before ? (now ? 'new' : '—') : `${now >= before ? '+' : '−'}${Math.abs(Math.round(((now - before) / before) * 100))}% on the period before`);

export function Chips({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto">
      {items.map((x) => (
        <Link key={x.href + x.label} href={x.href} className={`flex h-8 shrink-0 items-center rounded-lg px-3 text-[12.5px] transition ${x.active ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
          {x.label}
        </Link>
      ))}
    </div>
  );
}

/** Two bars on one line: share of value against share of pieces, so a price question reads at a glance. */
export function ShareBars({ value, units, money }: { value: number; units: number; money: boolean }) {
  return (
    <div className="space-y-1">
      {money && (
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span className="w-12 shrink-0">Value</span>
          <span className="relative h-2 flex-1 rounded-full bg-elev-3">
            <span className="bar-grow absolute inset-y-0 left-0 rounded-full bg-[var(--s1)]" style={{ width: `${Math.max(1.5, value * 100)}%` }} />
          </span>
          <span className="w-10 shrink-0 text-right font-mono text-ink-2">{Math.round(value * 100)}%</span>
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span className="w-12 shrink-0">Pieces</span>
        <span className="relative h-2 flex-1 rounded-full bg-elev-3">
          <span className="bar-grow absolute inset-y-0 left-0 rounded-full bg-[var(--s3)]" style={{ width: `${Math.max(1.5, units * 100)}%` }} />
        </span>
        <span className="w-10 shrink-0 text-right font-mono text-ink-2">{Math.round(units * 100)}%</span>
      </div>
    </div>
  );
}

export const weeksText = (n: number) => (n === 1 ? 'week' : `${n} weeks`);

/** Weeks of cover, readable: beyond two years it is just "2 yr+" (online sales against all the stock). */
export const coverText = (w: number | null) => (w == null ? '—' : w < 1 ? '<1 wk' : w > 104 ? '2 yr+' : `${Math.round(w)} wk`);

/** A share with a decimal when it is small, so 0.4% does not read as 0%. */
export const share = (v: number | null) => (v == null ? '—' : v > 0 && v < 0.1 ? `${(v * 100).toFixed(1)}%` : `${Math.round(v * 100)}%`);
