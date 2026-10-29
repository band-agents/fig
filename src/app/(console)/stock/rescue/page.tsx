import Link from 'next/link';
import { ArrowRightLeft, Boxes, CircleCheck, Info, PackagePlus, Truck } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee } from '@/lib/domain/perms';
import { sizeGaps, type SizeGap } from '@/lib/smart/sizes';
import { viewCurrency } from '@/lib/stock/views/common';
import { moneyIn, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';

export const metadata = { title: 'Size rescue' };

// Dan, 28 Oct: the sizes the websites cannot sell on styles that sell, what each costs a week, and
// where to get pieces: another place, a shop, or a purchase order on its way (smart/sizes.ts).

const ACTIONS = [
  { key: '', label: 'Every gap', icon: Boxes },
  { key: 'move', label: 'Move in', icon: ArrowRightLeft },
  { key: 'incoming', label: 'On order', icon: Truck },
  { key: 'reorder', label: 'Reorder', icon: PackagePlus },
] as const;

export default async function RescuePage(props: PageProps<'/stock/rescue'>) {
  const me = await requireUser();
  if (!canSee(me, 'rescue')) sendHome(me);
  const sp = await props.searchParams;
  const action = typeof sp.action === 'string' ? sp.action : '';
  const brand = typeof sp.brand === 'string' ? sp.brand : '';
  const cur = viewCurrency(me);
  const all = await sizeGaps(me);
  const m = (v: number) => moneyIn(v, cur, { compact: true });
  const money = can(me, 'money', 1);
  const brands = [...new Set(all.map((g) => g.brand))].sort();
  const rows = all.filter((g) => (!action || g.action === action) && (!brand || g.brand === brand));
  const count = (k: string) => (k ? all.filter((g) => g.action === k).length : all.length);
  const total = all.reduce((a, g) => a + g.weekly, 0);
  const sizes = all.reduce((a, g) => a + g.gone.length, 0);
  const qs = (o: Record<string, string>) => {
    const q = new URLSearchParams({ ...(action ? { action } : {}), ...(brand ? { brand } : {}), ...o });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return `/stock/rescue${s ? `?${s}` : ''}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Stock & buying" title="Size rescue" sub="Sizes the websites cannot sell on styles that do sell, what each costs a week, and where to get pieces." />

      <section className="panel inv-board grid grid-cols-2 overflow-hidden md:grid-cols-4">
        <div className="inv-stat p-4">
          <div className="text-[12.5px] text-ink-3">Costing a week</div>
          <div className="mt-1.5 font-mono text-[22px] font-semibold leading-none text-[var(--t-amber)] xl:text-[24px]">{money ? `≈ ${m(total)}` : '—'}</div>
          <div className="mt-1.5 text-[11.5px] text-ink-3">online sales missed</div>
        </div>
        <div className="inv-stat p-4">
          <div className="text-[12.5px] text-ink-3">Styles · sizes</div>
          <div className="mt-1.5 font-mono text-[22px] font-semibold leading-none xl:text-[24px]">
            {num(all.length)} <span className="text-ink-3">·</span> {num(sizes)}
          </div>
          <div className="mt-1.5 text-[11.5px] text-ink-3">{num(all.filter((g) => g.allOut).length)} sold out in every size</div>
        </div>
        <div className="inv-stat p-4">
          <div className="text-[12.5px] text-ink-3">Can move in now</div>
          <div className="mt-1.5 font-mono text-[22px] font-semibold leading-none text-[var(--sage-deep)] xl:text-[24px]">{num(count('move'))}</div>
          <div className="mt-1.5 text-[11.5px] text-ink-3">pieces in a shop or another place</div>
        </div>
        <div className="inv-stat p-4">
          <div className="text-[12.5px] text-ink-3">On order · to reorder</div>
          <div className="mt-1.5 font-mono text-[22px] font-semibold leading-none xl:text-[24px]">
            {num(count('incoming'))} <span className="text-ink-3">·</span> {num(count('reorder'))}
          </div>
          <div className="mt-1.5 text-[11.5px] text-ink-3">arriving, or nowhere else holds them</div>
        </div>
      </section>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            const on = action === a.key;
            return (
              <Link key={a.key || 'all'} href={qs({ action: a.key })} className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] transition ${on ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                <Icon className="size-3.5" /> {a.label}
                <span className="font-mono text-[11px] text-ink-4">{num(count(a.key))}</span>
              </Link>
            );
          })}
        </div>
        {brands.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Link href={qs({ brand: '' })} className={`flex h-8 shrink-0 items-center rounded-lg px-2.5 text-[12px] ${!brand ? 'bg-elev-3 font-semibold' : 'text-ink-3 hover:bg-elev-2'}`}>
              All brands
            </Link>
            {brands.map((b) => (
              <Link key={b} href={qs({ brand: brand === b ? '' : b })} className={`flex h-8 shrink-0 items-center rounded-lg px-2.5 text-[12px] ${brand === b ? 'bg-elev-3 font-semibold' : 'text-ink-3 hover:bg-elev-2'}`}>
                {b}
              </Link>
            ))}
          </div>
        )}
      </div>

      <section className="panel overflow-hidden">
        {rows.length === 0 ? (
          <Empty icon={CircleCheck} title="No sizes to rescue" body={all.length ? 'Nothing fits these filters.' : 'Every selling style has every size in the warehouse.'} />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {rows.slice(0, 120).map((g) => (
              <GapRow key={g.productId} g={g} m={money ? m : null} />
            ))}
          </ul>
        )}
      </section>

      <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          A size is out when the warehouse the websites sell from has none. Each costs the style’s online sales a week × that size’s share of what it sells × its price. Pieces in the shops show once Lucida’s logins are in (stock per branch); purchase orders count while they are approved, sent, confirmed or partly received.
        </span>
      </p>
    </div>
  );
}

const ACTION_TONE: Record<SizeGap['action'], string> = { move: 'success', incoming: 'info', reorder: 'attention' };

function GapRow({ g, m }: { g: SizeGap; m: ((v: number) => string) | null }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center">
      <Link href={`/stock/inventory/${g.productId}`} className="flex min-w-0 items-center gap-3 lg:w-[34%]">
        {g.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.image} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded-[7px] object-cover" />
        ) : (
          <span className="h-12 w-9 shrink-0 rounded-[7px] bg-elev-3" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium hover:underline">{g.title}</span>
          <span className="block truncate text-[11.5px] text-ink-3">
            {g.brand} · {g.styleCode} · sells {g.demand.toFixed(1)} a week
          </span>
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {g.gone.slice(0, 10).map((v) => {
          const from = v.sources.filter((s) => s.kind !== 'po').sort((a, b) => b.qty - a.qty)[0];
          const po = v.sources.find((s) => s.kind === 'po');
          return (
            <span key={v.variantId} className="rs-size" data-has={from ? 'move' : po ? 'po' : 'none'} title={`${v.size} · ${v.barcode ?? 'no barcode'} · ${Math.round(v.share * 100)}% of the style's sales${from ? ` · ${from.qty} at ${from.name}` : ''}${po ? ` · ${po.qty} on ${po.name}` : ''}`}>
              <b>{v.size}</b>
              {m && <span>{m(v.weekly)}</span>}
              {from && <span className="rs-src">{from.qty} at {from.name}</span>}
              {!from && po && <span className="rs-src">{po.qty} on order</span>}
            </span>
          );
        })}
        {g.gone.length > 10 && <span className="self-center text-[11px] text-ink-4">+{g.gone.length - 10}</span>}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 lg:w-[250px] lg:justify-end">
        <span className="pill max-w-[170px] truncate" data-tone={ACTION_TONE[g.action]} title={g.actionText}>
          {g.actionText}
        </span>
        {m && (
          <span className="text-right">
            <span className="block whitespace-nowrap font-mono text-[14px] font-semibold">≈ {m(g.weekly)}</span>
            <span className="block text-[11px] text-ink-4">a week</span>
          </span>
        )}
      </div>
    </li>
  );
}
