import Link from 'next/link';
import { ClipboardList, Sparkles } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, level, canSee } from '@/lib/domain/perms';
import { buyPlan, poList, supplierScores } from '@/lib/stock/views/purchasing';
import { marketsFor, viewCurrency } from '@/lib/stock/views/common';
import { PO_STATUS } from '@/lib/domain/stock/flows';
import { CHANNELS, channelLabel } from '@/lib/channels';
import { moneyIn, num, pct, when } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { NewPoButton, PlanGroup } from '@/components/stock/purchasing';
import { RecCard } from '@/components/stock/rec-card';
import { ParamFilters } from '@/components/stock/filters';
import { DemoNote } from '@/components/stock/bits';
import { AddSupplier } from '@/components/channels/setup';
import { CountUp } from '@/components/ui/count-up';

export const metadata = { title: 'Purchasing' };

const TABS = [
  { key: 'plan', label: 'Buy plan' },
  { key: 'orders', label: 'Purchase orders' },
  { key: 'suppliers', label: 'Suppliers' },
];

export default async function PurchasingPage(props: PageProps<'/stock/purchasing'>) {
  const me = await requireUser();
  const cur = viewCurrency(me);
  if (!canSee(me, 'purchasing')) sendHome(me);
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const tab = str('tab') ?? 'plan';
  const [plan, orders, scores] = await Promise.all([buyPlan(me), poList(me, { status: str('status'), supplier: str('supplier'), q: str('q') }), tab === 'suppliers' ? supplierScores(me) : null]);
  const channelNames = Object.fromEntries(CHANNELS.map((c) => [c.id, channelLabel(c.id)]));
  const egp = (v: number | null) => (v == null ? '—' : moneyIn(v, cur, { compact: true }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Stock & buying"
        title="Purchasing"
        sub="Buy plan per supplier from forecast, lead time and stock. Ticked lines go on a draft order."
        right={can(me, 'procurement', 2) ? <NewPoButton suppliers={orders.suppliers} markets={marketsFor(me)} /> : undefined}
      />
      <DemoNote />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'In the buy plan', value: num(plan.totals.lines), note: `${num(plan.totals.units)} pieces · ${egp(plan.totals.cost)} at cost` },
          { label: 'Open purchase orders', value: num(orders.counts.open), note: `${num(orders.kpi.openUnits)} pieces · ${egp(orders.kpi.openValue)}` },
          { label: 'Awaiting approval', value: num(orders.counts.approval), note: orders.kpi.approvalValue != null ? `${egp(orders.kpi.approvalValue)} to sign off` : 'to sign off', alert: orders.counts.approval > 0 && level(me, 'procurement') >= 3 },
          { label: 'Late deliveries', value: num(orders.counts.late), note: `${num(Math.round(orders.kpi.arrivingWeek))} pieces due this week`, alert: orders.counts.late > 0 },
        ].map((k) => (
          <div key={k.label} className="panel flex flex-col justify-between gap-2 p-4">
            <span className="text-[11.5px] text-ink-3">{k.label}</span>
            <div className={`font-display text-[20px] leading-none ${k.alert ? 'text-critical' : ''}`}>{typeof k.value === 'string' ? <CountUp text={k.value} /> : k.value}</div>
            <div className="text-[11px] text-ink-3">{k.note}</div>
          </div>
        ))}
      </section>

      <nav className="flex gap-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/stock/purchasing?tab=${t.key}`} className={`flex h-9 items-center gap-2 rounded-lg px-3.5 text-[12.5px] ${tab === t.key ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
            {t.label}
            {t.key === 'plan' && <span className="font-mono text-[11px] opacity-70">{plan.totals.lines}</span>}
            {t.key === 'orders' && <span className="font-mono text-[11px] opacity-70">{orders.counts.open}</span>}
          </Link>
        ))}
      </nav>

      {tab === 'plan' && (
        <div className="space-y-4">
          {plan.expedites.length > 0 && (
            <div className="grid gap-3 xl:grid-cols-2">
              {plan.expedites.map((r) => (
                <RecCard key={r.id} rec={r} publishLevel={level(me, 'merch')} channelNames={channelNames} />
              ))}
            </div>
          )}
          <p className="flex items-center gap-2 text-[12px] text-ink-3">
            <Sparkles className="size-3.5" /> Quantities cover the supplier’s lead time and two weeks more at the forecast, plus safety stock by how much the style matters, rounded to the case pack. Urgent lines are ticked for you.
          </p>
          {plan.groups.length === 0 ? (
            <div className="panel">
              <Empty icon={ClipboardList} title="Nothing to buy" body="Every style is covered through its lead time. The planner reads the range again on its next pass." />
            </div>
          ) : (
            plan.groups.map((g) => <PlanGroup key={g.key} g={g} canAct={plan.canAct} />)
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {[
              { k: undefined, l: 'Open', n: orders.counts.open },
              { k: 'approval', l: 'Awaiting approval', n: orders.counts.approval },
              { k: 'draft', l: 'Drafts', n: orders.counts.draft },
              { k: 'late', l: 'Late', n: orders.counts.late },
              { k: 'all', l: 'Everything', n: orders.counts.all },
            ].map((v) => (
              <Link key={v.l} href={`/stock/purchasing?tab=orders${v.k ? `&status=${v.k}` : ''}`} className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[12px] ${str('status') === v.k ? 'bg-elev-3 text-ink ring-1 ring-line-2' : 'text-ink-2 hover:bg-elev-2'}`}>
                {v.l} <span className={`font-mono text-[11px] ${v.k === 'late' && v.n ? 'text-critical' : 'text-ink-4'}`}>{v.n}</span>
              </Link>
            ))}
          </div>
          <ParamFilters q={str('q')} placeholder="Search order numbers and suppliers…" selects={[{ key: 'supplier', label: 'Every supplier', value: str('supplier'), options: orders.suppliers.map((s) => ({ value: s.id, label: s.name })) }]} />
          <div className="panel overflow-hidden">
            {orders.rows.length === 0 ? (
              <Empty icon={ClipboardList} title="No purchase orders here" />
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="table text-[12.5px]">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Supplier</th>
                      <th>Status</th>
                      <th className="text-right">Pieces</th>
                      {orders.seesCost && <th className="text-right">Value</th>}
                      <th className="text-right">Received</th>
                      <th className="text-right">Expected</th>
                      <th>Raised by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.rows.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/stock/purchasing/${o.id}`} className="font-mono hover:underline">
                            {o.number}
                          </Link>
                          <div className="text-[11px] text-ink-4">
                            {o.market} · {o.company === 'DCO' ? 'D&Co' : o.company === 'DH' ? 'D&H' : o.company}
                            {o.season ? ` · ${o.season}` : ''}
                          </div>
                        </td>
                        <td className="max-w-[240px] truncate">{o.supplier}</td>
                        <td>
                          <span className="pill" data-tint={o.late ? 'red' : PO_STATUS[o.status].tint}>
                            <span className="dot" />
                            {o.late ? 'Late' : PO_STATUS[o.status].label}
                          </span>
                        </td>
                        <td className="text-right font-mono">{num(o.units)}</td>
                        {orders.seesCost && <td className="whitespace-nowrap text-right font-mono">{o.totalLocal}</td>}
                        <td className="text-right">
                          <div className="ml-auto h-1.5 w-16 rounded-full bg-elev-3">
                            <div className="h-full rounded-full bg-[var(--s3)]" style={{ width: `${Math.round(o.received * 100)}%` }} />
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-ink-4">{pct(o.received)}</div>
                        </td>
                        <td className={`whitespace-nowrap text-right text-[12px] ${o.late ? 'text-critical' : 'text-ink-2'}`}>{o.expectedAt ? when(o.expectedAt) : '—'}</td>
                        <td className="whitespace-nowrap text-[12px] text-ink-2">
                          {o.source === 'ai' && <Sparkles className="mr-1 inline size-3 text-ink-3" />}
                          {o.createdByName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'suppliers' && scores && (
        <div className="panel overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div>
            <h2 className="text-[14px] font-medium">Supplier scorecard · last 12 months</h2>
            <p className="mt-0.5 text-[11.5px] text-ink-3">On time means landed within two days of the promised date.</p>
            </div>
            {scores.canManage && <AddSupplier />}
          </header>
          <div className="scroll-thin overflow-x-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="text-right">Grade</th>
                  <th className="text-right">On time</th>
                  <th className="text-right">Late by</th>
                  <th className="text-right">Lead time</th>
                  <th className="text-right">Complete</th>
                  <th className="text-right">Damaged</th>
                  {scores.rows.some((r) => r.spend != null) && <th className="text-right">Spend</th>}
                  <th className="text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {scores.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-[11px] text-ink-3">
                        {r.country} · {r.brands.join(', ')} · {r.payment_terms}
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="pill" data-tint={r.grade === 'A' ? 'green' : r.grade === 'B' ? 'amber' : r.grade === 'C' ? 'red' : 'neutral'}>
                        {r.grade}
                      </span>
                    </td>
                    <td className={`text-right font-mono ${r.onTime != null && r.onTime < 0.6 ? 'text-critical' : ''}`}>{r.onTime == null ? '—' : pct(r.onTime)}</td>
                    <td className="text-right font-mono text-ink-2">{r.delay == null ? '—' : `${r.delay > 0 ? '+' : ''}${r.delay.toFixed(1)}d`}</td>
                    <td className="whitespace-nowrap text-right font-mono text-ink-2">
                      {r.lead_actual == null ? `${r.lead_days}d` : `${Math.round(r.lead_actual)}d`}
                      <span className="text-ink-4"> / {r.lead_days}d</span>
                    </td>
                    <td className="text-right font-mono">{r.fill == null ? '—' : pct(r.fill)}</td>
                    <td className="text-right font-mono text-ink-2">{r.damage == null ? '—' : pct(r.damage, 1)}</td>
                    {r.spend != null && <td className="text-right font-mono">{moneyIn(r.spend, cur, { compact: true })}</td>}
                    <td className="text-right font-mono text-ink-2">{r.open_pos ? `${r.open_pos} · ${num(r.open_units)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
