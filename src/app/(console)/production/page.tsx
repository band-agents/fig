import Link from 'next/link';
import { Factory } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee, can, READ_ONLY_ROLES } from '@/lib/domain/perms';
import { makersFor, productionList } from '@/lib/production';
import { marketsFor, viewCurrency } from '@/lib/stock/views/common';
import { money, moneyIn, num, pct } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { MakerButton, NewProductionButton } from '@/components/production/production';
import { Ring } from '@/components/charts/stock-charts';

const PASTELS = ['mint', 'peach', 'sky', 'sand', 'lav', 'aqua', 'lime', 'pink'];
import { CountUp } from '@/components/ui/count-up';

export const metadata = { title: 'Production' };

const TABS = [
  { key: 'orders', label: 'Production orders' },
  { key: 'factories', label: 'Factories' },
];
const STATUS = [
  { key: '', label: 'Open & done' },
  { key: 'open', label: 'In progress' },
  { key: 'late', label: 'Running late' },
  { key: 'done', label: 'Received' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default async function ProductionPage(props: PageProps<'/production'>) {
  const me = await requireUser();
  if (!canSee(me, 'production')) sendHome(me);
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const tab = str('tab') === 'factories' ? 'factories' : 'orders';
  const d = await productionList(me, { status: str('status'), brand: str('brand'), maker: str('maker'), q: str('q') });
  const makers = tab === 'factories' ? await makersFor(me) : [];
  const cur = viewCurrency(me);
  const canEdit = d.canCreate && !me.previewing && !READ_ONLY_ROLES.includes(me.role);
  const qs = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab: tab === 'orders' ? undefined : tab, status: str('status'), brand: str('brand'), maker: str('maker'), ...o })) if (v) q.set(k, v);
    const s = q.toString();
    return `/production${s ? `?${s}` : ''}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Stock & buying"
        title="Production"
        sub="Styles our contract factories make for us, from the brief to our warehouse: every sample, material, cutting, sewing and inspection step with its planned day, so a slipping factory shows the day it slips."
        right={
          canEdit ? (
            <div className="flex gap-2">
              <MakerButton />
              <NewProductionButton makers={d.makers.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }))} brands={d.brands} markets={marketsFor(me)} seesCost={d.seesCost} />
            </div>
          ) : undefined
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'In production', value: num(d.kpi.open), note: `${num(d.kpi.units)} pieces` },
          { label: 'Value at cost', value: d.kpi.valueEgp == null ? '—' : moneyIn(d.kpi.valueEgp, cur, { compact: true }), note: 'open orders' },
          { label: 'Running late', value: num(d.kpi.late), note: 'a step past its day', alert: d.kpi.late > 0 },
          { label: 'Leaving in 30 days', value: num(d.kpi.dueSoon), note: 'ex-factory' },
          { label: 'Final QC pass rate', value: d.kpi.qcPassRate == null ? '—' : pct(d.kpi.qcPassRate), note: 'first and repeat inspections' },
          { label: 'Factories', value: num(d.makers.filter((m) => m.active).length), note: `${num(d.makers.filter((m) => m.open > 0).length)} with work open` },
        ].map((k) => (
          <div key={k.label} className="panel flex flex-col gap-1.5 p-4">
            <span className="text-[12px] text-ink-3">{k.label}</span>
            <div className={`font-display text-[20px] leading-tight tabular ${k.alert ? 'text-critical' : ''}`}>{typeof k.value === 'string' ? <CountUp text={k.value} /> : k.value}</div>
            <div className="truncate text-[11.5px] text-ink-3">{k.note}</div>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link key={t.key} href={t.key === 'orders' ? '/production' : `/production?tab=${t.key}`} className={`flex h-8 shrink-0 items-center rounded-lg px-3 text-[12.5px] transition ${tab === t.key ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
              {t.label}
            </Link>
          ))}
        </div>
        {tab === 'orders' && (
          <div className="no-scrollbar ml-auto flex gap-1 overflow-x-auto">
            {STATUS.map((s) => (
              <Link key={s.key} href={qs({ status: s.key || undefined })} className={`flex h-8 shrink-0 items-center rounded-lg px-3 text-[12px] transition ${(str('status') ?? '') === s.key ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                {s.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {tab === 'orders' ? (
        <>
          {d.kpi.open > 0 && (
            <section className="panel p-4">
              <div className="mb-3 text-[12px] text-ink-3">Where the open orders are</div>
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                {d.byStage.map((s) => (
                  <div key={s.key} className={`min-w-[86px] flex-1 rounded-xl px-3 py-2.5 ${s.n ? 'bg-elev-2' : 'bg-elev-2/40'}`}>
                    <div className="truncate text-[11px] text-ink-3">{s.label}</div>
                    <div className={`font-display text-[17px] leading-tight ${s.n ? '' : 'text-ink-4'}`}>{num(s.n)}</div>
                    <div className="text-[10.5px] text-ink-4">{s.n ? `${num(s.units)} pcs` : ' '}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {d.rows.length === 0 ? (
            <div className="panel overflow-hidden">
              <Empty
                icon={Factory}
                title={d.kpi.open || str('status') ? 'Nothing here' : 'No production orders yet'}
                body={d.makers.length ? 'Place a style with one of your factories and its steps are planned from the day the brief goes out.' : 'Add the factories you work with first, then place production orders with them.'}
              />
            </div>
          ) : (
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {d.rows.map((x, i) => (
                <div key={x.id} className="panel flex flex-col p-2.5">
                  <Link href={`/production/${x.id}`} className="pastel relative flex h-[132px] items-end justify-center overflow-hidden rounded-[8px]" data-pastel={PASTELS[i % PASTELS.length]}>
                    <span className="pastel-dot absolute right-3.5 top-3.5" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {x.image ? <img src={x.image} alt="" className="h-[118px] w-auto rounded-t-xl object-cover shadow-[0_-4px_20px_rgb(0_0_0/0.08)]" /> : <Factory className="mb-5 size-14 text-[color-mix(in_oklab,var(--pastel-dot)_70%,#1f2b25)]" strokeWidth={1.3} />}
                  </Link>
                  <div className="flex items-start gap-2 px-1.5 pt-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/production/${x.id}`} className="block truncate text-[13.5px] font-semibold hover:underline">
                        {x.title}
                      </Link>
                      <div className="truncate text-[11px] text-ink-3">
                        {x.number} · {x.maker}
                      </div>
                    </div>
                    <Ring value={x.status === 'cancelled' ? null : x.progress} size={40} stroke={4} progress />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 px-1.5 pt-3">
                    <div className="chip-box px-2 py-1.5">
                      <div className="text-[10px] text-ink-3">Pieces</div>
                      <div className="text-[12px] font-semibold tabular">{num(x.qty)}</div>
                    </div>
                    <div className="chip-box px-2 py-1.5">
                      <div className="text-[10px] text-ink-3">Now at</div>
                      <div className={`truncate text-[12px] font-semibold ${x.late ? 'text-critical' : ''}`}>{x.status === 'cancelled' ? 'Cancelled' : x.status === 'done' ? 'Received' : x.stageLabel}</div>
                    </div>
                    <div className="chip-box px-2 py-1.5">
                      <div className="text-[10px] text-ink-3">{d.seesCost ? 'At cost' : 'Ex-factory'}</div>
                      <div className="truncate text-[12px] font-semibold tabular">{d.seesCost ? (x.value == null ? '—' : money(x.value, x.currency, { compact: true })) : (x.dueAt ?? '—')}</div>
                    </div>
                  </div>
                  {x.daysLate > 0 && <div className="px-1.5 pt-2 text-[11px] text-critical">{x.daysLate} days behind · ex-factory {x.dueAt}</div>}
                  <div className="mt-auto px-1.5 pb-1 pt-3">
                    <Link href={`/production/${x.id}`} className="btn btn-quiet btn-sm w-full justify-center">
                      Open {x.number}
                    </Link>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      ) : (
        <div className="panel overflow-hidden">
          {makers.length === 0 ? (
            <Empty icon={Factory} title="No factories yet" body="Add each manufacturer you place production with: who to call, what they make, how long they take and how they are paid." />
          ) : (
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Factory</th>
                  <th>Makes</th>
                  <th className="text-right">Open</th>
                  <th className="text-right">Late</th>
                  <th className="text-right">On time</th>
                  <th className="text-right">QC pass</th>
                  <th>Terms</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {makers.map((m) => (
                  <tr key={m.id} className={m.active ? '' : 'opacity-60'}>
                    <td>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-[11px] text-ink-3">
                        {[m.city, m.country].filter(Boolean).join(', ')}
                        {m.contactName ? ` · ${m.contactName}` : ''}
                        {m.phone ? ` · ${m.phone}` : ''}
                      </div>
                    </td>
                    <td className="text-ink-2">{m.skills.join(', ') || '—'}</td>
                    <td className="text-right font-mono">
                      {num(m.open)}
                      {m.units ? <span className="text-ink-3"> · {num(m.units)} pcs</span> : null}
                    </td>
                    <td className={`text-right font-mono ${m.late ? 'text-critical' : ''}`}>{num(m.late)}</td>
                    <td className="text-right font-mono">{m.onTime == null ? '—' : pct(m.onTime)}</td>
                    <td className="text-right font-mono">{m.qcPass == null ? '—' : pct(m.qcPass)}</td>
                    <td className="text-ink-3">
                      {m.paymentTerms ?? '—'}
                      {m.leadDays ? <div className="text-[11px]">{m.leadDays} days lead</div> : null}
                    </td>
                    <td className="text-right">{canEdit && <MakerButton maker={m} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {!can(me, 'production', 3) && <p className="text-[11.5px] text-ink-4">Placing orders and managing factories is for the people with Production manage access.</p>}
    </div>
  );
}
