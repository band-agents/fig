import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertOctagon, AlertTriangle, ArrowLeft, Check, CheckCircle2, CircleDot, Download, ExternalLink, FileSpreadsheet, Info, Search, ShieldCheck } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee, READ_ONLY_ROLES } from '@/lib/domain/perms';
import { CHANNEL } from '@/lib/channels';
import { adminUrl, catalogStores, getJob, issueGroups, planPage, type ImportJobOptions, type ImportPlan, type JobProgress, type JobResult } from '@/lib/catalog/jobs';
import { pickOf, PICKABLE } from '@/lib/catalog/fields';
import type { PlanItem } from '@/lib/catalog/plan';
import { ActionPill, KIND, KindMark, StatusPill, StoreMark, ago, num } from '@/components/catalog/bits';
import { CopyExport, JobLive, MappingEditor, RevertButton, RunBar } from '@/components/catalog/job-view';

export const metadata = { title: 'Catalogue job' };

const FORMAT: Record<string, string> = { matrixify: 'Matrixify file', shopify: 'Shopify CSV', own: 'Your own sheet' };

export default async function CatalogJobPage(props: PageProps<'/catalog/[id]'>) {
  const me = await requireUser();
  if (!canSee(me, 'catalog')) sendHome(me);
  const { id } = await props.params;
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const job = await getJob(me, id);
  if (!job) notFound();
  const stores = catalogStores(me);
  const storeOf = (sid: string) => stores.find((s) => s.id === sid) ?? { id: sid, name: CHANNEL[sid]?.name ?? sid, brand: CHANNEL[sid]?.brand ?? sid };
  const acts = !me.previewing && !READ_ONLY_ROLES.includes(me.role);
  const canImport = acts && can(me, 'catalog', 2);
  const canManage = acts && can(me, 'catalog', 3);
  const plan = job.plan as unknown as ImportPlan | null;
  const results = job.results as JobResult[];
  const progress = (job.progress ?? {}) as JobProgress;
  const live = job.status === 'analysing' || job.status === 'running';
  const k = KIND[job.kind] ?? KIND.import;
  const qs = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [key, v] of Object.entries({ store: str('store'), action: str('action'), issue: str('issue'), q: str('q'), result: str('result'), ...o })) if (v) q.set(key, v);
    const s = q.toString();
    return `/catalog/${id}${s ? `?${s}` : ''}`;
  };

  return (
    <div className="space-y-5 pb-4">
      <div>
        <Link href="/catalog" className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
          <ArrowLeft className="size-3.5" /> Import & export
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <KindMark kind={job.kind} size={42} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-semibold tracking-[-0.3px] sm:text-[24px]">{job.kind === 'export' ? `Export · ${storeOf(job.stores[0]).name}` : `${k.label} · ${job.fileName ?? 'file'}`}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              <StatusPill status={job.status} />
              <span>
                {job.stores.map((s) => storeOf(s).name).join(' + ')} · {job.createdByName ?? 'someone'} · {ago(job.createdAt)}
              </span>
              {job.parentId && (
                <Link href={`/catalog/${job.parentId}`} className="text-[var(--link)] hover:underline">
                  {job.kind === 'revert' ? 'the import it undoes' : 'from an export'}
                </Link>
              )}
            </div>
          </div>
        </div>
        {job.note && (
          <div className={`mt-3 flex items-start gap-2 rounded-[14px] px-3.5 py-2.5 text-[12.5px] ${job.status === 'failed' ? 'bg-[var(--b-critical)] text-[var(--b-critical-ink)]' : 'bg-elev-2 text-ink-2'}`}>
            <Info className="mt-px size-4 shrink-0" /> {job.note}
          </div>
        )}
      </div>

      {job.kind === 'import' && <Steps status={job.status} hasResults={results.length > 0} />}

      {live && <JobLive id={id} status={job.status} progress={progress} stores={job.stores.map(storeOf)} canStop={canImport} />}

      {job.kind === 'export' && !live && <ExportDone job={job} progress={progress} canImport={canImport} stores={stores.filter((s) => s.connected && s.id !== job.stores[0]).map((s) => ({ id: s.id, name: s.name, brand: s.brand }))} />}

      {job.kind === 'import' && plan && job.status === 'ready' && <Review id={id} plan={plan} options={job.options as unknown as ImportJobOptions} storeOf={storeOf} sp={{ store: str('store'), action: str('action'), issue: str('issue'), q: str('q'), page: Number(str('page')) || 1 }} qs={qs} canImport={canImport} />}

      {(job.kind === 'revert' || (job.kind === 'import' && (results.length > 0 || job.status === 'running'))) && !(job.status === 'running' && !results.length) && (
        <Results id={id} job={{ kind: job.kind, status: job.status }} results={results} storeOf={storeOf} filter={str('result')} q={str('q')} page={Number(str('page')) || 1} qs={qs} canRevert={canManage && job.kind === 'import' && !live && results.some((r) => r.result === 'ok' && (r.action === 'create' || r.before))} />
      )}
    </div>
  );
}

function Steps({ status, hasResults }: { status: string; hasResults: boolean }) {
  const steps = [
    { label: 'Uploaded', done: true },
    { label: 'Checked (dry run)', done: status !== 'analysing', now: status === 'analysing' },
    { label: 'Imported', done: status === 'done' && hasResults, now: status === 'running' },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[12px]">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${s.done ? 'bg-[var(--sage-soft)] text-[var(--sage-ink)]' : s.now ? 'bg-[var(--b-info)] text-[var(--b-info-ink)]' : 'bg-elev-2 text-ink-3'}`}>
            {s.done ? <Check className="size-3.5" /> : <CircleDot className={`size-3.5 ${s.now ? 'animate-pulse' : ''}`} />} {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-5 bg-line-2" />}
        </li>
      ))}
    </ol>
  );
}

type StoreLite = { id: string; name: string; brand: string };

function Review({ id, plan, options, storeOf, sp, qs, canImport }: { id: string; plan: ImportPlan; options: ImportJobOptions; storeOf: (s: string) => StoreLite; sp: { store?: string; action?: string; issue?: string; q?: string; page: number }; qs: (o: Record<string, string | undefined>) => string; canImport: boolean }) {
  const storeIds = Object.keys(plan.stores);
  const store = sp.store && plan.stores[sp.store] ? sp.store : storeIds[0];
  const sPlan = plan.stores[store];
  const page = planPage(plan, store, sp);
  const issues = issueGroups(plan, store);
  const columns = plan.mapping.map((m) => ({ index: m.index, header: m.header, pick: pickOf(m.ref), how: m.how, problem: m.problem, sample: plan.sample.map((r) => r[m.index] ?? '') }));
  const known = columns.filter((c) => c.pick !== 'ignore').length;
  const errors = Object.values(plan.stores).reduce((a, s) => a + s.tally.error, 0);
  const lines = storeIds.map((sid) => {
    const t = plan.stores[sid].tally;
    const st = storeOf(sid);
    return { store: sid, name: st.name, brand: st.brand, create: plan.stores[sid].blocked ? 0 : t.create, update: plan.stores[sid].blocked ? 0 : t.update, remove: plan.stores[sid].blocked ? 0 : t.delete + t.archive };
  });
  const tiles = [
    { key: 'create', label: 'New', tone: 'var(--live)' },
    { key: 'update', label: 'Updates', tone: 'var(--t-blue)' },
    { key: 'unchanged', label: 'No change', tone: 'var(--ink-3)' },
    { key: 'skip', label: 'Skipped', tone: 'var(--ink-3)' },
    { key: 'error', label: 'Errors', tone: 'var(--signal)' },
    { key: 'warning', label: 'To check', tone: 'var(--t-amber)' },
  ] as const;
  return (
    <>
      <section className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="panel p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <FileSpreadsheet className="size-4 text-ink-2" /> {FORMAT[plan.format]}
            </span>
            <span>
              <b className="font-mono text-ink">{num(plan.rows)}</b> rows
            </span>
            <span>
              <b className="font-mono text-ink">{num(plan.products)}</b> products
            </span>
            <span>
              <b className="font-mono text-ink">{known}</b> of {columns.length} columns used
            </span>
            {plan.checks.images.checked > 0 && (
              <span className={plan.checks.images.broken.length ? 'text-[var(--t-amber)]' : ''}>
                {plan.checks.images.broken.length ? `${plan.checks.images.broken.length} of ${plan.checks.images.checked} photo links broken` : `${plan.checks.images.checked} photo links open`}
              </span>
            )}
            {plan.checks.barcodes > 0 && <span>{num(plan.checks.barcodes)} barcodes checked against the store</span>}
          </div>
        </div>
      </section>

      {storeIds.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {storeIds.map((sid) => {
            const st = storeOf(sid);
            const t = plan.stores[sid].tally;
            return (
              <Link key={sid} href={qs({ store: sid, page: undefined, action: undefined, issue: undefined })} className={`flex items-center gap-2 rounded-[14px] border px-3 py-2 text-[12.5px] transition ${sid === store ? 'border-[var(--t-violet)] bg-[color-mix(in_oklab,var(--t-violet)_12%,transparent)]' : 'border-line hover:border-line-2'}`}>
                <StoreMark name={st.name} brand={st.brand} size={22} /> <span className="font-semibold">{st.name}</span>
                <span className="text-ink-3">
                  {num(t.create)} new · {num(t.update)} upd{t.error ? ` · ${num(t.error)} err` : ''}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {sPlan.blocked && (
        <div className="flex items-start gap-2 rounded-[14px] bg-[var(--b-attention)] px-3.5 py-3 text-[12.5px] text-[var(--b-attention-ink)]">
          <ShieldCheck className="mt-px size-4 shrink-0" /> {sPlan.blocked}
        </div>
      )}

      <section className="grid grid-cols-3 gap-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const n = t.key === 'warning' ? sPlan.tally.warnings : sPlan.tally[t.key];
          const on = sp.action === t.key;
          return (
            <Link key={t.key} href={qs({ action: on ? undefined : t.key, page: undefined, issue: undefined })} className={`panel relative overflow-hidden p-3.5 transition hover:-translate-y-px ${on ? 'ring-2 ring-[var(--t-violet)]' : ''}`}>
              <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: t.tone, opacity: n ? 1 : 0.25 }} />
              <div className="text-[12px] text-ink-3">{t.label}</div>
              <div className="mt-1 font-mono text-[24px] font-semibold leading-none" style={{ color: n && (t.key === 'error' || t.key === 'warning') ? t.tone : undefined }}>
                {num(n)}
              </div>
            </Link>
          );
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold">Products</h2>
            <span className="text-[12px] text-ink-3">
              {num(page.total)} {sp.action || sp.issue || sp.q ? 'shown' : 'in the file'}
            </span>
            {(sp.action || sp.issue || sp.q) && (
              <Link href={qs({ action: undefined, issue: undefined, q: undefined, page: undefined })} className="text-[12px] text-[var(--link)] hover:underline">
                show all
              </Link>
            )}
            <form action={`/catalog/${id}`} className="relative ml-auto w-full sm:w-56">
              <input type="hidden" name="store" value={store} />
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" />
              <input name="q" defaultValue={sp.q} placeholder="Find a product" className="field !h-8 !pl-8 !text-[12px]" />
            </form>
          </div>
          {page.items.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-ink-3">Nothing here.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {page.items.map((item) => (
                <PlanRow key={item.key} item={item} />
              ))}
            </ul>
          )}
          {page.pages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
              <span>
                Page {page.page} of {page.pages}
              </span>
              <span className="flex gap-1">
                {page.page! > 1 && (
                  <Link className="btn btn-quiet btn-sm" href={qs({ page: String(page.page! - 1) })}>
                    Previous
                  </Link>
                )}
                {page.page! < page.pages && (
                  <Link className="btn btn-quiet btn-sm" href={qs({ page: String(page.page! + 1) })}>
                    Next
                  </Link>
                )}
              </span>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="panel p-4">
            <h2 className="mb-3 text-[14px] font-semibold">What to check</h2>
            {issues.length === 0 ? (
              <p className="flex items-center gap-2 text-[12.5px] text-ink-3">
                <CheckCircle2 className="size-4 text-[var(--live)]" /> Nothing: the file reads cleanly.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {issues.map((g) => (
                  <li key={g.code}>
                    <Link href={qs({ issue: sp.issue === g.code ? undefined : g.code, action: undefined, page: undefined })} className={`flex items-start gap-2.5 rounded-[12px] p-2 text-[12px] transition hover:bg-elev-2 ${sp.issue === g.code ? 'bg-elev-2' : ''}`}>
                      {g.level === 'error' ? <AlertOctagon className="mt-px size-4 shrink-0 text-critical" /> : g.level === 'warning' ? <AlertTriangle className="mt-px size-4 shrink-0 text-[var(--t-amber)]" /> : <Info className="mt-px size-4 shrink-0 text-ink-3" />}
                      <span className="min-w-0 flex-1 leading-snug">
                        <span className="line-clamp-2 text-ink-2">{g.example}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[11.5px] text-ink-3">{num(g.count)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <h2 className="text-[14px] font-semibold">Columns</h2>
          <span className="text-[12px] text-ink-3">How each column was read. Change any, then Check again.</span>
        </div>
        <MappingEditor id={id} columns={columns} choices={PICKABLE} options={{ tags: options.tags, images: options.images, newStatus: options.newStatus, publishNew: options.publishNew, emptyClears: options.emptyClears }} canEdit={canImport} />
      </section>

      <RunBar id={id} lines={lines} blocked={storeIds.filter((s) => plan.stores[s].blocked).map((s) => storeOf(s).name)} canRun={canImport} errors={errors} />
    </>
  );
}

function PlanRow({ item }: { item: PlanItem }) {
  const errors = item.issues.filter((i) => i.level === 'error');
  const warnings = item.issues.filter((i) => i.level === 'warning');
  const notes = item.issues.filter((i) => i.level === 'info');
  const summary = item.changes.length ? item.changes.map((c) => c.label).slice(0, 4).join(' · ') + (item.changes.length > 4 ? ` · +${item.changes.length - 4}` : '') : item.action === 'unchanged' ? 'Already as the file says' : (item.issues[0]?.message ?? '');
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition hover:bg-elev-2/60">
          {item.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt="" className="size-10 shrink-0 rounded-[10px] object-cover" loading="lazy" />
          ) : (
            <span className="size-10 shrink-0 rounded-[10px] bg-elev-3" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium">{item.title}</span>
              <ActionPill action={item.action} />
              {errors.length === 0 && warnings.length > 0 && <AlertTriangle className="size-3.5 shrink-0 text-[var(--t-amber)]" />}
            </div>
            <div className="truncate text-[11.5px] text-ink-3">
              <span className="font-mono">{item.handle}</span> · {summary}
            </div>
          </div>
          <span className="hidden shrink-0 text-right text-[11px] text-ink-4 sm:block">row{item.lines.length > 1 ? 's' : ''} {item.lines.length > 3 ? `${item.lines[0]}–${item.lines[item.lines.length - 1]}` : item.lines.join(', ')}</span>
        </summary>
        <div className="space-y-2 bg-elev-2/40 px-4 pt-2 pb-3.5 sm:pl-[68px]">
          {item.changes.length > 0 && (
            <table className="w-full text-[12px]">
              <tbody>
                {item.changes.map((c) => (
                  <tr key={c.field} className="align-top">
                    <td className="w-40 py-1 pr-3 text-ink-3">{c.label}</td>
                    <td className="py-1">
                      {c.before && c.before !== '—' && c.before !== 'kept' && c.before !== '' ? <span className="mr-1.5 text-ink-4 line-through decoration-[var(--signal)]/50">{c.before.length > 140 ? `${c.before.slice(0, 140)}…` : c.before}</span> : null}
                      <span className={c.rule ? 'text-[var(--sage-ink)]' : 'text-ink'}>{c.after.length > 200 ? `${c.after.slice(0, 200)}…` : c.after}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {[...errors, ...warnings, ...notes].map((x, i) => (
            <div key={i} className={`flex items-start gap-2 text-[12px] ${x.level === 'error' ? 'text-critical' : x.level === 'warning' ? 'text-[var(--t-amber)]' : 'text-ink-3'}`}>
              {x.level === 'error' ? <AlertOctagon className="mt-px size-3.5 shrink-0" /> : x.level === 'warning' ? <AlertTriangle className="mt-px size-3.5 shrink-0" /> : <Info className="mt-px size-3.5 shrink-0" />}
              {x.message}
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}

function Results({ id, job, results, storeOf, filter, q, page, qs, canRevert }: { id: string; job: { kind: string; status: string }; results: JobResult[]; storeOf: (s: string) => StoreLite; filter?: string; q?: string; page: number; qs: (o: Record<string, string | undefined>) => string; canRevert: boolean }) {
  const counts = { ok: 0, failed: 0, skipped: 0 };
  for (const r of results) counts[r.result]++;
  let shown = filter ? results.filter((r) => r.result === filter) : results;
  if (q) shown = shown.filter((r) => r.handle.includes(q.toLowerCase()) || r.title.toLowerCase().includes(q.toLowerCase()));
  const per = 50;
  const pages = Math.max(1, Math.ceil(shown.length / per));
  const p = Math.min(pages, Math.max(1, page));
  const rows = shown.slice((p - 1) * per, p * per);
  const done = job.status !== 'running';
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold">{job.kind === 'revert' ? 'Reverted' : 'Results'}</h2>
        <div className="flex gap-1">
          {(
            [
              ['', `All ${num(results.length)}`],
              ['ok', `Done ${num(counts.ok)}`],
              ['failed', `Failed ${num(counts.failed)}`],
              ['skipped', `Skipped ${num(counts.skipped)}`],
            ] as const
          ).map(([k, label]) => (
            <Link key={k} href={qs({ result: k || undefined, page: undefined })} className={`flex h-7 items-center rounded-lg px-2.5 text-[12px] transition ${(filter ?? '') === k ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2'} ${k === 'failed' && counts.failed ? 'text-critical' : ''}`}>
              {label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {done && (
            <a href={`/catalog/${id}/results`} className="btn btn-quiet btn-sm">
              <Download className="size-4" /> Results sheet
            </a>
          )}
          {canRevert && <RevertButton id={id} count={results.filter((r) => r.result === 'ok' && (r.action === 'create' || r.before)).length} />}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-ink-3">{results.length ? 'Nothing here.' : 'Starting…'}</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="table text-[12.5px]">
            <thead>
              <tr>
                <th>Product</th>
                <th>Store</th>
                <th>Result</th>
                <th>What happened</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = CHANNEL[r.store];
                const href = c ? adminUrl(c, r.productId) : undefined;
                const st = storeOf(r.store);
                return (
                  <tr key={`${r.store}|${r.key}`}>
                    <td className="max-w-[260px]">
                      <div className="truncate font-medium">{r.title}</div>
                      <div className="truncate font-mono text-[11px] text-ink-3">{r.handle}</div>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <StoreMark name={st.name} brand={st.brand} size={18} /> {st.name}
                      </span>
                    </td>
                    <td>
                      <span className="pill" data-tone={r.result === 'ok' ? 'success' : r.result === 'failed' ? 'critical' : 'neutral'}>
                        {r.result === 'ok' ? (r.action === 'create' ? 'Created' : r.action === 'archive' ? 'Archived' : r.action === 'delete' ? 'Deleted' : 'Updated') : r.result === 'failed' ? 'Failed' : 'Skipped'}
                      </span>
                    </td>
                    <td className="max-w-[460px] text-ink-2">
                      <span className="line-clamp-2">{r.message}</span>
                    </td>
                    <td className="text-right">
                      {href && (
                        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-[var(--link)] hover:underline">
                          Shopify <ExternalLink className="size-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
          <span>
            Page {p} of {pages}
          </span>
          <span className="flex gap-1">
            {p > 1 && (
              <Link className="btn btn-quiet btn-sm" href={qs({ page: String(p - 1) })}>
                Previous
              </Link>
            )}
            {p < pages && (
              <Link className="btn btn-quiet btn-sm" href={qs({ page: String(p + 1) })}>
                Next
              </Link>
            )}
          </span>
        </div>
      )}
    </section>
  );
}

function ExportDone({ job, progress, canImport, stores }: { job: { id: string; status: string; fileName: string | null; finishedAt: Date | null; startedAt: Date | null }; progress: JobProgress; canImport: boolean; stores: StoreLite[] }) {
  if (job.status !== 'done') return null;
  const c = progress.counts ?? {};
  const secs = job.finishedAt && job.startedAt ? Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000) : null;
  return (
    <section className="panel cat-hero relative overflow-hidden p-6">
      <div className="relative z-[1] flex flex-wrap items-center gap-6">
        <span className="grid size-16 place-items-center rounded-[20px] bg-[var(--sage-soft)] text-[var(--sage-ink)]">
          <FileSpreadsheet className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold">{job.fileName}</div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
            <span>
              <b className="font-mono text-ink">{num(c.products)}</b> products
            </span>
            <span>
              <b className="font-mono text-ink">{num(c.variants)}</b> variants
            </span>
            <span>
              <b className="font-mono text-ink">{num(c.images)}</b> photos
            </span>
            <span>
              <b className="font-mono text-ink">{num(c.rows)}</b> rows
            </span>
            {secs != null && <span>ready in {secs < 90 ? `${secs} s` : `${Math.round(secs / 60)} min`}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImport && <CopyExport id={job.id} stores={stores} />}
          <a href={`/catalog/${job.id}/file`} className="btn btn-primary">
            <Download className="size-4" /> Download
          </a>
        </div>
      </div>
    </section>
  );
}
