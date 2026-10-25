import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Sparkles } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/domain/perms';
import { poDetail } from '@/lib/stock/views/purchasing';
import { PO_STATUS, type PoStatus } from '@/lib/domain/stock/flows';
import { TASK_KIND, type TaskKind } from '@/lib/domain/stock/work';
import { num, when } from '@/lib/format';
import { LineQty, PoAddLines, PoSteps, ReceiveButton } from '@/components/stock/purchasing';
import { Cover } from '@/components/stock/bits';

export const metadata = { title: 'Purchase order' };

export default async function PoPage(props: PageProps<'/stock/purchasing/[id]'>) {
  const me = await requireUser();
  if (!can(me, 'procurement', 1) && !can(me, 'warehouse', 1)) notFound();
  const { id } = await props.params;
  const d = await poDetail(me, id);
  if (!d) notFound();
  const po = d.po;
  const reached = (s: PoStatus) => {
    const order = ['draft', 'approval', 'approved', 'sent', 'confirmed', 'partial', 'received', 'closed'];
    return order.indexOf(po.status) >= order.indexOf(s) && po.status !== 'cancelled';
  };
  const units = d.styles.reduce((a, s) => a + s.qty, 0);
  const got = d.styles.reduce((a, s) => a + s.received, 0);

  return (
    <div className="space-y-5">
      <Link href="/stock/purchasing?tab=orders" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Purchase orders
      </Link>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-[21px] font-medium">{po.number}</h1>
              <span className="pill" data-tint={po.late ? 'red' : po.tint}>
                <span className="dot" />
                {po.late ? `Late · ${po.statusLabel}` : po.statusLabel}
              </span>
              {po.source === 'ai' && (
                <span className="pill" data-tint="violet">
                  <Sparkles className="size-3" /> From the buy plan
                </span>
              )}
            </div>
            <div className="mt-2 text-[12.5px]">{d.supplier?.name}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
              <span>to {d.location?.name}</span>
              <span>raised by {po.createdByName}</span>
              {po.approvedByName && <span>approved by {po.approvedByName}</span>}
              {d.fmt.expected && <span className={po.late ? 'text-critical' : ''}>expected {d.fmt.expected}</span>}
              {d.supplier && <span>{d.supplier.paymentTerms}</span>}
            </div>
            {po.reason && <p className="mt-2 text-[12.5px] text-ink-2">{po.reason}</p>}
          </div>
          <div className="text-right">
            {po.total && <div className="font-display text-[20px] leading-none">{po.total}</div>}
            <div className="mt-1 text-[11.5px] text-ink-3">
              {num(units)} pieces · {d.styles.length} styles{got ? ` · ${num(got)} received` : ''}
            </div>
            {d.overLimit && ['draft', 'approval'].includes(po.status) && <div className="mt-1 text-[11.5px] text-[var(--warn)]">Over the {d.limit} limit: needs an approver</div>}
          </div>
        </div>
        <div className="no-scrollbar overflow-x-auto border-t border-line px-5 py-4">
          <ol className="flex min-w-[560px]">
            {d.track.map((s, i) => {
              const done = reached(s);
              const cur = po.status === s || (s === 'received' && po.status === 'partial');
              return (
                <li key={s} className="relative flex flex-1 flex-col items-center text-center" data-tint={PO_STATUS[s].tint}>
                  {i > 0 && <span className={`absolute right-1/2 top-[11px] h-[2px] w-full ${done ? 'bg-[var(--tint)]' : 'bg-line-2'}`} style={{ marginRight: 12 }} />}
                  <span className={`relative z-[1] grid size-6 place-items-center rounded-full border-2 ${cur ? 'border-[var(--tint)] bg-bg' : done ? 'border-[var(--tint)] bg-[var(--tint)]' : 'border-line-2 bg-bg'}`}>
                    {cur ? <span className="size-2 animate-pulse rounded-full bg-[var(--tint)]" /> : done && <Check className="size-3.5 text-bg" strokeWidth={3} />}
                  </span>
                  <span className={`mt-2 text-[11.5px] ${cur ? 'font-medium' : done ? 'text-ink-2' : 'text-ink-4'}`}>{s === 'received' && po.status === 'partial' ? 'Part received' : PO_STATUS[s].label}</span>
                </li>
              );
            })}
          </ol>
        </div>
        {(d.steps.length > 0 || d.canReceive) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-inset/50 px-5 py-3">
            <PoSteps id={po.id} steps={d.steps} empty={d.empty} />
            {d.empty && d.canEdit && <span className="text-[11.5px] text-ink-3">Add at least one style below to approve it.</span>}
            {d.canReceive && <ReceiveButton id={po.id} number={po.number} styles={d.styles} />}
          </div>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="panel overflow-hidden">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-medium">Lines</h2>
            {d.canEdit && <span className="text-[11.5px] text-ink-3">Change a quantity and press Enter; 0 removes the size.</span>}
          </header>
          {d.styles.length === 0 && <p className="px-5 py-6 text-center text-[12.5px] text-ink-3">{d.canEdit ? 'No styles on this order yet. Add them below.' : 'No styles on this order.'}</p>}
          <ul className="divide-y divide-[var(--line)]">
            {d.styles.map((s) => (
              <li key={s.productId} className="flex gap-4 px-5 py-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s.image ? <img src={s.image} alt="" className="h-20 w-16 shrink-0 rounded-lg object-cover" /> : <span className="h-20 w-16 shrink-0 rounded-lg bg-elev-3" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/stock/inventory/${s.productId}`} className="truncate text-[13px] hover:underline">
                      {s.title}
                    </Link>
                    <span className="shrink-0 font-mono text-[12.5px]">
                      {num(s.qty)}
                      {s.cost && <span className="ml-2 text-ink-3">{s.cost}</span>}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-ink-3">
                    {s.brand}
                    {s.cover != null && (
                      <>
                        {' '}
                        · <Cover weeks={s.cover} /> weeks of cover today
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.sizes.map((z) => (
                      <div key={z.lineId} className="flex items-center gap-1.5 rounded-lg bg-elev-2 px-2 py-1 text-[11.5px]">
                        <span className="text-ink-3">{z.size}</span>
                        {d.canEdit ? <LineQty lineId={z.lineId} qty={z.qty} /> : <span className="font-mono">{z.qty}</span>}
                        {(z.received > 0 || z.damaged > 0) && (
                          <span className="font-mono text-[11px] text-good">
                            ✓{z.received}
                            {z.damaged ? <span className="text-critical"> ✕{z.damaged}</span> : null}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {d.canEdit && <PoAddLines poId={po.id} />}
        </div>
        <aside className="space-y-5">
          {d.tasks.length > 0 && (
            <section className="panel p-5">
              <div className="eyebrow mb-3">Work on this order</div>
              <ul className="space-y-2.5">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2.5 text-[12.5px]">
                    <span className="pill !h-5 shrink-0" data-tint={t.status === 'done' ? 'green' : t.status === 'blocked' ? 'red' : TASK_KIND[t.kind as TaskKind]?.tint ?? 'neutral'}>
                      <span className="dot" />
                      {t.status === 'done' ? 'Done' : t.status === 'doing' ? 'In hand' : t.status === 'blocked' ? 'Blocked' : 'To do'}
                    </span>
                    <span className="min-w-0">
                      <span className="block">{t.title}</span>
                      <span className="block text-[11px] text-ink-3">
                        {t.number} · {t.who ?? 'unassigned'}
                        {t.dueAt && t.status !== 'done' ? ` · due ${when(t.dueAt)}` : t.doneAt ? ` · ${when(t.doneAt)}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="panel p-5">
            <div className="eyebrow mb-3">Timeline</div>
            {d.activity.length === 0 ? (
              <p className="text-[12.5px] text-ink-3">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {d.activity.map((a) => (
                  <li key={a.id} className="text-[12.5px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{a.actorName}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-4">{when(a.at)}</span>
                    </div>
                    <div className="text-ink-2">{a.message}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </section>
    </div>
  );
}
