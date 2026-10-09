import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { commandCentre } from '@/lib/dashboard';
import { insightsFor } from '@/lib/insights';
import { feedFor } from '@/lib/feed';
import { can } from '@/lib/domain/perms';
import { greeting, money, num, pct } from '@/lib/format';
import { RelayFlow } from '@/components/dashboard/relay-flow';
import { InsightCards } from '@/components/dashboard/insight-cards';
import { ActivityFeed } from '@/components/dashboard/activity';
import { HourArea, Sparkline } from '@/components/charts/charts';
import { ChannelChip } from '@/components/ui/bits';
import { AskButton } from '@/components/dashboard/ask-button';

export const metadata = { title: 'Command centre' };

export default async function CommandCentre() {
  const me = await requireUser();
  const [d, insights, feed] = await Promise.all([commandCentre(me), insightsFor(me), feedFor(me, 22)]);
  const first = me.name.split(' ')[0];
  const seesMoney = can(me, 'money', 1);
  const attention = insights.filter((i) => i.severity === 'critical' || i.severity === 'warn').length;
  const dateLine = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' }).format(new Date());

  const delta = (a: number, b: number) => (b ? (a - b) / b : null);
  const kpis = [
    { label: 'Orders today', value: num(d.kpi.today), delta: delta(d.kpi.today, d.kpi.yday), note: `vs ${num(d.kpi.yday)} by now yesterday`, spark: d.spark.orders, color: 'var(--s1)' },
    ...(seesMoney
      ? [{ label: 'Sales today', value: money(Math.round(d.kpi.revenueToday) * 100, 'EGP', { compact: true }), delta: delta(d.kpi.revenueToday, d.kpi.revenueYday), note: d.kpi.byCurrency.filter((c) => c.currency !== 'EGP' && c.today).map((c) => `incl. ${money(c.today, c.currency)}`).join(' · ') || 'EGP equivalent, all stores', spark: d.spark.revenue, color: 'var(--s3)' }]
      : []),
    { label: 'In motion', value: num(d.kpi.inflight), delta: null, note: d.kpi.late ? `${d.kpi.late} past target` : 'all on time', alert: d.kpi.late > 0, spark: null, color: '' },
    { label: 'Shipped on time', value: d.kpi.onTime == null ? '—' : pct(d.kpi.onTime), delta: null, note: 'within 48h Egypt · 30h Kuwait, last 7 days', spark: null, color: '' },
    { label: 'COD refused', value: d.kpi.refusal == null ? '—' : pct(d.kpi.refusal, 1), delta: null, note: 'of cash parcels, last 30 days', spark: d.spark.rto, color: 'var(--t-red)', invert: true },
    { label: 'Return rate', value: d.kpi.returnRate == null ? '—' : pct(d.kpi.returnRate, 1), delta: null, note: 'returns ÷ deliveries, 30 days', spark: d.spark.returns, color: 'var(--t-rose)', invert: true },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow mb-2">{dateLine}</div>
          <h1 className="font-display text-[40px] leading-[1] tracking-tight sm:text-[52px]">
            {greeting()}, {first}
            <span className="text-signal">.</span>
          </h1>
          <p className="mt-3 text-[15px] text-ink-2">
            {num(d.kpi.inflight)} orders in motion across {d.channels.filter((c) => c.mode !== 'off').length} storefronts.{' '}
            {attention ? (
              <span className="text-ink">
                {attention} thing{attention > 1 ? 's' : ''} need{attention > 1 ? '' : 's'} attention.
              </span>
            ) : (
              'Nothing needs attention.'
            )}
          </p>
        </div>
        <AskButton />
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k, i) => (
          <div key={k.label} className="panel rise flex flex-col justify-between gap-3 p-4" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] text-ink-3">{k.label}</span>
              {k.delta != null && (
                <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] ${k.delta >= 0 ? 'text-good' : 'text-critical'}`}>
                  {k.delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                  {Math.abs(Math.round(k.delta * 100))}%
                </span>
              )}
            </div>
            <div className={`font-display text-[34px] leading-none tabular ${'alert' in k && k.alert ? '' : ''}`}>{k.value}</div>
            {k.spark ? <Sparkline data={k.spark} color={k.color} height={26} /> : <div className="h-[26px]" />}
            <div className={`truncate text-[11.5px] ${'alert' in k && k.alert ? 'text-critical' : 'text-ink-3'}`} title={k.note}>
              {k.note}
            </div>
          </div>
        ))}
      </section>

      <RelayFlow lanes={d.lanes} exceptions={d.exceptions} canOpen={{ care: can(me, 'intake', 1), finance: can(me, 'finance', 1), fulfilment: can(me, 'fulfilment', 1), shipping: can(me, 'shipping', 1), cash: can(me, 'finance', 1) && can(me, 'money', 2) }} />

      <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-6">
          <div className="panel">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-signal" />
                <h2 className="text-[15px] font-medium">Relay noticed</h2>
              </div>
              <span className="text-[12px] text-ink-3">computed from live data, just now</span>
            </div>
            <div className="px-4 pb-1">
              <InsightCards items={insights} />
            </div>
          </div>
          <div className="panel p-5">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <div className="eyebrow mb-1">Today, by the hour</div>
                <h2 className="text-[15px] font-medium">Orders coming in</h2>
              </div>
              <Link href="/insights" className="text-[12.5px] text-ink-2 hover:text-ink">
                All insights →
              </Link>
            </div>
            <HourArea today={d.hourly.today} usual={d.hourly.usual} nowHour={d.hourly.nowHour} />
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel flex max-h-[760px] flex-col">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-medium">On the floor</h2>
              <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                <span className="live-dot" /> live
              </span>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-3 py-2">
              <ActivityFeed rows={feed} />
            </div>
          </div>
          <div className="panel p-5">
            <div className="eyebrow mb-3">Storefronts today</div>
            <ul className="divide-y divide-[var(--line)]">
              {d.channels.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <ChannelChip id={c.id} />
                  <span className={`ml-auto text-[11px] ${c.mode === 'live' ? 'text-good' : c.mode === 'demo' ? 'text-ink-3' : 'text-ink-4'}`}>{c.mode === 'live' ? '● live' : c.mode === 'demo' ? 'demo' : 'not connected'}</span>
                  <span className="w-10 text-right font-mono text-[12.5px]">{c.n}</span>
                  {seesMoney && <span className="hidden w-28 text-right font-mono text-[12px] text-ink-3 sm:block">{c.total ? money(c.total, c.currency, { compact: true }) : '—'}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
