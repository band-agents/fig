import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { PackageSearch, Sparkles } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { getDb, schema } from '@/lib/db';
import { inventoryList, INV_VIEWS, type InvFilters } from '@/lib/stock/views/inventory';
import { marketsFor, viewCurrency } from '@/lib/stock/views/common';
import { VELOCITY_LABEL } from '@/lib/domain/stock/classify';
import { moneyIn, num, pct } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { ExportButton } from '@/components/ui/export-button';
import { ImportButton } from '@/components/ui/import-button';
import { IMPORT_LABEL, mayImport } from '@/lib/imports';
import { Sparkline } from '@/components/charts/charts';
import { ParamFilters } from '@/components/stock/filters';
import { Cover, DemoNote, VelocityPill, companyLabel } from '@/components/stock/bits';
import { KIND } from '@/components/stock/rec-meta';

export const metadata = { title: 'Inventory' };

export default async function InventoryPage(props: PageProps<'/stock/inventory'>) {
  const me = await requireUser();
  const cur = viewCurrency(me);
  if (!canSee(me, 'inventory')) sendHome(me);
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const f: InvFilters = { q: str('q'), market: str('market'), company: str('company'), brand: str('brand'), category: str('category'), velocity: str('velocity'), view: str('view'), location: str('location'), sort: str('sort'), page: Number(str('page') ?? 1) };
  const db = await getDb();
  const [d, locs] = await Promise.all([inventoryList(me, f), db.select().from(schema.locations).orderBy(asc(schema.locations.kind), asc(schema.locations.name))]);
  const markets = marketsFor(me);
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, page: undefined, ...patch })) if (v != null && v !== '') next.set(k, String(v));
    return `/stock/inventory?${next}`;
  };
  const pages = Math.ceil(d.total / d.limit);
  const hint = INV_VIEWS.find((v) => v.key === d.view)?.hint;

  return (
    <div>
      <PageHeader
        eyebrow="Stock & buying"
        title="Inventory"
        sub="Every style in every warehouse and shop: pace, cover and the next step."
        right={
          <div className="flex items-center gap-2">
          {mayImport(me, 'costs') && <ImportButton kind="costs" {...IMPORT_LABEL.costs} label="Import costs" />}
          <ExportButton name={`inventory-${d.view}`} href={`/stock/inventory/export${qs({}).replace('/stock/inventory', '')}`} label={`Export ${d.total}`} />
          <div className="flex gap-1 rounded-xl border border-line bg-elev p-1">
            {[{ v: undefined, l: 'All' }, ...markets.map((m) => ({ v: m, l: m === 'EG' ? 'Egypt' : 'Kuwait' }))].map((m) => (
              <Link key={m.l} href={qs({ market: m.v })} className={`flex h-8 items-center rounded-lg px-3 text-[12.5px] ${f.market === m.v ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                {m.l}
              </Link>
            ))}
          </div>
          </div>
        }
      />
      <div className="mb-4">
        <DemoNote />
      </div>

      <div className="no-scrollbar -mx-4 mb-2 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {INV_VIEWS.map((v) => {
          const active = d.view === v.key;
          return (
            <Link key={v.key} href={qs({ view: v.key === 'all' ? undefined : v.key, sort: undefined })} className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] transition ${active ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
              {v.label}
              <span className={`font-mono text-[11px] ${active ? 'opacity-70' : v.key === 'risk' && d.counts[v.key] ? 'text-critical' : 'text-ink-4'}`}>{num(d.counts[v.key] ?? 0)}</span>
            </Link>
          );
        })}
      </div>
      {hint && <p className="mb-3 text-[12px] text-ink-3">{hint}.</p>}

      <ParamFilters
        q={f.q}
        placeholder="Search styles, brands, style codes…"
        selects={[
          { key: 'company', label: 'Every company', value: f.company, options: ['DH', 'DCO', 'FIG'].map((c) => ({ value: c, label: companyLabel(c) })) },
          { key: 'category', label: 'Every category', value: f.category, options: d.categories.map((c) => ({ value: c.id, label: c.label })) },
          { key: 'brand', label: 'Every brand', value: f.brand, options: d.brands.map((b) => ({ value: b, label: b })) },
          { key: 'velocity', label: 'Any pace', value: f.velocity, options: Object.entries(VELOCITY_LABEL).map(([value, label]) => ({ value, label })) },
          { key: 'location', label: 'Everywhere', value: f.location, options: locs.filter((l) => markets.includes(l.country as 'EG' | 'KW')).map((l) => ({ value: l.id, label: l.name })) },
          { key: 'sort', label: 'Sort: stock value', value: f.sort, options: [{ value: 'rate', label: 'Sort: fastest' }, { value: 'cover', label: 'Sort: least cover' }, { value: 'coverDesc', label: 'Sort: most cover' }, { value: 'sell', label: 'Sort: sell-through' }, { value: 'units', label: 'Sort: most pieces' }, { value: 'name', label: 'Sort: A–Z' }] },
        ]}
      />

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-3">
        <span>
          <b className="font-mono text-ink">{num(d.totals.styles)}</b> styles
        </span>
        <span>
          <b className="font-mono text-ink">{num(d.totals.units)}</b> pieces{f.location ? ` at ${locs.find((l) => l.id === f.location)?.name}` : ''}
        </span>
        {d.totals.retail != null && (
          <span>
            <b className="font-mono text-ink">{moneyIn(d.totals.retail, cur, { compact: true })}</b> at retail
          </span>
        )}
      </div>

      <div className="panel mt-3 overflow-hidden">
        {d.rows.length === 0 ? (
          <Empty icon={PackageSearch} title="Nothing here" body={f.q ? `No style matches “${f.q}”.` : 'No style fits these filters.'} />
        ) : (
          <>
            <div className="scroll-thin hidden overflow-x-auto md:block">
              <table className="table text-[12.5px]">
                <thead>
                  <tr>
                    <th>Style</th>
                    <th className="text-right">Pieces</th>
                    <th>Pace, 12 weeks</th>
                    <th className="text-right">Weeks left</th>
                    <th className="text-right">Sell-through</th>
                    <th>Pace</th>
                    <th className="text-right">On order</th>
                    <th>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => {
                    const k = r.next ? KIND[r.next] : null;
                    return (
                      <tr key={r.id} className="group">
                        <td className="max-w-[340px]">
                          <Link href={`/stock/inventory/${r.id}`} className="flex items-center gap-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {r.image ? <img src={r.image} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded-md object-cover" /> : <span className="h-12 w-9 shrink-0 rounded-md bg-elev-3" />}
                            <span className="min-w-0">
                              <span className="block truncate font-medium group-hover:underline">{r.title}</span>
                              <span className="block truncate text-[11px] text-ink-3">
                                {r.brand} · {r.category} · {companyLabel(r.company)} {r.market}
                                {r.season !== 'core' ? ` · ${r.season}` : ''}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="text-right">
                          <div className="font-mono">{num(r.onHand)}</div>
                          <div className="text-[11px] text-ink-4">{f.location ? 'here' : `${num(r.warehouse)} wh · ${num(r.shops)} shops`}</div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-20">
                              <Sparkline data={r.spark} color={r.velocity === 'fast' ? 'var(--s3)' : r.velocity === 'slow' || r.velocity === 'dead' ? 'var(--s4)' : 'var(--s1)'} height={22} />
                            </div>
                            <span className="font-mono text-[11.5px] text-ink-2">{r.rate < 0.1 ? '<0.1' : r.rate.toFixed(r.rate < 10 ? 1 : 0)}/wk</span>
                          </div>
                        </td>
                        <td className="text-right">
                          <Cover weeks={r.cover} />
                          {r.stockout && <div className="text-[11px] text-critical">out wk of {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${r.stockout}T00:00:00Z`))}</div>}
                        </td>
                        <td className="text-right font-mono">{pct(r.sellThrough)}</td>
                        <td>
                          <VelocityPill v={r.velocity} />
                          <span className="ml-1.5 font-mono text-[11px] text-ink-4" title="Share of sales (A–C) and steadiness (X–Z)">
                            {r.abc}
                            {r.xyz}
                          </span>
                        </td>
                        <td className="text-right font-mono text-ink-2">
                          {r.onOrder ? num(r.onOrder) : '—'}
                          {r.inDraft ? <div className="text-[11px] text-ink-4">{num(r.inDraft)} in draft</div> : null}
                        </td>
                        <td>
                          {k ? (
                            <Link href={`/stock/inventory/${r.id}#ai`} className="pill whitespace-nowrap" data-tint={k.tint}>
                              <Sparkles className="size-3 text-[var(--tint)]" /> {k.label}
                            </Link>
                          ) : (
                            <span className="text-[11.5px] text-ink-4">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-[var(--line)] md:hidden">
              {d.rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/stock/inventory/${r.id}`} className="flex gap-3 px-4 py-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.image ? <img src={r.image} alt="" loading="lazy" className="h-16 w-12 shrink-0 rounded-md object-cover" /> : <span className="h-16 w-12 shrink-0 rounded-md bg-elev-3" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{r.title}</div>
                      <div className="truncate text-[11.5px] text-ink-3">
                        {r.brand} · {r.market}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                        <VelocityPill v={r.velocity} />
                        <span className="font-mono">{num(r.onHand)} pcs</span>
                        <span className="text-ink-3">
                          <Cover weeks={r.cover} /> wks
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-[12.5px] text-ink-3">
          <span>
            {num((d.page - 1) * d.limit + 1)}–{num(Math.min(d.total, d.page * d.limit))} of {num(d.total)}
          </span>
          <div className="flex gap-2">
            {d.page > 1 && (
              <Link className="btn btn-quiet btn-sm" href={qs({ page: String(d.page - 1) })}>
                Previous
              </Link>
            )}
            {d.page < pages && (
              <Link className="btn btn-quiet btn-sm" href={qs({ page: String(d.page + 1) })}>
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
