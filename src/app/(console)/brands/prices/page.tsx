import Link from 'next/link';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { brandsOverview, PERIOD_LABEL, PERIODS, periodOf, TIER_LABEL, TIERS } from '@/lib/brands';
import { bandSheet, brandSheet, tierSheet } from '@/lib/brands-sheets';
import { moneyIn, num, pct } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { WeekBars } from '@/components/charts/week-bars';
import { ExportButton } from '@/components/ui/export-button';
import { ByMeasure, MeasureToggle } from '@/components/ui/measure';
import { Card, Chips, ShareBars, share } from '@/components/reports/bits';

export const metadata = { title: 'High vs low price' };

const TIER_COLOR = { high: 'var(--s1)', mid: 'var(--s4)', low: 'var(--s3)' } as const;
const MARKET = { KW: 'Kuwait', EG: 'Egypt' } as const;

export default async function PricesPage(props: PageProps<'/brands/prices'>) {
  const me = await requireUser();
  if (!canSee(me, 'brands')) sendHome(me);
  const sp = await props.searchParams;
  const weeks = periodOf(typeof sp.weeks === 'string' ? sp.weeks : null);
  const d = await brandsOverview(me, weeks);
  const c = d.currency;
  const m = (v: number | null) => moneyIn(v, c, { compact: true });
  const o = { money: d.money, currency: c, weeks };
  const book = [...(d.money ? [tierSheet(d.tiers, { currency: c, weeks })] : []), ...d.bands.map((b) => bandSheet(b.rows, { ...o, name: `Price bands ${b.market}` })), brandSheet(d.rows, o)];
  const series = (k: 'units' | 'value') => d.trend.series.map((s) => ({ name: TIER_LABEL[s.tier], color: TIER_COLOR[s.tier], values: s[k] }));
  const leader = (k: 'shareValue' | 'shareUnits') => [...d.tiers].sort((a, b) => b[k] - a[k])[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="High vs low price"
        sub={`What sells more: the dearer brands and pieces, or the cheaper ones. ${PERIOD_LABEL[weeks]} to this week, websites.`}
        right={
          <>
            <MeasureToggle money={d.money} />
            <ExportButton name={`price-tiers-${weeks}-weeks`} sheets={book} label="Export all" />
          </>
        }
      />
      <Chips items={PERIODS.map((w) => ({ href: `/brands/prices?weeks=${w}`, label: PERIOD_LABEL[w], active: w === weeks }))} />

      {d.money && d.tiers.length > 0 && (
        <>
          <section className="grid gap-3 sm:gap-4 md:grid-cols-3">
            {TIERS.map((t) => d.tiers.find((x) => x.tier === t))
              .filter((x): x is NonNullable<typeof x> => Boolean(x))
              .map((x) => (
                <div key={x.tier} className="panel p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] font-semibold">{TIER_LABEL[x.tier]}</span>
                    {leader('shareValue')?.tier === x.tier && <span className="pill" data-tone="success">Most sales</span>}
                    {leader('shareValue')?.tier !== x.tier && leader('shareUnits')?.tier === x.tier && <span className="pill" data-tone="info">Most pieces</span>}
                  </div>
                  <div className="mt-1 truncate text-[11.5px] text-ink-3">{x.brands.join(', ')}</div>
                  <div className="mt-3">
                    <ShareBars value={x.shareValue} units={x.shareUnits} money={d.money} />
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div className="chip-box px-2.5 py-2">
                      <dt className="text-ink-3">Sales</dt>
                      <dd className="mt-0.5 font-mono text-[12.5px] font-semibold">
                        <ByMeasure value={m(x.value)} units={num(x.units)} />
                      </dd>
                    </div>
                    <div className="chip-box px-2.5 py-2">
                      <dt className="text-ink-3">Avg a piece</dt>
                      <dd className="mt-0.5 font-mono text-[12.5px] font-semibold">{x.asp ? m(x.asp) : '—'}</dd>
                    </div>
                    <div className="chip-box px-2.5 py-2">
                      <dt className="text-ink-3">Sell-through</dt>
                      <dd className="mt-0.5 font-mono text-[12.5px] font-semibold">{share(x.sellThrough)}</dd>
                    </div>
                  </dl>
                  <div className="mt-2 text-[11px] text-ink-3">{pct(x.stockShare)} of the stock</div>
                </div>
              ))}
          </section>

          <Card title="Week by week, by price tier" sub="Stacked: each bar is a week" right={<MeasureToggle money={d.money} />}>
            <ByMeasure value={<WeekBars weeks={d.trend.weeks} series={series('value')} kind="money" currency={c} />} units={<WeekBars weeks={d.trend.weeks} series={series('units')} kind="pieces" />} />
          </Card>
        </>
      )}

      <section className="grid gap-5 xl:grid-cols-2">
        {d.bands.map((b) => (
          <Card key={b.market} title={`By the price of the piece${d.bands.length > 1 ? ` · ${MARKET[b.market]}` : ''}`} sub="Every style by its full price, whatever the brand" flush right={<><MeasureToggle money={d.money} /><ExportButton name={`price-bands-${b.market}-${weeks}-weeks`} sheets={[bandSheet(b.rows, o)]} quiet /></>}>
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Full price</th>
                  <th className="text-right">Styles</th>
                  <th className="text-right">Sales</th>
                  <th className="min-w-[160px]">Share of sales and pieces</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">Sell-through</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((x) => (
                  <tr key={x.label} className={x.styles ? '' : 'text-ink-4'}>
                    <td className="whitespace-nowrap">{x.label}</td>
                    <td className="text-right font-mono">{num(x.styles)}</td>
                    <td className="text-right font-mono">
                      <ByMeasure value={d.money ? m(x.value) : undefined} units={num(x.units)} />
                    </td>
                    <td>
                      <ShareBars value={x.shareValue} units={x.shareUnits} money={d.money} />
                    </td>
                    <td className="text-right font-mono">{num(x.onHand)}</td>
                    <td className="text-right font-mono">{share(x.sellThrough)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}

        {d.money && (
          <Card title="Brands in each tier" sub="Ranked by the median full price of their live range" flush right={<ExportButton name={`brands-by-tier-${weeks}-weeks`} sheets={[brandSheet(d.rows, o)]} quiet />}>
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Tier</th>
                  <th className="text-right">Full price</th>
                  <th className="text-right">Avg sold at</th>
                  <th className="text-right">Sales</th>
                  <th className="text-right">Sell-through</th>
                </tr>
              </thead>
              <tbody>
                {[...d.rows]
                  .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.fullPrice - a.fullPrice)
                  .map((r) => (
                    <tr key={r.brand}>
                      <td className="font-medium">
                        <Link href={`/brands/${encodeURIComponent(r.brand)}?weeks=${weeks}`} className="hover:underline">
                          {r.brand}
                        </Link>
                      </td>
                      <td className="text-ink-3">{TIER_LABEL[r.tier]}</td>
                      <td className="text-right font-mono">{m(r.fullPrice)}</td>
                      <td className="text-right font-mono text-ink-2">{r.asp ? m(r.asp) : '—'}</td>
                      <td className="text-right font-mono">
                        <ByMeasure value={m(r.value)} units={num(r.units)} />
                      </td>
                      <td className="text-right font-mono">{share(r.sellThrough)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
