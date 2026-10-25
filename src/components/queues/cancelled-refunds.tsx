'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { BadgeX, Loader2, Undo2 } from 'lucide-react';
import { refundCancelledAction } from '@/app/actions';
import type { OrderRow } from '@/lib/order-query';
import { money } from '@/lib/format';
import { ChannelChip, Empty } from '@/components/ui/bits';
import { toast } from '@/components/ui/toast';

/**
 * Cancelled orders that had been paid online. Cancelling never refunds on its own (Dan, 24 Oct), so
 * Finance sends each refund deliberately: the store returns the money the way it was paid.
 */
export function CancelledRefunds({ rows, canRefund }: { rows: OrderRow[]; canRefund: boolean }) {
  const [gone, setGone] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const left = rows.filter((o) => !gone.includes(o.id));
  if (!left.length) return <div className="panel"><Empty icon={Undo2} title="Nothing to refund" body="Cancelled orders that were paid online wait here until the money goes back." /></div>;
  return (
    <div className="panel overflow-hidden">
      <ul className="divide-y divide-[var(--line)]">
        {left.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 text-[12.5px] md:px-5">
            <BadgeX className="size-4 shrink-0 text-ink-3" />
            <Link href={`/orders/${o.id}`} className="font-mono hover:underline">
              {o.number}
            </Link>
            <ChannelChip id={o.channelId} compact />
            <span className="min-w-0 flex-1 truncate text-ink-2">
              {o.customer} · {o.items} piece{o.items === 1 ? '' : 's'} · {o.paymentMethod}
            </span>
            <span className="font-mono font-medium">{o.total == null ? '—' : money(o.total, o.currency)}</span>
            {canRefund ? (
              <button
                disabled={pending}
                onClick={() => {
                  setBusy(o.id);
                  start(async () => {
                    const r = await refundCancelledAction(o.id);
                    setBusy(null);
                    if (r.ok) {
                      toast(`${o.number}: ${r.message}`);
                      setGone((g) => [...g, o.id]);
                    } else toast(r.error, { tone: 'error' });
                  });
                }}
                className="btn btn-primary btn-sm"
              >
                {busy === o.id ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />} Refund in Shopify
              </button>
            ) : (
              <span className="text-[11px] text-ink-4">Refunds need Finance manage access</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
