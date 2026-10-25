import Link from 'next/link';
import { GitCompareArrows } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee, READ_ONLY_ROLES } from '@/lib/domain/perms';
import { webItemsView } from '@/lib/web-items';
import { lucidaAccountCount } from '@/lib/connectors/lucida';
import { REASONS, VERDICTS, type Reason, type Verdict } from '@/lib/domain/web-gap';
import { ago, money, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { ExportButton } from '@/components/ui/export-button';
import { WebItemsRun } from '@/components/stock/web-items';

export const metadata = { title: 'Website vs Lucida' };

const GROUPS = [
  { key: 'unpublished', label: 'Not on sale', hint: 'Draft, archived or never uploaded' },
  { key: 'gap', label: 'On sale, but off', hint: 'Live on the website, disagreeing with Lucida' },
  { key: 'matched', label: 'On sale and right', hint: 'Live and matching, or Lucida not asked yet' },
  { key: 'quiet', label: 'Not on sale, nothing to sell', hint: 'No stock on either side' },
] as const;

export default async function WebItemsPage(props: PageProps<'/stock/web-items'>) {
  const me = await requireUser();
  if (!canSee(me, 'webItems')) sendHome(me);
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const d = await webItemsView(me, { store: str('store'), verdict: str('verdict'), reason: str('reason'), brand: str('brand'), q: str('q'), page: Number(str('page')) || 1 });
  const canRun = (can(me, 'merch', 2) || can(me, 'stock', 2) || can(me, 'procurement', 3)) && !me.previewing && !READ_ONLY_ROLES.includes(me.role);
  const qs = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const cur = { store: str('store'), verdict: str('verdict'), reason: str('reason'), brand: str('brand'), q: str('q') };
    for (const [k, v] of Object.entries({ ...cur, ...o })) if (v) q.set(k, v);
    const s = q.toString();
    return `/stock/web-items${s ? `?${s}` : ''}`;
  };

  if (d.empty || !d.store) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Stock & buying" title="Website vs Lucida" sub="Every product on the website beside what Lucida holds for it, and why the two differ." />
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
  const groupOf = (v: Verdict) => VERDICTS[v].group;
  const sum = (g: string) => d.byVerdict.filter((x) => groupOf(x.verdict) === g).reduce((a, x) => a + x.styles, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Stock & buying"
        title="Website vs Lucida"
        sub="Every product on the website, live or not, beside what Lucida holds for the same barcode, and why each is or is not on sale."
        right={
          read ? (
            <ExportButton name="website-vs-lucida" href={`/stock/web-items/export${qs({}).replace('/stock/web-items', '')}`} />
          ) : undefined
        }
      />

      <section className="panel flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
          {d.stores.length > 1 ? (
            <div className="flex gap-1">
              {d.stores.map((x) => (
                <Link key={x.id} href={qs({ store: x.id, page: undefined })} className={`flex h-8 items-center rounded-lg px-3 text-[12.5px] ${x.id === d.store!.id ? 'bg-elev-3 font-semibold' : 'text-ink-2 hover:bg-elev-2'}`}>
                  {x.label}
                </Link>
              ))}
            </div>
          ) : (
            <span className="font-medium">{d.store.label}</span>
          )}
          <span className="text-ink-3">
            Website: {s.websiteAt ? `${num(s.products ?? 0)} products, ${num(s.sizes ?? 0)} sizes, read ${ago(s.websiteAt)}` : 'not read yet'}
          </span>
          <span className="text-ink-3">
            Lucida:{' '}
            {!d.lucida
              ? 'not connected to this console yet'
              : s.lucidaAt
                ? `${num(s.lucidaReported ?? 0)} sizes with stock, asked ${ago(s.lucidaAt)} (${s.lucidaCalls} calls)`
                : 'not asked yet'}
          </span>
          {s.error && <span className="text-critical">Last run failed: {s.error}</span>}
        </div>
        <WebItemsRun store={d.store.id} lucida={d.lucida && read} running={s.running ?? null} canRun={canRun} callsNeeded={callsNeeded} accounts={accounts} callsLeft={d.budget?.left ?? null} />
      </section>

      {!d.lucida && (
        <p className="-mt-2 text-[12px] text-ink-3">
          Until Lucida’s logins are added to this console (LUCIDA_ACCOUNTS), the page compares what the website itself knows: what is not published and why. Lucida’s stock and prices join in on the first “Ask Lucida”.
        </p>
      )}

      {!read ? (
        <div className="panel">
          <Empty icon={GitCompareArrows} title="The website has not been read yet" body={canRun ? 'Read the website to list every product, live or not, with what each is missing.' : 'Someone with Merchandising or Stock access can read the website for this page.'} />
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {GROUPS.map((g) => (
              <div key={g.key} className="panel p-4">
                <div className="text-[12px] text-ink-3">{g.label}</div>
                <div className="font-display text-[20px] leading-tight tabular">{num(sum(g.key))}</div>
                <div className="truncate text-[11.5px] text-ink-3">{g.hint}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <div className="panel overflow-hidden">
              <div className="border-b border-line px-5 py-3.5">
                <h2 className="text-[14px]">Where they differ</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">Styles by their most pressing gap. Tap one to list them.</p>
              </div>
              <ul className="divide-y divide-[var(--line)]">
                {d.byVerdict
                  .sort((a, b) => Object.keys(VERDICTS).indexOf(a.verdict) - Object.keys(VERDICTS).indexOf(b.verdict))
                  .map((x) => (
                    <li key={x.verdict}>
                      <Link href={qs({ verdict: x.verdict, reason: undefined, page: undefined })} className={`flex items-center gap-3 px-5 py-2.5 text-[12.5px] hover:bg-elev-2 ${str('verdict') === x.verdict ? 'bg-elev-2' : ''}`}>
                        <span className="pill" data-tone={VERDICTS[x.verdict].tone}>
                          <span className="dot" />
                          {VERDICTS[x.verdict].label}
                        </span>
                        <span className="ml-auto font-mono">{num(x.styles)}</span>
                        <span className="w-24 text-right font-mono text-[11px] text-ink-3">{num(x.sizes)} sizes</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="panel overflow-hidden">
              <div className="border-b border-line px-5 py-3.5">
                <h2 className="text-[14px]">Why</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">Styles not live and right, by each reason found (a style can have several).</p>
              </div>
              <ul className="divide-y divide-[var(--line)]">
                {d.byReason.map((x) => (
                  <li key={x.reason}>
                    <Link href={qs({ reason: x.reason, verdict: str('verdict') ?? 'all', page: undefined })} className={`flex items-center gap-3 px-5 py-2.5 text-[12.5px] hover:bg-elev-2 ${str('reason') === x.reason ? 'bg-elev-2' : ''}`}>
                      <span>{REASONS[x.reason]}</span>
                      <span className="ml-auto font-mono">{num(x.styles)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="border-b border-line px-5 py-3.5">
              <h2 className="text-[14px]">By brand</h2>
            </div>
            <div className="scroll-thin max-h-[360px] overflow-auto">
              <table className="table text-[12.5px]">
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th className="text-right">Styles</th>
                    <th className="text-right">Live</th>
                    <th className="text-right">Not published, Lucida has stock</th>
                    <th className="text-right">In Lucida, not uploaded</th>
                    <th className="text-right">Live but off</th>
                  </tr>
                </thead>
                <tbody>
                  {d.brands.map((b) => (
                    <tr key={b.brand}>
                      <td>
                        <Link href={qs({ brand: b.brand, page: undefined })} className="font-medium hover:underline">
                          {b.brand}
                        </Link>
                      </td>
                      <td className="text-right font-mono">{num(b.total)}</td>
                      <td className="text-right font-mono">{num(b.live)}</td>
                      <td className={`text-right font-mono ${b.unpublishedStock ? 'text-critical' : 'text-ink-4'}`}>{num(b.unpublishedStock)}</td>
                      <td className={`text-right font-mono ${b.notUploaded ? 'text-critical' : 'text-ink-4'}`}>{num(b.notUploaded)}</td>
                      <td className={`text-right font-mono ${b.gaps ? '' : 'text-ink-4'}`}>{num(b.gaps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
              <h2 className="text-[14px]">Styles</h2>
              <span className="text-[11.5px] text-ink-3">
                {num(d.total)} {str('verdict') && str('verdict') !== 'all' ? VERDICTS[str('verdict') as Verdict]?.label.toLowerCase() : 'that need a look'}
                {str('reason') ? ` · ${REASONS[str('reason') as Reason]?.toLowerCase()}` : ''}
                {str('brand') ? ` · ${str('brand')}` : ''}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {(str('verdict') || str('reason') || str('brand')) && (
                  <Link href={qs({ verdict: undefined, reason: undefined, brand: undefined, page: undefined })} className="text-[12px] text-ink-2 hover:underline">
                    Clear
                  </Link>
                )}
                <Link href={qs({ verdict: 'all', page: undefined })} className="text-[12px] text-ink-2 hover:underline">
                  Every style
                </Link>
                <form action="/stock/web-items" className="flex">
                  {['store', 'verdict', 'reason', 'brand'].map((k) => (str(k) ? <input key={k} type="hidden" name={k} value={str(k)} /> : null))}
                  <input name="q" defaultValue={str('q') ?? ''} placeholder="Search a style…" className="field !h-8 !w-48 text-[12px]" />
                </form>
              </div>
            </div>
            {d.rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">Nothing here.</p>
            ) : (
              <table className="table text-[12.5px]">
                <thead>
                  <tr>
                    <th>Style</th>
                    <th>Website</th>
                    <th className="text-right">Website stock</th>
                    <th className="text-right">Lucida stock</th>
                    <th>What is wrong</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((x) => (
                    <tr key={x.key}>
                      <td className="max-w-[300px]">
                        <div className="truncate">{x.title}</div>
                        <div className="truncate text-[11px] text-ink-3">
                          {x.brand ?? 'Brand unknown'}
                          {x.handle ? <span className="font-mono"> · {x.handle}</span> : ''} · {x.sizes} size{x.sizes === 1 ? '' : 's'}
                          {x.price ? ` · ${money(x.price, cur)}` : ''}
                          {x.lucidaPrice && x.price && x.lucidaPrice !== x.price ? ` (Lucida ${money(x.lucidaPrice, cur)})` : ''}
                        </div>
                      </td>
                      <td>
                        <span className="pill" data-tone={x.status === 'active' ? 'success' : x.status === 'absent' ? 'critical' : 'neutral'}>
                          {x.status === 'active' ? 'Live' : x.status === 'draft' ? 'Draft' : x.status === 'archived' ? 'Archived' : 'Not on it'}
                        </span>
                      </td>
                      <td className="text-right font-mono">{x.status === 'absent' ? '—' : num(x.webQty)}</td>
                      <td className="text-right font-mono">{x.lucidaQty == null ? <span className="text-ink-4">not asked</span> : num(x.lucidaQty)}</td>
                      <td>
                        <div className="mb-0.5">
                          <span className="pill" data-tone={VERDICTS[x.verdict].tone}>
                            {VERDICTS[x.verdict].label}
                          </span>
                        </div>
                        <div className="text-[11.5px] text-ink-2">{x.reasons.map((r) => REASONS[r]).join(' · ') || '—'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.total > d.per && (
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[12px] text-ink-3">
                <span>
                  {num((d.page - 1) * d.per + 1)}–{num(Math.min(d.total, d.page * d.per))} of {num(d.total)}
                </span>
                <div className="flex gap-2">
                  {d.page > 1 && (
                    <Link href={qs({ page: String(d.page - 1) })} className="btn btn-ghost btn-sm">
                      Previous
                    </Link>
                  )}
                  {d.page * d.per < d.total && (
                    <Link href={qs({ page: String(d.page + 1) })} className="btn btn-ghost btn-sm">
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
