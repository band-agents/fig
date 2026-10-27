import Link from 'next/link';
import { CircleCheck, ImageOff, Info } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee } from '@/lib/domain/perms';
import { listingScores, PARTS, type Listing } from '@/lib/smart/listings';
import { viewCurrency } from '@/lib/stock/views/common';
import { moneyIn, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';

export const metadata = { title: 'Listing score' };

// Dan, 28 Oct: every style the websites can sell, scored on what a shopper needs to buy it, and the
// weakest listings ranked by the sales they put at stake (smart/listings.ts).

const GRADES: { g: Listing['grade']; label: string }[] = [
  { g: 'A', label: '90+' },
  { g: 'B', label: '70–89' },
  { g: 'C', label: '50–69' },
  { g: 'D', label: 'under 50' },
];

export default async function ListingsPage(props: PageProps<'/stock/listings'>) {
  const me = await requireUser();
  if (!canSee(me, 'listings')) sendHome(me);
  const sp = await props.searchParams;
  const brand = typeof sp.brand === 'string' ? sp.brand : '';
  const grade = typeof sp.grade === 'string' ? sp.grade : '';
  const cur = viewCurrency(me);
  const d = await listingScores(me);
  const m = (v: number) => moneyIn(v, cur, { compact: true });
  const money = can(me, 'money', 1);
  const total = Math.max(1, d.listings.length);
  const rows = d.listings.filter((x) => (!brand || x.brand === brand) && (!grade || x.grade === grade) && x.score < 100);
  const qs = (o: Record<string, string>) => {
    const q = new URLSearchParams({ ...(brand ? { brand } : {}), ...(grade ? { grade } : {}), ...o });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return `/stock/listings${s ? `?${s}` : ''}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Stock & buying" title="Listing score" sub="Every style the websites can sell, scored on what a shopper needs to buy it; the weakest first by the sales they put at stake." />

      <section className="panel wv-hero overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[44px] font-semibold leading-none tracking-[-1.5px] sm:text-[56px]">{d.average ?? '—'}</span>
              <span className="text-[14px] text-ink-2">average score out of 100</span>
            </div>
            <p className="mt-2 text-[12.5px] text-ink-3">
              {num(d.listings.length)} styles with pieces · {num(d.weak)} below 70{money && d.stake > 0 ? ` · ≈ ${m(d.stake)} a week at stake` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-3">
            {PARTS.map((p) => (
              <span key={p.key}>
                {p.label} <b className="font-mono text-ink-2">{p.points}</b>
                {d.missingCount[p.label] ? <span className="text-critical"> · {num(d.missingCount[p.label])} missing</span> : null}
              </span>
            ))}
          </div>
        </div>
        <div className="wv-bar mt-5">
          {GRADES.filter((x) => d.grades[x.g] > 0).map((x) => (
            <Link key={x.g} href={qs({ grade: grade === x.g ? '' : x.g })} className="wv-seg ls-fill" data-grade={x.g} style={{ flexGrow: d.grades[x.g] }} title={`${x.g} (${x.label}): ${num(d.grades[x.g])}`} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px]">
          {GRADES.map((x) => (
            <Link key={x.g} href={qs({ grade: grade === x.g ? '' : x.g })} className={`flex items-center gap-1.5 hover:text-ink ${grade === x.g ? 'font-semibold text-ink' : 'text-ink-2'}`}>
              <span className="wv-key ls-fill" data-grade={x.g} />
              {x.g} · {x.label}
              <span className="font-mono text-ink-4">
                {num(d.grades[x.g])} · {Math.round((d.grades[x.g] / total) * 100)}%
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
            <h2 className="text-[14px]">Fix these first</h2>
            {(brand || grade) && (
              <Link href="/stock/listings" className="text-[12px] text-ink-3 hover:text-ink hover:underline">
                Clear filters
              </Link>
            )}
          </div>
          {rows.length === 0 ? (
            <Empty icon={CircleCheck} title="Nothing to fix here" body="Every listing in this view scores 100." />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {rows.slice(0, 80).map((x) => (
                <li key={x.key}>
                  <Link href={`/stock/web-items?store=${x.storeId}&group=all&q=${encodeURIComponent(x.handle ?? x.title)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-elev-2 sm:px-5">
                    {x.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={x.image} alt="" loading="lazy" className="h-11 w-8 shrink-0 rounded-[6px] object-cover" />
                    ) : (
                      <span className="grid h-11 w-8 shrink-0 place-items-center rounded-[6px] bg-elev-3 text-ink-4">
                        <ImageOff className="size-3.5" />
                      </span>
                    )}
                    <span className="ls-score" data-grade={x.grade}>
                      {x.score}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{x.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="mr-1 truncate text-[11px] text-ink-3">
                          {x.brand} · {num(x.units)} pcs · {x.store}
                        </span>
                        {x.missing.map((k) => (
                          <span key={k} className="wv-tag">
                            {k === 'Live' ? 'Not live' : `No ${k.toLowerCase()}`}
                          </span>
                        ))}
                      </span>
                    </span>
                    {money && x.stake > 0 && <span className="hidden shrink-0 text-right font-mono text-[12.5px] font-semibold sm:block">≈ {m(x.stake)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="panel h-fit overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <h2 className="text-[14px]">Brand by brand</h2>
            <p className="mt-0.5 text-[11.5px] text-ink-3">Average score; tap to list a brand.</p>
          </div>
          <ul className="scroll-thin max-h-[520px] overflow-auto px-2 pb-2">
            {d.brands.map((b) => (
              <li key={b.brand}>
                <Link href={qs({ brand: brand === b.brand ? '' : b.brand })} className={`flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-elev-2 ${brand === b.brand ? 'bg-elev-2' : ''}`}>
                  <span className="ls-score ls-score-sm" data-grade={b.score >= 90 ? 'A' : b.score >= 70 ? 'B' : b.score >= 50 ? 'C' : 'D'}>
                    {b.score}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{b.brand}</span>
                    <span className="block text-[11px] text-ink-3">
                      {num(b.styles)} styles · {num(b.weak)} below 70
                    </span>
                  </span>
                  {money && b.stake > 0 && <span className="font-mono text-[12px] text-ink-2">≈ {m(b.stake)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>Scored from the last website reading (Website vs Lucida): styles with pieces on the website or in Lucida. At stake a week: pieces × price × the pace stock sells online × the share of the score it is missing.</span>
      </p>
    </div>
  );
}
