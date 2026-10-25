'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ExternalLink, MessageCircle, PackageCheck, PackageOpen, Printer, RotateCcw, Truck, TriangleAlert } from 'lucide-react';
import { bookUpsAction } from '@/app/actions';
import { fmt, recommend } from '@/lib/domain/courier-rates';
import { gmtcArea } from '@/lib/connectors/kuwait-areas';
import { toast } from '@/components/ui/toast';
import type { OrderRow } from '@/lib/order-query';
import type { ReturnRow } from '@/lib/return-query';
import type { Scopes } from '@/lib/domain/perms';
import { RTO_REASONS } from '@/lib/domain/stages';
import { CHANNEL } from '@/lib/channels';
import { ago, money } from '@/lib/format';
import { aramexTrackingUrl } from '@/lib/connectors/aramex-map';
import { ChannelChip, Empty, Payment, ReturnPill, StagePill } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { OrderLink, ReasonModal, Spin, useMover } from './shared';

type View = 'handover' | 'road' | 'exceptions' | 'rto' | 'pickups';

export function ShippingQueue({ view, packed, road, exceptions, rto, pickups, scopes, ups = null }: { view: View; packed: OrderRow[]; road: OrderRow[]; exceptions: OrderRow[]; rto: OrderRow[]; pickups: ReturnRow[]; scopes: Scopes; ups?: 'staging' | 'live' | null }) {
  const m = useMover();
  const [booking, startBooking] = useTransition();
  const [bookingId, setBookingId] = useState<string | null>(null);
  const bookUps = (id: string) => {
    setBookingId(id);
    startBooking(async () => {
      const r = await bookUpsAction(id);
      setBookingId(null);
      if (r.ok) toast(r.message ?? 'Booked with UPS');
      else toast(r.error, { tone: 'error' });
    });
  };
  const ships = (scopes.shipping ?? 0) >= 2;
  const desk = (scopes.returns ?? 0) >= 2;
  const [waybills, setWaybills] = useState<Record<string, string>>({});
  const [refuse, setRefuse] = useState<OrderRow | null>(null);
  const [book, setBook] = useState<ReturnRow | null>(null);

  if (view === 'handover') {
    if (!packed.length) return <div className="panel"><Empty icon={PackageCheck} title="Nothing waiting for the courier" body="Packed parcels show up here with a box for the waybill." /></div>;
    const cod = packed.filter((o) => o.paymentMethod === 'cod');
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Parcels to hand over" value={String(packed.length)} />
          <Tile label="Cash on delivery" value={String(cod.length)} />
          <Tile label="Cash the courier will collect" value={cod[0]?.total != null ? money(cod.reduce((s, o) => s + (o.total ?? 0), 0), cod[0].currency, { compact: true }) : '—'} />
        </div>
        <div className="panel overflow-hidden">
          <ul className="divide-y divide-[var(--line)]">
            {packed.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <OrderLink id={o.id} number={o.number} />
                    <ChannelChip id={o.channelId} compact />
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-3">
                    {o.customer} · {o.city} · {o.items} piece{o.items > 1 ? 's' : ''}
                  </div>
                </div>
                <Payment method={o.paymentMethod} status={o.paymentStatus} short />
                {o.total != null && o.paymentMethod === 'cod' && <span className="font-mono text-[12px]">collect {money(o.total, o.currency)}</span>}
                {CHANNEL[o.channelId]?.country === 'KW' && !o.tracking && o.total != null && <CheapestCourier area={gmtcArea(o.city, { within: true })} pieces={o.items} cod={o.paymentMethod === 'cod' ? o.total : 0} ups={Boolean(ups)} />}
                <SlaChip due={o.dueAt} since={o.stageAt} held={o.onHold} />
                {ships && o.courier === 'UPS Kuwait' && o.tracking ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] text-ink-2">UPS {o.tracking}</span>
                    <a href={`/orders/${o.id}/label`} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
                      <Printer className="size-3.5" /> Label
                    </a>
                    <button onClick={() => m.order(o.id, 'shipped', { tracking: o.tracking!, courier: 'UPS Kuwait' })} disabled={m.pending} className="btn btn-primary btn-sm">
                      <Spin on={m.busy === `${o.id}:shipped`} />
                      <Truck className="size-3.5" /> Handed over
                    </button>
                  </div>
                ) : ships && (
                  <div className="flex flex-wrap items-center gap-2">
                  {ups && CHANNEL[o.channelId]?.country === 'KW' && !o.tracking && (!o.courier || o.courier === CHANNEL[o.channelId]?.carrier || o.courier === 'UPS Kuwait') && (
                    <button onClick={() => bookUps(o.id)} disabled={booking} className="btn btn-primary btn-sm" title={ups === 'staging' ? 'GMTC test account: no real pickup is booked' : undefined}>
                      <Spin on={booking && bookingId === o.id} />
                      <Truck className="size-3.5" /> Book UPS{ups === 'staging' ? ' (test)' : ''}
                    </button>
                  )}
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      m.order(o.id, 'shipped', { tracking: waybills[o.id] ?? '', courier: o.courier ?? CHANNEL[o.channelId]?.carrier ?? 'Aramex' });
                    }}
                  >
                    <input value={waybills[o.id] ?? ''} onChange={(e) => setWaybills((w) => ({ ...w, [o.id]: e.target.value }))} placeholder="Waybill" className="field !h-[30px] !w-36 font-mono text-[12px]" inputMode="numeric" data-editing={waybills[o.id] ? 'true' : undefined} />
                    <button disabled={!waybills[o.id]?.trim() || m.pending} className="btn btn-primary btn-sm">
                      <Spin on={m.busy === `${o.id}:shipped`} />
                      <Truck className="size-3.5" /> Handed over
                    </button>
                  </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (view === 'road' || view === 'exceptions') {
    const rows = view === 'road' ? road : exceptions;
    if (!rows.length) return <div className="panel"><Empty icon={Truck} title={view === 'road' ? 'Nothing on the road' : 'No exceptions'} body={view === 'road' ? 'Shipped parcels appear here until the courier delivers them.' : 'Parcels with a failed attempt or no courier scan for three days land here.'} /></div>;
    return (
      <div className="panel overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {rows.map((o) => {
            const ch = CHANNEL[o.channelId];
            const waPhone = o.phone?.replace(/\D/g, '');
            return (
              <li key={o.id} className="grid gap-2 px-4 py-3 lg:grid-cols-[1.3fr_1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <OrderLink id={o.id} number={o.number} />
                    <ChannelChip id={o.channelId} compact />
                    <StagePill stage={o.stage} />
                    <SlaChip due={o.dueAt} since={o.stageAt} />
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-3" suppressHydrationWarning>
                    {o.customer} · {o.city} · shipped {ago(o.stageAt)}
                  </div>
                  {o.exception && (
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-critical">
                      <TriangleAlert className="size-3.5" />
                      {o.exception}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[12px]">
                  {o.tracking && o.courier === 'UPS Kuwait' ? (
                    <a href={`/orders/${o.id}/label`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-ink-2 hover:text-ink" title="UPS (GMTC) label">
                      UPS {o.tracking} <Printer className="size-3" />
                    </a>
                  ) : o.tracking && (
                    <a href={aramexTrackingUrl(o.tracking, ch?.country === 'KW' ? 'kw' : 'eg')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-ink-2 hover:text-ink">
                      {o.tracking} <ExternalLink className="size-3" />
                    </a>
                  )}
                  <Payment method={o.paymentMethod} status={o.paymentStatus} short />
                </div>
                {ships && (
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {waPhone && view === 'exceptions' && (
                      <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi ${o.customer.split(' ')[0]}, this is FIG. The courier couldn't reach you for order ${o.number}. When is a good time to deliver?`)}`} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm">
                        <MessageCircle className="size-3.5" /> Customer
                      </a>
                    )}
                    {o.stage === 'shipped' && (
                      <button onClick={() => m.order(o.id, 'delivering')} disabled={m.pending} className="btn btn-quiet btn-sm">
                        <Spin on={m.busy === `${o.id}:delivering`} /> Out for delivery
                      </button>
                    )}
                    <button onClick={() => m.order(o.id, 'delivered')} disabled={m.pending} className="btn btn-primary btn-sm">
                      <Spin on={m.busy === `${o.id}:delivered`} /> Delivered
                    </button>
                    <button onClick={() => setRefuse(o)} className="btn btn-danger btn-sm">
                      Refused
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {refuse && <ReasonModal title={`${refuse.number} coming back`} reasons={RTO_REASONS} cta="Mark returning to origin" danger onClose={() => setRefuse(null)} onSubmit={(reason) => m.order(refuse.id, 'rto', { reason }, () => setRefuse(null))} />}
      </div>
    );
  }

  if (view === 'rto') {
    if (!rto.length) return <div className="panel"><Empty icon={RotateCcw} title="Nothing coming back" body="Refused and undeliverable parcels appear here until the warehouse receives them." /></div>;
    return (
      <div className="panel overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {rto.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-[200px] flex-1">
                <div className="flex items-center gap-2">
                  <OrderLink id={o.id} number={o.number} />
                  <ChannelChip id={o.channelId} compact />
                </div>
                <div className="mt-0.5 text-[12px] text-ink-3" suppressHydrationWarning>
                  {o.customer} · {o.city} · refused {ago(o.stageAt)}
                </div>
              </div>
              {o.total != null && <span className="font-mono text-[12px] text-critical">{money(o.total, o.currency)} not collected</span>}
              <SlaChip due={o.dueAt} since={o.stageAt} />
              {desk ? (
                <button onClick={() => m.order(o.id, 'rto_closed')} disabled={m.pending} className="btn btn-primary btn-sm">
                  <Spin on={m.busy === `${o.id}:rto_closed`} /> Received & restocked
                </button>
              ) : (
                <span className="text-[11.5px] text-ink-3">Returns desk receives it</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!pickups.length) return <div className="panel"><Empty icon={PackageOpen} title="No return pickups" body="Approved returns needing a courier pickup show up here." /></div>;
  return (
    <div className="panel overflow-hidden">
      <ul className="divide-y divide-[var(--line)]">
        {pickups.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-[200px] flex-1">
              <div className="flex items-center gap-2">
                <Link href={`/returns/${r.id}`} className="font-mono text-[12.5px] hover:underline">
                  {r.number}
                </Link>
                <OrderLink id={r.orderId} number={r.orderNumber} />
                <ReturnPill stage={r.stage} />
              </div>
              <div className="mt-0.5 text-[12px] text-ink-3">
                {r.customer} · {r.city} · {r.items.length} piece{r.items.length > 1 ? 's' : ''} · {r.method === 'store' ? 'drop-off at a store' : 'courier pickup'}
              </div>
            </div>
            {r.tracking && <span className="font-mono text-[11.5px] text-ink-3">{r.tracking}</span>}
            <SlaChip due={r.dueAt} since={r.stageAt} />
            {r.stage === 'approved' && ships && r.method !== 'store' && (
              <button onClick={() => setBook(r)} className="btn btn-primary btn-sm">
                Book pickup
              </button>
            )}
            {r.stage === 'pickup' && ships && (
              <button onClick={() => m.ret(r.id, 'in_transit')} disabled={m.pending} className="btn btn-primary btn-sm">
                <Spin on={m.busy === `${r.id}:in_transit`} /> Collected
              </button>
            )}
            {(r.stage === 'in_transit' || (r.stage === 'approved' && r.method === 'store')) && desk && (
              <button onClick={() => m.ret(r.id, 'received')} disabled={m.pending} className="btn btn-primary btn-sm">
                <Spin on={m.busy === `${r.id}:received`} /> Received
              </button>
            )}
          </li>
        ))}
      </ul>
      {book && <ReasonModal title={`Book pickup for ${book.number}`} reasons={[]} withTracking cta="Book pickup" onClose={() => setBook(null)} onSubmit={(_, tracking) => m.ret(book.id, 'pickup', { tracking }, () => setBook(null))} />}
    </div>
  );
}

/** The courier the rate sheet says is cheapest for this Kuwait parcel (price first; UPS wins a tie when the console books it). */
function CheapestCourier({ area, pieces, cod, ups }: { area: string | null; pieces: number; cod: number; ups: boolean }) {
  const r = recommend({ to: 'KW', pieces, area, codAmount: cod }, { apis: ups ? ['UPS'] : [] });
  if (!r.pick) return null;
  return (
    <span className="pill" data-tint="info" title={`${r.why} ${r.options.filter((x) => x.inUse).map((x) => `${x.label} ${fmt(x.total)}`).join(' · ')}`}>
      Cheapest: {r.pick.courier} {fmt(r.pick.total)}
    </span>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="mt-2 font-display text-[17px] leading-none tabular">{value}</div>
    </div>
  );
}
