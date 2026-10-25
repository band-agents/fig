'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Crown, PauseCircle, TriangleAlert } from 'lucide-react';
import type { OrderRow } from '@/lib/order-query';
import type { Scopes } from '@/lib/domain/perms';
import { CANCEL_REASONS, isAllowed, mayTake, ORDER_FLOW, ORDER_STAGE, RTO_REASONS, type OrderStage, type Transition } from '@/lib/domain/stages';
import { money } from '@/lib/format';
import { ChannelChip, RiskBadge } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { ReasonModal, useMover } from '@/components/queues/shared';

const COLUMNS: { stages: OrderStage[]; drop: OrderStage; label: string }[] = [
  { stages: ['new', 'confirming', 'finance', 'ready'], drop: 'ready', label: 'Ready to pick' },
  { stages: ['picking'], drop: 'picking', label: 'Picking' },
  { stages: ['packed'], drop: 'packed', label: 'Packed' },
  { stages: ['shipped'], drop: 'shipped', label: 'Shipped' },
  { stages: ['delivering'], drop: 'delivering', label: 'Out for delivery' },
  { stages: ['delivered'], drop: 'delivered', label: 'Delivered' },
  { stages: ['rto'], drop: 'rto', label: 'Coming back' },
];

export function Board({ orders, scopes, channels, channel }: { orders: OrderRow[]; scopes: Scopes; channels: { id: string; label: string }[]; channel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const m = useMover();
  const [drag, setDrag] = useState<OrderRow | null>(null);
  const [over, setOver] = useState<OrderStage | null>(null);
  const [need, setNeed] = useState<{ o: OrderRow; t: Transition<OrderStage> } | null>(null);
  // Optimistic moves belong to the order list they were made on; fresh server data replaces them.
  const [opt, setOpt] = useState<{ base: OrderRow[]; map: Record<string, OrderStage> }>({ base: orders, map: {} });
  const moved = opt.base === orders ? opt.map : {};
  const setMoved = (fn: (m: Record<string, OrderStage>) => Record<string, OrderStage>) => setOpt((o) => ({ base: orders, map: fn(o.base === orders ? o.map : {}) }));
  const view = orders.map((o) => (moved[o.id] ? { ...o, stage: moved[o.id] } : o));

  const canDrop = (o: OrderRow | null, to: OrderStage) => {
    if (!o || o.onHold) return null;
    const t = isAllowed(ORDER_FLOW, o.stage as OrderStage, to);
    if (!t) return null;
    return mayTake(scopes, t) ? t : null;
  };

  const drop = (to: OrderStage) => {
    const o = drag;
    setOver(null);
    setDrag(null);
    const t = canDrop(o, to);
    if (!o || !t) return;
    if (t.needs?.length) return setNeed({ o, t });
    setMoved((mv) => ({ ...mv, [o.id]: to }));
    m.order(o.id, to, {}, () => undefined);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select
          className="field !h-9 !w-auto text-[12.5px]"
          value={channel ?? ''}
          onChange={(e) => router.replace(e.target.value ? `${pathname}?channel=${e.target.value}` : pathname)}
          aria-label="Storefront"
        >
          <option value="">All storefronts</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {drag && <span className="text-[12px] text-ink-3">Drop on a highlighted column to hand it on</span>}
      </div>
      <div className="scroll-thin -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex gap-3" style={{ minWidth: COLUMNS.length * 272 }}>
          {COLUMNS.map((col) => {
            const items = view.filter((o) => col.stages.includes(o.stage as OrderStage));
            const meta = ORDER_STAGE[col.drop];
            const ok = drag ? canDrop(drag, col.drop) : null;
            const late = items.filter((o) => o.dueAt && !o.onHold && o.dueAt.getTime() < Date.now()).length;
            return (
              <section
                key={col.drop}
                data-tint={meta.tint}
                onDragOver={(e) => {
                  if (ok) {
                    e.preventDefault();
                    setOver(col.drop);
                  }
                }}
                onDragLeave={() => setOver((x) => (x === col.drop ? null : x))}
                onDrop={() => drop(col.drop)}
                className={`flex w-[260px] shrink-0 flex-col rounded-2xl border transition ${over === col.drop ? 'border-[var(--tint)] bg-[color-mix(in_oklab,var(--tint)_8%,transparent)]' : ok ? 'border-dashed border-[color-mix(in_oklab,var(--tint)_55%,transparent)] bg-elev/60' : 'border-line bg-elev/60'} ${drag && !ok && !col.stages.includes(drag.stage as OrderStage) ? 'opacity-45' : ''}`}
              >
                <header className="flex items-center gap-2 px-3 py-3">
                  <span className="size-2 rounded-full bg-[var(--tint)]" />
                  <span className="text-[12.5px] font-medium">{col.label}</span>
                  <span className="font-mono text-[11px] text-ink-3">{items.length}</span>
                  {late > 0 && <span className="ml-auto font-mono text-[11px] text-critical">{late} late</span>}
                </header>
                <div className="scroll-thin flex max-h-[calc(100dvh-300px)] min-h-[120px] flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {items.map((o) => (
                    <Link
                      key={o.id}
                      href={`/orders/${o.id}`}
                      draggable={!o.onHold}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', o.id);
                        setDrag(o);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                      className={`group block rounded-xl border border-line bg-elev-2 p-2.5 transition hover:border-line-3 ${drag?.id === o.id ? 'opacity-40' : ''} ${o.onHold ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px]">{o.number}</span>
                        {o.vip && <Crown className="size-3 text-[var(--t-amber)]" />}
                        <span className="ml-auto">
                          <RiskBadge level={o.riskLevel} score={o.risk} compact />
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <ChannelChip id={o.channelId} compact />
                        {o.total != null && <span className="ml-auto font-mono text-[11px] text-ink-3">{money(o.total, o.currency, { compact: true })}</span>}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex -space-x-1.5">
                          {o.images.filter(Boolean).slice(0, 3).map((src, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={src!} alt="" className="size-7 rounded-md object-cover ring-2 ring-[var(--bg-elev-2)]" />
                          ))}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{o.customer}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <SlaChip due={o.dueAt} since={o.stageAt} held={o.onHold} />
                        {o.assignee && <span className="truncate text-[11px] text-ink-4">{o.assignee.split(' ')[0]}</span>}
                      </div>
                      {o.onHold && (
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--warn)]">
                          <PauseCircle className="size-3" /> {o.holdReason}
                        </div>
                      )}
                      {o.exception && (
                        <div className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-critical">
                          <TriangleAlert className="size-3 shrink-0" /> {o.exception}
                        </div>
                      )}
                    </Link>
                  ))}
                  {items.length === 0 && <div className="px-2 py-6 text-center text-[11.5px] text-ink-4">Empty</div>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {need && (
        <ReasonModal
          title={`${need.t.label} · ${need.o.number}`}
          reasons={need.t.to === 'cancelled' ? CANCEL_REASONS : need.t.to === 'rto' ? RTO_REASONS : []}
          withTracking={need.t.needs?.includes('tracking')}
          cta={need.t.label}
          danger={need.t.tone === 'danger'}
          onClose={() => setNeed(null)}
          onSubmit={(reason, tracking) => {
            const { o, t } = need;
            setMoved((mv) => ({ ...mv, [o.id]: t.to }));
            m.order(o.id, t.to, { reason, tracking: tracking ?? '' }, () => setNeed(null));
          }}
        />
      )}
    </div>
  );
}
