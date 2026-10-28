import Link from 'next/link';
import { ChevronLeft, ChevronRight, Info, Target } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { pacing, type BrandPace } from '@/lib/smart/pacing';
import { monthKey } from '@/lib/targets';
import { IMPORT_LABEL, mayImport } from '@/lib/imports';
import { viewCurrency } from '@/lib/stock/views/common';
import { moneyIn, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { ImportButton } from '@/components/ui/import-button';

export const metadata = { title: 'Targets & pacing' };

// Dan, 28 Oct: each brand's month against its target, where it will land at today's pace, what it
// needs a day, and why it is ahead or behind (smart/pacing.ts).

const STATUS: Record<BrandPace['status'], { label: string; tone: string }> = {
  ahead: { label: 'Ahead', tone: 'success' },
  on: { label: 'On track', tone: 'success' },
  close: { label: 'Close', tone: 'attention' },
  behind: { label: 'Behind', tone: 'critical' },
  none: { label: 'No target', tone: 'neutral' },
};

const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  return monthKey(new Date(Date.UTC(y, m - 1 + by, 15)));
};
const monthName = (month: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T00:00:00Z`));

export default async function TargetsPage(props: PageProps<'/targets'>) {
  const me = await requireUser();
  if (!canSee(me, 'targets')) sendHome(me);
  const sp = await props.searchParams;
  const current = monthKey();
  const asked = typeof sp.month === 'string' && /^\d{4}-\d{2}$/.test(sp.month) && sp.month <= current ? sp.month : current;
  const d = await pacing(me, asked);
  const cur = viewCurrency(me);
  const m = (v: number) => moneyIn(v, cur, { compact: true });
  const t = d.total;
  const live = asked === current;
  const pace = t.target ? t.targetProjection / t.target : null;
  const vsLast = t.prev > 0 ? t.mtd / t.prev - 1 : null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Business"
        title="Targets & pacing"
        sub="Each brand’s month against its target: where it will land at today’s pace, what it needs a day, and why."
        right={
          <div className="flex items-center gap-2">
            {mayImport(me, 'targets') && <ImportButton kind="targets" {...IMPORT_LABEL.targets} label="Set targets" />}
            <div className="flex items-center gap-1 rounded-xl border border-line bg-elev p-1">
              <Link href={`/targets?month=${shift(asked, -1)}`} className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-elev-2" aria-label="Month before">
                <ChevronLeft className="size-4" />
              </Link>
              <span className="min-w-[120px] text-center text-[12.5px] font-semibold">{monthName(asked)}</span>
              {live ? (
                <span className="grid size-8 place-items-center text-ink-4">
                  <ChevronRight className="size-4" />
                </span>
              ) : (
                <Link href={`/targets?month=${shift(asked, 1)}`} className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-elev-2" aria-label="Month after">
                  <ChevronRight className="size-4" />
                </Link>
              )}
            </div>
          </div>
        }
      />

      {/* the month in one line, then on a chart */}
      <section className="panel wv-hero overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <div className="flex items-baseline gap-3">
              <span className={`font-mono text-[44px] font-semibold leading-none tracking-[-1.5px] sm:text-[56px] ${pace != null && pace < 0.85 ? 'text-critical' : ''}`}>{pace != null ? `${Math.round(pace * 100)}%` : m(t.projection)}</span>
              <span className="text-[14px] text-ink-2">{pace != null ? (live ? 'of target, at today’s pace' : 'of target') : live ? 'this month, at today’s pace' : 'this month'}</span>
            </div>
            <p className="mt-2 text-[12.5px] text-ink-3">
              {m(t.mtd)} so far from {num(t.orders)} orders
              {vsLast != null && ` · ${vsLast >= 0 ? '+' : ''}${Math.round(vsLast * 100)}% on the same days last month`}
              {live && ` · ${Math.ceil(d.remaining)} day${Math.ceil(d.remaining) === 1 ? '' : 's'} left`}
              {d.behind > 0 && <span className="text-critical"> · {d.behind} brand{d.behind === 1 ? '' : 's'} behind</span>}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-6 text-right">
            <Figure label={pace != null ? 'Heading for' : 'So far'} value={m(pace != null ? t.projection : t.mtd)} />
            {t.target != null ? <Figure label="Target" value={m(t.target)} /> : <Figure label="Same days last month" value={m(t.prev)} />}
            <Figure label={t.needPerDay != null ? 'A day: doing / need' : 'A day'} value={t.needPerDay != null ? `${m(t.ratePerDay)} / ${m(t.needPerDay)}` : m(t.ratePerDay)} bad={t.needPerDay != null && t.needPerDay > t.ratePerDay} />
          </div>
        </div>
        <MonthChart daily={t.daily} elapsed={d.elapsed} rate={t.ratePerDay} target={t.target} live={live} />
      </section>

      {!d.brands.length ? (
        <div className="panel">
          <Empty icon={Target} title="Nothing sold this month yet" body="Brands show here with their first sale, or as soon as they have a target." />
        </div>
      ) : (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-2 px-5 pt-4 pb-2">
            <div>
              <h2 className="text-[14px]">Brand by brand</h2>
              <p className="mt-0.5 text-[11.5px] text-ink-3">{d.hasTargets ? 'Behind first, then close, on track and ahead.' : 'No targets set for this month yet: “Set targets” takes a sheet of brand, month and sales.'}</p>
            </div>
          </div>
          <div className="scroll-thin hidden overflow-x-auto md:block">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Brand and why</th>
                  <th className="text-right">Target</th>
                  <th className="text-right">So far</th>
                  <th className="text-right">Heading for</th>
                  <th className="min-w-[200px]">Pace</th>
                  <th className="text-right">A day: doing / need</th>
                </tr>
              </thead>
              <tbody>
                {d.brands.map((b) => (
                  <tr key={b.key}>
                    <td className="min-w-[240px] max-w-[340px]">
                      <div className="font-medium">
                        {b.label}
                        <span className="ml-1.5 text-[11px] font-normal text-ink-4">{b.market === 'KW' ? 'Kuwait' : 'Egypt'}</span>
                      </div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{b.why}</div>
                    </td>
                    <td className="whitespace-nowrap text-right font-mono text-ink-2">{b.target != null ? m(b.target) : '—'}</td>
                    <td className="whitespace-nowrap text-right font-mono">{m(b.mtd)}</td>
                    <td className="whitespace-nowrap text-right font-mono font-semibold">{m(b.projection)}</td>
                    <td>
                      <PaceBar b={b} />
                    </td>
                    <td className={`whitespace-nowrap text-right font-mono ${b.needPerDay != null && b.needPerDay > b.ratePerDay ? 'text-critical' : 'text-ink-2'}`}>{b.needPerDay != null ? `${m(b.ratePerDay)} / ${m(b.needPerDay)}` : m(b.ratePerDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-[var(--line)] md:hidden">
            {d.brands.map((b) => (
              <li key={b.key} className="space-y-2 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{b.label}</span>
                  <span className="font-mono text-[13px] font-semibold">
                    {m(b.projection)}
                    {b.target != null && <span className="font-normal text-ink-3"> / {m(b.target)}</span>}
                  </span>
                </div>
                <PaceBar b={b} />
                <p className="text-[11.5px] text-ink-3">{b.why}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Sales are the websites’ orders after discounts, refused and cancelled ones left out, by day in Cairo time; shop sales join when Lucida’s do. “Heading for” adds the days left at a pace half this month’s own and half the last four weeks’. Targets come from Set targets (brand, month, sales and/or pieces), kept per market in its own money.
        </span>
      </p>
    </div>
  );
}

function Figure({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className={`mt-1 whitespace-nowrap font-mono text-[16px] font-semibold sm:text-[18px] ${bad ? 'text-critical' : ''}`}>{value}</div>
    </div>
  );
}

/** Sold so far, where today's pace takes it, and the target as a line at 100%. */
function PaceBar({ b }: { b: BrandPace }) {
  const scale = Math.max(b.target ?? 0, b.projection, 1) * 1.08;
  const st = STATUS[b.status];
  return (
    <div className="flex items-center gap-2.5">
      <div className="pc-track flex-1">
        <span className="pc-proj" data-s={b.status} style={{ width: `${(b.projection / scale) * 100}%` }} />
        <span className="pc-fill" data-s={b.status} style={{ width: `${(b.mtd / scale) * 100}%` }} />
        {b.target != null && <span className="pc-mark" style={{ left: `${(b.target / scale) * 100}%` }} />}
      </div>
      <span className="pill w-[88px] justify-center" data-tone={st.tone}>
        {b.pace != null ? `${Math.round(b.pace * 100)}%` : st.label}
      </span>
    </div>
  );
}

/** The month day by day: sold so far (solid), where today's pace takes it (dashed), the even road to the target (dotted). */
function MonthChart({ daily, elapsed, rate, target, live }: { daily: number[]; elapsed: number; rate: number; target: number | null; live: boolean }) {
  const W = 1000;
  const H = 170;
  const n = daily.length;
  const done = live ? Math.min(n, Math.ceil(elapsed)) : n;
  const cum: number[] = [];
  daily.forEach((v, i) => cum.push((cum[i - 1] ?? 0) + v));
  const sofar = cum[done - 1] ?? 0;
  const end = live ? sofar + rate * Math.max(0, n - elapsed) : sofar;
  const top = Math.max(target ?? 0, end, sofar, 1) * 1.1;
  const x = (day: number) => (day / n) * W;
  const y = (v: number) => H - (v / top) * H;
  const actual = cum.slice(0, done).map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`);
  return (
    <div className="mt-5">
      <svg viewBox={`0 -8 ${W} ${H + 16}`} preserveAspectRatio="none" className="h-[150px] w-full overflow-visible sm:h-[180px]" role="img" aria-label="Sales through the month">
        <line x1="0" y1={H} x2={W} y2={H} className="pc-axis" />
        {target != null && <line x1="0" y1={H} x2={W} y2={y(target)} className="pc-road" />}
        {target != null && <line x1="0" y1={y(target)} x2={W} y2={y(target)} className="pc-goal" />}
        <polygon points={`0,${H} ${actual.join(' ')} ${x(done).toFixed(1)},${H}`} className="pc-area" />
        <polyline points={`0,${H} ${actual.join(' ')}`} className="pc-line" />
        {live && done < n && <line x1={x(elapsed)} y1={y(sofar)} x2={W} y2={y(end)} className="pc-dash" />}
        {live && <line x1={x(elapsed)} y1="0" x2={x(elapsed)} y2={H} className="pc-today" />}
      </svg>
      <div className="relative mt-1.5 flex justify-between text-[11px] text-ink-4">
        <span>Day 1</span>
        {live && elapsed > n * 0.12 && elapsed < n * 0.88 && (
          <span className="absolute -translate-x-1/2" style={{ left: `${(elapsed / n) * 100}%` }}>
            today
          </span>
        )}
        <span>Day {n}</span>
      </div>
    </div>
  );
}
