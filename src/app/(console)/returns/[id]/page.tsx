import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Store, Truck, UserRound } from 'lucide-react';
import { asc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { can, maskName, seesBrands, seesChannel } from '@/lib/domain/perms';
import { RETURN_REASONS, RETURN_STAGE, RETURN_TRACK, type ReturnReason, type ReturnStage } from '@/lib/domain/stages';
import { money, when } from '@/lib/format';
import { CHANNEL } from '@/lib/channels';
import { findBranch } from '@/lib/domain/branches';
import { photosFor } from '@/lib/return-photos';
import { ChannelChip, ReturnPill, StagePill } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { Timeline } from '@/components/order/timeline';
import { NoteComposer } from '@/components/order/composer';
import { DeskActions } from '@/components/returns/desk-actions';
import { ReviewCard } from '@/components/returns/review-card';
import { reviewContext } from '@/lib/return-query';

export const metadata = { title: 'Return' };

export default async function ReturnPage(props: PageProps<'/returns/[id]'>) {
  const me = await requireUser();
  const { id } = await props.params;
  const db = await getDb();
  const [r] = await db.select().from(schema.returns).where(eq(schema.returns.id, id));
  if (!r || !seesChannel(me, r.channelId)) notFound();
  const [[o], items, events] = await Promise.all([
    db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId)),
    db.select({ ri: schema.returnItems, i: schema.orderItems }).from(schema.returnItems).innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.returnItems.orderItemId)).where(eq(schema.returnItems.returnId, id)),
    db.select({ e: schema.events, hue: schema.users.hue }).from(schema.events).leftJoin(schema.users, eq(schema.users.id, schema.events.actorId)).where(eq(schema.events.returnId, id)).orderBy(asc(schema.events.at)),
  ]);
  if (me.brands?.length && !seesBrands(me, (await db.select({ b: schema.orderItems.brand }).from(schema.orderItems).where(eq(schema.orderItems.orderId, r.orderId))).map((x) => x.b))) notFound();
  const reached: Record<string, Date> = {};
  for (const { e } of events) if (e.toStage) reached[e.toStage] = e.at;
  const idx = RETURN_TRACK.indexOf(r.stage as ReturnStage);
  const seesMoney = can(me, 'money', 1);
  const channel = CHANNEL[r.channelId];
  const branch = findBranch(channel?.brand ?? 'FIG', channel?.country ?? 'EG', r.branch);
  const photos = await photosFor(r.id);
  const track = r.method === 'store' ? RETURN_TRACK.filter((s) => s !== 'pickup' && s !== 'in_transit') : RETURN_TRACK;

  return (
    <div className="space-y-5">
      <Link href="/returns" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Returns
      </Link>
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-[21px] font-medium">{r.number}</h1>
              <ReturnPill stage={r.stage} />
              <SlaChip due={r.dueAt} since={r.stageAt} big />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
              <ChannelChip id={r.channelId} />
              <span>Requested {when(r.requestedAt)}</span>
              <span className="inline-flex items-center gap-1">{r.method === 'store' ? <Store className="size-3.5" /> : <Truck className="size-3.5" />}{r.method === 'store' ? 'Store drop-off' : 'Courier pickup'}</span>
              {/* Nobody on the desk typed this one in: the customer opened it themselves. */}
              {r.openedVia !== 'agent' && (
                <span className="inline-flex items-center gap-1 text-ink-2">
                  <UserRound className="size-3.5" />
                  Self-service{r.openedVia === 'app' ? ' (app)' : ''}
                </span>
              )}
            </div>
          </div>
          {seesMoney && (
            <div className="text-right">
              <div className="text-[11.5px] text-ink-3">{r.resolution === 'refund' ? 'Refund' : r.resolution === 'exchange' ? 'Exchange value' : 'Account credit'}</div>
              <div className="font-display text-[20px] leading-none tabular">{money(r.amount, r.currency)}</div>
              {/* The amount is what the customer was promised, bonus included. Finance pays it, so
                  the part that is not the order's own money is named here. */}
              {r.review?.refundKind === 'partial' && r.review.refundAmount != null && <div className="mt-1 text-[11.5px] text-ink-2">Desk approved {money(r.review.refundAmount, r.currency)} back</div>}
              {r.bonus > 0 && (
                <div className="mt-1 text-[11.5px] text-ink-3">
                  incl. {money(r.bonus, r.currency)} account-credit bonus
                </div>
              )}
            </div>
          )}
        </div>
        <div className="no-scrollbar overflow-x-auto border-t border-line px-5 py-5">
          <ol className="flex min-w-[620px]">
            {track.map((s, i) => {
              const m = RETURN_STAGE[s];
              const done = Boolean(reached[s]) && (RETURN_TRACK.indexOf(s) < idx || r.stage === 'refunded');
              const cur = s === r.stage;
              return (
                <li key={s} className="relative flex flex-1 flex-col items-center text-center" data-tint={m.tint}>
                  {i > 0 && <span className={`absolute right-1/2 top-[11px] h-[2px] w-full ${reached[s] ? 'bg-[var(--tint)]' : 'bg-line-2'}`} style={{ marginRight: 12 }} />}
                  <span className={`relative z-[1] grid size-6 place-items-center rounded-full border-2 ${cur ? 'border-[var(--tint)] bg-bg' : done || reached[s] ? 'border-[var(--tint)] bg-[var(--tint)]' : 'border-line-2 bg-bg'}`}>
                    {cur ? <span className="size-2 animate-pulse rounded-full bg-[var(--tint)]" /> : reached[s] && <Check className="size-3.5 text-bg" strokeWidth={3} />}
                  </span>
                  <span className={`mt-2 text-[11.5px] ${cur ? 'font-medium' : reached[s] ? 'text-ink-2' : 'text-ink-4'}`}>{m.label}</span>
                  {reached[s] && <span className="text-[10.5px] text-ink-3">{when(reached[s]).replace('Today ', '')}</span>}
                </li>
              );
            })}
          </ol>
          {(r.stage === 'rejected' || r.stage === 'closed') && <p className="mt-3 text-[12.5px] text-ink-2">{RETURN_STAGE[r.stage as ReturnStage].label} {r.closedAt ? when(r.closedAt) : ''}</p>}
        </div>
        <div className="border-t border-line bg-inset/50 px-5 py-3">
          <DeskActions
            id={r.id}
            number={r.number}
            stage={r.stage}
            method={r.method}
            scopes={me.scopes}
            review={reviewContext({ amount: seesMoney ? r.amount : null, currency: r.currency, resolution: r.resolution, refundMethod: r.refundMethod, deliveredAt: o?.deliveredAt ?? null, requestedAt: r.requestedAt, photos: photos.length, channelId: r.channelId })}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <section className="panel">
            <header className="border-b border-line px-5 py-3.5">
              <h2 className="text-[14px] font-medium">Coming back</h2>
            </header>
            <ul className="divide-y divide-[var(--line)]">
              {items.map(({ ri, i }) => (
                <li key={ri.id} className="flex gap-4 px-5 py-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {i.image ? <img src={i.image} alt="" className="h-20 w-16 rounded-lg object-cover" /> : <span className="h-20 w-16 rounded-lg bg-elev-3" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{i.brand}</div>
                    <div className="text-[13px]">{i.title}</div>
                    <div className="mt-1 text-[11.5px] text-ink-3">
                      {i.size ? `Size ${i.size} · ` : ''}Qty {ri.quantity} · <span className="font-mono">{i.sku}</span>
                    </div>
                  </div>
                  {seesMoney && <div className="font-mono text-[12.5px]">{money(i.unitPrice * ri.quantity, r.currency)}</div>}
                </li>
              ))}
            </ul>
            <div className="space-y-1 border-t border-line px-5 py-4 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-ink-3">Reason</span>
                <span>{RETURN_REASONS[r.reason as ReturnReason]}</span>
              </div>
              {r.reasonNote && <p className="pt-1 text-ink-2">“{r.reasonNote}”</p>}
              {branch && (
                <div className="flex justify-between pt-1">
                  <span className="text-ink-3">{r.refundMethod === 'cash_at_store' ? 'Collecting from' : 'Bringing it to'}</span>
                  <span className="text-right">{branch.name}</span>
                </div>
              )}
              {photos.length > 0 && (
                <div className="pt-3">
                  {/* What the customer photographed before we collected it. */}
                  <div className="mb-2 text-ink-3">From the customer</div>
                  <div className="flex flex-wrap gap-2">
                    {photos.map((p) => (
                      <a key={p.id} href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/photos/${p.id}`}
                          alt="Sent by the customer with the return"
                          className="h-24 w-20 rounded-lg border border-line object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {r.inspection && (
                <div className="flex justify-between pt-1">
                  <span className="text-ink-3">Inspection</span>
                  <span className={r.inspection === 'pass' ? 'text-good' : 'text-[var(--warn)]'}>
                    {r.inspection.replace('_', ' ')}
                    {r.restocked ? ' · restocked' : ' · not restocked'}
                  </span>
                </div>
              )}
              {r.tracking && (
                <div className="flex justify-between pt-1">
                  <span className="text-ink-3">Pickup waybill</span>
                  <span className="font-mono">{r.tracking}</span>
                </div>
              )}
            </div>
          </section>
          <section className="panel">
            <header className="border-b border-line px-5 py-3.5">
              <h2 className="text-[14px] font-medium">Timeline</h2>
            </header>
            <div className="p-5">
              <div className="mb-5">
                <NoteComposer target={{ returnId: r.id, orderId: r.orderId }} />
              </div>
              <Timeline events={events.map(({ e, hue }) => ({ ...e, hue }))} />
            </div>
          </section>
        </div>
        <aside className="space-y-5">
          <ReviewCard review={r.review ?? null} currency={r.currency} seesMoney={seesMoney} />
          {o && (
            <section className="panel p-5">
              <div className="eyebrow mb-3">Original order</div>
              <Link href={`/orders/${o.id}`} className="flex items-center gap-2 font-mono text-[14px] hover:underline">
                {o.number}
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
                <StagePill stage={o.stage} />
                <span>{can(me, 'customers', 1) ? o.customerName : maskName(o.customerName)}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
                <div className="rounded-lg bg-elev-2 px-2.5 py-2">
                  <div className="text-ink-4">Delivered</div>
                  <div className="font-mono">{o.deliveredAt ? when(o.deliveredAt) : '—'}</div>
                </div>
                <div className="rounded-lg bg-elev-2 px-2.5 py-2">
                  <div className="text-ink-4">Paid by</div>
                  <div>{o.paymentMethod === 'cod' ? 'Cash' : o.paymentMethod.toUpperCase()}</div>
                </div>
              </div>
              {o.paymentMethod === 'cod' && r.resolution === 'refund' && <p className="mt-3 text-[11.5px] text-ink-3">Paid in cash: the refund goes out by wallet or bank transfer, not to a card.</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
