'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Loader2, MapPin, PauseCircle, TriangleAlert, X } from 'lucide-react';
import type { OrderRow } from '@/lib/order-query';
import { mayTake, ORDER_FLOW, ORDER_STAGE, type OrderStage } from '@/lib/domain/stages';
import type { Scopes } from '@/lib/domain/perms';
import { money, when } from '@/lib/format';
import { ChannelChip, Payment, PayBadge, RiskBadge, StagePill, Thumbs } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { bulkMoveAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';

export function OrdersTable({ rows, seesMoney, scopes, compact = false }: { rows: OrderRow[]; seesMoney: boolean; scopes: Scopes; compact?: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const chosen = rows.filter((r) => sel.has(r.id));
  const bulk = useMemo(() => {
    if (!chosen.length) return [];
    const stages = new Set(chosen.map((r) => r.stage));
    if (stages.size !== 1) return [];
    const stage = [...stages][0] as OrderStage;
    return ORDER_FLOW[stage].filter((t) => !t.needs?.length && mayTake(scopes, t));
  }, [chosen, scopes]);
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));

  return (
    <div className="relative">
      {/* phone: Shopify's order list: when, the number and total, payment and fulfilment badges, who and where */}
      <ul className="divide-y divide-[var(--line)] md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <button onClick={() => router.push(`/orders/${r.id}`)} className="w-full px-4 py-3 text-left active:bg-elev-2">
              <div className="text-[11.5px] text-ink-3">{when(r.placedAt)}</div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold">{r.number}</span>
                {seesMoney && r.total != null && <span className="tabular text-[14px] font-semibold">{money(r.total, r.currency)}</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <PayBadge status={r.paymentStatus} />
                <StagePill stage={r.stage} held={r.onHold} />
                {r.riskLevel !== 'low' && <RiskBadge level={r.riskLevel} score={r.risk} compact />}
              </div>
              <div className="mt-1.5 truncate text-[12.5px] text-ink-2">
                {r.customer} • {r.items} item{r.items === 1 ? '' : 's'}
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-3 text-[12px] text-ink-3">
                <ChannelChip id={r.channelId} compact />
                <SlaChip due={r.dueAt} since={r.stageAt} held={r.onHold} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* desktop: table */}
      <div className="scroll-thin hidden max-h-[calc(100dvh-280px)] overflow-auto md:block">
        <table className="table text-[12.5px]">
          <thead>
            <tr>
              <th className="w-8 !pr-0">
                <input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} className="accent-[var(--ink)]" />
              </th>
              <th>Order</th>
              <th>Customer</th>
              {!compact && <th>Items</th>}
              {seesMoney && <th className="text-right">Total</th>}
              <th>Payment</th>
              <th>Stage</th>
              <th>Target</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`cursor-pointer ${sel.has(r.id) ? 'bg-elev-2' : ''}`} onClick={() => router.push(`/orders/${r.id}`)}>
                <td className="!pr-0" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${r.number}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="accent-[var(--ink)]" />
                </td>
                <td>
                  <div className="font-mono text-[12.5px]">{r.number}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <ChannelChip id={r.channelId} compact />
                    <span className="text-[11px] text-ink-4" suppressHydrationWarning>{when(r.placedAt)}</span>
                  </div>
                </td>
                <td className="max-w-[220px]">
                  <div className="flex items-center gap-1.5 truncate">
                    {r.customer}
                    {r.vip && <Crown className="size-3.5 shrink-0 text-[var(--t-amber)]" aria-label="VIP" />}
                  </div>
                  {r.city && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-ink-3">
                      <MapPin className="size-3" />
                      {r.city}
                    </div>
                  )}
                </td>
                {!compact && (
                  <td>
                    <Thumbs images={r.images} count={r.items} />
                  </td>
                )}
                {seesMoney && <td className="whitespace-nowrap text-right font-mono">{r.total != null ? money(r.total, r.currency) : '—'}</td>}
                <td>
                  <Payment method={r.paymentMethod} status={r.paymentStatus} short />
                </td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <StagePill stage={r.stage} held={r.onHold} />
                    {r.onHold && r.holdReason && (
                      <span className="flex items-center gap-1 text-[11px] text-[var(--warn)]">
                        <PauseCircle className="size-3" />
                        {r.holdReason}
                      </span>
                    )}
                    {r.exception && (
                      <span className="flex max-w-[200px] items-center gap-1 truncate text-[11px] text-critical">
                        <TriangleAlert className="size-3 shrink-0" />
                        {r.exception}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <SlaChip due={r.dueAt} since={r.stageAt} held={r.onHold} />
                </td>
                <td>
                  <RiskBadge level={r.riskLevel} score={r.risk} compact />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chosen.length > 0 && (
        <div className="rise fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-[640px] flex-wrap items-center gap-2 rounded-2xl border border-line-2 bg-elev-2/95 p-2 pl-4 shadow-[var(--shadow-lg)] backdrop-blur lg:bottom-6">
          <span className="text-[12.5px]">
            <b className="font-mono">{chosen.length}</b> selected
          </span>
          <span className="mx-1 h-5 w-px bg-line-2" />
          {bulk.length === 0 ? (
            <span className="text-[12px] text-ink-3">{new Set(chosen.map((r) => r.stage)).size > 1 ? 'Pick orders in the same stage to move them together' : 'Nothing you can move in bulk here'}</span>
          ) : (
            bulk.map((t) => (
              <button
                key={t.to}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await bulkMoveAction(
                      chosen.map((c) => c.id),
                      t.to,
                    );
                    if (r.ok) {
                      toast(`${r.message ?? 'Done'} → ${ORDER_STAGE[t.to].label}`);
                      setSel(new Set());
                    } else toast(r.error, { tone: 'error' });
                  })
                }
                className={`btn btn-sm ${t.tone === 'primary' ? 'btn-primary' : t.tone === 'danger' ? 'btn-danger' : 'btn-quiet'}`}
              >
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {t.label}
              </button>
            ))
          )}
          <button onClick={() => setSel(new Set())} className="btn btn-ghost btn-sm ml-auto !px-2" aria-label="Clear selection">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
