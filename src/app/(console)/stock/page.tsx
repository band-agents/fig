import Link from 'next/link';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { viewCurrency } from '@/lib/stock/views/common';
import { level, canSee } from '@/lib/domain/perms';
import { stockBrief } from '@/lib/stock/views/brief';
import { CHANNELS, channelLabel } from '@/lib/channels';
import { ago, moneyIn, num, pct } from '@/lib/format';
import { Sparkline } from '@/components/charts/charts';
import { RangeMap, Ring, TrendChart } from '@/components/charts/stock-charts';
import { VELOCITY_COLOR } from '@/lib/domain/stock/classify';
import { RecBoard, RunPlannerButton } from '@/components/stock/rec-board';
import { PageHeader } from '@/components/ui/bits';
import { ExportButton } from '@/components/ui/export-button';
import type { Sheet } from '@/lib/sheet';
import { inView } from '@/lib/brands-sheets';
import { DemoNote } from '@/components/stock/bits';
import { CountUp } from '@/components/ui/count-up';

export const metadata = { title: 'Stock brief' };

export default async function StockBriefPage() {
  const me = await requireUser();
  const cur = viewCurrency(me);
  if (!canSee(me, 'stockBrief')) sendHome(me);
  const b = await stockBrief(me);
  const egp = (v: number | null) => (v == null ? '—' : moneyIn(v, cur, { compact: true }));
  const channelNames = Object.fromEntries(CHANNELS.map((c) => [c.id, channelLabel(c.id)]));
  const kpis = [
    { label: 'Stock at retail', value: egp(b.kpi.retail), note: b.kpi.cost != null ? `${egp(b.kpi.cost)} at cost · ${num(b.kpi.styles)} styles` : `${num(b.kpi.styles)} styles in stock`, hide: b.kpi.retail == null },
    { label: 'Pieces on hand', value: num(b.kpi.units), note: `${b.markets.length > 1 ? 'Egypt and Kuwait' : b.markets[0] === 'EG' ? 'Egypt' : 'Kuwait'}, warehouses and shops` },
    { label: 'Weeks of cover', value: b.kpi.cover == null ? '—' : b.kpi.cover >= 100 ? '99+' : b.kpi.cover.toFixed(1), note: b.kpi.cover != null && b.kpi.cover >= 100 ? 'at the forecast rate; website sales only until the shops join' : 'at the forecast rate, across the range' },
    { label: 'Sell-through', value: b.kpi.sellThrough == null ? '—' : b.kpi.sellThrough > 0 && b.kpi.sellThrough < 0.01 ? `${(b.kpi.sellThrough * 100).toFixed(1)}%` : pct(b.kpi.sellThrough), note: 'of what was available, last 8 weeks' },
    { label: 'Sales at risk', value: egp(b.kpi.atRisk), note: 'if nothing in the reorder plan is bought', alert: true, hide: b.kpi.atRisk == null },
    { label: 'Arriving in 30 days', value: num(b.kpi.inboundUnits), note: `${b.kpi.inboundPos} purchase orders${b.kpi.inboundValue != null ? ` · ${egp(b.kpi.inboundValue)} at cost` : ''}` },
  ].filter((k) => !k.hide);
  const pulse = (area: string) => b.pulse.find((p) => p.area === area);
  const moverSheet = (name: string, rows: typeof b.fast): Sheet => ({
    name,
    columns: [
      { key: 'title', label: 'Style' },
      { key: 'brand', label: 'Brand' },
      { key: 'market', label: 'Market' },
      { key: 'rate', label: 'Pieces a week', kind: 'num', decimals: 1 },
      { key: 'onHand', label: 'Pieces on hand', kind: 'int' },
      { key: 'cover', label: 'Weeks left', kind: 'num', decimals: 1 },
      ...(b.seesMoney ? [{ key: 'value', label: `Stock at retail (${cur})`, kind: 'num' as const, decimals: cur === 'KWD' ? 3 : 2 }] : []),
    ],
    rows: rows.map((p) => ({ title: p.title, brand: p.brand, market: p.market, rate: p.rate, onHand: p.onHand, cover: Number.isFinite(p.cover) ? p.cover : null, value: inView(p.value, cur) })),
  });
  const kpiSheet: Sheet = { name: 'Stock brief', columns: [{ key: 'label', label: 'Figure' }, { key: 'value', label: 'Value' }, { key: 'note', label: 'Note' }], rows: kpis.map((k) => ({ label: k.label, value: k.value, note: k.note })) };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock brief"
        sub={
          <>
            {num(b.points.length + b.kpi.deadStyles)} styles · warehouses, shops and websites
            {b.run ? <span suppressHydrationWarning>{` · plan read ${ago(b.run.at)}`}</span> : ''}
          </>
        }
        right={
          <>
            <RunPlannerButton />
            <ExportButton name="stock-brief" sheets={[kpiSheet, moverSheet('Fast movers', b.fast), moverSheet('Slow and stuck', b.slow)]} />
          </>
        }
      />

      <DemoNote />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="panel rise flex flex-col justify-between gap-2 p-4">
            <span className="text-[11.5px] text-ink-3">{k.label}</span>
            <div className={`font-display text-[20px] leading-none ${'alert' in k && k.alert ? 'text-critical' : ''}`}>{typeof k.value === 'string' ? <CountUp text={k.value} /> : k.value}</div>
            <div className="text-[11px] leading-snug text-ink-3">{k.note}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <div className="panel p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-semibold">Suggested actions</h2>
              <p className="mt-0.5 text-[11.5px] text-ink-3">{num(b.recs.length)} open · accept or set aside</p>
            </div>
            <div className="flex items-center gap-3 text-[11.5px] text-ink-3">
              {b.kpi.acceptance != null && <span>{pct(b.kpi.acceptance)} accepted in 30 days</span>}
              {b.kpi.decisionHours != null && <span>· decided in {b.kpi.decisionHours < 1 ? 'under an hour' : `${Math.round(b.kpi.decisionHours)}h`} on average</span>}
            </div>
          </div>
          <RecBoard recs={b.recs} publishLevel={level(me, 'merch')} channelNames={channelNames} columns={1} pageSize={5} />
        </div>

        <div className="space-y-6">
          <div className="panel p-5">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <h2 className="text-[14px] font-semibold">Pieces sold by week</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">26 weeks back, 12 weeks forecast</p>
              </div>
              <Link href="/stock/planning" className="text-[12px] text-ink-2 hover:text-ink">
                Planning →
              </Link>
            </div>
            <TrendChart points={b.curve} />
          </div>

          <div className="panel p-5">
            <div className="mb-1 flex items-end justify-between">
              <div>
                <h2 className="text-[14px] font-semibold">Pace against cover</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">Each dot a style · top left: buy · bottom right: clear</p>
              </div>
            </div>
            <RangeMap points={b.points} />
          </div>
          <div className="panel p-5">
            <h2 className="text-[14px] font-semibold">Next month: {b.nextMonth.name}</h2>
            <p className="mb-3 mt-0.5 text-[11.5px] text-ink-3">Expected pace against this month, by category</p>
            <ul className="space-y-2.5">
              {b.nextMonth.peaks.map((p) => (
                <li key={`${p.market}${p.category}`} className="flex items-center gap-3">
                  <span className="w-9 shrink-0 font-mono text-[11px] text-ink-4">{p.market}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{p.label}</span>
                  <div className="relative h-1.5 w-24 rounded-full bg-elev-3">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--s1)]" style={{ width: `${Math.min(100, (p.x / 2.2) * 100)}%` }} />
                    <span className="absolute -top-1 h-3.5 w-px bg-ink-3" style={{ left: `${(1 / 2.2) * 100}%` }} title="This month's pace" />
                  </div>
                  <span className={`w-12 text-right font-mono text-[12px] ${p.x >= 1.15 ? 'text-ink' : 'text-ink-3'}`}>{p.x.toFixed(1)}×</span>
                </li>
              ))}
            </ul>
            {b.nextMonth.events.length > 0 && (
              <div className="mt-4 space-y-1.5 border-t border-line pt-3">
                {b.nextMonth.events.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-[12px] text-ink-2">
                    <CalendarClock className="size-3.5 text-ink-4" />
                    <span className="truncate">{e.label}</span>
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-3">
                      {e.markets.join(' · ')} · {e.span}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Link href="/stock/planning" className="mt-4 inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink">
              Planning <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Movers title="Fast movers" rows={b.fast} kind="fast" money={b.seesMoney} cur={cur} sheet={moverSheet('Fast movers', b.fast)} />
        <Movers title="Slow and stuck" rows={b.slow} kind="slow" money={b.seesMoney} cur={cur} sheet={moverSheet('Slow and stuck', b.slow)} />
        <div className="panel p-5">
          <h2 className="mb-4 text-[14px] font-semibold">Where it sold, last 8 weeks</h2>
          <div className="space-y-4">
            {b.markets.map((m) => {
              const rows = b.split.filter((r) => r.market === m);
              const total = rows.reduce((a, r) => a + r.units, 0) || 1;
              return (
                <div key={m}>
                  <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
                    <span>{m === 'EG' ? 'Egypt' : 'Kuwait'}</span>
                    <span className="font-mono text-[11.5px] text-ink-3">{num(total)} pieces</span>
                  </div>
                  <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
                    {rows
                      .sort((a, b2) => (a.where < b2.where ? 1 : -1))
                      .map((r) => (
                        <span key={r.where} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(r.units / total) * 100}%`, background: r.where === 'Websites' ? 'var(--s1)' : 'var(--s6)' }} title={`${r.where}: ${num(r.units)} pieces`} />
                      ))}
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11.5px] text-ink-3">
                    {rows
                      .sort((a, b2) => (a.where < b2.where ? 1 : -1))
                      .map((r) => (
                        <span key={r.where} className="flex items-center gap-1.5">
                          <span className="size-2 rounded-sm" style={{ background: r.where === 'Websites' ? 'var(--s1)' : 'var(--s6)' }} />
                          {r.where} {pct(r.units / total)}
                          {b.seesMoney ? ` · ${moneyIn(r.revenue, cur, { compact: true })}` : ''}
                        </span>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 grid grid-cols-5 gap-2 border-t border-line pt-4">
            {b.velocityMix.map((v) => (
              <div key={v.v} className="text-center">
                <div className="mx-auto mb-1 size-2 rounded-full" style={{ background: VELOCITY_COLOR[v.v] }} />
                <div className="font-mono text-[14px]">{v.styles}</div>
                <div className="text-[11px] text-ink-3">{v.label}</div>
              </div>
            ))}
          </div>
        </div>

      </section>

      <section>
        <div className="panel p-5">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-[14px] font-semibold">The teams today</h2>
            </div>
            <Link href="/stock/team" className="text-[12px] text-ink-2 hover:text-ink">
              Team pulse →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { area: 'warehouse', label: 'Warehouse & shops', href: '/stock/warehouse' },
              { area: 'procurement', label: 'Buying', href: '/stock/purchasing' },
              { area: 'merch', label: 'Websites', href: '/stock/merch' },
            ].map((t) => {
              const x = pulse(t.area);
              const total = (x?.open ?? 0) + (x?.done_today ?? 0);
              return (
                <Link key={t.area} href={t.href} className="rounded-xl border border-line bg-elev-2/50 p-3.5 transition hover:border-line-2">
                  <Ring value={total ? (x?.done_today ?? 0) / total : null} size={48} stroke={5} />
                  <div className="mt-2.5 text-[12.5px] font-medium">{t.label}</div>
                  <div className="mt-0.5 text-[11.5px] text-ink-3">
                    {x?.done_today ?? 0} done today · {x?.open ?? 0} waiting
                  </div>
                  <div className="mt-1 flex gap-2 text-[11px]">
                    {x?.doing ? <span className="text-ink-2">{x.doing} in hand</span> : null}
                    {x?.late ? <span className="text-critical">{x.late} late</span> : null}
                    {x?.blocked ? <span className="text-[var(--warn)]">{x.blocked} blocked</span> : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function Movers({ title, rows, kind, money: seesMoney, cur, sheet }: { title: string; rows: Awaited<ReturnType<typeof stockBrief>>['fast']; kind: 'fast' | 'slow'; money: boolean; cur: string; sheet: Sheet }) {
  return (
    <div className="panel p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          <ExportButton name={title} sheets={[sheet]} quiet />
          <Link href={`/brands/movers?pace=${kind === 'fast' ? 'fast' : 'slow'}`} className="text-[12px] text-ink-2 hover:text-ink">
            All →
          </Link>
        </div>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {rows.map((p) => (
          <li key={p.id}>
            <Link href={`/stock/inventory/${p.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-elev-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.image ? <img src={p.image} alt="" className="h-11 w-9 shrink-0 rounded-md object-cover" /> : <span className="h-11 w-9 shrink-0 rounded-md bg-elev-3" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px]">{p.title}</div>
                <div className="truncate text-[11px] text-ink-3">
                  {p.brand} · {p.market} · {kind === 'fast' ? `${p.rate.toFixed(p.rate < 10 ? 1 : 0)}/wk` : seesMoney ? moneyIn(p.value, cur, { compact: true }) : `${num(p.onHand)} pcs`}
                </div>
              </div>
              <div className="w-16">
                <Sparkline data={p.spark} color={kind === 'fast' ? 'var(--s3)' : 'var(--s4)'} height={24} />
              </div>
              <div className="w-14 text-right">
                <div className={`font-mono text-[12px] ${kind === 'fast' && p.cover < 4 ? 'text-critical' : ''}`}>{Number.isFinite(p.cover) ? (p.cover >= 100 ? '99+' : p.cover.toFixed(1)) : '∞'}</div>
                <div className="text-[10px] text-ink-4">wks left</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
