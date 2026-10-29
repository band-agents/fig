import Link from 'next/link';
import { GitCompareArrows, ImageOff, Search, X } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee, READ_ONLY_ROLES } from '@/lib/domain/perms';
import { webItemsView, type Group } from '@/lib/web-items';
import { lucidaAccountCount } from '@/lib/connectors/lucida';
import { REASONS, VERDICTS, type Reason, type Verdict } from '@/lib/domain/web-gap';
import { ago, money, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { ExportButton } from '@/components/ui/export-button';
import { WebItemsRun } from '@/components/stock/web-items';

export const metadata = { title: 'Website vs Lucida' };

// Dan, 27 Oct: "more sexy, clean, clear and to the point". One bar for the whole catalogue, what is in
// the way, brand by brand, then the styles themselves.

const GROUP_ORDER: Group[] = ['matched', 'gap', 'unpublished', 'quiet'];
const GROUP_TEXT: Record<Group, { label: string; hint: string }> = {
  matched: { label: 'Live and right', hint: 'On sale and matching Lucida' },
  gap: { label: 'Live, but off', hint: 'On sale, disagreeing with Lucida' },
  unpublished: { label: 'Not on sale', hint: 'Draft, archived or never uploaded' },
  quiet: { label: 'Nothing to sell', hint: 'No stock on either side' },
};
const SHORT: Record<Verdict, string> = {
  ok: 'Matching Lucida',
  live_web_only: 'Lucida not asked yet',
  live_qty: 'Stock differs',
  live_price: 'Price differs',
  live_not_lucida: 'Lucida has none',
  live_sold_out: 'Sizes sold out',
  unpublished_stock: 'Lucida has stock',
  not_uploaded: 'Never uploaded',
  unpublished: 'Not published',
  unpublished_none: 'No stock anywhere',
};
const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Live', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
  absent: { label: 'Not on it', tone: 'critical' },
};

export default async function WebItemsPage(props: PageProps<'/stock/web-items'>) {
  const me = await requireUser();
  if (!canSee(me, 'webItems')) sendHome(me);
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const f = { store: str('store'), group: str('group'), verdict: str('verdict'), reason: str('reason'), brand: str('brand'), q: str('q') };
  const d = await webItemsView(me, { ...f, page: Number(str('page')) || 1 });
  const canRun = (can(me, 'merch', 2) || can(me, 'stock', 2) || can(me, 'procurement', 3)) && !me.previewing && !READ_ONLY_ROLES.includes(me.role);
  const qs = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...o })) if (v) q.set(k, v);
    const s = q.toString();
    return `/stock/web-items${s ? `?${s}` : ''}`;
  };

  if (d.empty || !d.store) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Stock & buying" title="Website vs Lucida" sub="Is everything that should be on sale on sale, and right?" />
        <div className="panel">
          <Empty icon={GitCompareArrows} title="No website connected for your stores" body="Once a store’s Shopify keys are in this console, its whole catalogue can be read and compared with Lucida here." />
        </div>
      </div>
    );
  }

  const s = d.state;
  const cur = d.store.currency;
  const accounts = lucidaAccountCount();
  const callsNeeded = accounts * Math.max(1, Math.ceil(d.totals.sizes / 3000));
  const read = Boolean(s.websiteAt);
  const asked = d.totals.asked;
  const text = { ...GROUP_TEXT, matched: asked ? GROUP_TEXT.matched : { label: 'Live', hint: 'On sale; not checked with Lucida yet' } };
  const g = d.groups;
  const all = d.totals.styles || 1;
  const verdictsOf = (grp: Group) => d.byVerdict.filter((x) => VERDICTS[x.verdict].group === grp).sort((a, b) => b.styles - a.styles);
  const maxReason = Math.max(1, ...d.byReason.map((x) => x.styles));
  const filtered = Boolean(f.group || f.verdict || f.reason || f.brand || f.q);
  const tab = f.group ?? (f.verdict === 'all' ? 'all' : f.verdict ? VERDICTS[f.verdict as Verdict]?.group : 'look');

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Stock & buying" title="Website vs Lucida" sub="Is everything that should be on sale on sale, and right? Every product on the website beside what Lucida holds for its barcode." right={read ? <ExportButton name="website-vs-lucida" href={`/stock/web-items/export${qs({}).replace('/stock/web-items', '')}`} /> : undefined} />

      {/* where the two readings stand, and the buttons that take them again */}
      <section className="panel flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
        {d.stores.length > 1 && (
          <div className="flex shrink-0 rounded-[6px] bg-elev-2 p-0.5">
            {d.stores.map((x) => (
              <Link key={x.id} href={`/stock/web-items?store=${x.id}`} className={`flex h-8 items-center rounded-[6px] px-3 text-[12.5px] ${x.id === d.store!.id ? 'bg-elev font-semibold text-ink shadow-[var(--card-shadow)]' : 'text-ink-3 hover:text-ink'}`}>
                {x.label}
              </Link>
            ))}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]">
          <Source on={read} name={d.stores.length > 1 ? 'Website' : `${d.store.label} website`} text={s.websiteAt ? `${num(s.products ?? 0)} products · ${num(s.sizes ?? 0)} sizes · read ${ago(s.websiteAt)}` : 'not read yet'} />
          <Source on={Boolean(d.lucida && s.lucidaAt)} name="Lucida" text={!d.lucida ? 'not connected yet' : s.lucidaAt ? `${num(s.lucidaReported ?? 0)} sizes with stock · asked ${ago(s.lucidaAt)}` : 'not asked yet'} />
          {s.error && <span className="text-critical">Last run failed: {s.error}</span>}
        </div>
        <WebItemsRun store={d.store.id} lucida={d.lucida && read} running={s.running ?? null} canRun={canRun} callsNeeded={callsNeeded} accounts={accounts} callsLeft={d.budget?.left ?? null} />
      </section>

      {!read ? (
        <div className="panel">
          <Empty icon={GitCompareArrows} title="The website has not been read yet" body={canRun ? 'Read the website to list every product, live or not, with what each is missing.' : 'Someone with Merchandising or Stock access can read the website for this page.'} />
        </div>
      ) : (
        <>
          {/* the whole catalogue in one bar */}
          <section className="panel wv-hero overflow-hidden p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[44px] font-semibold leading-none tracking-[-1.5px] sm:text-[56px]">{Math.round((g.matched / all) * 100)}%</span>
                  <span className="text-[14px] text-ink-2">{asked ? 'of the catalogue is live and right' : 'of the catalogue is live'}</span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-ink-3">
                  {num(g.matched)} of {num(d.totals.styles)} styles{d.brands.length > 1 ? ` across ${num(d.brands.length)} brands` : ''}
                  {!asked && ' · Lucida’s stock and prices join in once Lucida is asked'}
                </p>
              </div>
            </div>
            <div className="wv-bar mt-5" role="img" aria-label="The catalogue by state">
              {GROUP_ORDER.filter((k) => g[k] > 0).map((k) => (
                <Link key={k} href={qs({ group: k, verdict: undefined, reason: undefined, page: undefined })} className="wv-seg" data-g={k} style={{ flexGrow: g[k] }} title={`${text[k].label}: ${num(g[k])}`} />
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
              {GROUP_ORDER.map((k) => (
                <div key={k} className={`min-w-0 ${f.group === k ? 'wv-on' : ''}`}>
                  <Link href={qs({ group: f.group === k ? undefined : k, verdict: undefined, reason: undefined, page: undefined })} className="group block">
                    <div className="flex items-center gap-2 text-[12px] text-ink-3">
                      <span className="wv-key" data-g={k} />
                      <span className="group-hover:text-ink">{text[k].label}</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-[26px] font-semibold leading-none tracking-[-0.5px]">{num(g[k])}</span>
                      <span className="font-mono text-[12px] text-ink-4">{Math.round((g[k] / all) * 100)}%</span>
                    </div>
                  </Link>
                  <ul className="mt-2 space-y-0.5">
                    {verdictsOf(k).length ? (
                      verdictsOf(k).map((x) => (
                        <li key={x.verdict}>
                          <Link href={qs({ group: undefined, verdict: x.verdict, reason: undefined, page: undefined })} className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 -mx-1.5 text-[12px] hover:bg-elev-2 ${f.verdict === x.verdict ? 'bg-elev-2 font-medium text-ink' : 'text-ink-2'}`}>
                            <span className="truncate">{SHORT[x.verdict]}</span>
                            <span className="font-mono text-ink-3">{num(x.styles)}</span>
                          </Link>
                        </li>
                      ))
                    ) : (
                      <li className="text-[12px] text-ink-4">{text[k].hint}</li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* what keeps styles off sale or wrong */}
            <div className="panel overflow-hidden">
              <div className="px-5 pt-4 pb-2">
                <h2 className="text-[14px]">What is in the way</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">Styles not live and right, by reason. A style can have several.</p>
              </div>
              <ul className="px-2 pb-3">
                {d.byReason.map((x) => {
                  const on = f.reason === x.reason;
                  return (
                    <li key={x.reason}>
                      <Link href={qs({ reason: on ? undefined : x.reason, group: f.group ?? (f.verdict ? undefined : 'all'), page: undefined })} className={`block rounded-xl px-3 py-2 transition hover:bg-elev-2 ${on ? 'bg-elev-2' : ''}`}>
                        <div className="flex items-center justify-between gap-3 text-[12.5px]">
                          <span className={`truncate ${on ? 'font-semibold' : ''}`}>{REASONS[x.reason]}</span>
                          <span className="font-mono font-semibold">{num(x.styles)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elev-3">
                          <div className="wv-reason h-full rounded-full" data-r={x.reason} style={{ width: `${Math.max(1.5, (x.styles / maxReason) * 100)}%` }} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
                {!d.byReason.length && <li className="px-3 py-6 text-center text-[12.5px] text-ink-3">Nothing in the way.</li>}
              </ul>
            </div>

            {/* brand by brand */}
            <div className="panel flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-end justify-between gap-3 px-5 pt-4 pb-2">
                <div>
                  <h2 className="text-[14px]">Brand by brand</h2>
                  <p className="mt-0.5 text-[11.5px] text-ink-3">Most to fix first. Tap a brand to list its styles.</p>
                </div>
                <div className="hidden items-center gap-3 text-[11px] text-ink-3 sm:flex">
                  {GROUP_ORDER.slice(0, 3).map((k) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span className="wv-key" data-g={k} />
                      {text[k].label}
                    </span>
                  ))}
                </div>
              </div>
              <ul className="scroll-thin max-h-[388px] overflow-auto px-2 pb-3">
                {d.brands.map((b) => {
                  const on = f.brand === b.brand;
                  const fix = b.groups.gap + b.groups.unpublished;
                  return (
                    <li key={b.brand}>
                      <Link href={qs({ brand: on ? undefined : b.brand, page: undefined })} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-xl px-3 py-2 transition hover:bg-elev-2 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)_64px_64px] ${on ? 'bg-elev-2' : ''}`}>
                        <span className={`truncate text-[12.5px] ${on ? 'font-semibold' : 'font-medium'}`}>{b.brand}</span>
                        <span className="wv-bar wv-bar-sm order-last col-span-2 sm:order-none sm:col-span-1">
                          {GROUP_ORDER.filter((k) => b.groups[k] > 0).map((k) => (
                            <span key={k} className="wv-seg" data-g={k} style={{ flexGrow: b.groups[k] }} />
                          ))}
                        </span>
                        <span className="text-right font-mono text-[12px] text-ink-3" title="Styles">
                          {num(b.total)}
                        </span>
                        <span className={`hidden text-right font-mono text-[12.5px] font-semibold sm:block ${fix ? '' : 'text-ink-4'}`} title="Styles to fix: live but off, or not on sale">
                          {num(fix)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* the styles */}
          <section className="panel overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center">
              <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
                {[
                  { k: 'look', label: 'Needs a look', href: qs({ group: undefined, verdict: undefined, page: undefined }) },
                  { k: 'gap', label: text.gap.label, href: qs({ group: 'gap', verdict: undefined, page: undefined }) },
                  { k: 'unpublished', label: text.unpublished.label, href: qs({ group: 'unpublished', verdict: undefined, page: undefined }) },
                  { k: 'matched', label: text.matched.label, href: qs({ group: 'matched', verdict: undefined, page: undefined }) },
                  { k: 'all', label: 'Every style', href: qs({ group: 'all', verdict: undefined, page: undefined }) },
                ].map((t) => (
                  <Link key={t.k} href={t.href} className={`flex h-8 shrink-0 items-center rounded-lg px-3 text-[12.5px] transition ${tab === t.k ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                    {t.label}
                  </Link>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {f.verdict && f.verdict !== 'all' && <Chip label={SHORT[f.verdict as Verdict] ?? f.verdict} href={qs({ verdict: undefined, page: undefined })} />}
                {f.reason && <Chip label={REASONS[f.reason as Reason] ?? f.reason} href={qs({ reason: undefined, page: undefined })} />}
                {f.brand && <Chip label={f.brand} href={qs({ brand: undefined, page: undefined })} />}
                {f.q && <Chip label={`“${f.q}”`} href={qs({ q: undefined, page: undefined })} />}
                {filtered && (
                  <Link href={qs({ group: undefined, verdict: undefined, reason: undefined, brand: undefined, q: undefined, page: undefined })} className="px-1 text-[12px] text-ink-3 hover:text-ink hover:underline">
                    Clear all
                  </Link>
                )}
              </div>
              <form action="/stock/web-items" className="relative flex shrink-0">
                {(['store', 'group', 'verdict', 'reason', 'brand'] as const).map((k) => (f[k] ? <input key={k} type="hidden" name={k} value={f[k]} /> : null))}
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" />
                <input name="q" defaultValue={f.q ?? ''} placeholder="Style, handle or brand…" className="field !h-8 !w-full !pl-8 text-[12.5px] lg:!w-56" />
              </form>
            </div>
            <div className="flex items-center justify-between px-5 pt-3 pb-1 text-[11.5px] text-ink-3">
              <span>
                {num(d.total)} style{d.total === 1 ? '' : 's'}
              </span>
              <span className="hidden sm:inline">Website stock beside Lucida’s, size for size</span>
            </div>
            {d.rows.length === 0 ? (
              <Empty icon={GitCompareArrows} title="Nothing here" body={filtered ? 'Nothing fits these filters.' : 'Every style is live and right.'} />
            ) : (
              <>
                <div className="scroll-thin hidden overflow-x-auto md:block">
                  <table className="table text-[12.5px]">
                    <thead>
                      <tr>
                        <th>Style</th>
                        <th>Website</th>
                        <th className="text-right">Sizes</th>
                        <th className="text-right">Website stock</th>
                        <th className="text-right">Lucida stock</th>
                        <th className="text-right">Price</th>
                        <th>What is wrong</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((x) => (
                        <tr key={x.key}>
                          <td className="max-w-[340px]">
                            <StyleCell x={x} />
                          </td>
                          <td>
                            <span className="pill" data-tone={STATUS[x.status]?.tone ?? 'neutral'}>
                              {STATUS[x.status]?.label ?? x.status}
                            </span>
                          </td>
                          <td className="text-right font-mono text-ink-3">{num(x.sizes)}</td>
                          <td className="text-right font-mono text-[13.5px] font-semibold">{x.status === 'absent' ? <span className="font-normal text-ink-4">—</span> : num(x.webQty)}</td>
                          <td className="text-right font-mono text-[13.5px] font-semibold">
                            {x.lucidaQty == null ? <span className="text-[11.5px] font-normal text-ink-4">not asked</span> : <span className={x.lucidaQty !== x.webQty ? 'text-[var(--t-amber)]' : ''}>{num(x.lucidaQty)}</span>}
                          </td>
                          <td className="whitespace-nowrap text-right font-mono">
                            {x.price ? money(x.price, cur) : <span className="text-ink-4">—</span>}
                            {x.lucidaPrice && x.price && x.lucidaPrice !== x.price ? <div className="text-[11px] text-[var(--t-amber)]">Lucida {money(x.lucidaPrice, cur)}</div> : null}
                          </td>
                          <td className="min-w-[240px]">
                            <Why x={x} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-[var(--line)] md:hidden">
                  {d.rows.map((x) => (
                    <li key={x.key} className="space-y-2.5 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <StyleCell x={x} />
                        <span className="pill shrink-0" data-tone={STATUS[x.status]?.tone ?? 'neutral'}>
                          {STATUS[x.status]?.label ?? x.status}
                        </span>
                      </div>
                      <div className="flex gap-4 text-[11.5px] text-ink-3">
                        <span>
                          Website <b className="font-mono text-ink">{x.status === 'absent' ? '—' : num(x.webQty)}</b>
                        </span>
                        <span>
                          Lucida <b className="font-mono text-ink">{x.lucidaQty == null ? 'not asked' : num(x.lucidaQty)}</b>
                        </span>
                        <span>{num(x.sizes)} sizes</span>
                      </div>
                      <Why x={x} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {d.total > d.per && (
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[12px] text-ink-3">
                <span>
                  {num((d.page - 1) * d.per + 1)}–{num(Math.min(d.total, d.page * d.per))} of {num(d.total)}
                </span>
                <div className="flex gap-2">
                  {d.page > 1 && (
                    <Link href={qs({ page: String(d.page - 1) })} className="btn btn-quiet btn-sm">
                      Previous
                    </Link>
                  )}
                  {d.page * d.per < d.total && (
                    <Link href={qs({ page: String(d.page + 1) })} className="btn btn-quiet btn-sm">
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Source({ on, name, text }: { on: boolean; name: string; text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${on ? 'bg-[var(--sage)]' : 'bg-[var(--line-2)]'}`} />
      <span className="whitespace-nowrap font-medium">{name}</span>
      <span className="truncate text-ink-3">{text}</span>
    </span>
  );
}

function Chip({ label, href }: { label: string; href: string }) {
  return (
    <Link href={href} className="inline-flex h-7 max-w-[260px] items-center gap-1 rounded-lg bg-elev-2 pr-1.5 pl-2.5 text-[12px] text-ink hover:bg-elev-3">
      <span className="truncate">{label}</span>
      <X className="size-3 shrink-0 text-ink-3" />
    </Link>
  );
}

type Row = { title: string; brand: string | null; handle: string | null; image: string | null; verdict: Verdict; reasons: Reason[]; webQty: number; lucidaQty: number | null };

function StyleCell({ x }: { x: Row }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {x.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={x.image} alt="" loading="lazy" className="h-11 w-8 shrink-0 rounded-[6px] object-cover" />
      ) : (
        <span className="grid h-11 w-8 shrink-0 place-items-center rounded-[6px] bg-elev-3 text-ink-4">
          <ImageOff className="size-3.5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium">{x.title}</div>
        <div className="truncate text-[11px] text-ink-3">
          {x.brand ?? 'Brand unknown'}
          {x.handle ? <span className="text-ink-4"> · {x.handle}</span> : ''}
        </div>
      </div>
    </div>
  );
}

/** The verdict in a word, then the reasons as small tags (a style's reasons come from its sizes, so they say "some" where the style still has pieces). */
function Why({ x }: { x: Row }) {
  const v = VERDICTS[x.verdict];
  const tag = (r: Reason) => (r === 'web_no_stock' && x.webQty > 0 ? 'Some sizes at 0' : r === 'lucida_no_stock' && (x.lucidaQty ?? 0) > 0 ? 'Some sizes not in Lucida' : REASON_TAG[r]);
  // the status pill beside it already says draft, archived or never uploaded
  const rest = x.reasons.filter((r) => r !== 'not_uploaded' && r !== 'archived' && r !== 'draft');
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="pill" data-tone={v.tone}>
        <span className="dot" />
        {x.verdict === 'live_sold_out' && x.webQty === 0 ? 'Sold out' : SHORT[x.verdict]}
      </span>
      {rest.slice(0, 4).map((r) => (
        <span key={r} className="wv-tag">
          {tag(r)}
        </span>
      ))}
      {rest.length > 4 && <span className="text-[11px] text-ink-4">+{rest.length - 4}</span>}
    </div>
  );
}

const REASON_TAG: Record<Reason, string> = {
  no_photo: 'No photo',
  no_description: 'No description',
  no_category: 'No category',
  no_price: 'No price',
  no_barcode: 'No barcode',
  web_no_stock: 'No website stock',
  lucida_no_stock: 'No Lucida stock',
  archived: 'Archived',
  draft: 'Draft',
  not_uploaded: 'Never uploaded',
  qty_differs: 'Stock differs',
  price_differs: 'Price differs',
};
