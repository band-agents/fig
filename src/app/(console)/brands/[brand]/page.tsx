import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { brandDetail, PERIOD_LABEL, PERIODS, periodOf, TIER_LABEL, type StyleRow } from '@/lib/brands';
import { bandSheet, inView, styleSheet } from '@/lib/brands-sheets';
import { moneyDecimals } from '@/lib/sheet';
import { VELOCITY_LABEL } from '@/lib/domain/stock/classify';
import { moneyIn, num, pct } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { BarList } from '@/components/charts/barlist';
import { WeekBars } from '@/components/charts/week-bars';
import { ExportButton } from '@/components/ui/export-button';
import { ImportButton } from '@/components/ui/import-button';
import { IMPORT_LABEL, mayImport } from '@/lib/imports';
import { ByMeasure, MeasureToggle } from '@/components/ui/measure';
import { Card, Chips, Delta, Figure, deltaText, coverText, share } from '@/components/reports/bits';

export async function generateMetadata(props: PageProps<'/brands/[brand]'>) {
  return { title: decodeURIComponent((await props.params).brand) };
}

const PACE_TONE = { fast: 'success', steady: 'neutral', slow: 'warning', dead: 'critical', new: 'info' } as const;

export default async function BrandPage(props: PageProps<'/brands/[brand]'>) {
  const me = await requireUser();
  if (!canSee(me, 'brands')) sendHome(me);
  const brand = decodeURIComponent((await props.params).brand);
  const sp = await props.searchParams;
  const weeks = periodOf(typeof sp.weeks === 'string' ? sp.weeks : null);
  const d = await brandDetail(me, brand, weeks);
  if (!d) notFound();
  const r = d.row;
  const c = d.currency;
  const m = (v: number | null) => moneyIn(v, c, { compact: true });
  const o = { money: d.money, currency: c, weeks };
  const fast = d.fast.slice(0, 15);
  const slow = d.slow.slice(0, 15);
  const book = [
    styleSheet(d.fast, { ...o, name: 'Fast movers' }),
    styleSheet(d.slow, { ...o, name: 'Slow and not selling' }),
    styleSheet(d.styles, { ...o, name: 'All styles' }),
    { name: 'Categories', columns: [{ key: 'label', label: 'Category' }, { key: 'styles', label: 'Styles', kind: 'int' as const }, { key: 'units', label: 'Pieces sold', kind: 'int' as const }, ...(d.money ? [{ key: 'value', label: `Sales (${c})`, kind: 'num' as const, decimals: moneyDecimals(c) }] : []), { key: 'onHand', label: 'Pieces on hand', kind: 'int' as const }], rows: d.categories.map((x) => ({ ...x, value: inView(x.value, c) })) },
    ...d.bands.map((b) => bandSheet(b.rows, { ...o, name: `Price bands ${b.market}` })),
  ];
  const href = (w: number) => `/brands/${encodeURIComponent(r.brand)}?weeks=${w}`;
  const gaps = r.web ? r.web.soldOutLive + r.web.stockNotLive + r.web.noPhoto : 0;

  return (
    <div className="space-y-5">
      <Link href={`/brands?weeks=${weeks}`} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> All brands
      </Link>
      <PageHeader
        title={r.brand}
        sub={`${d.money ? `${TIER_LABEL[r.tier]} · ` : ''}#${d.rank} of ${d.brands} brands by ${d.money ? 'sales' : 'pieces'} · ${num(r.live)} live of ${num(r.styles)} styles · ${PERIOD_LABEL[weeks]}`}
        right={
          <>
            <MeasureToggle money={d.money} />
            {mayImport(me, 'targets') && <ImportButton kind="targets" {...IMPORT_LABEL.targets} label="Targets" />}
            <ExportButton name={`${r.brand}-${weeks}-weeks`} sheets={book} label="Export all" />
          </>
        }
      />
      <Chips items={PERIODS.map((w) => ({ href: href(w), label: PERIOD_LABEL[w], active: w === weeks }))} />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-6">
        <Figure label="Sales" value={<ByMeasure value={m(r.value)} units={`${num(r.units)} pcs`} />} note={<ByMeasure value={deltaText(r.value, r.prevValue)} units={deltaText(r.units, r.prevUnits)} />} tone={r.units >= r.prevUnits ? 'good' : 'bad'} />
        <Figure label="Share" value={<ByMeasure value={pct(r.shareValue)} units={pct(r.shareUnits)} />} note="of all brands" />
        {d.money && <Figure label="Average selling price" value={r.asp ? m(r.asp) : '—'} note={`full price median ${m(r.fullPrice)}`} />}
        <Figure label="Sell-through" value={share(r.sellThrough)} note={r.markdownShare ? `${pct(r.markdownShare)} sold on markdown` : 'sold of sold + on hand'} />
        <Figure label="Stock" value={<ByMeasure value={d.money ? m(r.stockValue) : undefined} units={`${num(r.onHand)} pcs`} />} note={r.cover == null ? 'no sales to measure cover' : `${coverText(r.cover)} of cover`} tone={r.cover != null && r.cover > 26 ? 'bad' : undefined} />
        {d.month.target ? (
          <Figure
            label="This month vs target"
            value={<ByMeasure value={d.month.target.value != null ? `${share(d.month.target.value ? d.month.value / d.month.target.value : null)}` : undefined} units={d.month.target.units != null ? share(d.month.target.units ? d.month.units / d.month.target.units : null) : '—'} />}
            note={<ByMeasure value={d.month.target.value != null ? `${m(d.month.value)} of ${m(d.month.target.value)}` : undefined} units={d.month.target.units != null ? `${num(d.month.units)} of ${num(d.month.target.units)} pcs` : 'no pieces target'} />}
          />
        ) : (
          <Figure label="Returned" value={r.returnRate == null ? '—' : pct(r.returnRate)} note="of pieces ordered online" tone={r.returnRate != null && r.returnRate > 0.15 ? 'bad' : undefined} />
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Sales by week" sub={`${PERIOD_LABEL[weeks]}, websites`} right={<MeasureToggle money={d.money} />}>
          <ByMeasure
            value={d.money ? <WeekBars weeks={d.weekly.map((w) => w.week)} series={[{ name: r.brand, color: 'var(--s1)', values: d.weekly.map((w) => w.value) }]} kind="money" currency={c} /> : undefined}
            units={<WeekBars weeks={d.weekly.map((w) => w.week)} series={[{ name: r.brand, color: 'var(--s3)', values: d.weekly.map((w) => w.units) }]} kind="pieces" />}
          />
        </Card>
        <Card title="By category" sub={`${d.categories.length} categories`} right={<MeasureToggle money={d.money} />}>
          <ByMeasure
            value={d.money ? <BarList rows={[...d.categories].sort((a, b) => b.value - a.value).map((x) => ({ label: x.label, value: x.value, sub: `${num(x.onHand)} on hand` }))} format={(v) => m(v)} /> : undefined}
            units={<BarList rows={[...d.categories].sort((a, b) => b.units - a.units).map((x) => ({ label: x.label, value: x.units, sub: `${num(x.onHand)} on hand` }))} format={(v) => `${num(v)} pcs`} color="var(--s3)" />}
          />
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card title="Fast movers" sub="Most pieces sold · low cover needs buying" flush right={<ExportButton name={`${r.brand}-fast-movers`} sheets={[styleSheet(d.fast, { ...o, name: 'Fast movers' })]} quiet />}>
          <Styles rows={fast} money={d.money} m={m} mode="fast" empty="Nothing sold in this period." />
        </Card>
        <Card title="Slow and not selling" sub="In stock and not moving · most money stuck first" flush right={<ExportButton name={`${r.brand}-slow-movers`} sheets={[styleSheet(d.slow, { ...o, name: 'Slow and not selling' })]} quiet />}>
          <Styles rows={slow} money={d.money} m={m} mode="slow" empty="Every style in stock is selling." />
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        {d.bands.map((b) => (
          <Card key={b.market} title={`By price${d.bands.length > 1 ? ` · ${b.market === 'KW' ? 'Kuwait' : 'Egypt'}` : ''}`} sub="Full price of each style" flush right={<><MeasureToggle money={d.money} /><ExportButton name={`${r.brand}-price-bands`} sheets={[bandSheet(b.rows, o)]} quiet /></>}>
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Full price</th>
                  <th className="text-right">Styles</th>
                  <th className="text-right">Sales</th>
                  <th className="text-right">Share</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">Sell-through</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((x) => (
                  <tr key={x.label} className={x.styles ? '' : 'text-ink-4'}>
                    <td>{x.label}</td>
                    <td className="text-right font-mono">{num(x.styles)}</td>
                    <td className="text-right font-mono">
                      <ByMeasure value={d.money ? m(x.value) : undefined} units={num(x.units)} />
                    </td>
                    <td className="text-right font-mono text-ink-3">
                      <ByMeasure value={d.money ? pct(x.shareValue) : undefined} units={pct(x.shareUnits)} />
                    </td>
                    <td className="text-right font-mono">{num(x.onHand)}</td>
                    <td className="text-right font-mono">{share(x.sellThrough)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
        <Card
          title="On the website"
          sub="From the last website reading"
          right={
            <Link href={`/stock/web-items?brand=${encodeURIComponent(r.brand)}`} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-ink-3 hover:bg-elev-2 hover:text-ink">
              Open the list <ArrowRight className="size-3.5" />
            </Link>
          }
        >
          {r.web ? (
            <dl className="grid grid-cols-2 gap-3 text-[12.5px]">
              <Fact label="Live styles" value={num(r.web.live)} />
              <Fact label="Live but sold out" value={num(r.web.soldOutLive)} bad={r.web.soldOutLive > 0} />
              <Fact label="Stock but not live" value={num(r.web.stockNotLive)} bad={r.web.stockNotLive > 0} />
              <Fact label="Live without a photo" value={num(r.web.noPhoto)} bad={r.web.noPhoto > 0} />
              <div className="col-span-2 text-[11.5px] text-ink-3">{gaps ? `${num(gaps)} to fix` : 'Nothing to fix.'}</div>
            </dl>
          ) : (
            <p className="text-[12.5px] text-ink-3">The website has not been read for this brand yet.</p>
          )}
        </Card>
      </section>
    </div>
  );
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="chip-box px-3 py-2.5">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className={`mt-0.5 text-[16px] font-semibold ${bad ? 'text-critical' : ''}`}>{value}</dd>
    </div>
  );
}

function Styles({ rows, money, m, mode, empty }: { rows: StyleRow[]; money: boolean; m: (v: number | null) => string; mode: 'fast' | 'slow'; empty: string }) {
  if (!rows.length) return <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">{empty}</p>;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="table text-[12.5px]">
        <thead>
          <tr>
            <th>Style</th>
            <th className="text-right">Sold</th>
            {mode === 'fast' ? <th className="text-right">A week</th> : <th className="text-right">Since sale</th>}
            <th className="text-right">On hand</th>
            <th className="text-right">Cover</th>
            {money && mode === 'slow' && <th className="text-right">Stock value</th>}
            <th>Pace</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
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
                    <span className="block max-w-[220px] truncate font-medium">{x.title}</span>
                    <span className="block text-[11px] text-ink-3">
                      {x.styleCode} · {x.category}
                      {money && x.price ? ` · ${m(x.price)}` : ''}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="text-right font-mono">
                <ByMeasure value={money ? m(x.value) : undefined} units={num(x.units)} />
                <div>
                  <Delta now={x.units} before={x.prevUnits} />
                </div>
              </td>
              {mode === 'fast' ? <td className="text-right font-mono text-ink-2">{x.perWeek.toFixed(1)}</td> : <td className="text-right font-mono text-ink-2">{x.weeksSinceSale == null ? 'never' : `${x.weeksSinceSale} wk`}</td>}
              <td className="text-right font-mono">{num(x.onHand)}</td>
              <td className={`text-right font-mono ${mode === 'fast' && x.cover != null && x.cover < 4 ? 'font-semibold text-critical' : 'text-ink-3'}`}>{coverText(x.cover)}</td>
              {money && mode === 'slow' && <td className="text-right font-mono">{m(x.stockValue)}</td>}
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
  );
}
