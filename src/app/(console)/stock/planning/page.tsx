import Link from 'next/link';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { planning } from '@/lib/stock/views/planning';
import { MONTHS_SHORT } from '@/lib/domain/stock/calendar';
import { marketsFor, viewCurrency } from '@/lib/stock/views/common';
import { moneyIn, num, pct } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { BarList } from '@/components/charts/barlist';
import { MonthCompare, SeasonHeat } from '@/components/charts/stock-charts';
import { DemoNote } from '@/components/stock/bits';
import { CountUp } from '@/components/ui/count-up';

export const metadata = { title: 'Planning' };

export default async function PlanningPage(props: PageProps<'/stock/planning'>) {
  const me = await requireUser();
  const cur = viewCurrency(me);
  if (!canSee(me, 'planning')) sendHome(me);
  const sp = await props.searchParams;
  const m = typeof sp.month === 'string' ? Number(sp.month) : undefined;
  const market = typeof sp.market === 'string' ? sp.market : undefined;
  const d = await planning(me, { month: m != null && m >= 0 && m < 12 ? m : undefined, market });
  const markets = marketsFor(me);
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ month: String(d.month), market, ...patch })) if (v != null && v !== '') next.set(k, v);
    return `/stock/planning?${next}`;
  };
  const ly = d.lastYear;
  const fmtDay = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stock & buying · Planning"
        title={
          <>
            {d.monthName} {d.targetY}, <em className="text-ink-2">read from {d.monthName} {d.lastY}</em>
          </>
        }
        sub="The same month last year, when each category peaks, and when it has to be bought."
        right={
          markets.length > 1 ? (
            <div className="flex gap-1 rounded-xl border border-line bg-elev p-1">
              {[{ v: undefined, l: 'All' }, { v: 'EG', l: 'Egypt' }, { v: 'KW', l: 'Kuwait' }].map((x) => (
                <Link key={x.l} href={qs({ market: x.v })} className={`flex h-8 items-center rounded-lg px-3 text-[12.5px] ${market === x.v ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                  {x.l}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      />
      <DemoNote />

      <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Month">
        {MONTHS_SHORT.map((label, i) => (
          <Link key={label} href={qs({ month: String(i) })} className={`flex h-9 min-w-[52px] shrink-0 items-center justify-center rounded-lg px-3 text-[12.5px] transition ${d.month === i ? 'bg-elev-3 font-semibold text-ink' : i === d.thisMonth ? 'text-ink ring-1 ring-line-2' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
            {label}
          </Link>
        ))}
      </nav>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {[
          { label: `Sold in ${d.monthName} ${d.lastY}`, value: num(ly.units), note: ly.yoy == null ? 'pieces' : `${ly.yoy >= 0 ? '+' : '−'}${pct(Math.abs(ly.yoy))} on the year before` },
          ...(ly.revenue != null ? [{ label: 'Sales that month', value: moneyIn(ly.revenue, cur, { compact: true }), note: cur === 'EGP' ? 'EGP equivalent, every market in view' : `${cur}, Kuwait` }] : []),
          { label: `Forecast, ${d.monthName} ${d.targetY}`, value: ly.forecast == null ? '—' : num(ly.forecast), note: ly.forecast == null ? 'beyond the 26-week forecast' : ly.units ? `${ly.forecast >= ly.units ? '+' : '−'}${pct(Math.abs(ly.forecast - ly.units) / Math.max(1, ly.units))} on last year` : 'pieces' },
          { label: 'Lost to sold-out shelves', value: num(ly.lostUnits), note: ly.lostValue != null ? `${moneyIn(ly.lostValue, cur, { compact: true })} of sales, ${d.monthName} ${d.lastY}` : `pieces, ${d.monthName} ${d.lastY}`, alert: ly.lostUnits > 0 },
          { label: 'Styles that sold out', value: num(ly.lost.length), note: 'for at least part of the month' },
        ].map((k) => (
          <div key={k.label} className="panel rise flex flex-col justify-between gap-2 p-4">
            <span className="text-[11.5px] text-ink-3">{k.label}</span>
            <div className={`font-display text-[20px] leading-none ${'alert' in k && k.alert ? 'text-critical' : ''}`}>{typeof k.value === 'string' ? <CountUp text={k.value} /> : k.value}</div>
            <div className="text-[11px] leading-snug text-ink-3">{k.note}</div>
          </div>
        ))}
      </section>

      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold">Pieces sold by month</h2>
            <p className="mt-0.5 text-[11.5px] text-ink-3">This year against last · coming months forecast</p>
          </div>
        </div>
        <MonthCompare months={d.months} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="eyebrow mb-1">
            {d.monthName} {d.lastY}
          </div>
          <h2 className="mb-3 text-[14px] font-medium">What sold most</h2>
          <ol className="divide-y divide-[var(--line)]">
            {ly.top.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="w-4 font-mono text-[11px] text-ink-4">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.image ? <img src={t.image} alt="" className="h-11 w-9 rounded-md object-cover" /> : <span className="h-11 w-9 rounded-md bg-elev-3" />}
                <div className="min-w-0 flex-1">
                  <Link href={`/stock/inventory/${t.id}`} className="block truncate text-[12.5px] hover:underline">
                    {t.title}
                  </Link>
                  <div className="truncate text-[11px] text-ink-3">
                    {t.brand} · {t.market}
                    {t.season !== 'core' ? ` · ${t.season}` : ''}
                  </div>
                </div>
                <span className="font-mono text-[12.5px]">{num(t.units)}</span>
              </li>
            ))}
            {!ly.top.length && <li className="py-4 text-[12.5px] text-ink-3">No sales on record for that month.</li>}
          </ol>
        </div>
        <div className="panel p-5">
          <div className="eyebrow mb-1">
            {d.monthName} {d.lastY}
          </div>
          <h2 className="mb-3 text-[14px] font-medium">What sold out, and what it cost</h2>
          <ul className="divide-y divide-[var(--line)]">
            {ly.lost.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.image ? <img src={t.image} alt="" className="h-11 w-9 rounded-md object-cover" /> : <span className="h-11 w-9 rounded-md bg-elev-3" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px]">{t.title}</div>
                  <div className="text-[11px] text-ink-3">
                    empty {t.days} days over {t.weeks} week{t.weeks > 1 ? 's' : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[12.5px] text-critical">−{num(t.lostUnits)}</div>
                  <div className="text-[10.5px] text-ink-4">{t.lostValue != null ? moneyIn(t.lostValue, cur, { compact: true }) : 'pieces'}</div>
                </div>
              </li>
            ))}
            {!ly.lost.length && <li className="py-4 text-[12.5px] text-ink-3">Nothing sold out that month.</li>}
          </ul>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="panel p-5">
          <div className="eyebrow mb-1">The year, by category</div>
          <h2 className="mb-1 text-[14px] font-medium">When each category sells</h2>
          <p className="mb-4 text-[11.5px] text-ink-3">Learned from two years of sales with the moving holidays taken out, so Eid and White Friday land on their own dates each year.</p>
          <div className="scroll-thin overflow-x-auto">
            <div className="min-w-[620px]">
              <SeasonHeat rows={d.heat} months={MONTHS_SHORT} highlight={d.month} />
            </div>
          </div>
        </div>
        <div className="panel p-5">
          <div className="eyebrow mb-1">
            {d.monthName} {d.lastY}, by category
          </div>
          <h2 className="mb-4 text-[14px] font-medium">Where the pieces went</h2>
          <BarList
            rows={ly.categories.slice(0, 9).map((c) => ({ label: c.label, value: c.units, sub: c.md && c.md.units ? `${pct(c.md.md / c.md.units)} on markdown` : undefined }))}
            format={num}
            color="var(--s1)"
          />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <header className="border-b border-line px-5 py-3.5">
            <div className="eyebrow mb-1">Buying calendar</div>
            <h2 className="text-[14px] font-medium">Order by these dates to land before the peak</h2>
          </header>
          <div className="scroll-thin overflow-x-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Peak</th>
                  <th className="text-right">Lead time</th>
                  <th className="text-right">Order by</th>
                </tr>
              </thead>
              <tbody>
                {d.calendar.map((c) => (
                  <tr key={`${c.market}${c.category}`}>
                    <td>
                      {c.category} <span className="text-[11px] text-ink-4">{c.market}</span>
                    </td>
                    <td>
                      {c.peak} <span className="font-mono text-[11px] text-ink-3">{c.x.toFixed(1)}×</span>
                    </td>
                    <td className="text-right font-mono text-ink-2">{c.lead}d</td>
                    <td className={`text-right font-mono ${c.late ? 'text-critical' : ''}`}>{c.late ? `late · ${fmtDay(c.orderBy)}` : fmtDay(c.orderBy)}</td>
                  </tr>
                ))}
                {!d.calendar.length && (
                  <tr>
                    <td colSpan={4} className="text-ink-3">
                      No category peaks in the next five months.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {d.otb ? (
          <div className="panel p-5">
            <div className="eyebrow mb-1">Open to buy, at cost</div>
            <h2 className="mb-1 text-[14px] font-medium">What the next three months need, and what is still to buy</h2>
            <p className="mb-4 text-[11.5px] text-ink-3">Forecast sales at cost, met first from stock on hand and on order. What is left is the budget still open.</p>
            <div className="space-y-4">
              {d.otb.map((o) => {
                const max = Math.max(...d.otb!.map((x) => x.need), 1);
                return (
                  <div key={o.month}>
                    <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
                      <span>{o.month}</span>
                      <span className="font-mono text-[11.5px] text-ink-3">
                        needs {moneyIn(o.need, cur, { compact: true })} · <b className={o.open ? 'text-ink' : 'text-good'}>{o.open ? `${moneyIn(o.open, cur, { compact: true })} open` : 'covered'}</b>
                      </span>
                    </div>
                    <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-elev-3">
                      <span className="h-full rounded-l-full bg-[var(--s1)]" style={{ width: `${((o.need - o.open) / max) * 100}%` }} title="Covered by stock and orders" />
                      {o.open > 0 && <span className="h-full rounded-r-full bg-[var(--s4)]" style={{ width: `${(o.open / max) * 100}%` }} title="Still to buy" />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-4 text-[11px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[var(--s1)]" /> Covered by stock and orders
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[var(--s4)]" /> Still to buy
              </span>
            </div>
          </div>
        ) : (
          <div className="panel p-5 text-[12.5px] text-ink-3">Open-to-buy needs cost prices, which your access does not show.</div>
        )}
      </section>
    </div>
  );
}
