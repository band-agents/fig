import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Ban, Bot, Crown, ExternalLink, Mail, MapPin, MessageCircle, Phone, ShieldAlert, ShieldCheck, Sparkles, TriangleAlert, Truck } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { orderDetail } from '@/lib/order-detail';
import { CHANNEL, channelLabel } from '@/lib/channels';
import { ORDER_STAGE, type OrderStage } from '@/lib/domain/stages';
import { money, when } from '@/lib/format';
import { aramexTrackingUrl } from '@/lib/connectors/aramex-map';
import { ChannelChip, Payment, ReturnPill, StagePill } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { StageTracker } from '@/components/order/tracker';
import { Timeline } from '@/components/order/timeline';
import { NoteComposer } from '@/components/order/composer';
import { ActionBar } from '@/components/order/action-bar';
import { CopyButton } from '@/components/ui/copy';

export async function generateMetadata(props: PageProps<'/orders/[id]'>) {
  const me = await requireUser();
  const d = await orderDetail(me, (await props.params).id);
  return { title: d ? d.order.number : 'Order' };
}

export default async function OrderPage(props: PageProps<'/orders/[id]'>) {
  const me = await requireUser();
  const { id } = await props.params;
  const d = await orderDetail(me, id);
  if (!d) notFound();
  const o = d.order;
  const meta = ORDER_STAGE[o.stage as OrderStage];
  const ch = CHANNEL[o.channelId];
  const first = o.customerName.split(' ')[0];
  const waText = waTemplate(o.stage, first, o.number, d.lines.map((l) => l.title).slice(0, 2).join(', '), o.address?.city ?? '');
  const waPhone = o.phone?.replace(/\D/g, '');

  return (
    <div className="space-y-5">
      <Link href="/orders" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Orders
      </Link>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-[28px] font-medium tracking-tight">{o.number}</h1>
              <StagePill stage={o.stage} held={o.onHold} />
              <SlaChip due={o.dueAt} since={o.stageAt} held={o.onHold} big />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
              <ChannelChip id={o.channelId} />
              <span>Placed {when(o.placedAt)}</span>
              <span>{meta?.verb}</span>
              {o.source !== 'demo' && <span className="text-good">● synced {o.syncedAt ? when(o.syncedAt) : ''}</span>}
            </div>
            {o.onHold && <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[color-mix(in_oklab,var(--warn)_12%,transparent)] px-3 py-1.5 text-[13px] text-[var(--warn)]">On hold · {o.holdReason}</div>}
            {o.exception && (
              <div className="mt-3 flex items-center gap-2 text-[13px] text-critical">
                <TriangleAlert className="size-4" /> {o.exception}
                {o.attempts > 0 && <span className="text-ink-3">· {o.attempts} failed attempt{o.attempts > 1 ? 's' : ''}</span>}
              </div>
            )}
          </div>
          {d.autopilotNext && !o.onHold && (
            <div className="flex max-w-sm items-start gap-2.5 rounded-xl border border-line bg-elev-2 px-3 py-2.5 text-[12.5px]">
              <Bot className="mt-0.5 size-4 shrink-0 text-ink-2" />
              <span className="text-ink-2">
                Autopilot would move this to <b className="font-medium text-ink">{ORDER_STAGE[d.autopilotNext.to].label}</b>: {d.autopilotNext.why.toLowerCase()}.
              </span>
            </div>
          )}
        </div>
        <div className="border-t border-line px-5 py-5">
          <StageTracker stage={o.stage} reached={d.reached} onHold={o.onHold} />
        </div>
        <div className="border-t border-line bg-inset/50 px-5 py-3">
          <ActionBar
            orderId={o.id}
            stage={o.stage}
            onHold={o.onHold}
            scopes={me.scopes}
            me={{ id: me.id }}
            assigneeId={o.assigneeId}
            assignable={d.assignable}
            courier={o.courier}
            canReturn={d.can.returns}
            canWork={d.can.work}
            lines={d.lines.map((l) => ({ id: l.id, title: l.title, size: l.size, image: l.image, quantity: l.quantity, unitPrice: l.unitPrice, returnable: l.returnable }))}
            currency={o.currency}
            policy={d.policy}
            canOverride={d.can.override}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <section className="panel">
            <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-medium">
                {o.items} item{o.items === 1 ? '' : 's'}
              </h2>
              {ch && <span className="text-[12px] text-ink-3">ships from {ch.warehouse === 'fig-cairo' ? 'FIG warehouse, New Cairo' : 'D&H warehouse, Kuwait'}</span>}
            </header>
            <ul className="divide-y divide-[var(--line)]">
              {d.lines.map((l) => (
                <li key={l.id} className="flex gap-4 px-5 py-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.image ? <img src={l.image} alt="" className="h-20 w-16 shrink-0 rounded-lg object-cover" /> : <span className="h-20 w-16 shrink-0 rounded-lg bg-elev-3" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{l.brand}</div>
                    <div className="mt-0.5 text-[14px] leading-snug">{l.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                      {l.size && (
                        <span>
                          Size <b className="font-medium text-ink">{l.size}</b>
                        </span>
                      )}
                      <span>
                        Qty <b className="font-medium text-ink">{l.quantity}</b>
                      </span>
                      {l.sku && <span className="font-mono">{l.sku}</span>}
                      {!l.returnable && (
                        <span className="inline-flex items-center gap-1 text-ink-3">
                          <Ban className="size-3" /> final sale
                        </span>
                      )}
                    </div>
                  </div>
                  {l.unitPrice != null && <div className="text-right font-mono text-[13px]">{money(l.unitPrice * l.quantity, o.currency)}</div>}
                </li>
              ))}
            </ul>
            {o.total != null && (
              <div className="space-y-1.5 border-t border-line px-5 py-4 text-[13px]">
                <Row label="Subtotal" value={money(o.subtotal!, o.currency)} />
                {o.discount ? <Row label="Discount" value={`−${money(o.discount, o.currency)}`} /> : null}
                <Row label="Delivery" value={o.shipping ? money(o.shipping, o.currency) : 'Free'} />
                <div className="flex items-baseline justify-between pt-1.5">
                  <span className="text-ink-2">Total</span>
                  <span className="font-display text-[26px] tabular">{money(o.total, o.currency)}</span>
                </div>
              </div>
            )}
            {o.note && <div className="border-t border-line px-5 py-3 text-[13px] text-ink-2">Customer note: “{o.note}”</div>}
          </section>

          <section className="panel">
            <header className="border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-medium">Timeline</h2>
              <p className="text-[12px] text-ink-3">Every hand-off, call, note and courier scan, for everyone.</p>
            </header>
            <div className="p-5">
              {d.can.note && (
                <div className="mb-5">
                  <NoteComposer target={{ orderId: o.id }} />
                </div>
              )}
              <Timeline events={d.events} />
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="panel p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="eyebrow mb-1.5">Customer</div>
                <div className="flex items-center gap-2 text-[16px] font-medium">
                  {o.customerName}
                  {d.customer?.vip && (
                    <span className="pill" data-tint="amber">
                      <Crown className="size-3" /> VIP
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-2 text-[13px]">
              {o.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="size-3.5 text-ink-3" />
                  {d.can.contact ? (
                    <a href={`tel:${o.phone}`} className="font-mono hover:underline">
                      {o.phone}
                    </a>
                  ) : (
                    <span className="font-mono text-ink-3">{o.phone}</span>
                  )}
                </div>
              )}
              {o.email && (
                <div className="flex items-center gap-2 truncate">
                  <Mail className="size-3.5 text-ink-3" />
                  {o.email}
                </div>
              )}
              {o.address && (o.address.line1 || o.address.city) && (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
                  <span className="text-ink-2">{[o.address.line1, o.address.city, o.address.region].filter(Boolean).join(', ')}</span>
                </div>
              )}
            </div>
            {d.can.contact && waPhone && (
              <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm mt-4 w-full">
                <MessageCircle className="size-4" /> WhatsApp with a ready message
              </a>
            )}
            {d.customer && (
              <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-4 text-center">
                <Stat n={d.customer.orders} label="orders" />
                <Stat n={d.customer.delivered} label="delivered" />
                <Stat n={d.customer.refused} label="refused" alert={d.customer.refused > 0} />
                <Stat n={d.customer.returned} label="returned" />
              </div>
            )}
            {d.others.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 text-[11.5px] text-ink-3">Across every FIG store</div>
                <ul className="space-y-1">
                  {d.others.map((x) => (
                    <li key={x.id}>
                      <Link href={`/orders/${x.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-elev-2">
                        <span className="font-mono">{x.number}</span>
                        <span className="text-ink-4">{channelLabel(x.channelId)}</span>
                        <span className="ml-auto">
                          <StagePill stage={x.stage} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="panel p-5">
            <div className="eyebrow mb-3">Payment</div>
            <Payment method={o.paymentMethod} status={o.paymentStatus} />
            {o.paymentMethod === 'cod' && o.total != null && (
              <p className="mt-2 text-[12.5px] text-ink-3">
                Courier collects <b className="font-mono text-ink">{money(o.total, o.currency)}</b> at the door
                {o.settlementId ? ', in an Aramex remittance batch.' : '.'}
              </p>
            )}
          </section>

          <section className="panel p-5">
            <div className="eyebrow mb-3">Delivery</div>
            <div className="flex items-center gap-2 text-[13px]">
              <Truck className="size-4 text-ink-3" />
              {o.courier ?? '—'}
            </div>
            {o.tracking ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-[14px]">{o.tracking}</span>
                <CopyButton text={o.tracking} />
                <a href={o.trackingUrl ?? aramexTrackingUrl(o.tracking, ch?.country === 'KW' ? 'kw' : 'eg')} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm !h-7 !px-2" aria-label="Track on the courier site">
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            ) : (
              <p className="mt-2 text-[12.5px] text-ink-3">No waybill yet. Shipping adds it at courier handover.</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <Mini label="Packed" at={o.packedAt} />
              <Mini label="Shipped" at={o.shippedAt} />
              <Mini label="Delivered" at={o.deliveredAt} />
              <Mini label="Settled" at={o.closedAt && o.stage === 'settled' ? o.closedAt : null} />
            </div>
          </section>

          <section className="panel p-5">
            <div className="flex items-center justify-between">
              <div className="eyebrow">Delivery risk</div>
              <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${o.riskLevel === 'high' ? 'text-critical' : o.riskLevel === 'medium' ? 'text-[var(--warn)]' : 'text-good'}`}>
                {o.riskLevel === 'low' ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
                {o.riskLevel[0].toUpperCase() + o.riskLevel.slice(1)}
              </span>
            </div>
            <div className="mt-3 flex items-end gap-3">
              <span className="font-display text-[44px] leading-none tabular">{o.risk}</span>
              <div className="mb-1.5 flex-1">
                <div className="relative h-1.5 rounded-full bg-[linear-gradient(90deg,var(--good)_0%,var(--good)_30%,var(--warn)_30%,var(--warn)_55%,var(--critical)_55%)] opacity-80">
                  <span className="absolute -top-1 h-3.5 w-1 rounded-full bg-ink ring-2 ring-[var(--bg-elev)]" style={{ left: `calc(${Math.min(100, o.risk)}% - 2px)` }} />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-ink-4">
                  <span>0</span>
                  <span>30</span>
                  <span>55</span>
                  <span>100</span>
                </div>
              </div>
            </div>
            {o.riskReasons.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {o.riskReasons.map((r) => (
                  <li key={r.code} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-ink-2">{r.label}</span>
                    <span className={`font-mono text-[11.5px] ${r.weight > 0 ? 'text-ink-3' : 'text-good'}`}>
                      {r.weight > 0 ? '+' : ''}
                      {r.weight}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12.5px] text-ink-3">Nothing unusual about this order.</p>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-ink-4">
              <Sparkles className="mt-0.5 size-3 shrink-0" /> Learned from this floor’s own refusals and returns. Every point has a reason.
            </p>
          </section>

          {d.returns.length > 0 && (
            <section className="panel p-5">
              <div className="eyebrow mb-3">Returns</div>
              <ul className="space-y-2">
                {d.returns.map((r) => (
                  <li key={r.id}>
                    <Link href={`/returns/${r.id}`} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] hover:border-line-3">
                      <span className="font-mono">{r.number}</span>
                      <ReturnPill stage={r.stage} />
                      {d.can.money && <span className="ml-auto font-mono text-[12px] text-ink-3">{money(r.amount, r.currency)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-3">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Stat({ n, label, alert }: { n: number; label: string; alert?: boolean }) {
  return (
    <div>
      <div className={`font-display text-[24px] leading-none tabular ${alert ? 'text-critical' : ''}`}>{n}</div>
      <div className="mt-1 text-[10.5px] text-ink-3">{label}</div>
    </div>
  );
}

function Mini({ label, at }: { label: string; at: Date | null }) {
  return (
    <div className="rounded-lg bg-elev-2 px-2.5 py-2">
      <div className="text-ink-4">{label}</div>
      <div className={`mt-0.5 font-mono ${at ? 'text-ink' : 'text-ink-4'}`}>{at ? when(at) : '—'}</div>
    </div>
  );
}

function waTemplate(stage: string, first: string, number: string, items: string, city: string) {
  if (stage === 'confirming' || stage === 'new')
    return `Hi ${first}, this is FIG customer care. We're confirming your order ${number} (${items}) for delivery to ${city}. Reply YES to confirm, or tell us anything you'd like to change.`;
  if (stage === 'shipped' || stage === 'delivering') return `Hi ${first}, your FIG order ${number} is on its way to you. The courier will call before arriving. Anything we should know?`;
  if (stage === 'delivered' || stage === 'settled') return `Hi ${first}, we hope you love your order ${number}. If anything doesn't fit, reply here and we'll arrange a return.`;
  return `Hi ${first}, this is FIG about your order ${number}.`;
}
