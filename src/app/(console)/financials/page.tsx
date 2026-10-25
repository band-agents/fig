import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee, READ_ONLY_ROLES, worksOrders } from '@/lib/domain/perms';
import { financials, PERIODS } from '@/lib/financials';
import { moneyIn, num, pct } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { BarList } from '@/components/charts/barlist';
import { MoneyMonths } from '@/components/finance/money-months';
import { ByMeasure, MeasureToggle } from '@/components/ui/measure';
import { ExportButton } from '@/components/ui/export-button';
import { DemoNote } from '@/components/stock/bits';
import { ShippingCalculator } from '@/components/finance/shipping-tools';
import { CourierCompare } from '@/components/finance/courier-compare';
import { CHANNEL } from '@/lib/channels';
import { gmtcConfigured } from '@/lib/connectors';
import { CountUp } from '@/components/ui/count-up';

export const metadata = { title: 'Finance & analysis' };

const MARKET_LABEL: Record<string, string> = { EG: 'Egypt', KW: 'Kuwait' };
const fmtWeek = (k: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${k}T00:00:00Z`));

export default async function FinancialsPage(props: PageProps<'/financials'>) {
  const me = await requireUser();
  if (!canSee(me, 'financials')) sendHome(me);
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const d = await financials(me, { period: str('period'), market: str('market') });
  const cur = d.currency;
  const m = (v: number | null) => (v == null ? '—' : moneyIn(v, cur, { compact: true }));
  const full = (v: number) => moneyIn(v, cur);
  const market = d.markets.length === 1 && d.allowed.length > 1 ? d.markets[0] : undefined;
  const qs = (o: { period?: string; market?: string }) => {
    const q = new URLSearchParams();
    const period = o.period ?? d.period;
    const mk = 'market' in o ? o.market : market;
    if (period !== 'mtd') q.set('period', period);
    if (mk) q.set('market', mk);
    const s = q.toString();
    return `/financials${s ? `?${s}` : ''}`;
  };
  const periodLabel = PERIODS.find((p) => p.key === d.period)?.label ?? '';
  const k = d.kpi;
  const c = d.cash;
  const sh = d.shipping;
  const canEditRates = (can(me, 'finance', 2) || can(me, 'settings', 2)) && !me.previewing && !READ_ONLY_ROLES.includes(me.role);
  // cash with the couriers, refunds to pay, shipping costs and ship-from are the order floor's; others read the selling and the margin
  const floor = worksOrders(me);

  const kpis = [
    { label: 'Net sales', value: m(k.netSales), delta: k.netSalesChange, note: k.netSalesVsLy == null ? 'websites and shops' : `${k.netSalesVsLy >= 0 ? '+' : '−'}${pct(Math.abs(k.netSalesVsLy))} on last year` },
    { label: 'Gross margin', value: m(k.grossMargin), delta: null, note: k.marginPct == null ? 'sales less cost of goods' : `${pct(k.marginPct)} of sales${k.marginPctBefore != null ? ` · was ${pct(k.marginPctBefore)}` : ''}` },
    { label: 'Pieces sold', value: num(k.units), delta: k.unitsChange, note: k.mdShare == null ? '' : `${pct(k.mdShare)} sold on markdown` },
    { label: 'Online orders', value: num(k.orders), delta: k.ordersChange, note: k.aov == null ? 'websites and apps' : `${m(k.aov)} average order` },
    { label: 'Refunds paid', value: m(k.refunded), delta: null, note: `${num(k.refundsCount)} return${k.refundsCount === 1 ? '' : 's'} refunded` },
    { label: 'Discounts given', value: m(k.discounts), delta: null, note: `${m(k.shipping)} shipping charged` },
  ];

  const cash = [
    { label: 'Paid online this period', value: k.paidOnline, note: 'card, KNET, wallets' },
    { label: 'With the courier', floor: true, value: c.withCourier, note: `${num(c.withCourierCount)} cash parcels collected, not yet remitted` },
    { label: 'Still to collect', floor: true, value: c.toCollect, note: `${num(c.toCollectCount)} cash parcels on their way` },
    { label: 'Refunds owed', floor: true, value: c.refundsOwed, note: `${num(c.refundsOwedCount)} waiting for finance`, out: true },
    { label: 'Owed to suppliers', value: c.supplierOpen, note: `${m(c.supplierDue30)} lands in the next 30 days`, out: true },
    { label: 'Stock at cost', value: c.stockCost, note: `${m(c.stockRetail)} at retail` },
  ].filter((x) => floor || !('floor' in x));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Business"
        title="Finance & analysis"
        sub="Sales, profit and cash across every store and website: what came in, what it cost, and what is still owed both ways."
        right={
          <>
            <MeasureToggle />
            <ExportButton name={`finance-${d.period}`} href={`/financials/export${qs({}).replace('/financials', '')}`} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {PERIODS.map((p) => (
            <Link key={p.key} href={qs({ period: p.key })} className={`flex h-8 shrink-0 items-center rounded-lg px-3 text-[12.5px] transition ${d.period === p.key ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
              {p.label}
            </Link>
          ))}
        </div>
        {d.allowed.length > 1 && (
          <div className="ml-auto flex gap-1">
            {[undefined, ...d.allowed].map((x) => (
              <Link key={x ?? 'all'} href={qs({ market: x })} className={`flex h-8 items-center rounded-lg px-3 text-[12.5px] transition ${market === x ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                {x ? MARKET_LABEL[x] : 'All markets'}
              </Link>
            ))}
          </div>
        )}
      </div>

      <DemoNote />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((x) => (
          <div key={x.label} className="panel flex flex-col gap-1.5 p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] text-ink-3">{x.label}</span>
              {x.delta != null && (
                <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${x.delta >= 0 ? 'text-good' : 'text-critical'}`}>
                  {x.delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                  {pct(Math.abs(x.delta))}
                </span>
              )}
            </div>
            <div className={`font-display text-[20px] leading-tight tabular ${'alert' in x && x.alert ? 'text-critical' : ''}`}>{typeof x.value === 'string' ? <CountUp text={x.value} /> : x.value}</div>
            <div className="truncate text-[11.5px] text-ink-3" title={x.note}>
              {x.note}
            </div>
          </div>
        ))}
      </section>
      <p className="-mt-2 text-[11.5px] text-ink-4">
        {periodLabel} · {d.markets.map((x) => MARKET_LABEL[x]).join(' and ')} · {cur === 'EGP' && d.markets.length > 1 ? 'EGP equivalent' : cur} · sales and margin by whole week ({d.weeks.count} week{d.weeks.count === 1 ? '' : 's'} from {fmtWeek(d.weeks.from)}), against as many weeks before; orders and refunds by day
      </p>

      <section className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <div className="panel p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-semibold">Sales by month</h2>
              <p className="mt-0.5 text-[11.5px] text-ink-3">Twelve months, this year against last</p>
            </div>
            <MeasureToggle />
          </div>
          <div className="mt-4">
            <MoneyMonths months={d.months} currency={cur} />
          </div>
        </div>
        <div className="panel p-5">
          <div className="eyebrow">Today</div>
          <h2 className="mt-0.5 text-[14px]">Where the cash is</h2>
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {cash.map((x) => (
              <li key={x.label} className="flex items-baseline justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12.5px]">{x.label}</div>
                  <div className="truncate text-[11.5px] text-ink-3">{x.note}</div>
                </div>
                <span className={`shrink-0 font-mono text-[13px] font-medium ${x.out ? 'text-ink-2' : ''}`}>
                  {x.out && x.value > 0 ? '−' : ''}
                  {m(x.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <div className="panel overflow-hidden">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="text-[14px]">Margin by brand</h2>
            <p className="mt-0.5 text-[11.5px] text-ink-3">{periodLabel}, websites and shops together. Cost is each style’s cost price.</p>
          </div>
          {d.brands.length === 0 ? (
            <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">No sales in this period yet.</p>
          ) : (
            <div className="scroll-thin max-h-[440px] overflow-auto">
              <table className="table text-[12.5px]">
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th className="text-right">Net sales</th>
                    <th className="text-right">Share</th>
                    <th className="text-right">Pieces</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Margin</th>
                    <th className="text-right">On markdown</th>
                  </tr>
                </thead>
                <tbody>
                  {d.brands.map((b) => (
                    <tr key={b.brand}>
                      <td className="font-medium">{b.brand}</td>
                      <td className="text-right font-mono">{m(b.revenue)}</td>
                      <td className="text-right font-mono text-ink-3">{pct(b.share)}</td>
                      <td className="text-right font-mono">{num(b.units)}</td>
                      <td className="text-right font-mono text-ink-3">{m(b.cost)}</td>
                      <td className="text-right">
                        <span className="font-mono">{m(b.margin)}</span>
                        {b.marginPct != null && (
                          <span className="pill ml-2" data-tone={b.marginPct >= 0.5 ? 'success' : b.marginPct >= 0.35 ? 'neutral' : 'warning'}>
                            {pct(b.marginPct)}
                          </span>
                        )}
                      </td>
                      <td className="text-right font-mono text-ink-3">{b.mdShare == null ? '—' : pct(b.mdShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="space-y-5">
          <div className="panel p-5">
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-semibold">Where sales came from</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">Shops and the websites, {periodLabel.toLowerCase()}</p>
              </div>
              <MeasureToggle />
            </div>
            {d.places.length ? (
              <ByMeasure
                value={<BarList rows={[...d.places].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((x) => ({ label: x.label, value: x.revenue, sub: `${num(x.units)} pcs` }))} format={(v) => m(v)} />}
                units={<BarList rows={[...d.places].sort((a, b) => b.units - a.units).slice(0, 8).map((x) => ({ label: x.label, value: x.units, sub: m(x.revenue) }))} format={(v) => `${num(v)} pcs`} color="var(--s3)" />}
              />
            ) : (
              <p className="text-[12.5px] text-ink-3">No sales yet.</p>
            )}
          </div>
          <div className="panel p-5">
            <h2 className="text-[14px]">Online stores</h2>
            <p className="mb-4 mt-0.5 text-[11.5px] text-ink-3">Orders placed, {periodLabel.toLowerCase()}</p>
            {d.channels.length ? <BarList rows={d.channels.map((x) => ({ label: x.label, value: x.total, sub: `${num(x.count)} orders` }))} format={(v) => m(v)} color="var(--s2)" /> : <p className="text-[12.5px] text-ink-3">No online orders in this period.</p>}
            {floor && k.refused > 0 && <p className="mt-3 text-[11.5px] text-ink-3">{m(k.refused)} of cash orders were refused at the door.</p>}
          </div>
          {floor && (
            <div className="panel p-5">
              <h2 className="text-[14px]">Where orders shipped from</h2>
              <p className="mb-4 mt-0.5 text-[11.5px] text-ink-3">The branch each online order left from, {periodLabel.toLowerCase()}, as set on the order</p>
              {d.shipFrom.some((x) => !x.unset) ? (
                <BarList rows={d.shipFrom.map((x) => ({ label: x.label, value: x.orders, sub: m(x.total) }))} format={(v) => `${num(v)} orders`} color="var(--s3)" />
              ) : (
                <p className="text-[12.5px] text-ink-3">No branch recorded yet: it is set on each order under Ships from{d.shipFrom[0] ? ` (${num(d.shipFrom[0].orders)} orders without one)` : ''}.</p>
              )}
            </div>
          )}
        </div>
      </section>

      {floor && (
        <section className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
          <div className="panel overflow-hidden">
            <div className="border-b border-line px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14px]">Shipping we pay</h2>
                {sh.placeholder && (
                  <span className="pill" data-tone="attention">
                    <span className="dot" />
                    Placeholder rates
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11.5px] text-ink-3">
                Every parcel that left the warehouse {periodLabel.toLowerCase()}, priced on the courier’s rate card, against what customers paid us for delivery.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-4">
              {[
                { label: 'We paid couriers', value: m(sh.cost), note: `${num(sh.parcels)} parcel${sh.parcels === 1 ? '' : 's'}${sh.returns.cost ? ' + return pickups' : ''}` },
                { label: 'Customers paid us', value: m(sh.charged), note: 'delivery charged on orders' },
                { label: sh.net >= 0 ? 'Shipping covered' : 'Shipping we absorb', value: m(Math.abs(sh.net)), note: sh.cost ? `${pct(Math.min(1, sh.charged / sh.cost))} of the cost recovered` : '—', alert: sh.net < 0 },
                { label: 'Per parcel', value: m(sh.perParcel), note: sh.codFees ? `${m(sh.codFees)} of it cash-collection fees` : 'all in' },
              ].map((x) => (
                <div key={x.label} className="bg-elev px-4 py-3.5">
                  <div className="text-[11.5px] text-ink-3">{x.label}</div>
                  <div className={`font-display text-[18px] leading-tight tabular ${x.alert ? 'text-critical' : ''}`}>{typeof x.value === 'string' ? <CountUp text={x.value} /> : x.value}</div>
                  <div className="truncate text-[11px] text-ink-3">{x.note}</div>
                </div>
              ))}
            </div>
            {sh.byCourier.length === 0 ? (
              <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">No parcels left the warehouse in this period.</p>
            ) : (
              <div className="grid gap-0 lg:grid-cols-2">
                <table className="table text-[12.5px]">
                  <thead>
                    <tr>
                      <th>Courier</th>
                      <th className="text-right">Parcels</th>
                      <th className="text-right">Cost</th>
                      <th className="text-right">Charged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sh.byCourier.map((x) => (
                      <tr key={`${x.market}:${x.courier}`}>
                        <td>
                          <div className="font-medium">{x.courier}</div>
                          <div className="text-[11px] text-ink-3">
                            {MARKET_LABEL[x.market]}
                            {x.refused ? ` · ${num(x.refused)} refused` : ''}
                          </div>
                        </td>
                        <td className="text-right font-mono">{num(x.parcels)}</td>
                        <td className="text-right font-mono">{m(x.cost)}</td>
                        <td className="text-right font-mono text-ink-3">{m(x.charged)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="table text-[12.5px] lg:border-l lg:border-line">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      <th className="text-right">Parcels</th>
                      <th className="text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sh.byZone.map((x) => (
                      <tr key={`${x.market}:${x.zone}`}>
                        <td>{x.zone}</td>
                        <td className="text-right font-mono">{num(x.parcels)}</td>
                        <td className="text-right font-mono">{m(x.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(sh.refused > 0 || sh.returns.cost > 0) && (
              <p className="border-t border-line px-5 py-3 text-[11.5px] text-ink-3">
                {sh.refused > 0 && <>Refused parcels cost {m(sh.refusedCost)} across {num(sh.refused)} trips out and back. </>}
                {sh.returns.cost > 0 && (
                  <>
                    Return pickups we pay for: {m(sh.returns.cost)} ({num(sh.returns.ours)} agreed by the desk{sh.returns.unreviewed ? `, ${num(sh.returns.unreviewed)} decided before reviews, counted as ours` : ''}).
                  </>
                )}
              </p>
            )}
          </div>
          <ShippingCalculator rates={sh.rates} canEdit={canEditRates} />
        </section>
      )}

      {floor && me.channels.some((c) => CHANNEL[c]?.country === 'KW') && <CourierCompare ups={gmtcConfigured('KW')} />}

      <section className={floor ? 'grid gap-5 lg:grid-cols-2' : 'grid gap-5'}>
        <div className="panel overflow-hidden">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="text-[14px]">Owed to suppliers</h2>
            <p className="mt-0.5 text-[11.5px] text-ink-3">Approved purchase orders not yet received, at cost</p>
          </div>
          {d.payables.length === 0 ? (
            <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">Nothing open with suppliers.</p>
          ) : (
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Terms</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Next 30 days</th>
                  <th className="text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {d.payables.map((x, i) => (
                  <tr key={`${x.supplier}:${i}`}>
                    <td className="font-medium">{x.supplier}</td>
                    <td className="text-ink-3">{x.terms ?? '—'}</td>
                    <td className="text-right font-mono">{x.orders}</td>
                    <td className="text-right font-mono">{x.due30 ? m(x.due30) : '—'}</td>
                    <td className="text-right font-mono font-medium">{m(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {floor && (
          <div className="panel overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
              <div>
                <h2 className="text-[14px]">Courier cash to receive</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">Remittances not yet matched to the bank</p>
              </div>
              <Link href="/finance" className="text-[12px] text-ink-2 hover:text-ink hover:underline">
                Cash & refunds →
              </Link>
            </div>
            {d.settlements.length === 0 ? (
              <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">Every remittance is matched.</p>
            ) : (
              <table className="table text-[12.5px]">
                <thead>
                  <tr>
                    <th>Remittance</th>
                    <th>Status</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Expected</th>
                  </tr>
                </thead>
                <tbody>
                  {d.settlements.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <div className="font-medium">{x.courier}</div>
                        <div className="font-mono text-[11px] text-ink-3">{x.reference}</div>
                      </td>
                      <td>
                        <span className="pill" data-tone={x.status === 'discrepancy' ? 'critical' : 'warning'}>
                          <span className="dot" />
                          {x.status === 'discrepancy' ? `Short ${x.gap != null ? full(x.gap) : ''}` : 'Waiting'}
                        </span>
                      </td>
                      <td className="text-right font-mono">{x.orders}</td>
                      <td className="text-right font-mono font-medium">{m(x.expected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
