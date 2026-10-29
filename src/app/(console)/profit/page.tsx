import Link from 'next/link';
import { Info, PiggyBank } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee, seesCost } from '@/lib/domain/perms';
import { channelLabel } from '@/lib/channels';
import { trueProfit, type OrderProfit } from '@/lib/smart/profit';
import { viewCurrency } from '@/lib/stock/views/common';
import { moneyIn, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';

export const metadata = { title: 'True profit' };

// Dan, 28 Oct: what each order really leaves after the goods, the courier, the fees and the returns,
// and where the business sells at a loss (smart/profit.ts holds how each part is counted).

type Slice = { key: string; label: string; orders: number; net: number; profit: number; courier: number; losing: number };

const PARTS = [
  { key: 'cogs', label: 'Cost of goods', tone: 'cogs' },
  { key: 'courier', label: 'Courier', tone: 'courier' },
  { key: 'payFee', label: 'Payment fees', tone: 'fees' },
  { key: 'back', label: 'Refunds & returns', tone: 'back' },
  { key: 'profit', label: 'Profit', tone: 'profit' },
] as const;

export default async function ProfitPage(props: PageProps<'/profit'>) {
  const me = await requireUser();
  if (!canSee(me, 'profit') || !seesCost(me)) sendHome(me);
  const sp = await props.searchParams;
  const days = sp.days === '90' ? 90 : sp.days === '7' ? 7 : 30;
  const cur = viewCurrency(me);
  const d = await trueProfit(me, days);
  const m = (v: number) => moneyIn(v, cur, { compact: true });
  const mf = (v: number) => moneyIn(v, cur);
  const t = d.totals;

  const header = (
    <PageHeader
      eyebrow="Business"
      title="True profit"
      sub="What each order really leaves after the goods, the courier, the fees and the returns, and where it sells at a loss."
      right={
        <div className="flex gap-1 rounded-xl border border-line bg-elev p-1">
          {[7, 30, 90].map((n) => (
            <Link key={n} href={`/profit?days=${n}`} className={`flex h-8 items-center rounded-lg px-3 text-[12.5px] ${days === n ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
              {n} days
            </Link>
          ))}
        </div>
      }
    />
  );
  if (!t) {
    return (
      <div className="space-y-4">
        {header}
        <div className="panel">
          <Empty icon={PiggyBank} title="No orders in this period" body="Pick a longer period to see what the orders left." />
        </div>
      </div>
    );
  }

  const parts = { cogs: t.cogs, courier: t.courier, payFee: t.payFee, back: t.refunds + t.returnCost, profit: Math.max(0, t.profit) };
  const base = Math.max(1, t.sales);
  const margin = t.sales > 0 ? t.profit / t.sales : 0;
  const losers = [...d.orders].filter((o) => o.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 15);

  return (
    <div className="space-y-4">
      {header}

      <section className="panel inv-board grid grid-cols-2 overflow-hidden md:grid-cols-5">
        <Stat label="Sales" value={m(t.sales)} sub={`${num(t.orders)} orders, delivery included`} />
        <Stat label="Cost of goods" value={m(t.cogs)} sub={`${Math.round((t.cogs / base) * 100)}% of sales`} />
        <Stat label="Courier & fees" value={m(t.courier + t.payFee)} sub={`${Math.round(((t.courier + t.payFee) / base) * 100)}% · charged ${m(t.shipCharged)}`} />
        <Stat label="Refunds & returns" value={m(t.refunds + t.returnCost)} sub={`${t.refused} refused at the door`} />
        <Stat label="True profit" value={m(t.profit)} sub={`${(margin * 100).toFixed(1)}% margin · ${num(t.losing)} orders at a loss`} tone={t.profit < 0 ? 'bad' : 'good'} wide />
      </section>

      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px]">Where every {cur} 100 of sales goes</h2>
          {t.lost < 0 && <span className="text-[12px] text-ink-3">Orders at a loss cost {m(-t.lost)} in {days} days</span>}
        </div>
        <div className="wv-bar mt-4 !h-5">
          {PARTS.filter((p) => parts[p.key] > 0).map((p) => (
            <span key={p.key} className="wv-seg pf-fill" data-pf={p.tone} style={{ flexGrow: parts[p.key] }} title={`${p.label}: ${m(parts[p.key])}`} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-5">
          {PARTS.map((p) => (
            <div key={p.key}>
              <div className="flex items-center gap-1.5 text-ink-3">
                <span className="wv-key pf-fill" data-pf={p.tone} />
                {p.label}
              </div>
              <div className="mt-0.5 font-mono text-[16px] font-semibold">{((p.key === 'profit' ? t.profit : parts[p.key]) / base * 100).toFixed(1)}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <SliceTable title="By pieces in the order" note="Small orders far away are where the courier eats the margin." rows={d.slices!.pieces} m={m} keepOrder />
        <SliceTable title="By destination" note="Courier zones, worst first." rows={d.slices!.zone} m={m} />
        <SliceTable title="By payment" note="Cash on delivery pays the courier’s cash fee and the refusals." rows={d.slices!.payment} m={m} />
        <SliceTable title="By brand" note="Each order shared across its brands by the value of their pieces." rows={d.slices!.brand} m={m} />
      </div>
      {d.slices!.store.length > 1 && <SliceTable title="By store" rows={d.slices!.store} m={m} />}

      <section className="panel overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-[14px]">Orders that lost money</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-3">The biggest losses in the last {days} days, and what made them.</p>
        </div>
        {losers.length === 0 ? (
          <p className="px-5 pb-6 text-[12.5px] text-ink-3">No order lost money in this period.</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Where</th>
                  <th className="text-right">Pieces</th>
                  <th className="text-right">Sales</th>
                  <th className="text-right">Courier</th>
                  <th className="text-right">Profit</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {losers.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/orders/${o.id}`} className="font-mono font-semibold hover:underline">
                        {o.number}
                      </Link>
                      <div className="text-[11px] text-ink-4">{channelLabel(o.channel)}</div>
                    </td>
                    <td className="max-w-[200px] truncate">{o.city}</td>
                    <td className="text-right font-mono">{o.pieces}</td>
                    <td className="whitespace-nowrap text-right font-mono">{mf(o.net + o.shipCharged)}</td>
                    <td className="whitespace-nowrap text-right font-mono">{mf(o.courier)}</td>
                    <td className="whitespace-nowrap text-right font-mono font-semibold text-critical">{mf(o.profit)}</td>
                    <td className="text-[11.5px] text-ink-2">{why(o, mf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Cost of goods is the catalogue’s cost price: Shopify’s or an imported one where we have it, otherwise estimated at 40% of the full price until Lucida’s costs come in, so “sold below cost” means discounted past that estimate
          {d.guessed ? `; ${num(d.guessed)} orders had lines with no cost, priced at the average ${Math.round(d.costShare * 100)}% of sales` : ''}. Courier costs come from the rate cards{d.placeholder ? ', some of them still placeholders until the couriers’ real cards are in' : ''}. Payment fees: {Object.entries(d.fees).map(([k, v]) => `${k.replace('_', ' ')} ${(v * 100).toFixed(1)}%`).join(', ')}. Refunded pieces come back to stock, so their cost of goods comes back too.
        </span>
      </p>
    </div>
  );
}

/** The one thing that made the order lose money, in words. */
function why(o: OrderProfit, mf: (v: number) => string) {
  if (o.refused) return `Refused at the door: the courier both ways, ${mf(o.courier)}`;
  const back = o.refunds + o.returnCost;
  if (back > 0 && back >= o.courier) return `Returned: ${mf(o.refunds)} refunded${o.returnCost ? `, ${mf(o.returnCost)} to collect` : ''}`;
  if (o.cogs > o.net) return `Sold below cost: the goods cost ${mf(o.cogs)}, sold for ${mf(o.net)} after discounts`;
  return `The courier: ${mf(o.courier)} on ${mf(o.net + o.shipCharged)} of sales`;
}

function Stat({ label, value, sub, tone, wide }: { label: string; value: string; sub: string; tone?: 'good' | 'bad'; wide?: boolean }) {
  return (
    <div className={`inv-stat p-4 ${wide ? 'col-span-2 md:col-span-1' : ''}`}>
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className={`mt-1.5 whitespace-nowrap font-mono text-[20px] font-semibold leading-none xl:text-[24px] ${tone === 'bad' ? 'text-critical' : tone === 'good' ? 'text-[var(--sage-deep)]' : ''}`}>{value}</div>
      <div className="mt-1.5 truncate text-[11.5px] text-ink-3">{sub}</div>
    </div>
  );
}

function SliceTable({ title, note, rows, m, keepOrder }: { title: string; note?: string; rows: Slice[]; m: (v: number) => string; keepOrder?: boolean }) {
  const list = keepOrder ? rows : [...rows].sort((a, b) => a.profit / Math.max(1, a.net) - b.profit / Math.max(1, b.net)).slice(0, 12);
  return (
    <section className="panel overflow-hidden">
      <div className="px-5 pt-4 pb-2">
        <h2 className="text-[14px]">{title}</h2>
        {note && <p className="mt-0.5 text-[11.5px] text-ink-3">{note}</p>}
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="table text-[12.5px]">
          <thead>
            <tr>
              <th />
              <th className="text-right">Orders</th>
              <th className="text-right">Sales</th>
              <th className="text-right">Profit an order</th>
              <th className="min-w-[140px]">Margin</th>
              <th className="text-right">At a loss</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const margin = r.net > 0 ? r.profit / r.net : r.profit < 0 ? -1 : 0;
              const per = r.orders > 0 ? r.profit / r.orders : 0;
              return (
                <tr key={r.key}>
                  <td className="max-w-[200px] truncate font-medium">{r.label}</td>
                  <td className="text-right font-mono">{r.orders > 0 && r.orders < 1 ? '<1' : num(Math.round(r.orders))}</td>
                  <td className="whitespace-nowrap text-right font-mono text-ink-2">{m(r.net)}</td>
                  <td className={`whitespace-nowrap text-right font-mono font-semibold ${per < 0 ? 'text-critical' : ''}`}>{m(Math.round(per))}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="pf-track">
                        <div className="pf-bar" data-neg={margin < 0 ? '' : undefined} style={{ width: `${Math.min(100, Math.abs(margin) * 100)}%` }} />
                      </div>
                      <span className={`w-12 text-right font-mono text-[11.5px] ${margin < 0 ? 'text-critical' : 'text-ink-2'}`}>{(margin * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className={`text-right font-mono ${r.losing ? 'text-critical' : 'text-ink-4'}`}>{r.orders > 0 ? `${Math.round((r.losing / r.orders) * 100)}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
