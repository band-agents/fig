import Link from 'next/link';
import { ArrowUpRight, PauseCircle, RotateCcw, TimerOff, Undo2 } from 'lucide-react';
import { span } from '@/lib/domain/sla';
import { num } from '@/lib/format';

type Lane = { key: string; label: string; verb: string; tint: string; href: string; n: number; late: number; soon: number; held: number; dwellMs: number; passed24h: number };

/** The relay: each department is a leg, the baton is the order. Counts are live; the dashed lines move. */
export function RelayFlow({ lanes, exceptions, canOpen }: { lanes: Lane[]; exceptions: { rto: number; held: number; returns: number; returnsLate: number }; canOpen: Record<string, boolean> }) {
  const max = Math.max(1, ...lanes.map((l) => l.n));
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="live-dot" />
          <h2 className="text-[14px] font-medium">The relay, right now</h2>
          <span className="hidden text-[12px] text-ink-3 sm:inline">where every open order is, and who has the baton</span>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-ink-3">
          <span className="inline-flex items-center gap-1">
            <TimerOff className="size-3.5 text-critical" /> late
          </span>
          <span className="inline-flex items-center gap-1">
            <PauseCircle className="size-3.5 text-[var(--warn)]" /> on hold
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {lanes.map((l, i) => (
          <MaybeLink
            key={l.key}
            href={canOpen[l.key] ? l.href : null}
            data-tint={l.tint}
            className="group relative flex flex-col gap-3 border-b border-line p-5 transition hover:bg-elev-2 sm:border-r lg:border-b-0 lg:[&:nth-child(5)]:border-r-0"
          >
            {i < lanes.length - 1 && (
              <svg className="absolute -right-[13px] top-[34px] z-10 hidden lg:block" width="26" height="12" viewBox="0 0 26 12" aria-hidden>
                <path d="M1 6 H21" stroke="var(--line-3)" strokeWidth="1.5" />
                <path d="M1 6 H21" stroke="var(--tint)" strokeWidth="1.5" className="baton" />
                <path d="M19 2 L24 6 L19 10" fill="none" stroke="var(--line-3)" strokeWidth="1.5" />
              </svg>
            )}
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[var(--tint)] shadow-[0_0_12px_var(--tint)]" />
              <span className="text-[12.5px] font-medium">{l.label}</span>
              <ArrowUpRight className="ml-auto size-3.5 text-ink-4 opacity-0 transition group-hover:opacity-100" />
            </div>
            <div className="flex items-end gap-2">
              <span className="font-display text-[26px] leading-tight tabular">{num(l.n)}</span>
              <span className="mb-1 text-[11.5px] text-ink-3">{l.verb}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-elev-3">
              <div className="h-full rounded-full bg-[var(--tint)] transition-[width] duration-200" style={{ width: `${(l.n / max) * 100}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
              {l.late > 0 ? (
                <span className="inline-flex items-center gap-1 font-medium text-critical">
                  <TimerOff className="size-3.5" /> {l.late} late
                </span>
              ) : (
                <span className="text-good">on time</span>
              )}
              {l.held > 0 && (
                <span className="inline-flex items-center gap-1 text-[var(--warn)]">
                  <PauseCircle className="size-3.5" /> {l.held}
                </span>
              )}
              <span className="text-ink-3">avg {l.n ? span(l.dwellMs) : '—'} here</span>
            </div>
            <div className="mt-auto text-[11px] text-ink-4">{num(l.passed24h)} passed on in the last 24h</div>
          </MaybeLink>
        ))}
      </div>

      <div className="grid grid-cols-3 border-t border-line bg-inset/60 text-[12px]">
        <Link href="/queue/shipping?view=rto" className="flex items-center gap-2 px-5 py-3 transition hover:bg-elev-2">
          <RotateCcw className="size-4 text-[var(--t-red)]" />
          <span className="text-ink-2">Refused, coming back</span>
          <span className="ml-auto font-mono">{exceptions.rto}</span>
        </Link>
        <Link href="/orders?view=held" className="flex items-center gap-2 border-x border-line px-5 py-3 transition hover:bg-elev-2">
          <PauseCircle className="size-4 text-[var(--warn)]" />
          <span className="text-ink-2">On hold</span>
          <span className="ml-auto font-mono">{exceptions.held}</span>
        </Link>
        <Link href="/returns" className="flex items-center gap-2 px-5 py-3 transition hover:bg-elev-2">
          <Undo2 className="size-4 text-[var(--t-rose)]" />
          <span className="text-ink-2">Returns open</span>
          <span className="ml-auto font-mono">
            {exceptions.returns}
            {exceptions.returnsLate > 0 && <span className="ml-1.5 text-critical">· {exceptions.returnsLate} late</span>}
          </span>
        </Link>
      </div>
    </section>
  );
}

function MaybeLink({ href, children, ...rest }: { href: string | null; children: React.ReactNode; className?: string; 'data-tint'?: string }) {
  if (href) return <Link href={href} {...rest}>{children}</Link>;
  return <div {...rest}>{children}</div>;
}
