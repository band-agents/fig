'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Banknote, Check, Loader2, Undo2 } from 'lucide-react';
import type { OrderRow } from '@/lib/order-query';
import type { ReturnRow } from '@/lib/return-query';
import { DEFAULT_AUTOPILOT } from '@/lib/domain/autopilot';
import { RETURN_REASONS, type ReturnReason } from '@/lib/domain/stages';
import type { Scopes } from '@/lib/domain/perms';
import { money, toMajor } from '@/lib/format';
import { ChannelChip, Empty, Payment, RiskBadge } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { bulkMoveAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';
import { OrderLink, ReasonModal, Spin, useMover } from './shared';

function whyHere(o: OrderRow) {
  if (o.paymentMethod !== 'cod' && o.paymentStatus !== 'paid') return 'Payment not captured yet';
  if (o.paymentMethod === 'cod') {
    const cap = DEFAULT_AUTOPILOT.financeMaxCod[o.currency];
    if (o.total != null && cap && toMajor(o.total, o.currency) > cap) return `Cash order above the ${o.currency} ${cap.toLocaleString('en')} auto-limit`;
    if (o.risk >= DEFAULT_AUTOPILOT.financeMaxRisk) return `Risk ${o.risk} is above the auto-approve line`;
  }
  return 'Sent here by a person';
}

export function FinanceQueue({ orders, returns, view, scopes }: { orders: OrderRow[]; returns: ReturnRow[]; view: 'clear' | 'refunds'; scopes: Scopes }) {
  const m = useMover();
  const [back, setBack] = useState<OrderRow | null>(null);
  const [cancel, setCancel] = useState<OrderRow | null>(null);
  const [pending, start] = useTransition();
  const canApprove = (scopes.finance ?? 0) >= 2;
  const canRefund = (scopes.finance ?? 0) >= 3;

  if (view === 'refunds') {
    if (!returns.length) return <div className="panel"><Empty icon={Undo2} title="No refunds waiting" body="Returns that pass inspection land here for the money to go back." /></div>;
    return (
      <div className="panel overflow-hidden">
        <table className="table text-[13px]">
          <thead>
            <tr>
              <th>Return</th>
              <th>Customer</th>
              <th>Reason</th>
              <th className="text-right">Refund</th>
              <th>Target</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/returns/${r.id}`} className="font-mono hover:underline">
                    {r.number}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                    <OrderLink id={r.orderId} number={r.orderNumber} /> <ChannelChip id={r.channelId} compact />
                  </div>
                </td>
                <td>{r.customer}</td>
                <td className="text-ink-2">{RETURN_REASONS[r.reason as ReturnReason]}</td>
                <td className="text-right font-mono">{r.amount != null ? money(r.amount, r.currency) : '—'}</td>
                <td>
                  <SlaChip due={r.dueAt} since={r.stageAt} />
                </td>
                <td className="text-right">
                  {canRefund ? (
                    <button onClick={() => m.ret(r.id, 'refunded')} disabled={m.pending} className="btn btn-primary btn-sm">
                      <Spin on={m.busy === `${r.id}:refunded`} /> Refund issued
                    </button>
                  ) : (
                    <span className="text-[12px] text-ink-3">Needs refund access</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!orders.length) return <div className="panel"><Empty icon={Banknote} title="All clear" body="Autopilot cleared everything inside the limits. Anything that needs judgement will show up here." /></div>;
  return (
    <div className="space-y-3">
      {canApprove && orders.length > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-elev px-4 py-2.5 text-[13px]">
          <span className="text-ink-2">
            {orders.length} orders waiting
            {orders.some((o) => o.total != null) && <> · {money(orders.filter((o) => o.currency === 'EGP').reduce((s, o) => s + (o.total ?? 0), 0), 'EGP', { compact: true })} in Egypt</>}
          </span>
          <button
            onClick={() =>
              start(async () => {
                const ids = orders.filter((o) => o.riskLevel === 'low' && !o.onHold).map((o) => o.id);
                if (!ids.length) return toast('No low-risk orders to approve in bulk', { tone: 'error' });
                const r = await bulkMoveAction(ids, 'ready');
                if (r.ok) toast(`Approved: ${r.message}`);
                else toast(r.error, { tone: 'error' });
              })
            }
            className="btn btn-quiet btn-sm"
            disabled={pending}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Approve all low-risk
          </button>
        </div>
      )}
      <div className="panel overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {orders.map((o) => (
            <li key={o.id} className="grid gap-3 p-4 md:grid-cols-[1.2fr_1fr_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <OrderLink id={o.id} number={o.number} />
                  <ChannelChip id={o.channelId} compact />
                  <SlaChip due={o.dueAt} since={o.stageAt} held={o.onHold} />
                </div>
                <div className="mt-1 text-[13px] text-ink-2">
                  {o.customer}
                  {o.city ? ` · ${o.city}` : ''}
                  {o.history && <span className="text-ink-3"> · {o.history.orders <= 1 ? 'first order' : `${o.history.delivered}/${o.history.orders} delivered`}</span>}
                </div>
                <div className="mt-1.5 text-[12px] text-[var(--warn)]">{whyHere(o)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {o.total != null && <span className="font-display text-[22px] tabular">{money(o.total, o.currency)}</span>}
                <Payment method={o.paymentMethod} status={o.paymentStatus} short />
                <RiskBadge level={o.riskLevel} score={o.risk} />
              </div>
              {canApprove && (
                <div className="flex gap-2 md:justify-end">
                  <button onClick={() => m.order(o.id, 'ready')} disabled={m.pending || o.onHold} className="btn btn-primary btn-sm">
                    <Spin on={m.busy === `${o.id}:ready`} />
                    <Check className="size-3.5" /> Approve
                  </button>
                  <button onClick={() => setBack(o)} className="btn btn-quiet btn-sm">
                    Ask care
                  </button>
                  <button onClick={() => setCancel(o)} className="btn btn-danger btn-sm">
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      {back && <ReasonModal title={`Send ${back.number} back to Customer care`} reasons={['Confirm the address', 'Confirm the customer really wants it', 'Ask for prepayment', 'Check the phone number']} cta="Send back" onClose={() => setBack(null)} onSubmit={(reason) => m.order(back.id, 'confirming', { reason }, () => setBack(null))} />}
      {cancel && <ReasonModal title={`Cancel ${cancel.number}`} reasons={['Suspected fraud', 'Payment failed', 'Duplicate order']} cta="Cancel order" danger onClose={() => setCancel(null)} onSubmit={(reason) => m.order(cancel.id, 'cancelled', { reason }, () => setCancel(null))} />}
    </div>
  );
}
