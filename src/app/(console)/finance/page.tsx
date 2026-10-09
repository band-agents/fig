import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, sql } from 'drizzle-orm';
import { CircleAlert, CircleCheck, Clock3 } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { scope } from '@/lib/queries';
import { can } from '@/lib/domain/perms';
import { money, num, when } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { BarList } from '@/components/charts/barlist';
import { Reconcile } from '@/components/finance/reconcile';

export const metadata = { title: 'Cash & refunds' };

export default async function FinancePage() {
  const me = await requireUser();
  if (!can(me, 'finance', 1) || !can(me, 'money', 2)) notFound();
  const db = await getDb();
  const s = scope(me);
  const [settlements, withCourier, refunds, mix, rto] = await Promise.all([
    db.select().from(schema.settlements).orderBy(desc(schema.settlements.createdAt)).limit(20),
    db.execute<{ currency: string; n: number; total: number; oldest: string }>(sql`
      select currency, count(*)::int as n, sum(total)::bigint as total, min(delivered_at) as oldest from orders
      where ${s} and stage = 'delivered' and payment_method = 'cod' group by currency`),
    db.execute<{ stage: string; currency: string; n: number; total: number }>(sql`
      select stage, currency, count(*)::int as n, sum(amount)::bigint as total from returns
      where ${scope(me, sql`channel_id`)} and (stage in ('refund_pending','inspected','received') or (stage = 'refunded' and closed_at > now() - interval '30 days'))
      group by stage, currency`),
    db.execute<{ payment_method: string; n: number }>(sql`
      select payment_method, count(*)::int as n from orders where ${s} and placed_at > now() - interval '30 days' and stage <> 'cancelled' group by 1 order by 2 desc`),
    db.execute<{ currency: string; n: number; total: number }>(sql`
      select currency, count(*)::int as n, sum(total)::bigint as total from orders where ${s} and stage in ('rto','rto_closed') and placed_at > now() - interval '30 days' group by currency`),
  ]);
  const totalMix = mix.rows.reduce((a, r) => a + r.n, 0);
  const pending = refunds.rows.filter((r) => r.stage === 'refund_pending');
  const done = refunds.rows.filter((r) => r.stage === 'refunded');
  const soon = refunds.rows.filter((r) => r.stage !== 'refund_pending' && r.stage !== 'refunded');
  const PAY: Record<string, string> = { cod: 'Cash on delivery', card: 'Card (Paymob / gateway)', knet: 'KNET', wallet: 'Mobile wallet', instapay: 'InstaPay' };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Finance" title="Cash & refunds" sub="Where the money is: collected by the courier, remitted to FIG, or on its way back to a customer." />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {withCourier.rows.map((r) => (
          <div key={r.currency} className="panel p-5">
            <div className="text-[12px] text-ink-3">With the courier · {r.currency}</div>
            <div className="mt-2 font-display text-[36px] leading-none tabular">{money(Number(r.total), r.currency, { compact: true })}</div>
            <div className="mt-2 text-[12px] text-ink-3">
              {num(r.n)} delivered cash orders · oldest {when(r.oldest)}
            </div>
          </div>
        ))}
        <div className="panel p-5">
          <div className="text-[12px] text-ink-3">Refunds to issue</div>
          <div className="mt-2 font-display text-[36px] leading-none tabular">{num(pending.reduce((a, r) => a + r.n, 0))}</div>
          <div className="mt-2 text-[12px] text-ink-3">{pending.map((r) => money(Number(r.total), r.currency, { compact: true })).join(' · ') || 'nothing waiting'}</div>
          {pending.length > 0 && (
            <Link href="/queue/finance?view=refunds" className="mt-3 inline-block text-[12.5px] hover:underline">
              Issue refunds →
            </Link>
          )}
        </div>
        <div className="panel p-5">
          <div className="text-[12px] text-ink-3">Coming to finance soon</div>
          <div className="mt-2 font-display text-[36px] leading-none tabular">{num(soon.reduce((a, r) => a + r.n, 0))}</div>
          <div className="mt-2 text-[12px] text-ink-3">returns at the desk, not yet inspected</div>
        </div>
        <div className="panel p-5">
          <div className="text-[12px] text-ink-3">Refunded · 30 days</div>
          <div className="mt-2 font-display text-[36px] leading-none tabular">{done.map((r) => money(Number(r.total), r.currency, { compact: true })).join(' + ') || '—'}</div>
          <div className="mt-2 text-[12px] text-ink-3">{num(done.reduce((a, r) => a + r.n, 0))} returns</div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-medium">Courier remittances</h2>
            <p className="text-[12px] text-ink-3">Aramex collects cash at the door and remits it on Sundays and Wednesdays. Enter what landed in the bank; a match settles every order in the batch.</p>
          </div>
        </header>
        <div className="scroll-thin overflow-x-auto">
          <table className="table text-[13px]">
            <thead>
              <tr>
                <th>Remittance</th>
                <th>Deliveries covered</th>
                <th className="text-right">Orders</th>
                <th className="text-right">Expected</th>
                <th className="text-right">Received</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settlements.map((st) => {
                const diff = st.remitted != null ? st.remitted - st.expected : null;
                return (
                  <tr key={st.id}>
                    <td className="font-mono">{st.reference}</td>
                    <td className="text-ink-3">
                      {when(st.periodFrom).replace(/ \d\d:\d\d$/, '')} – {when(st.periodTo).replace(/ \d\d:\d\d$/, '')}
                    </td>
                    <td className="text-right font-mono">{st.orderCount}</td>
                    <td className="whitespace-nowrap text-right font-mono">{money(st.expected, st.currency)}</td>
                    <td className="whitespace-nowrap text-right font-mono">
                      {st.remitted != null ? money(st.remitted, st.currency) : '—'}
                      {diff ? <div className="text-[11.5px] text-critical">{money(diff, st.currency, { sign: true })}</div> : null}
                    </td>
                    <td>
                      {st.status === 'matched' ? (
                        <span className="inline-flex items-center gap-1 text-good">
                          <CircleCheck className="size-3.5" /> Matched
                        </span>
                      ) : st.status === 'discrepancy' ? (
                        <span className="inline-flex items-center gap-1 text-critical">
                          <CircleAlert className="size-3.5" /> Short
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[var(--warn)]">
                          <Clock3 className="size-3.5" /> Awaiting
                        </span>
                      )}
                    </td>
                    <td className="text-right">{st.status !== 'matched' && can(me, 'finance', 2) && <Reconcile id={st.id} expected={st.expected} currency={st.currency} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="panel p-5">
          <h2 className="mb-4 text-[15px] font-medium">How customers pay · 30 days</h2>
          <BarList rows={mix.rows.map((r) => ({ label: PAY[r.payment_method] ?? r.payment_method, value: r.n, sub: totalMix ? `${Math.round((r.n / totalMix) * 100)}%` : undefined }))} format={num} />
        </div>
        <div className="panel p-5">
          <h2 className="mb-1 text-[15px] font-medium">Revenue lost to refusals · 30 days</h2>
          <p className="mb-4 text-[12px] text-ink-3">Cash orders packed, shipped and brought back without a sale.</p>
          {rto.rows.length ? (
            rto.rows.map((r) => (
              <div key={r.currency} className="flex items-baseline justify-between border-b border-line py-2 last:border-0">
                <span className="text-ink-2">{num(r.n)} parcels</span>
                <span className="font-display text-[28px] tabular text-critical">{money(Number(r.total), r.currency, { compact: true })}</span>
              </div>
            ))
          ) : (
            <p className="text-[13px] text-ink-3">No refusals this month.</p>
          )}
        </div>
      </section>
    </div>
  );
}
