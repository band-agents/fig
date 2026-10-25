'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Crown, Headset, MessageCircle, Phone, PhoneOff, ShieldAlert, Sparkles, Undo2, X } from 'lucide-react';
import type { OrderRow } from '@/lib/order-query';
import type { ReturnRow } from '@/lib/return-query';
import { CANCEL_REASONS, RETURN_REASONS, type ReturnReason } from '@/lib/domain/stages';
import type { Scopes } from '@/lib/domain/perms';
import { ago, money } from '@/lib/format';
import { ChannelChip, Empty, Payment } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { OrderLink, ReasonModal, Spin, useMover } from './shared';

export function CareQueue({ orders, returns, view, me }: { orders: OrderRow[]; returns: ReturnRow[]; view: 'calls' | 'returns'; me: { scopes: Scopes } }) {
  const m = useMover();
  const [cancel, setCancel] = useState<OrderRow | null>(null);
  const [reject, setReject] = useState<ReturnRow | null>(null);
  const acts = (me.scopes.intake ?? 0) >= 2;
  const actsReturns = (me.scopes.returns ?? 0) >= 2;
  const sorted = [...orders].sort((a, b) => (b.riskLevel === 'high' ? 1 : 0) - (a.riskLevel === 'high' ? 1 : 0) || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));

  if (view === 'returns') {
    if (!returns.length) return <div className="panel"><Empty icon={Undo2} title="No returns to approve" body="New return requests land here first." /></div>;
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {returns.map((r) => (
          <div key={r.id} className="panel p-4">
            <div className="flex items-center gap-2">
              <Link href={`/returns/${r.id}`} className="font-mono text-[12.5px] hover:underline">
                {r.number}
              </Link>
              <span className="text-ink-4">·</span>
              <OrderLink id={r.orderId} number={r.orderNumber} />
              <ChannelChip id={r.channelId} compact />
              <span className="ml-auto">
                <SlaChip due={r.dueAt} since={r.stageAt} />
              </span>
            </div>
            <div className="mt-2 text-[13px]">{r.customer}</div>
            <div className="mt-3 flex gap-2">
              {r.items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-elev-2 p-1.5 pr-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {it.image && <img src={it.image} alt="" className="size-10 rounded-md object-cover" />}
                  <div className="text-[11.5px] leading-tight">
                    <div className="max-w-[180px] truncate">{it.title}</div>
                    <div className="text-ink-3">{it.size ? `Size ${it.size}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
              <span className="pill" data-tint="rose">
                <span className="dot" />
                {RETURN_REASONS[r.reason as ReturnReason]}
              </span>
              <span>wants a {r.resolution}</span>
              {r.amount != null && <span className="font-mono">{money(r.amount, r.currency)}</span>}
              <span className="text-ink-4" suppressHydrationWarning>{ago(r.requestedAt)}</span>
            </div>
            {actsReturns && (
              <div className="mt-4 flex gap-2">
                <button onClick={() => m.ret(r.id, 'approved')} disabled={m.pending} className="btn btn-primary btn-sm">
                  <Spin on={m.busy === `${r.id}:approved`} /> Approve return
                </button>
                <button onClick={() => setReject(r)} className="btn btn-danger btn-sm">
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
        {reject && (
          <ReasonModal
            title={`Reject ${reject.number}`}
            reasons={['Outside the return window', 'Final-sale item', 'Worn or washed', 'Tags removed']}
            cta="Reject return"
            danger
            onClose={() => setReject(null)}
            onSubmit={(reason) => m.ret(reject.id, 'rejected', { reason }, () => setReject(null))}
          />
        )}
      </div>
    );
  }

  if (!sorted.length) return <div className="panel"><Empty icon={Headset} title="Nobody to call" body="Every order is confirmed. New cash orders appear here the moment they arrive." /></div>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {sorted.map((o) => {
        const bracket = o.riskReasons.find((r) => r.code === 'bracketing');
        const waPhone = o.phone?.replace(/\D/g, '');
        const first = o.customer.split(' ')[0];
        const msg = `Hi ${first}, this is FIG customer care. We're confirming your order ${o.number}${o.lines[0] ? ` (${o.lines.map((l) => `${l.title}${l.size ? ` size ${l.size}` : ''}`).slice(0, 2).join(', ')})` : ''}${o.city ? ` for delivery to ${o.city}` : ''}. Reply YES to confirm.${bracket ? ' We noticed the same piece in more than one size: which one would you like?' : ''}`;
        return (
          <article key={o.id} className={`panel rise flex flex-col p-4 ${o.riskLevel === 'high' ? 'ring-1 ring-[color-mix(in_oklab,var(--critical)_45%,transparent)]' : ''}`}>
            <div className="flex items-center gap-2">
              <OrderLink id={o.id} number={o.number} />
              <ChannelChip id={o.channelId} compact />
              <span className="text-[11px] text-ink-4" suppressHydrationWarning>{ago(o.placedAt)}</span>
              <span className="ml-auto">
                <SlaChip due={o.dueAt} since={o.stageAt} held={o.onHold} />
              </span>
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[14.5px] font-medium">
                  {o.customer}
                  {o.vip && <Crown className="size-4 text-[var(--t-amber)]" />}
                </div>
                <div className="mt-0.5 text-[12px] text-ink-3">
                  {o.city}
                  {o.history && <> · {o.history.orders <= 1 ? 'first order' : `${o.history.orders} orders, ${o.history.delivered} delivered${o.history.refused ? `, ${o.history.refused} refused` : ''}`}</>}
                </div>
              </div>
              {o.total != null && (
                <div className="text-right">
                  <div className="font-display text-[16px] leading-none tabular">{money(o.total, o.currency)}</div>
                  <div className="mt-1">
                    <Payment method={o.paymentMethod} status={o.paymentStatus} short />
                  </div>
                </div>
              )}
            </div>

            {o.riskReasons.filter((r) => r.weight > 0).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {o.riskReasons
                  .filter((r) => r.weight >= 8)
                  .slice(0, 4)
                  .map((r) => (
                    <span key={r.code} className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] ${r.code === 'bracketing' || r.weight >= 20 ? 'bg-[color-mix(in_oklab,var(--critical)_12%,transparent)] text-critical' : 'bg-elev-2 text-ink-2'}`}>
                      {r.weight >= 20 && <ShieldAlert className="size-3" />}
                      {r.label}
                    </span>
                  ))}
              </div>
            )}

            <ul className="mt-3 space-y-1.5">
              {o.lines.slice(0, 4).map((l, i) => (
                <li key={i} className="flex items-center gap-2.5 text-[12px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.image ? <img src={l.image} alt="" className="size-9 rounded-md object-cover" /> : <span className="size-9 rounded-md bg-elev-3" />}
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  {l.size && <span className="rounded border border-line-2 px-1.5 font-mono text-[11px]">{l.size}</span>}
                  {l.quantity > 1 && <span className="font-mono text-[11px] text-ink-3">×{l.quantity}</span>}
                </li>
              ))}
            </ul>
            {bracket && (
              <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-ink-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-signal" /> Same piece in several sizes. Ask which one they want before it ships.
              </p>
            )}

            {acts && (
              <div className="mt-auto pt-4">
                <div className="flex flex-wrap gap-2">
                  {o.phone && (
                    <a href={`tel:${o.phone}`} className="btn btn-quiet btn-sm">
                      <Phone className="size-3.5" /> Call
                    </a>
                  )}
                  {waPhone && (
                    <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
                      <MessageCircle className="size-3.5" /> WhatsApp
                    </a>
                  )}
                  <button onClick={() => m.call(o.id, 'No answer')} disabled={m.pending} className="btn btn-ghost btn-sm">
                    <Spin on={m.busy === `${o.id}:call`} />
                    <PhoneOff className="size-3.5" /> No answer
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => m.order(o.id, 'finance')}
                    disabled={m.pending || o.onHold}
                    className="btn btn-primary flex-1"
                  >
                    <Spin on={m.busy === `${o.id}:finance`} />
                    <Check className="size-4" /> Customer confirmed
                  </button>
                  <button onClick={() => setCancel(o)} className="btn btn-danger" aria-label="Cancel order">
                    <X className="size-4" />
                    <span className="hidden sm:inline">Cancel</span>
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
      {cancel && <ReasonModal title={`Cancel ${cancel.number}`} reasons={CANCEL_REASONS} cta="Cancel order" danger onClose={() => setCancel(null)} onSubmit={(reason) => m.order(cancel.id, 'cancelled', { reason }, () => setCancel(null))} />}
    </div>
  );
}

