import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee, READ_ONLY_ROLES } from '@/lib/domain/perms';
import { productionDetail } from '@/lib/production';
import { costPerPiece, marginOn } from '@/lib/domain/production';
import { bySize } from '@/lib/domain/stock/sizes';
import { money, num, pct, when } from '@/lib/format';
import { CancelButton, CostEditor, InspectButton, Payments, ReceiveForm, Steps } from '@/components/production/production';

export const metadata = { title: 'Production order' };

export default async function ProductionOrderPage(props: PageProps<'/production/[id]'>) {
  const me = await requireUser();
  if (!canSee(me, 'production')) sendHome(me);
  const { id } = await props.params;
  const d = await productionDetail(me, id);
  if (!d) notFound();
  const o = d.order;
  const looking = Boolean(me.previewing) || READ_ONLY_ROLES.includes(me.role);
  const canStep = d.canStep && !looking && o.status !== 'cancelled';
  const canManage = d.canManage && !looking;
  const perPiece = d.costs ? costPerPiece(Object.fromEntries(d.costs.map((c) => [c.key, c.value]))) : null;
  const margin = perPiece != null ? marginOn(perPiece, o.retailPrice) : null;
  const paid = d.payments?.filter((x) => x.paidAt).reduce((a, x) => a + x.amount, 0) ?? 0;
  const owed = d.payments?.reduce((a, x) => a + x.amount, 0) ?? 0;

  return (
    <div className="space-y-5">
      <Link href="/production" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Production
      </Link>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {o.image ? <img src={o.image} alt="" className="h-28 w-22 shrink-0 rounded-xl object-cover" /> : <span className="grid h-28 w-22 shrink-0 place-items-center rounded-xl bg-elev-3 text-[11px] text-ink-4">No photo</span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-[21px] font-medium">{o.number}</h1>
              {o.status === 'open' ? (
                <span className="pill" data-tone={o.late ? 'critical' : 'attention'}>
                  <span className="dot" />
                  {o.stageLabel}
                  {o.daysLate ? ` · ${o.daysLate}d late` : ''}
                </span>
              ) : (
                <span className="pill" data-tone="neutral">
                  {o.status === 'done' ? 'Received' : 'Cancelled'}
                </span>
              )}
            </div>
            <div className="mt-1 text-[14px]">{o.title}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
              <span>{o.brand}</span>
              <span className="font-mono">{o.styleCode}</span>
              {o.colour && <span>{o.colour}</span>}
              {o.season && <span>{o.season}</span>}
              <span>{o.market === 'KW' ? 'For Kuwait' : 'For Egypt'}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11.5px] sm:w-[340px]">
            <div className="rounded-xl bg-elev-2 px-3 py-2">
              <div className="text-ink-4">Pieces</div>
              <div className="font-display text-[17px]">{num(o.qty)}</div>
            </div>
            <div className="rounded-xl bg-elev-2 px-3 py-2">
              <div className="text-ink-4">Ex-factory</div>
              <div className="font-mono text-[13px]">{o.dueAt ?? '—'}</div>
            </div>
            <div className="rounded-xl bg-elev-2 px-3 py-2">
              <div className="text-ink-4">Done</div>
              <div className="font-display text-[17px]">{pct(o.progress)}</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line bg-inset/50 px-5 py-3 text-[12.5px]">
          <span>
            <span className="text-ink-3">Size run </span>
            {Object.entries(o.sizes)
              .sort(([a], [b]) => bySize(a, b))
              .map(([s, n]) => `${s} ${num(n)}`)
              .join(' · ')}
          </span>
          {canManage && <span className="ml-auto"><CancelButton id={o.id} cancelled={o.status === 'cancelled'} /></span>}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <section className="panel overflow-hidden">
            <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <h2 className="text-[14px]">Steps</h2>
              <span className="text-[11.5px] text-ink-3">Tick a step the day it is done; move a planned day when the factory gives a new one.</span>
            </header>
            <Steps id={o.id} steps={d.steps} canStep={canStep} current={o.stage} />
          </section>

          <section className="panel overflow-hidden">
            <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <h2 className="text-[14px]">Inspections</h2>
              <span className="text-[11.5px] text-ink-3">
                Lot of {num(o.qty)}: check {d.aql.sample}, pass with up to {d.aql.majorAccept} major and {d.aql.minorAccept} minor defects
              </span>
              {canStep && (
                <span className="ml-auto">
                  <InspectButton id={o.id} qty={o.qty} />
                </span>
              )}
            </header>
            {d.inspections.length === 0 ? (
              <p className="px-5 py-4 text-[12.5px] text-ink-3">No inspections yet. A passed final inspection ticks the Final QC step.</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {d.inspections.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[12.5px]">
                    <span className="pill" data-tone={i.result === 'pass' ? 'success' : i.result === 'rework' ? 'warning' : 'critical'}>
                      {i.result}
                    </span>
                    <span>{i.kind === 'final' ? 'Final' : 'During production'}</span>
                    <span className="text-ink-3">
                      {i.major} major · {i.minor} minor in {num(i.sampled)} of {num(i.lot)}
                    </span>
                    {i.note && <span className="w-full text-ink-2 sm:w-auto">“{i.note}”</span>}
                    <span className="ml-auto text-[11px] text-ink-4">
                      {i.inspector}, {i.at}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel overflow-hidden">
            <header className="border-b border-line px-5 py-3.5">
              <h2 className="text-[14px]">Activity</h2>
            </header>
            {d.log.length === 0 ? (
              <p className="px-5 py-4 text-[12.5px] text-ink-3">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {d.log.map((a) => (
                  <li key={a.id} className="flex gap-3 px-5 py-2.5 text-[12.5px]">
                    <span className="min-w-0 flex-1">{a.message.replace(`${o.number}: `, '')}</span>
                    <span className="shrink-0 text-[11px] text-ink-4">
                      {a.who}, {when(a.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          {d.maker && (
            <section className="panel p-5">
              <div className="eyebrow mb-2">Factory</div>
              <div className="text-[14px] font-medium">{d.maker.name}</div>
              <div className="mt-1 space-y-0.5 text-[12.5px] text-ink-2">
                <div>{[d.maker.city, d.maker.country].filter(Boolean).join(', ')}</div>
                {d.maker.contact && <div>{d.maker.contact}</div>}
                {d.maker.phone && <div className="font-mono">{d.maker.phone}</div>}
                {d.maker.email && <div>{d.maker.email}</div>}
                {d.maker.terms && <div className="text-ink-3">{d.maker.terms}</div>}
              </div>
            </section>
          )}

          {d.costs && (
            <section className="panel overflow-hidden">
              <header className="flex items-center border-b border-line px-5 py-3.5">
                <h2 className="text-[14px]">Cost per piece</h2>
                {canManage && (
                  <span className="ml-auto">
                    <CostEditor id={o.id} costs={d.costs} currency={o.currency} retailPrice={o.retailPrice} />
                  </span>
                )}
              </header>
              <dl className="space-y-1 px-5 py-4 text-[12.5px]">
                {d.costs
                  .filter((c) => c.value > 0)
                  .map((c) => (
                    <div key={c.key} className="flex justify-between">
                      <dt className="text-ink-3">{c.label}</dt>
                      <dd className="font-mono">{money(c.value, o.currency)}</dd>
                    </div>
                  ))}
                <div className="flex justify-between border-t border-line pt-1.5 font-medium">
                  <dt>A piece</dt>
                  <dd className="font-mono">{money(perPiece, o.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-3">The order</dt>
                  <dd className="font-mono">{money((perPiece ?? 0) * o.qty, o.currency)}</dd>
                </div>
                {o.retailPrice != null && (
                  <div className="flex justify-between">
                    <dt className="text-ink-3">Retail · margin</dt>
                    <dd className="font-mono">
                      {money(o.retailPrice, o.currency)}
                      {margin != null && <span className="pill ml-2" data-tone={margin >= 0.6 ? 'success' : margin >= 0.45 ? 'neutral' : 'warning'}>{pct(margin)}</span>}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {d.payments && (
            <section className="panel overflow-hidden">
              <header className="flex items-center border-b border-line px-5 py-3.5">
                <h2 className="text-[14px]">Paying the factory</h2>
                {owed > 0 && <span className="ml-auto text-[11.5px] text-ink-3">{money(paid, o.currency)} of {money(owed, o.currency)} paid</span>}
              </header>
              <Payments id={o.id} payments={d.payments} currency={o.currency} canManage={canManage} canPay={d.canPay && !looking} />
            </section>
          )}

          <section className="panel p-5">
            <div className="eyebrow mb-2">Received in our warehouse</div>
            <div className="mb-3 text-[12.5px] text-ink-2">
              {num(o.received)} of {num(o.qty)} received{o.rejected ? `, ${num(o.rejected)} rejected` : ''}
            </div>
            {canStep && <ReceiveForm id={o.id} received={o.received} rejected={o.rejected} qty={o.qty} />}
          </section>

          {d.note && (
            <section className="panel p-5">
              <div className="eyebrow mb-2">Notes</div>
              <p className="whitespace-pre-line text-[12.5px] text-ink-2">{d.note}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
