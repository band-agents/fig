import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Megaphone } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { can, level } from '@/lib/domain/perms';
import { productDetail } from '@/lib/stock/views/product';
import { CHANNELS, channelLabel } from '@/lib/channels';
import { num, pct, when } from '@/lib/format';
import { SizeCurve, WeekStacks } from '@/components/charts/stock-charts';
import { RecCard } from '@/components/stock/rec-card';
import { AdjustStock } from '@/components/stock/adjust';
import { Cover, VelocityPill, companyLabel } from '@/components/stock/bits';

export const metadata = { title: 'Style' };

const MOVE: Record<string, string> = { receive: 'Received', sale: 'Sold', return: 'Returned', transfer_out: 'Sent away', transfer_in: 'Arrived', adjust: 'Adjusted', count: 'Counted', damage: 'Damaged' };

export default async function ProductPage(props: PageProps<'/stock/inventory/[id]'>) {
  const me = await requireUser();
  if (!can(me, 'stock', 1)) notFound();
  const { id } = await props.params;
  const d = await productDetail(me, id);
  if (!d) notFound();
  const p = d.product;
  const fx = d.fx;
  const channelNames = Object.fromEntries(CHANNELS.map((c) => [c.id, channelLabel(c.id)]));
  const sold8 = fx?.sold8 ?? 0;
  const yoy = d.lastYear8 ? (sold8 - d.lastYear8) / d.lastYear8 : null;
  const stats = [
    { label: 'Pieces', value: num(fx?.onHand ?? 0), sub: `${num(fx?.warehouseOnHand ?? 0)} in the warehouse` },
    { label: 'Sells a week', value: fx ? fx.rate.toFixed(fx.rate < 10 ? 1 : 0) : '—', sub: fx ? `${fx.trend > 1.05 ? 'picking up' : fx.trend < 0.95 ? 'slowing' : 'steady'} · ${fx.abc}${fx.xyz}` : '' },
    { label: 'Weeks left', value: fx ? <Cover weeks={fx.cover} /> : '—', sub: fx?.stockout ? `empty week of ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${fx.stockout}T00:00:00Z`))}` : 'lasts the forecast' },
    { label: 'Sell-through', value: fx ? pct(fx.sellThrough8) : '—', sub: 'last 8 weeks' },
    { label: 'On order', value: num(fx?.onOrder ?? 0), sub: fx?.inDraft ? `${num(fx.inDraft)} more in a draft` : 'with suppliers' },
    { label: 'Against last year', value: yoy == null ? '—' : `${yoy >= 0 ? '+' : ''}${Math.round(yoy * 100)}%`, sub: `${num(sold8)} sold in 8 weeks vs ${num(d.lastYear8)}` },
  ];

  return (
    <div className="space-y-6">
      <Link href="/stock/inventory" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Inventory
      </Link>

      <section className="panel overflow-hidden">
        <div className="grid gap-6 p-5 md:grid-cols-[180px_1fr] lg:p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.image ? <img src={p.image} alt="" className="aspect-[3/4] w-full max-w-[220px] rounded-xl object-cover" /> : <span className="aspect-[3/4] w-full rounded-xl bg-elev-3" />}
          <div className="min-w-0">
            <div className="eyebrow">
              {p.brand} · {companyLabel(p.company)} · {p.market === 'EG' ? 'Egypt' : 'Kuwait'}
            </div>
            <h1 className="mt-2 font-display text-[20px] leading-tight sm:text-[20px]">{p.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              {fx && <VelocityPill v={fx.velocity} />}
              <span className="pill" data-tint="neutral">
                {p.category}
              </span>
              {p.season !== 'core' && (
                <span className="pill" data-tint="neutral">
                  {p.season}
                </span>
              )}
              <span className="font-mono">{p.styleCode}</span>
              {p.price && (
                <span>
                  · <b className="font-medium text-ink">{p.price}</b>
                  {p.compareAt && <s className="ml-1">{p.compareAt}</s>}
                </span>
              )}
              {p.cost && (
                <span>
                  · cost {p.cost} · margin {pct(p.margin ?? 0)}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px] text-ink-3">
              Sold on {p.channels.length ? p.channels.map((c) => channelNames[c] ?? c).join(', ') : 'no website'} and in the shops that carry {p.brand}.
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl bg-elev-2 px-3 py-2.5">
                  <div className="text-[11px] text-ink-3">{s.label}</div>
                  <div className="mt-0.5 font-display text-[16px] leading-none">{s.value}</div>
                  <div className="mt-1 truncate text-[11px] text-ink-4">{s.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {d.recs.length > 0 && (
        <section id="ai" className="space-y-3">
          <h2 className="text-[14px] font-medium">Suggested actions</h2>
          <div className="grid gap-3 xl:grid-cols-2">
            {d.recs.map((r) => (
              <RecCard key={r.id} rec={r} publishLevel={level(me, 'merch')} channelNames={channelNames} />
            ))}
          </div>
        </section>
      )}

      <section className="panel p-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="eyebrow mb-1">A year of sales, half a year ahead</div>
            <h2 className="text-[14px] font-medium">Pieces sold each week</h2>
          </div>
          {fx && <span className="text-[11.5px] text-ink-3">{pct(fx.onlineShare)} of it on the websites</span>}
        </div>
        <WeekStacks weeks={d.weeks} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="panel overflow-hidden">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-medium">Where it is</h2>
            {d.canAdjust && <AdjustStock sizes={d.sizes} places={d.places.map((x) => ({ id: x.id, name: x.name }))} />}
          </header>
          <div className="scroll-thin overflow-x-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Place</th>
                  {d.sizes.map((s) => (
                    <th key={s.id} className="text-right">
                      {s.size}
                    </th>
                  ))}
                  <th className="text-right">Total</th>
                  <th className="text-right">A week</th>
                  <th className="text-right">Weeks left</th>
                </tr>
              </thead>
              <tbody>
                {d.places.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">
                      <div className={x.kind === 'warehouse' ? 'font-medium' : ''}>{x.name}</div>
                      <div className="text-[11px] text-ink-4">
                        {x.bin ? `Bin ${x.bin} · ` : ''}
                        {x.counted ? `counted ${when(x.counted)}` : 'never counted'}
                      </div>
                    </td>
                    {x.bySize.map((n, i) => (
                      <td key={i} className={`text-right font-mono ${n < 0 ? 'text-critical' : n === 0 ? 'text-ink-4' : ''}`}>
                        {n}
                      </td>
                    ))}
                    <td className="text-right font-mono font-medium">{num(x.onHand)}</td>
                    <td className="text-right font-mono text-ink-2">{x.rate < 0.05 ? '—' : x.rate.toFixed(1)}</td>
                    <td className="text-right">
                      <Cover weeks={x.cover} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel p-5">
          <div className="eyebrow mb-1">Size curve</div>
          <h2 className="mb-1 text-[14px] font-medium">What sells against what is on the shelf</h2>
          <p className="mb-4 text-[11.5px] text-ink-3">A blue bar taller than its amber one is a size that will run out first.</p>
          <SizeCurve rows={d.curve} />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <header className="border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-medium">Supply</h2>
          </header>
          <ul className="divide-y divide-[var(--line)]">
            {d.pos.map((po) => (
              <li key={po.id}>
                <Link href={`/stock/purchasing/${po.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-elev-2">
                  <span className="pill" data-tint={po.tint}>
                    <span className="dot" />
                    {po.label}
                  </span>
                  <span className="font-mono text-[12.5px]">{po.number}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{po.supplier}</span>
                  <span className="text-right font-mono text-[12px]">
                    {num(po.received)}/{num(po.qty)}
                  </span>
                  <span className="w-24 text-right text-[11.5px] text-ink-3">{po.expectedAt ? when(po.expectedAt) : ''}</span>
                </Link>
              </li>
            ))}
            {d.transfers.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                <span className="pill" data-tint={t.tint}>
                  <span className="dot" />
                  {t.label}
                </span>
                <span className="font-mono text-[12.5px]">{t.number}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
                  {t.from} → {t.to}
                </span>
                <span className="font-mono text-[12px]">{num(t.qty)}</span>
              </li>
            ))}
            {!d.pos.length && !d.transfers.length && <li className="px-5 py-6 text-[12.5px] text-ink-3">Nothing ordered or moving.</li>}
          </ul>
          {d.placements.length > 0 && (
            <div className="border-t border-line px-5 py-3">
              {d.placements.map((x) => (
                <Link key={x.id} href="/stock/merch" className="flex items-center gap-2 py-1 text-[12px] text-ink-2 hover:text-ink">
                  <Megaphone className="size-3.5 text-ink-3" /> {x.number} “{x.headline}” · {x.role === 'shown' ? 'shown to shoppers' : 'shown on its page'} · {x.status}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="panel overflow-hidden">
          <header className="border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-medium">Ledger</h2>
          </header>
          <ul className="scroll-thin max-h-[420px] divide-y divide-[var(--line)] overflow-y-auto">
            {d.moves.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-2.5 text-[12px]">
                <span className={`w-14 text-right font-mono ${m.qty < 0 ? 'text-ink-2' : 'text-good'}`}>
                  {m.qty > 0 ? '+' : ''}
                  {m.qty}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {MOVE[m.kind] ?? m.kind}
                    {m.size ? ` · ${m.size}` : ''} · {m.place}
                  </span>
                  <span className="block truncate text-[11px] text-ink-4">
                    {m.actorName}
                    {m.note ? ` · ${m.note}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-3">{when(m.at)}</span>
              </li>
            ))}
            {!d.moves.length && <li className="px-5 py-6 text-[12.5px] text-ink-3">No movements yet.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}
