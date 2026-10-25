import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { brandsOverview, PERIOD_LABEL, PERIODS, periodOf, TIER_LABEL } from '@/lib/brands';
import { brandSheet, tierSheet } from '@/lib/brands-sheets';
import { moneyIn, num, pct } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { BarList } from '@/components/charts/barlist';
import { ExportButton } from '@/components/ui/export-button';
import { ImportButton } from '@/components/ui/import-button';
import { IMPORT_LABEL, mayImport } from '@/lib/imports';
import { ByMeasure, MeasureToggle } from '@/components/ui/measure';
import { Card, Chips, Delta, Figure, ShareBars, deltaText, coverText, share } from '@/components/reports/bits';

export const metadata = { title: 'Brands' };

const TIER_TONE = { high: 'info', mid: 'neutral', low: 'success' } as const;

export default async function BrandsPage(props: PageProps<'/brands'>) {
  const me = await requireUser();
  if (!canSee(me, 'brands')) sendHome(me);
  const sp = await props.searchParams;
  const weeks = periodOf(typeof sp.weeks === 'string' ? sp.weeks : null);
  const d = await brandsOverview(me, weeks);
  const c = d.currency;
  const m = (v: number | null) => moneyIn(v, c, { compact: true });
  const t = d.totals;
  const sheets = [brandSheet(d.rows, { money: d.money, currency: c, weeks }), ...(d.money ? [tierSheet(d.tiers, { currency: c, weeks })] : [])];
  const gaps = d.rows.reduce((a, r) => ({ soldOut: a.soldOut + (r.web?.soldOutLive ?? 0), stock: a.stock + (r.web?.stockNotLive ?? 0), photo: a.photo + (r.web?.noPhoto ?? 0) }), { soldOut: 0, stock: 0, photo: 0 });
  const top = d.rows.slice(0, 12);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Brands"
        sub={`Each brand's sales, pace, stock and website, ${PERIOD_LABEL[weeks]} to this week. Websites' orders; shop sales are in Lucida.`}
        right={
          <>
            <MeasureToggle money={d.money} />
            {mayImport(me, 'targets') && <ImportButton kind="targets" {...IMPORT_LABEL.targets} label="Import targets" />}
            <ExportButton name={`brands-${weeks}-weeks`} sheets={sheets} />
          </>
        }
      />
      <Chips items={PERIODS.map((w) => ({ href: `/brands?weeks=${w}`, label: PERIOD_LABEL[w], active: w === weeks }))} />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <Figure label="Sales" value={<ByMeasure value={m(t.value)} units={`${num(t.units)} pcs`} />} note={<ByMeasure value={deltaText(t.value, t.prevValue)} units={deltaText(t.units, t.prevUnits)} />} tone={t.units >= t.prevUnits ? 'good' : 'bad'} />
        {d.money && <Figure label="Average selling price" value={t.units ? m(Math.round(t.value / t.units)) : '—'} note="per piece sold" />}
        <Figure label="Sell-through" value={t.units + t.onHand > 0 ? share(t.units / (t.units + t.onHand)) : '—'} note={`sold of sold + on hand`} />
        <Figure label="Stock on hand" value={<ByMeasure value={d.money ? m(t.stockValue) : undefined} units={`${num(t.onHand)} pcs`} />} note={d.money ? `${num(t.onHand)} pieces at retail` : 'pieces'} />
        <Figure label="Website gaps" value={num(gaps.soldOut + gaps.stock + gaps.photo)} note={`${num(gaps.soldOut)} sold out live · ${num(gaps.stock)} stock not live · ${num(gaps.photo)} no photo`} tone={gaps.soldOut + gaps.stock + gaps.photo ? 'bad' : undefined} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Sales by brand" sub={`Top ${top.length} of ${d.rows.length}`} right={<MeasureToggle money={d.money} />}>
          {top.every((r) => !r.units) ? (
            <p className="py-6 text-center text-[12.5px] text-ink-3">No sales in this period.</p>
          ) : (
            <ByMeasure
              value={d.money ? <BarList rows={[...top].sort((a, b) => b.value - a.value).map((r) => ({ label: <Link href={`/brands/${encodeURIComponent(r.brand)}`} className="hover:underline">{r.brand}</Link>, value: r.value, sub: pct(r.shareValue) }))} format={(v) => m(v)} /> : undefined}
              units={<BarList rows={[...top].sort((a, b) => b.units - a.units).map((r) => ({ label: <Link href={`/brands/${encodeURIComponent(r.brand)}`} className="hover:underline">{r.brand}</Link>, value: r.units, sub: pct(r.shareUnits) }))} format={(v) => `${num(v)} pcs`} color="var(--s3)" />}
            />
          )}
        </Card>
        {d.money && d.tiers.length > 0 ? (
          <Card
            title="High vs low price"
            sub="Brands ranked by the median full price of their range"
            right={
              <Link href={`/brands/prices?weeks=${weeks}`} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-ink-3 hover:bg-elev-2 hover:text-ink">
                Details <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            <ul className="space-y-4">
              {d.tiers.map((x) => (
                <li key={x.tier}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="font-semibold">{TIER_LABEL[x.tier]}</span>
                    <span className="truncate text-[11px] text-ink-3">{x.brands.join(', ')}</span>
                  </div>
                  <ShareBars value={x.shareValue} units={x.shareUnits} money={d.money} />
                  <div className="mt-1 flex justify-between text-[11px] text-ink-3">
                    <span>Avg {x.asp ? m(x.asp) : '—'} a piece</span>
                    <span>Sell-through {share(x.sellThrough)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card title="Fast and slow movers" sub="Styles in stock, by pace">
            <BarList rows={d.rows.slice(0, 8).map((r) => ({ label: r.brand, value: r.fast, sub: `${r.slow + r.dead} slow` }))} format={(v) => `${v} fast`} color="var(--s3)" />
          </Card>
        )}
      </section>

      <Card title="Every brand" sub={`${d.rows.length} brands · click one for its page`} flush right={<><MeasureToggle money={d.money} /><ExportButton name={`brands-${weeks}-weeks`} sheets={sheets} quiet /></>}>
        {d.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-ink-3">No brands in your stores yet.</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Brand</th>
                  {d.money && <th>Price</th>}
                  <th className="text-right">Sales</th>
                  <th className="text-right">Share</th>
                  <th className="text-right">vs before</th>
                  {d.money && <th className="text-right">Avg price</th>}
                  <th className="text-right">Sell-through</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">Cover</th>
                  <th className="text-right">Fast</th>
                  <th className="text-right">Slow</th>
                  <th className="text-right">Not selling</th>
                  <th className="text-right">Returned</th>
                  <th className="text-right" title="Live but sold out · stock but not live · live without a photo">Website gaps</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.brand}>
                    <td className="font-medium">
                      <Link href={`/brands/${encodeURIComponent(r.brand)}?weeks=${weeks}`} className="hover:underline">
                        {r.brand}
                      </Link>
                      <div className="text-[11px] font-normal text-ink-3">
                        {num(r.live)} live of {num(r.styles)} styles
                      </div>
                    </td>
                    {d.money && (
                      <td>
                        <span className="pill" data-tone={TIER_TONE[r.tier]}>
                          {TIER_LABEL[r.tier]}
                        </span>
                      </td>
                    )}
                    <td className="text-right font-mono">
                      <ByMeasure value={m(r.value)} units={num(r.units)} />
                    </td>
                    <td className="text-right font-mono text-ink-3">
                      <ByMeasure value={pct(r.shareValue)} units={pct(r.shareUnits)} />
                    </td>
                    <td className="text-right">
                      <ByMeasure value={<Delta now={r.value} before={r.prevValue} />} units={<Delta now={r.units} before={r.prevUnits} />} />
                    </td>
                    {d.money && <td className="text-right font-mono text-ink-2">{r.asp ? m(r.asp) : '—'}</td>}
                    <td className="text-right font-mono">{share(r.sellThrough)}</td>
                    <td className="text-right font-mono">
                      <ByMeasure value={d.money ? m(r.stockValue) : undefined} units={num(r.onHand)} />
                    </td>
                    <td className="text-right font-mono text-ink-3">{coverText(r.cover)}</td>
                    <td className="text-right font-mono text-good">{r.fast || '—'}</td>
                    <td className="text-right font-mono text-[var(--warn)]">{r.slow || '—'}</td>
                    <td className="text-right font-mono text-critical">{r.dead || '—'}</td>
                    <td className="text-right font-mono text-ink-3">{r.returnRate == null ? '—' : pct(r.returnRate)}</td>
                    <td className="text-right font-mono text-ink-3">{r.web ? `${r.web.soldOutLive} · ${r.web.stockNotLive} · ${r.web.noPhoto}` : '—'}</td>
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
