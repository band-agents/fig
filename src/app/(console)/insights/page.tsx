import Link from 'next/link';
import { requireUser, sendHome } from '@/lib/auth/session';
import { analytics } from '@/lib/analytics';
import { can, canSee } from '@/lib/domain/perms';
import { ORDER_STAGE, RETURN_REASONS, type OrderStage, type ReturnReason } from '@/lib/domain/stages';
import { money, num, pct } from '@/lib/format';
import { span } from '@/lib/domain/sla';
import { PageHeader, ChannelChip } from '@/components/ui/bits';
import { Heatmap, StackedDays } from '@/components/charts/charts';
import { BarList } from '@/components/charts/barlist';
import { Avatar } from '@/components/ui/avatar';
import { ExportButton } from '@/components/ui/export-button';
import { channelLabel } from '@/lib/channels';

export const metadata = { title: 'Insights' };

export default async function InsightsPage(props: PageProps<'/insights'>) {
  const me = await requireUser();
  if (!canSee(me, 'insights')) sendHome(me);
  const sp = await props.searchParams;
  const days = sp.days === '7' ? 7 : sp.days === '90' ? 90 : 30;
  const a = await analytics(me, days);
  const seesMoney = can(me, 'money', 1);
  const totalReturns = a.reasons.reduce((s, r) => s + r.n, 0);
  const STAGE_ORDER = ['confirming', 'finance', 'ready', 'picking', 'packed', 'shipped', 'delivering', 'delivered'];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="How the floor is running"
        sub="Volumes, speed at every hand-off, refusals and returns, from the same data the queues run on."
        right={
          <div className="flex gap-1 rounded-xl border border-line bg-elev p-1">
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`/insights?days=${d}`} className={`flex h-8 items-center rounded-lg px-3 text-[12.5px] ${days === d ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                {d} days
              </Link>
            ))}
          </div>
        }
      />

      <section className="panel p-5">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <div className="eyebrow mb-1">Volume</div>
            <h2 className="text-[14px] font-medium">Orders per day, by brand</h2>
          </div>
          <span className="font-mono text-[11.5px] text-ink-3">{num(a.byDay.reduce((s, d) => s + d.values.reduce((x, y) => x + y, 0), 0))} orders</span>
        </div>
        <StackedDays days={a.byDay} series={a.brands.map((name, i) => ({ name, color: `var(--s${i + 1})` }))} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="panel p-5">
          <div className="eyebrow mb-1">Speed</div>
          <h2 className="mb-1 text-[14px] font-medium">Average time at each hand-off</h2>
          <p className="mb-4 text-[11.5px] text-ink-3">Red means slower than the stage target. Autopilot clears some stages in seconds, which pulls their average down.</p>
          <BarList
            rows={STAGE_ORDER.map((s) => a.dwell.find((d) => d.stage === s))
              .filter(Boolean)
              .map((d) => ({
                label: ORDER_STAGE[d!.stage as OrderStage].label,
                value: d!.hours,
                sub: d!.target != null ? `target ${span(d!.target * 3600_000)}` : undefined,
                tone: d!.target != null && d!.hours > d!.target ? ('alert' as const) : undefined,
              }))}
            format={(v) => span(v * 3600_000)}
            color="var(--t-blue)"
          />
        </div>
        <div className="panel p-5">
          <div className="eyebrow mb-1">Rhythm</div>
          <h2 className="mb-4 text-[14px] font-medium">When customers order (Cairo time)</h2>
          <Heatmap grid={a.grid} rows={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']} />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="panel p-5" id="refusals">
          <div className="eyebrow mb-1">Refusals</div>
          <h2 className="mb-1 text-[14px] font-medium">Cash parcels refused at the door, by governorate</h2>
          <p className="mb-4 text-[11.5px] text-ink-3">Last 60 days, areas with at least 6 cash deliveries. The tick is the average ({pct(a.rtoBaseline, 1)}). Risk scoring uses these numbers.</p>
          <BarList rows={a.rto.map((r) => ({ label: r.region || 'Unknown', value: r.rate, sub: `${r.n} parcels`, tone: r.rate > a.rtoBaseline * 1.8 ? ('alert' as const) : undefined }))} format={(v) => pct(v, 0)} color="var(--t-amber)" max={Math.max(0.05, ...a.rto.map((r) => r.rate))} mark={{ value: a.rtoBaseline, label: 'average' }} />
        </div>
        <div className="panel p-5" id="returns">
          <div className="eyebrow mb-1">Returns</div>
          <h2 className="mb-4 text-[14px] font-medium">Why things come back</h2>
          <BarList rows={a.reasons.map((r) => ({ label: RETURN_REASONS[r.reason as ReturnReason] ?? r.reason, value: r.n, sub: totalReturns ? pct(r.n / totalReturns) : undefined }))} format={num} color="var(--t-rose)" />
          {a.products.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-[12.5px] font-medium">Most returned pieces</h3>
              <ul className="divide-y divide-[var(--line)]">
                {a.products.map((p) => (
                  <li key={p.title} className="flex items-center gap-3 py-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.image ? <img src={p.image} alt="" className="h-11 w-9 rounded-md object-cover" /> : <span className="h-11 w-9 rounded-md bg-elev-3" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px]">{p.title}</div>
                      <div className="text-[11px] text-ink-3">
                        {p.brand} · mostly {RETURN_REASONS[p.top_reason as ReturnReason]?.toLowerCase()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono text-[12.5px] ${p.back / Math.max(1, p.sold) >= 0.3 ? 'text-critical' : ''}`}>
                        {p.back}/{p.sold}
                      </div>
                      <div className="text-[10.5px] text-ink-4">back / sold</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="text-[14px] font-semibold">Storefronts · last {days} days</h2>
          <ExportButton
            quiet
            name={`storefronts-${days}-days`}
            sheets={[
              {
                name: 'Storefronts',
                columns: [
                  { key: 'store', label: 'Storefront' },
                  { key: 'n', label: 'Orders', kind: 'int' },
                  ...(seesMoney ? [{ key: 'currency', label: 'Currency' }, { key: 'revenue', label: 'Sales', kind: 'num' as const, decimals: 3 }, { key: 'aov', label: 'Average order', kind: 'num' as const, decimals: 3 }] : []),
                  { key: 'cod', label: 'Cash share', kind: 'pct' },
                  { key: 'rto', label: 'Refused', kind: 'pct' },
                  { key: 'ret', label: 'Returned', kind: 'pct' },
                  { key: 'ship', label: 'Hours order to shipped', kind: 'num', decimals: 1 },
                ],
                rows: a.channels.map((c) => ({
                  store: channelLabel(c.channel_id),
                  n: c.n,
                  currency: c.currency,
                  revenue: Number(c.revenue) / 10 ** (c.currency === 'KWD' || c.currency === 'JOD' ? 3 : 2),
                  aov: Math.round(c.aov) / 10 ** (c.currency === 'KWD' || c.currency === 'JOD' ? 3 : 2),
                  cod: c.n ? c.cod / c.n : null,
                  rto: c.rtoRate,
                  ret: c.returnRate,
                  ship: c.ship_h,
                })),
              },
            ]}
          />
        </header>
        <div className="scroll-thin overflow-x-auto">
          <table className="table text-[12.5px]">
            <thead>
              <tr>
                <th>Storefront</th>
                <th className="text-right">Orders</th>
                {seesMoney && <th className="text-right">Sales</th>}
                {seesMoney && <th className="text-right">Avg order</th>}
                <th className="text-right">Cash share</th>
                <th className="text-right">Refused</th>
                <th className="text-right">Returned</th>
                <th className="text-right">Order → shipped</th>
              </tr>
            </thead>
            <tbody>
              {a.channels.map((c) => (
                <tr key={c.channel_id}>
                  <td>
                    <ChannelChip id={c.channel_id} />
                  </td>
                  <td className="text-right font-mono">{num(c.n)}</td>
                  {seesMoney && <td className="whitespace-nowrap text-right font-mono">{money(Number(c.revenue), c.currency, { compact: true })}</td>}
                  {seesMoney && <td className="whitespace-nowrap text-right font-mono">{money(Math.round(c.aov), c.currency)}</td>}
                  <td className="text-right font-mono">{c.n ? pct(c.cod / c.n) : '—'}</td>
                  <td className={`text-right font-mono ${c.rtoRate && c.rtoRate > 0.1 ? 'text-critical' : ''}`}>{c.rtoRate == null ? '—' : pct(c.rtoRate, 1)}</td>
                  <td className="text-right font-mono">{c.returnRate == null ? '—' : pct(c.returnRate, 1)}</td>
                  <td className="text-right font-mono">{c.ship_h == null ? '—' : span(c.ship_h * 3600_000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {a.team.length > 0 && (
        <section className="panel p-5">
          <div className="eyebrow mb-1">The team</div>
          <h2 className="mb-4 text-[14px] font-medium">Who carried the baton this week</h2>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {a.team.map((t) => (
              <div key={t.name} className="flex items-center gap-3">
                <Avatar name={t.name} hue={t.hue ?? 200} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex justify-between text-[12.5px]">
                    <span>{t.name}</span>
                    <span className="font-mono text-ink-2">{num(t.n)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-elev-3">
                    <div className="h-full rounded-full bg-[var(--s1)]" style={{ width: `${(t.n / a.team[0].n) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
