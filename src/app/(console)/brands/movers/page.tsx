import Link from 'next/link';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { moversList, PACES, PERIOD_LABEL, PERIODS, periodOf } from '@/lib/brands';
import { VELOCITY_LABEL } from '@/lib/domain/stock/classify';
import { moneyIn, num } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { ParamFilters } from '@/components/stock/filters';
import { ExportButton } from '@/components/ui/export-button';
import { ByMeasure, MeasureToggle } from '@/components/ui/measure';
import { Card, Chips, Delta, Figure, coverText, share } from '@/components/reports/bits';

export const metadata = { title: 'Fast & slow movers' };

const PACE_TONE = { fast: 'success', steady: 'neutral', slow: 'warning', dead: 'critical', new: 'info' } as const;
const SHOWN = 150;

export default async function MoversPage(props: PageProps<'/brands/movers'>) {
  const me = await requireUser();
  if (!canSee(me, 'brands')) sendHome(me);
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const weeks = periodOf(str('weeks'));
  const f = { brand: str('brand'), pace: str('pace'), category: str('category'), q: str('q') };
  const d = await moversList(me, weeks, f);
  const c = d.currency;
  const m = (v: number | null) => moneyIn(v, c, { compact: true });
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ weeks: String(weeks), ...f, ...patch })) if (v) next.set(k, v);
    return `?${next}`;
  };
  const exportHref = `/brands/movers/export${qs({})}`;
  const inStock = d.styles.filter((x) => x.onHand > 0);
  const count = (pace: string) => (pace === 'slow' ? inStock.filter((x) => x.velocity === 'slow' || x.velocity === 'dead').length : pace === 'dead' ? inStock.filter((x) => x.velocity === 'dead').length : d.styles.filter((x) => x.velocity === pace).length);
  const stuck = inStock.filter((x) => x.velocity === 'slow' || x.velocity === 'dead').reduce((a, x) => ({ n: a.n + x.onHand, v: a.v + x.stockValue }), { n: 0, v: 0 });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fast & slow movers"
        sub={`Every style's pace, ${PERIOD_LABEL[weeks]} to this week: what to buy again and what to push or mark down.`}
        right={
          <>
            <MeasureToggle money={d.money} />
            <ExportButton name={`movers-${f.pace || 'all'}-${weeks}-weeks`} href={exportHref} label={`Export ${num(d.rows.length)}`} />
          </>
        }
      />
      <Chips items={PERIODS.map((w) => ({ href: qs({ weeks: String(w) }), label: PERIOD_LABEL[w], active: w === weeks }))} />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Figure label="Fast movers" value={num(count('fast'))} note="sell well ahead of their category" tone="good" />
        <Figure label="Slow movers in stock" value={num(count('slow'))} note={`${num(count('dead'))} not selling at all`} tone={count('slow') ? 'bad' : undefined} />
        <Figure label="Stock not moving" value={<ByMeasure value={d.money ? m(stuck.v) : undefined} units={`${num(stuck.n)} pcs`} />} note="slow and not-selling styles, at retail" />
        <Figure label="New in" value={num(count('new'))} note="under six weeks live" />
      </section>

      <div className="space-y-3">
        <Chips items={PACES.map((x) => ({ href: qs({ pace: x.id || undefined }), label: x.label, active: (f.pace ?? '') === x.id }))} />
        <ParamFilters
          q={f.q}
          placeholder="Search a style, style code or brand"
          selects={[
            { key: 'brand', label: 'Every brand', value: f.brand, options: d.brands.map((b) => ({ value: b, label: b })) },
            { key: 'category', label: 'Every category', value: f.category, options: d.categories.map((x) => ({ value: x, label: x })) },
          ]}
        />
      </div>

      <Card title={`${num(d.rows.length)} styles`} sub={d.rows.length > SHOWN ? `The first ${SHOWN} here; Export has them all` : undefined} flush right={<><MeasureToggle money={d.money} /><ExportButton name={`movers-${f.pace || 'all'}-${weeks}-weeks`} href={exportHref} quiet /></>}>
        {d.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-ink-3">No style matches.</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Style</th>
                  <th>Brand</th>
                  <th className="text-right">Sold</th>
                  <th className="text-right">vs before</th>
                  <th className="text-right">A week</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">Cover</th>
                  <th className="text-right">Sell-through</th>
                  <th className="text-right">Since sale</th>
                  {d.money && <th className="text-right">Stock value</th>}
                  <th>Pace</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.slice(0, SHOWN).map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Link href={`/stock/inventory/${x.id}`} className="flex items-center gap-2.5 hover:underline">
                        {x.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={x.image} alt="" className="size-9 shrink-0 rounded-lg bg-elev-2 object-cover" loading="lazy" />
                        ) : (
                          <span className="size-9 shrink-0 rounded-lg bg-elev-2" />
                        )}
                        <span className="min-w-0">
                          <span className="block max-w-[240px] truncate font-medium">{x.title}</span>
                          <span className="block text-[11px] text-ink-3">
                            {x.styleCode} · {x.category}
                            {d.money && x.price ? ` · ${m(x.price)}` : ''}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <Link href={`/brands/${encodeURIComponent(x.brand)}?weeks=${weeks}`} className="text-ink-2 hover:underline">
                        {x.brand}
                      </Link>
                    </td>
                    <td className="text-right font-mono">
                      <ByMeasure value={d.money ? m(x.value) : undefined} units={num(x.units)} />
                    </td>
                    <td className="text-right">
                      <Delta now={x.units} before={x.prevUnits} />
                    </td>
                    <td className="text-right font-mono text-ink-2">{x.perWeek.toFixed(1)}</td>
                    <td className="text-right font-mono">{num(x.onHand)}</td>
                    <td className={`text-right font-mono ${x.velocity === 'fast' && x.cover != null && x.cover < 4 ? 'font-semibold text-critical' : 'text-ink-3'}`}>{coverText(x.cover)}</td>
                    <td className="text-right font-mono">{share(x.sellThrough)}</td>
                    <td className="text-right font-mono text-ink-3">{x.weeksSinceSale == null ? 'never' : `${x.weeksSinceSale} wk`}</td>
                    {d.money && <td className="text-right font-mono">{m(x.stockValue)}</td>}
                    <td>
                      <span className="pill" data-tone={PACE_TONE[x.velocity]}>
                        {VELOCITY_LABEL[x.velocity]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
