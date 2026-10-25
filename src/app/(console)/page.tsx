import Link from 'next/link';
import { ArrowRight, ArrowUpRight, CheckCircle2, Store, Truck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { commandCentre } from '@/lib/dashboard';
import { feedFor } from '@/lib/feed';
import { queueBadges } from '@/lib/queries';
import { brandsOverview } from '@/lib/brands';
import { can, canSee, landingFor } from '@/lib/domain/perms';
import { viewCurrency } from '@/lib/stock/views/common';
import { money, moneyIn, num, pct } from '@/lib/format';
import { NAV } from '@/components/shell/nav';
import { RelayFlow } from '@/components/dashboard/relay-flow';
import { ActivityFeed } from '@/components/dashboard/activity';
import { HourArea, Sparkline } from '@/components/charts/charts';
import { Gauge, MiniBars } from '@/components/charts/look';
import { BarList } from '@/components/charts/barlist';
import { ChannelChip } from '@/components/ui/bits';
import { CountUp } from '@/components/ui/count-up';
import { ByMeasure, MeasureToggle } from '@/components/ui/measure';
import { ExportButton } from '@/components/ui/export-button';

export const metadata = { title: 'Command centre' };

export default async function CommandCentre() {
  const me = await requireUser();
  // the whole floor is for the people who run it; everyone else starts on their own work
  if (!canSee(me, 'home')) {
    const to = landingFor(me);
    if (to && to !== '/') redirect(to);
    return <NoPages />;
  }
  const seesBrands = canSee(me, 'brands');
  const [d, feed, badges, brands] = await Promise.all([commandCentre(me), feedFor(me, 22), queueBadges(me), seesBrands ? brandsOverview(me, 4) : Promise.resolve(null)]);
  const first = me.name.split(' ')[0];
  const seesMoney = can(me, 'money', 1);
  const cur = viewCurrency(me);
  const delta = (a: number, b: number) => (b ? (a - b) / b : null);
  const usualNow = Math.round(d.hourly.usual.slice(0, d.hourly.nowHour + 1).reduce((a, v) => a + v, 0));
  const ordersDelta = delta(d.kpi.today, d.kpi.yday);
  // the work waiting in every queue this person can open: the same counts as the menu and the bell
  const queues = NAV.flatMap((g) => g.items)
    .filter((i) => i.badge && canSee(me, i.page))
    .map((i) => ({ ...i, n: badges[i.badge!]?.n ?? 0, late: badges[i.badge!]?.late ?? 0 }));
  const gaps = brands?.rows.reduce((a, r) => a + (r.web ? r.web.soldOutLive + r.web.stockNotLive + r.web.noPhoto : 0), 0) ?? 0;
  const top = brands?.rows.filter((r) => r.units > 0).slice(0, 6) ?? [];

  return (
    <div className="space-y-4">
      <header data-page-header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.4px] sm:text-[23px]">Hey, {first}!</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {num(d.kpi.inflight)} in motion · {num(d.kpi.late)} late · {num(d.kpi.today)} orders today
          </p>
        </div>
        <MeasureToggle money={seesMoney} />
      </header>

      {/* the four figures of the day; the last one is the live, filled card */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <div className="panel flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="min-w-0">
            <div className="text-[12px] text-ink-3">Sales today</div>
            <div className="mt-1 text-[19px] font-semibold tracking-tight sm:text-[22px]">
              <ByMeasure value={seesMoney ? <CountUp text={moneyIn(Math.round(d.kpi.revenueToday * 100), cur, { compact: true })} /> : undefined} units={<CountUp text={`${num(d.kpi.piecesToday)} pcs`} />} />
            </div>
            <div className="text-[11px] text-ink-3">
              <ByMeasure value={seesMoney ? `yesterday by now ${moneyIn(Math.round(d.kpi.revenueYday * 100), cur, { compact: true })}` : undefined} units={`yesterday by now ${num(d.kpi.piecesYday)} pcs`} />
            </div>
          </div>
          <MiniBars data={seesMoney ? d.spark.revenue.slice(-7) : d.spark.orders.slice(-7)} />
        </div>
        <Figure icon={Truck} label="In motion" value={num(d.kpi.inflight)} note={d.kpi.late ? `${d.kpi.late} past target` : 'all on time'} alert={d.kpi.late > 0} />
        <Figure icon={CheckCircle2} label="Shipped on time" value={d.kpi.onTime == null ? '—' : pct(d.kpi.onTime)} note="last 7 days" spark={null} />
        <div className="sage-card relative overflow-hidden p-4 sm:p-5">
          <div className="flex items-center gap-2 text-[12px] text-white/85">
            Orders today
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10.5px] font-medium">
              <span className="size-1.5 rounded-full bg-white" /> Live
            </span>
          </div>
          <div className="mt-1 flex flex-col justify-between gap-2 sm:flex-row sm:items-end sm:gap-3">
            <div>
              <div className="text-[19px] font-semibold tracking-tight sm:text-[22px]">
                <CountUp text={num(d.kpi.today)} />
              </div>
              <div className="text-[11px] text-white/75">{ordersDelta == null ? `vs ${num(d.kpi.yday)} yesterday` : `${ordersDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(ordersDelta * 100))}% on yesterday by now`}</div>
            </div>
            <div className="w-full sm:w-[96px]">
              <Sparkline data={d.spark.orders} color="#ffffff" height={36} fill={false} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[2fr_1fr_1fr]">
        <div className="panel p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold">Orders coming in</h2>
            <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
              <CheckCircle2 className="size-3.5" /> {num(d.kpi.today)} today · usual by now {num(usualNow)}
            </span>
            {canSee(me, 'insights') && (
              <Link href="/insights" className="ml-auto rounded-full bg-elev-2 px-3 py-1 text-[11.5px] text-ink-2 hover:text-ink">
                Insights
              </Link>
            )}
          </div>
          <div className="mt-2">
            <HourArea today={d.hourly.today} usual={d.hourly.usual} nowHour={d.hourly.nowHour} />
          </div>
        </div>

        <div className="panel flex flex-col p-5">
          <h2 className="text-[14px] font-semibold">Cash refused at the door</h2>
          <div className="mt-1 text-[11.5px] text-ink-3">Cash parcels refused, last 30 days</div>
          <div className="mt-auto flex flex-col items-center pt-4">
            <Gauge value={d.kpi.refusal} label="Refused share" />
            <div className="mt-2 grid w-full grid-cols-2 gap-2 text-center">
              <div className="chip-box py-2">
                <div className="text-[10.5px] text-ink-3">Return rate</div>
                <div className="text-[13px] font-semibold">{d.kpi.returnRate == null ? '—' : pct(d.kpi.returnRate, 1)}</div>
              </div>
              <div className="chip-box py-2">
                <div className="text-[10.5px] text-ink-3">Coming back</div>
                <div className="text-[13px] font-semibold">{num(d.exceptions.rto)}</div>
              </div>
            </div>
          </div>
        </div>

        {brands ? (
          <div className="panel flex flex-col p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold">Top brands</h2>
              <span className="text-[11.5px] text-ink-3">last 4 weeks</span>
            </div>
            <div className="mt-3 flex-1">
              {top.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">No sales in the last 4 weeks.</p>
              ) : (
                <ByMeasure
                  value={seesMoney ? <BarList rows={[...top].sort((a, b) => b.value - a.value).map((r) => ({ label: <Link href={`/brands/${encodeURIComponent(r.brand)}?weeks=4`} className="hover:underline">{r.brand}</Link>, value: r.value }))} format={(v) => moneyIn(v, brands.currency, { compact: true })} /> : undefined}
                  units={<BarList rows={[...top].sort((a, b) => b.units - a.units).map((r) => ({ label: <Link href={`/brands/${encodeURIComponent(r.brand)}?weeks=4`} className="hover:underline">{r.brand}</Link>, value: r.units }))} format={(v) => `${num(v)} pcs`} color="var(--s3)" />}
                />
              )}
            </div>
            <Link href="/brands?weeks=4" className="mt-3 inline-flex items-center gap-1 self-start text-[12px] text-ink-2 hover:text-ink">
              Every brand <ArrowRight className="size-3.5" />
            </Link>
          </div>
        ) : (
          <Storefronts d={d} seesMoney={seesMoney} me={me} />
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[2fr_1fr_1fr]">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-[14px] font-semibold">Needs action</h2>
            <ExportButton
              quiet
              name="needs-action"
              sheets={[{ name: 'Needs action', columns: [{ key: 'label', label: 'Queue' }, { key: 'n', label: 'Waiting', kind: 'int' }, { key: 'late', label: 'Late', kind: 'int' }], rows: [...queues.map((q) => ({ label: q.label, n: q.n, late: q.late })), ...(brands ? [{ label: 'Website gaps', n: gaps, late: null }] : [])] }]}
            />
          </div>
          <table className="table text-[12.5px]">
            <thead>
              <tr>
                <th>Queue</th>
                <th className="text-right">Waiting</th>
                <th className="text-right">Late</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => {
                const Icon = q.icon;
                return (
                  <tr key={q.href}>
                    <td>
                      <span className="flex items-center gap-2.5">
                        <span className="grid size-7 place-items-center rounded-full bg-elev-2">
                          <Icon className="size-3.5 text-ink-2" strokeWidth={1.8} />
                        </span>
                        {q.label}
                      </span>
                    </td>
                    <td className="text-right font-mono">{num(q.n)}</td>
                    <td className={`text-right font-mono ${q.late ? 'font-semibold text-critical' : 'text-ink-4'}`}>{q.late ? num(q.late) : '—'}</td>
                    <td className="w-10 text-right">
                      <Link href={q.href} className="inline-grid size-7 place-items-center rounded-full text-ink-3 hover:bg-elev-2 hover:text-ink" aria-label={`Open ${q.label}`}>
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {brands && canSee(me, 'webItems') && (
                <tr>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <span className="grid size-7 place-items-center rounded-full bg-elev-2">
                        <Store className="size-3.5 text-ink-2" strokeWidth={1.8} />
                      </span>
                      Website gaps
                      <span className="text-[11px] text-ink-3">sold out live · stock not live · no photo</span>
                    </span>
                  </td>
                  <td className="text-right font-mono">{num(gaps)}</td>
                  <td className="text-right text-ink-4">—</td>
                  <td className="w-10 text-right">
                    <Link href="/stock/web-items" className="inline-grid size-7 place-items-center rounded-full text-ink-3 hover:bg-elev-2 hover:text-ink" aria-label="Open Website vs Lucida">
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="panel flex max-h-[520px] flex-col">
          <div className="flex items-center justify-between px-5 pb-1 pt-4">
            <h2 className="text-[14px] font-semibold">On the floor</h2>
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <span className="live-dot" /> live
            </span>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-3 py-2">
            <ActivityFeed rows={feed} />
          </div>
        </div>
        {brands ? <Storefronts d={d} seesMoney={seesMoney} me={me} /> : <div className="hidden xl:block" />}
      </section>

      <RelayFlow lanes={d.lanes} exceptions={d.exceptions} canOpen={{ care: can(me, 'intake', 1), finance: can(me, 'finance', 1), fulfilment: can(me, 'fulfilment', 1), shipping: can(me, 'shipping', 1), cash: can(me, 'finance', 1) && can(me, 'money', 2) }} />
    </div>
  );
}

function Storefronts({ d, seesMoney, me }: { d: Awaited<ReturnType<typeof commandCentre>>; seesMoney: boolean; me: Parameters<typeof can>[0] }) {
  const shown = d.channels.filter((c) => c.mode !== 'off' || c.n > 0);
  return (
    <div className="panel flex flex-col p-5">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-full bg-elev-2">
          <Store className="size-4 text-ink-2" strokeWidth={1.8} />
        </span>
        <h2 className="text-[14px] font-semibold">Storefronts today</h2>
      </div>
      <ul className="mt-3 divide-y divide-[var(--line)]">
        {shown.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <ChannelChip id={c.id} />
            <span className={`ml-auto text-[11px] ${c.mode === 'live' ? 'text-good' : 'text-ink-4'}`}>{c.mode === 'live' ? '● live' : c.mode === 'demo' ? 'demo' : 'off'}</span>
            <span className="w-8 text-right text-[12px] font-medium tabular">{c.n}</span>
            {seesMoney && <span className="hidden w-20 text-right text-[11.5px] text-ink-3 tabular sm:block">{c.total ? money(c.total, c.currency, { compact: true }) : '—'}</span>}
          </li>
        ))}
        {shown.length === 0 && <li className="py-2 text-[12.5px] text-ink-3">No store connected yet.</li>}
      </ul>
      {can(me, 'channels', 1) && (
        <Link href="/channels" className="btn btn-sage btn-sm mt-auto self-center">
          Channels <ArrowUpRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function Figure({ icon: Icon, label, value, note, spark, alert = false }: { icon: typeof Truck; label: string; value: string; note?: string; spark?: number[] | null; alert?: boolean }) {
  return (
    <div className="panel flex flex-col items-start gap-2.5 p-4 sm:flex-row sm:items-center sm:gap-3.5 sm:p-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-elev-2 sm:size-11">
        <Icon className="size-[18px] text-ink-2" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-ink-3">{label}</div>
        <div className="mt-0.5 text-[19px] font-semibold leading-tight tracking-tight sm:text-[22px]">
          <CountUp text={value} />
        </div>
        {note && <div className={`truncate text-[11px] ${alert ? 'text-critical' : 'text-ink-3'}`}>{note}</div>}
      </div>
      {spark && (
        <div className="hidden w-[84px] sm:block">
          <Sparkline data={spark} color="var(--s1)" height={30} fill={false} />
        </div>
      )}
    </div>
  );
}

function NoPages() {
  return (
    <div className="panel mx-auto mt-16 max-w-md p-8 text-center">
      <h1 className="text-[16px]">No pages yet</h1>
      <p className="mt-2 text-[12.5px] text-ink-2">Your account is signed in but has no access to any page. Ask an admin to set your job under Team &amp; access.</p>
    </div>
  );
}

