import Link from 'next/link';
import { Boxes, LayoutGrid, PackageSearch, Rows3, ScanBarcode, Sparkles, Store, Table2, Truck, Warehouse } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { STOCK_STATUSES, stockroom, type SizeRow, type StockFilters, type StyleRow } from '@/lib/stock/views/stockroom';
import { marketsFor, viewCurrency } from '@/lib/stock/views/common';
import { moneyIn, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { ExportButton } from '@/components/ui/export-button';
import { ImportButton } from '@/components/ui/import-button';
import { IMPORT_LABEL, mayImport } from '@/lib/imports';
import { ParamFilters } from '@/components/stock/filters';
import { Cover, DemoNote } from '@/components/stock/bits';
import { KIND } from '@/components/stock/rec-meta';

export const metadata = { title: 'Inventory' };

// Dan, 27 Oct: inventory as a warehouse reads it, not as a website does: SKUs, sizes, places, bins,
// what is coming and what it is worth, at a glance and down to the barcode.

const STATUS_TONE: Record<string, string> = Object.fromEntries(STOCK_STATUSES.map((s) => [s.key || 'all', s.tone]));
const STATUS_WORD: Record<string, string> = { in: 'In stock', broken: 'Sizes missing', low: 'Running low', out: 'Out of stock', over: 'Overstock', dead: 'Not selling', new: 'New in' };
const MODES = [
  { key: 'styles', label: 'Styles', icon: Rows3, hint: 'Each style with its size run' },
  { key: 'skus', label: 'SKUs', icon: ScanBarcode, hint: 'Every size and barcode on its own line' },
  { key: 'matrix', label: 'Matrix', icon: Table2, hint: 'Styles across the places that hold them' },
] as const;
const SORTS = [
  { value: 'units', label: 'Sort: most pieces' },
  { value: 'missing', label: 'Sort: most sizes missing' },
  { value: 'cover', label: 'Sort: least cover' },
  { value: 'rate', label: 'Sort: fastest selling' },
  { value: 'code', label: 'Sort: style code' },
  { value: 'name', label: 'Sort: A–Z' },
];

const fmtDay = (d: string | null) => (d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(d)) : '—');

export default async function InventoryPage(props: PageProps<'/stock/inventory'>) {
  const me = await requireUser();
  const cur = viewCurrency(me);
  if (!canSee(me, 'inventory')) sendHome(me);
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const f: StockFilters = { q: str('q'), market: str('market'), brand: str('brand'), category: str('category'), season: str('season'), location: str('location'), status: str('status'), mode: str('mode'), sort: str('sort'), page: Number(str('page') ?? 1) };
  const d = await stockroom(me, f);
  const markets = marketsFor(me);
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, page: undefined, ...patch })) if (v != null && v !== '') next.set(k, String(v));
    const s = next.toString();
    return `/stock/inventory${s ? `?${s}` : ''}`;
  };
  const pages = Math.max(1, Math.ceil(d.total / d.per));
  const t = d.totals;
  const inRate = t.skus ? t.skusIn / t.skus : 0;
  const allUnits = d.locations.reduce((a, l) => a + l.units, 0);
  const here = f.location ? d.locations.find((l) => l.id === f.location) : null;
  const m = (v: number | null) => moneyIn(v, cur, { compact: true });
  const manyPlaces = d.locations.length > 1;
  const modes = MODES.filter((mo) => mo.key !== 'matrix' || manyPlaces);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Stock & buying"
        title="Inventory"
        sub="Every SKU in every warehouse and shop: pieces, sizes, bins, what is coming and what it is worth."
        right={
          <div className="flex items-center gap-2">
            {mayImport(me, 'costs') && <ImportButton kind="costs" {...IMPORT_LABEL.costs} label="Import costs" />}
            <ExportButton name={`inventory-skus`} href={`/stock/inventory/export${qs({}).replace('/stock/inventory', '')}`} label={`Export ${num(t.skus)} SKUs`} />
            {markets.length > 1 && (
              <div className="flex gap-1 rounded-xl border border-line bg-elev p-1">
                {[{ v: undefined, l: 'All' }, ...markets.map((mk) => ({ v: mk, l: mk === 'EG' ? 'Egypt' : 'Kuwait' }))].map((mk) => (
                  <Link key={mk.l} href={qs({ market: mk.v })} className={`flex h-8 items-center rounded-lg px-3 text-[12.5px] ${f.market === mk.v ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                    {mk.l}
                  </Link>
                ))}
              </div>
            )}
          </div>
        }
      />
      <DemoNote />

      {/* the board: the numbers a stock controller reads first */}
      <section className="panel inv-board grid grid-cols-2 overflow-hidden md:grid-cols-3 xl:grid-cols-6">
        <Stat label={here ? `Pieces at ${here.name}` : 'Pieces on hand'} value={num(t.units)} sub={here ? `${num(t.styles)} styles here` : `across ${num(d.locations.length)} place${d.locations.length === 1 ? '' : 's'}`} icon={Boxes} />
        <Stat label="SKUs in stock" value={`${num(t.skusIn)}`} sub={`of ${num(t.skus)} · ${Math.round(inRate * 100)}%`} icon={ScanBarcode}>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elev-3">
            <div className="h-full rounded-full bg-[var(--sage)]" style={{ width: `${inRate * 100}%` }} />
          </div>
        </Stat>
        <Stat label="SKUs sold out" value={num(t.skusOut)} sub="sizes with no piece" tone={t.skusOut ? 'critical' : undefined} href={qs({ status: 'broken' })} />
        <Stat label="Down to 1–2 pieces" value={num(t.skusLow)} sub="SKUs about to go" tone={t.skusLow ? 'attention' : undefined} />
        <Stat label="Stock value" value={t.retail != null ? m(t.retail) : '—'} sub={t.cost != null ? `${m(t.cost)} at cost` : 'at retail'} />
        <Stat label="Incoming" value={num(t.incoming)} sub="pieces on order or on the way" icon={Truck} href="/stock/purchasing" />
      </section>

      {/* the places: the warehouse and every shop */}
      {manyPlaces && (
        <section className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <Link href={qs({ location: undefined })} className={`inv-loc shrink-0 ${!f.location ? 'is-on' : ''}`}>
            <span className="inv-loc-icon">
              <LayoutGrid className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold">All places</span>
              <span className="block font-mono text-[11.5px] text-ink-3">{num(allUnits)} pcs</span>
            </span>
          </Link>
          {d.locations.map((l) => {
            const Icon = l.kind === 'store' ? Store : Warehouse;
            const share = allUnits ? l.units / allUnits : 0;
            return (
              <Link key={l.id} href={qs({ location: f.location === l.id ? undefined : l.id })} className={`inv-loc shrink-0 ${f.location === l.id ? 'is-on' : ''}`} title={l.place || l.name}>
                <span className="inv-loc-icon">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[160px] truncate text-[12.5px] font-semibold">{l.name}</span>
                  <span className="block font-mono text-[11.5px] text-ink-3">
                    {num(l.units)} pcs · {num(l.styles)} styles
                  </span>
                  <span className="mt-1.5 block h-1 w-28 overflow-hidden rounded-full bg-elev-3">
                    <span className="block h-full rounded-full bg-[var(--ink-3)]" style={{ width: `${Math.max(2, share * 100)}%` }} />
                  </span>
                </span>
              </Link>
            );
          })}
        </section>
      )}

      {/* what to look at, and how */}
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {STOCK_STATUSES.map((st) => {
            const on = (f.status ?? '') === st.key;
            const n = d.statusCounts[st.key] ?? 0;
            return (
              <Link key={st.key || 'all'} href={qs({ status: st.key || undefined, sort: undefined })} title={st.hint} className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] transition ${on ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                {st.key && <span className="inv-dot" data-tone={st.tone} />}
                {st.label}
                <span className="font-mono text-[11px] text-ink-4">{num(n)}</span>
              </Link>
            );
          })}
        </div>
        <div className="flex shrink-0 rounded-[11px] bg-elev-2 p-0.5">
          {modes.map((mo) => {
            const on = d.mode === mo.key;
            const Icon = mo.icon;
            return (
              <Link key={mo.key} href={qs({ mode: mo.key === 'styles' ? undefined : mo.key })} title={mo.hint} className={`flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] transition ${on ? 'bg-elev font-semibold text-ink shadow-[var(--card-shadow)]' : 'text-ink-3 hover:text-ink'}`}>
                <Icon className="size-3.5" /> {mo.label}
              </Link>
            );
          })}
        </div>
      </div>

      <ParamFilters
        q={f.q}
        placeholder="Barcode, SKU, style code or name…"
        selects={[
          { key: 'brand', label: 'Every brand', value: f.brand, options: d.brands.map((b) => ({ value: b, label: b })) },
          { key: 'category', label: 'Every category', value: f.category, options: d.categories.map((c) => ({ value: c.id, label: c.label })) },
          { key: 'season', label: 'Every season', value: f.season, options: d.seasons.map((s) => ({ value: s, label: s })) },
          { key: 'sort', label: 'Sort: stock value', value: f.sort, options: SORTS },
        ]}
      />

      <div className="panel overflow-hidden">
        {(d.mode === 'skus' ? d.skus.length : d.styles.length) === 0 ? (
          <Empty icon={PackageSearch} title="Nothing here" body={f.q ? `Nothing matches “${f.q}”.` : 'Nothing fits these filters.'} />
        ) : d.mode === 'skus' ? (
          <SkuTable rows={d.skus} manyPlaces={manyPlaces} locName={(id) => d.locations.find((l) => l.id === id)?.name ?? id} />
        ) : d.mode === 'matrix' ? (
          <MatrixTable rows={d.styles} columns={d.columns} />
        ) : (
          <StyleTable rows={d.styles} sizes={d.sizes} money={d.seesMoney} m={m} />
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-[12.5px] text-ink-3">
          <span>
            {num((d.page - 1) * d.per + 1)}–{num(Math.min(d.total, d.page * d.per))} of {num(d.total)} {d.mode === 'skus' ? 'SKUs' : 'styles'}
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

function Stat({ label, value, sub, tone, icon: Icon, href, children }: { label: string; value: string; sub?: string; tone?: 'critical' | 'attention'; icon?: typeof Boxes; href?: string; children?: React.ReactNode }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-3">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className={`mt-1.5 whitespace-nowrap font-mono text-[20px] font-semibold leading-none sm:text-[24px] tracking-[-0.5px] ${tone === 'critical' ? 'text-critical' : tone === 'attention' ? 'text-[var(--t-amber)]' : ''}`}>{value}</div>
      {sub && <div className="mt-1.5 truncate text-[11.5px] text-ink-3">{sub}</div>}
      {children}
    </>
  );
  const cls = 'inv-stat block p-4';
  return href ? (
    <Link href={href} className={`${cls} transition`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="pill whitespace-nowrap" data-tone={STATUS_TONE[status] ?? 'neutral'}>
      <span className="dot" />
      {STATUS_WORD[status] ?? status}
    </span>
  );
}

/** A size run: one cell per size, its pieces in it; empty sizes red, the last one or two amber. */
function SizeRun({ sizes }: { sizes: SizeRow[] }) {
  if (!sizes.length) return <span className="text-[11.5px] text-ink-4">—</span>;
  const bySize = new Map<string, SizeRow[]>();
  for (const z of sizes) bySize.set(z.size, [...(bySize.get(z.size) ?? []), z]);
  const cells = [...bySize.entries()];
  const shown = cells.slice(0, 12);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(([size, zs]) => {
        const qs = zs.map((z) => z.qty);
        // red when the size is gone everywhere, amber when it is nearly gone or gone in one of its colours
        const q = qs.every((n) => n <= 0) ? 'out' : qs.some((n) => n <= 2) ? 'low' : 'ok';
        return (
          <span key={size} className="inv-size" data-q={q} title={zs.map((z) => `${size} · ${z.barcode ?? z.sku} · ${z.qty} pcs${z.bins ? ` · bin ${z.bins}` : ''}`).join(' | ')}>
            <span className="inv-size-k">{size.length > 7 ? `${size.slice(0, 6)}…` : size}</span>
            <span className="inv-size-v">{qs.join('·')}</span>
          </span>
        );
      })}
      {cells.length > shown.length && <span className="self-center text-[11px] text-ink-4">+{cells.length - shown.length}</span>}
    </div>
  );
}

function StyleCell({ r }: { r: StyleRow }) {
  return (
    <Link href={`/stock/inventory/${r.id}`} className="flex items-center gap-3">
      {r.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.image} alt="" loading="lazy" className="h-11 w-8 shrink-0 rounded-[6px] object-cover" />
      ) : (
        <span className="grid h-11 w-8 shrink-0 place-items-center rounded-[6px] bg-elev-3 text-ink-4">
          <Boxes className="size-3.5" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12px] font-semibold tracking-tight group-hover:underline">{r.styleCode}</span>
        <span className="block max-w-[260px] truncate text-[12px] text-ink-2">{r.title}</span>
        <span className="block truncate text-[11px] text-ink-4">
          {r.brand} · {r.category}
          {r.season && r.season !== 'core' ? ` · ${r.season}` : ''}
        </span>
      </span>
    </Link>
  );
}

function StyleTable({ rows, sizes, money, m }: { rows: StyleRow[]; sizes: Map<string, SizeRow[]>; money: boolean; m: (v: number | null) => string }) {
  return (
    <>
      <div className="scroll-thin hidden overflow-x-auto md:block">
        <table className="table inv-table text-[12.5px]">
          <thead>
            <tr>
              <th>Style</th>
              <th>Size run · pieces per size</th>
              <th className="text-right">SKUs</th>
              <th className="text-right">On hand</th>
              <th className="text-right">Incoming</th>
              <th className="text-right">Cover</th>
              {money && <th className="text-right">Value</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = r.next ? KIND[r.next] : null;
              return (
                <tr key={r.id} className="group">
                  <td className="max-w-[320px]">
                    <StyleCell r={r} />
                  </td>
                  <td className="min-w-[220px]">
                    <SizeRun sizes={sizes.get(r.id) ?? []} />
                  </td>
                  <td className="text-right font-mono">
                    <span className={r.skusIn < r.skus ? 'text-[var(--t-amber)]' : ''}>{r.skusIn}</span>
                    <span className="text-ink-4">/{r.skus}</span>
                  </td>
                  <td className="text-right">
                    <div className="font-mono text-[14px] font-semibold">{num(r.onHand)}</div>
                    {r.shops > 0 && <div className="text-[11px] text-ink-4">{num(r.warehouse)} wh · {num(r.shops)} shops</div>}
                  </td>
                  <td className="text-right font-mono text-ink-2">{r.incoming ? `+${num(r.incoming)}` : '—'}</td>
                  <td className="text-right">
                    <Cover weeks={r.cover} />
                    <div className="text-[11px] text-ink-4">{r.rate < 0.1 ? '<0.1' : r.rate.toFixed(r.rate < 10 ? 1 : 0)}/wk</div>
                  </td>
                  {money && <td className="whitespace-nowrap text-right font-mono text-ink-2">{m(r.retail)}</td>}
                  <td>
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={r.status} />
                      {k && (
                        <Link href={`/stock/inventory/${r.id}#ai`} title={k.label} className="grid size-6 place-items-center rounded-full bg-elev-2 text-ink-3 hover:text-ink" data-tint={k.tint}>
                          <Sparkles className="size-3 text-[var(--tint)]" />
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[var(--line)] md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <StyleCell r={r} />
              <div className="shrink-0 text-right">
                <div className="font-mono text-[15px] font-semibold">{num(r.onHand)}</div>
                <div className="text-[11px] text-ink-4">pcs</div>
              </div>
            </div>
            <SizeRun sizes={sizes.get(r.id) ?? []} />
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
              <StatusPill status={r.status} />
              <span>
                {r.skusIn}/{r.skus} SKUs
              </span>
              {r.incoming > 0 && <span>+{num(r.incoming)} coming</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function SkuTable({ rows, manyPlaces, locName }: { rows: (SizeRow & { style: StyleRow })[]; manyPlaces: boolean; locName: (id: string) => string }) {
  const bins = rows.some((z) => z.bins);
  const counted = rows.some((z) => z.counted);
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="table inv-table text-[12.5px]">
        <thead>
          <tr>
            <th>Barcode · SKU</th>
            <th>Style</th>
            <th>Size</th>
            {manyPlaces && <th>Where</th>}
            {bins && <th>Bin</th>}
            <th className="text-right">On hand</th>
            {counted && <th>Last counted</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((z) => {
            const places = Object.entries(z.places)
              .filter(([, q]) => q !== 0)
              .sort((a, b) => b[1] - a[1]);
            return (
              <tr key={z.id} className="group">
                <td className="whitespace-nowrap">
                  <div className="font-mono text-[12.5px] font-semibold tracking-tight">{z.barcode ?? <span className="font-normal text-[var(--t-amber)]">no barcode</span>}</div>
                  {z.sku !== z.barcode && <div className="font-mono text-[11px] text-ink-4">{z.sku}</div>}
                </td>
                <td className="max-w-[260px]">
                  <Link href={`/stock/inventory/${z.style.id}`} className="block truncate hover:underline">
                    <span className="font-mono text-[11.5px] text-ink-3">{z.style.styleCode}</span> {z.style.title}
                  </Link>
                  <span className="block truncate text-[11px] text-ink-4">{z.style.brand}</span>
                </td>
                <td className="whitespace-nowrap font-medium">{z.size}</td>
                {manyPlaces && (
                <td>
                  <div className="flex flex-wrap gap-1">
                    {places.length ? (
                      places.slice(0, 3).map(([id, q]) => (
                        <span key={id} className="rounded-md bg-elev-2 px-1.5 py-0.5 text-[11px] whitespace-nowrap">
                          {locName(id)} <b className="font-mono">{q}</b>
                        </span>
                      ))
                    ) : (
                      <span className="text-[11.5px] text-ink-4">nowhere</span>
                    )}
                    {places.length > 3 && <span className="text-[11px] text-ink-4">+{places.length - 3}</span>}
                  </div>
                </td>
                )}
                {bins && <td className="font-mono text-[11.5px] text-ink-3">{z.bins ?? '—'}</td>}
                <td className={`text-right font-mono text-[14px] font-semibold ${z.qty <= 0 ? 'text-critical' : z.qty <= 2 ? 'text-[var(--t-amber)]' : ''}`}>{num(z.qty)}</td>
                {counted && <td className="whitespace-nowrap text-[11.5px] text-ink-3">{fmtDay(z.counted)}</td>}
                <td>
                  <StatusPill status={z.qty <= 0 ? 'out' : z.qty <= 2 ? 'low' : 'in'} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MatrixTable({ rows, columns }: { rows: StyleRow[]; columns: { id: string; name: string; kind: string }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => columns.map((c) => r.byLocation[c.id] ?? 0)));
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="table inv-table text-[12.5px]">
        <thead>
          <tr>
            <th>Style</th>
            {columns.map((c) => (
              <th key={c.id} className="text-center">
                <span className="inline-flex max-w-[110px] items-center gap-1 truncate">
                  {c.kind === 'store' ? <Store className="size-3" /> : <Warehouse className="size-3" />}
                  {c.name}
                </span>
              </th>
            ))}
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="group">
              <td className="max-w-[300px]">
                <StyleCell r={r} />
              </td>
              {columns.map((c) => {
                const q = r.byLocation[c.id] ?? 0;
                return (
                  <td key={c.id} className="text-center">
                    {q > 0 ? (
                      <span className="inv-heat" style={{ ['--h' as string]: `${Math.round(12 + (q / max) * 43)}%` }}>
                        {num(q)}
                      </span>
                    ) : (
                      <span className="text-ink-4">·</span>
                    )}
                  </td>
                );
              })}
              <td className="text-right font-mono text-[14px] font-semibold">{num(r.onHand)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
