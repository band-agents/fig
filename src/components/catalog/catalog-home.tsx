'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, Check, ChevronDown, FileSpreadsheet, Info, Loader2, Lock, ShieldCheck, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { startExportAction, startImportAction } from '@/app/(console)/catalog/actions';
import { toast } from '@/components/ui/toast';
import type { CatalogStore, JobRow } from '@/lib/catalog/jobs';
import { Bar, KIND, KindMark, StatusPill, StoreMark, ago, num } from './bits';

export type StoreCard = CatalogStore & { products: number; live: number; readAt: string | null };

const TEMPLATE = '/catalog/template';

const GROUPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'variants', label: 'Variants & prices' },
  { key: 'images', label: 'Images' },
  { key: 'stock', label: 'Stock & cost' },
  { key: 'seo', label: 'SEO' },
  { key: 'info', label: 'Dates' },
] as const;

/** The catalogue's home: the stores, Export and Import side by side (as in Matrixify), and every job, live. */
export function CatalogHome({ stores, jobs: first, canImport, canManage, brands }: { stores: StoreCard[]; jobs: JobRow[]; canImport: boolean; canManage: boolean; brands: string[] }) {
  const [jobs, setJobs] = useState(first);
  const [filter, setFilter] = useState<'all' | 'import' | 'export'>('all');
  // a fresh server render (after an action) brings a new list: take it over the polled one
  const [seen, setSeen] = useState(first);
  if (seen !== first) {
    setSeen(first);
    setJobs(first);
  }
  const active = jobs.some((j) => j.status === 'analysing' || j.status === 'running');
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/catalog/jobs', { cache: 'no-store' });
        if (r.ok && !stop) setJobs(((await r.json()) as { jobs: JobRow[] }).jobs);
      } catch {}
    };
    const t = setInterval(() => void tick(), active ? 2500 : 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active]);
  const shown = jobs.filter((j) => filter === 'all' || j.kind === filter || (filter === 'import' && j.kind === 'revert'));
  const connected = stores.filter((s) => s.connected);

  return (
    <div className="space-y-6">
      <section className="cat-hero panel relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
        <div className="relative z-[1] flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--b-magic)] px-2.5 py-1 text-[11px] font-medium text-[var(--b-magic-ink)]">
              <Sparkles className="size-3" /> Matrixify, built in
            </div>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.5px] sm:text-[30px]">Import & export products</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
              One Excel file into every website. Each import is checked first, product by product and store by store, with every change shown before → after. Nothing is written until you press Run, and a finished import can be undone.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={TEMPLATE} download className="btn btn-quiet">
              <FileSpreadsheet className="size-4" /> Template
            </a>
          </div>
        </div>
        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stores.map((s) => (
            <div key={s.id} className="rounded-[16px] border border-line bg-[color-mix(in_oklab,var(--bg-elev)_80%,transparent)] p-3.5 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <StoreMark name={s.name} brand={s.brand} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{s.name}</div>
                  <div className="text-[11.5px] text-ink-3">
                    {s.countryName} · {s.currency}
                  </div>
                </div>
                <span className="pill" data-tone={!s.connected ? 'neutral' : s.writable ? 'success' : 'warning'}>
                  {!s.connected ? 'Not connected' : s.writable ? 'Ready' : 'Read-only'}
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-3 text-[12px] text-ink-3">
                <span>
                  <b className="font-mono text-[15px] font-semibold text-ink">{num(s.products)}</b> products
                </span>
                {s.live > 0 && <span>{num(s.live)} live</span>}
              </div>
              {s.rules.notes.length > 0 && (
                <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-ink-3">
                  <ShieldCheck className="mt-px size-3.5 shrink-0 text-[var(--sage)]" />
                  {s.rules.notes[0]}
                </div>
              )}
              {s.connected && !s.writable && <div className="mt-2 text-[11px] leading-snug text-ink-3">Connected read-only: imports run as dry runs until it is switched on.</div>}
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <ExportPanel stores={connected} brands={brands} />
        <ImportPanel stores={connected} canImport={canImport} canManage={canManage} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Jobs</h2>
          <div className="flex gap-1">
            {(['all', 'import', 'export'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`flex h-8 items-center rounded-lg px-3 text-[12.5px] transition ${filter === f ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
                {f === 'all' ? 'All' : f === 'import' ? 'Imports' : 'Exports'}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="panel flex flex-col items-center px-6 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-elev-2">
              <Wand2 className="size-5 text-ink-3" />
            </span>
            <div className="mt-3 text-[15px] font-semibold">No jobs yet</div>
            <p className="mt-1 max-w-sm text-[12.5px] text-ink-3">Export a store to get its products in Matrixify’s layout, or drop a file into Import to start a dry run.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {shown.map((j) => (
              <JobCard key={j.id} job={j} stores={stores} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JobCard({ job, stores }: { job: JobRow; stores: StoreCard[] }) {
  const k = KIND[job.kind] ?? KIND.import;
  const p = (job.progress ?? {}) as { phase?: string; done?: number; total?: number; message?: string; counts?: Record<string, number>; perStore?: Record<string, { ok: number; failed: number; skipped: number }> };
  const live = job.status === 'analysing' || job.status === 'running';
  const frac = p.total ? (p.done ?? 0) / p.total : live ? 0.08 : 1;
  const tallies = job.summary ? Object.values(job.summary) : [];
  const sum = (key: string) => tallies.reduce((a, t) => a + ((t as unknown as Record<string, number>)[key] ?? 0), 0);
  const per = p.perStore ? Object.values(p.perStore) : [];
  const ok = per.reduce((a, x) => a + x.ok, 0);
  const failed = per.reduce((a, x) => a + x.failed, 0);
  const name = (id: string) => stores.find((s) => s.id === id)?.name ?? id;
  return (
    <Link href={`/catalog/${job.id}`} className="panel group flex flex-wrap items-center gap-x-4 gap-y-3 p-3.5 transition hover:-translate-y-px sm:flex-nowrap">
      <KindMark kind={job.kind} />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold">
            {k.label} · {job.kind === 'export' ? (job.fileName ?? name(job.stores[0])) : (job.fileName ?? 'file')}
          </span>
          <StatusPill status={job.status} />
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-ink-3">
          {job.stores.map(name).join(' + ')} · {job.createdByName ?? 'someone'} · {ago(job.createdAt)}
          {job.note ? ` · ${job.note}` : ''}
        </div>
      </div>
      <div className="w-full sm:w-56">
        {live ? (
          <>
            <Bar value={frac} live />
            <div className="mt-1 truncate text-[11px] text-ink-3">{p.message ?? (job.status === 'analysing' ? 'Reading the file' : 'Writing to Shopify')}</div>
          </>
        ) : job.kind === 'export' && job.status === 'done' ? (
          <div className="flex gap-3 text-[12px] text-ink-3">
            <span>
              <b className="font-mono text-ink">{num(p.counts?.products)}</b> products
            </span>
            <span>
              <b className="font-mono text-ink">{num(p.counts?.variants)}</b> variants
            </span>
          </div>
        ) : per.length ? (
          <div className="flex gap-3 text-[12px] text-ink-3">
            <span className="text-good">
              <b className="font-mono">{num(ok)}</b> done
            </span>
            {failed > 0 && (
              <span className="text-critical">
                <b className="font-mono">{num(failed)}</b> failed
              </span>
            )}
          </div>
        ) : tallies.length ? (
          <div className="flex flex-wrap gap-x-3 text-[12px] text-ink-3">
            <span>
              <b className="font-mono text-ink">{num(sum('create'))}</b> new
            </span>
            <span>
              <b className="font-mono text-ink">{num(sum('update'))}</b> updates
            </span>
            {sum('error') > 0 && (
              <span className="text-critical">
                <b className="font-mono">{num(sum('error'))}</b> errors
              </span>
            )}
          </div>
        ) : null}
      </div>
      <ArrowRight className="hidden size-4 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink sm:block" />
    </Link>
  );
}

function Panel({ icon: Icon, tint, title, sub, children }: { icon: typeof ArrowDownToLine; tint: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col p-5">
      <div className="mb-4 flex items-start gap-3">
        <span data-tint={tint} className="grid size-10 shrink-0 place-items-center rounded-[13px]" style={{ background: 'color-mix(in oklab, var(--tint) 18%, transparent)', color: 'var(--tint)' }}>
          <Icon className="size-5" strokeWidth={1.8} />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <p className="text-[12px] leading-snug text-ink-3">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-[11px] bg-elev-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={`h-7 rounded-[9px] px-2.5 text-[12px] transition ${value === o.value ? 'bg-elev font-semibold text-ink shadow-[var(--card-shadow)]' : 'text-ink-3 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label, hint, disabled = false }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 py-1.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button type="button" disabled={disabled} onClick={() => onChange(!on)} className={`relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition ${on ? 'bg-[var(--sage)]' : 'bg-elev-3'}`} aria-pressed={on}>
        <span className={`absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-all ${on ? 'left-[16px]' : 'left-[2px]'}`} />
      </button>
      <span className="min-w-0">
        <span className="block text-[12.5px]">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 text-[11.5px] font-medium text-ink-3">{children}</div>;

function ExportPanel({ stores, brands }: { stores: StoreCard[]; brands: string[] }) {
  const [store, setStore] = useState(stores[0]?.id ?? '');
  const [status, setStatus] = useState<string[]>(['active', 'draft', 'archived']);
  const [vendor, setVendor] = useState('');
  const [tag, setTag] = useState('');
  const [since, setSince] = useState('');
  const [groups, setGroups] = useState<string[]>(['basics', 'variants', 'images', 'stock', 'seo']);
  const [metafields, setMetafields] = useState(true);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [pending, start] = useTransition();
  const flip = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const go = () =>
    start(async () => {
      const r = await startExportAction(store, { status, vendor, tag, updatedSince: since, groups: groups as never, metafields, format });
      if (r.ok) toast('Export started: it shows under Jobs and downloads from there.', { tone: 'ok' });
      else toast(r.error, { tone: 'error' });
    });
  return (
    <Panel icon={ArrowUpFromLine} tint="cyan" title="Export" sub="A store’s products to Excel in Matrixify’s layout: one row per variant, photos on their own rows, ready to edit and import again (here or into another store).">
      {!stores.length ? (
        <p className="text-[12.5px] text-ink-3">No store is connected yet.</p>
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          <div>
            <Label>Store</Label>
            <div className="flex flex-wrap gap-2">
              {stores.map((s) => (
                <button key={s.id} type="button" onClick={() => setStore(s.id)} className={`flex items-center gap-2 rounded-[12px] border px-2.5 py-1.5 text-[12.5px] transition ${store === s.id ? 'border-[var(--sage)] bg-[var(--sage-soft)] font-semibold' : 'border-line hover:border-line-2'}`}>
                  <StoreMark name={s.name} brand={s.brand} size={20} /> {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Status</Label>
              <div className="flex flex-wrap gap-1.5">
                {['active', 'draft', 'archived'].map((s) => (
                  <button key={s} type="button" onClick={() => flip(status, setStatus, s)} className={`h-7 rounded-full px-3 text-[12px] capitalize transition ${status.includes(s) ? 'bg-[var(--inv-bg)] text-[var(--inv-ink)]' : 'bg-elev-2 text-ink-3'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Format</Label>
              <Seg
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'xlsx', label: 'Excel' },
                  { value: 'csv', label: 'CSV' },
                ]}
              />
            </div>
            <div>
              <Label>Vendor (brand)</Label>
              <input className="field" list="cat-brands" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Every brand" />
              <datalist id="cat-brands">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            <div>
              <Label>Tag</Label>
              <input className="field" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. aw26-promo" />
            </div>
            <div>
              <Label>Changed since</Label>
              <input className="field" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Toggle on={metafields} onChange={setMetafields} label="Metafields" hint="Every product and variant metafield as its own column" />
            </div>
          </div>
          <div>
            <Label>Columns</Label>
            <div className="flex flex-wrap gap-1.5">
              {GROUPS.map((g) => (
                <button key={g.key} type="button" onClick={() => flip(groups, setGroups, g.key)} className={`flex h-7 items-center gap-1 rounded-full px-3 text-[12px] transition ${groups.includes(g.key) ? 'bg-[var(--sage-soft)] font-medium text-[var(--sage-ink)]' : 'bg-elev-2 text-ink-3'}`}>
                  {groups.includes(g.key) && <Check className="size-3" />} {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 pt-1">
            <span className="text-[11.5px] text-ink-3">Shopify prepares the file in the background; big stores take a few minutes.</span>
            <button className="btn btn-primary" disabled={pending || !store || !status.length} onClick={go}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpFromLine className="size-4" />} Export products
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ImportPanel({ stores, canImport, canManage }: { stores: StoreCard[]; canImport: boolean; canManage: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [targets, setTargets] = useState<string[]>(() => {
    const w = stores.filter((s) => s.writable).map((s) => s.id);
    return w.length ? w : stores.map((s) => s.id).slice(0, 1);
  });
  const [open, setOpen] = useState(false);
  const [o, setO] = useState({ tags: 'MERGE' as 'MERGE' | 'REPLACE', images: 'MERGE' as 'MERGE' | 'REPLACE', newStatus: 'DRAFT' as 'DRAFT' | 'ACTIVE', publishNew: true, emptyClears: false, writeStock: false, safeDelete: true });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof o>(k: K, v: (typeof o)[K]) => setO((x) => ({ ...x, [k]: v }));
  const pick = (f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (!/\.(xlsx|csv|txt)$/i.test(f.name)) return setError('Choose an Excel (.xlsx) or CSV file.');
    if (f.size > 8 * 1024 * 1024) return setError('That file is over 8 MB: split it and import it in parts.');
    setFile(f);
  };
  const go = () =>
    start(async () => {
      if (!file) return;
      const fd = new FormData();
      fd.set('file', file);
      for (const t of targets) fd.append('store', t);
      fd.set('options', JSON.stringify(o));
      const r = await startImportAction(fd);
      if (r.ok) router.push(`/catalog/${r.id}`);
      else setError(r.error);
    });
  const readOnly = useMemo(() => stores.filter((s) => targets.includes(s.id) && !s.writable), [stores, targets]);
  if (!canImport)
    return (
      <Panel icon={ArrowDownToLine} tint="violet" title="Import" sub="Products from Excel into the websites.">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center text-[12.5px] text-ink-3">
          <Lock className="size-5" /> Importing needs Catalogue import access. Ask an admin.
        </div>
      </Panel>
    );
  return (
    <Panel icon={ArrowDownToLine} tint="violet" title="Import" sub="Matrixify files, Shopify CSVs and your own sheets (Style, Barcode, RRP, Size, Colour, Arabic headers). The columns are recognised for you.">
      <div className="flex flex-1 flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files[0]);
          }}
          onClick={() => input.current?.click()}
          className={`cat-drop relative flex cursor-pointer flex-col items-center justify-center rounded-[18px] border-[1.5px] border-dashed px-4 py-7 text-center transition ${drag ? 'is-over border-[var(--t-violet)]' : file ? 'border-[var(--sage)]' : 'border-line-2 hover:border-line-3'}`}
        >
          <input ref={input} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-[13px] bg-[var(--sage-soft)] text-[var(--sage-ink)]">
                <FileSpreadsheet className="size-5" />
              </span>
              <div className="text-left">
                <div className="max-w-[260px] truncate text-[13.5px] font-semibold">{file.name}</div>
                <div className="text-[11.5px] text-ink-3">{(file.size / 1024).toFixed(file.size > 1024 * 100 ? 0 : 1)} KB · ready to check</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  if (input.current) input.current.value = '';
                }}
                className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-elev-2 hover:text-ink"
                aria-label="Remove the file"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <span className="mb-2 grid size-12 place-items-center rounded-2xl bg-elev-2 text-ink-2">
                <Upload className="size-5" />
              </span>
              <div className="text-[13.5px] font-semibold">Drop an Excel or CSV file</div>
              <div className="mt-0.5 text-[12px] text-ink-3">or click to choose · up to 8 MB</div>
            </>
          )}
        </div>

        <div>
          <Label>Into</Label>
          <div className="flex flex-wrap gap-2">
            {stores.map((s) => {
              const on = targets.includes(s.id);
              return (
                <button key={s.id} type="button" onClick={() => setTargets(on ? targets.filter((x) => x !== s.id) : [...targets, s.id])} className={`flex items-center gap-2 rounded-[12px] border px-2.5 py-1.5 text-[12.5px] transition ${on ? 'border-[var(--t-violet)] bg-[color-mix(in_oklab,var(--t-violet)_14%,transparent)] font-semibold' : 'border-line hover:border-line-2'}`}>
                  <StoreMark name={s.name} brand={s.brand} size={20} /> {s.name}
                  {!s.writable && <span className="text-[10.5px] font-normal text-ink-3">dry run</span>}
                  {on && <Check className="size-3.5" />}
                </button>
              );
            })}
          </div>
          {readOnly.length > 0 && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-ink-3">
              <Info className="mt-px size-3.5 shrink-0" />
              {readOnly.map((s) => s.name).join(', ')} {readOnly.length === 1 ? 'is' : 'are'} connected read-only: checked, not written.
            </p>
          )}
        </div>

        <div className="rounded-[14px] bg-elev-2/60">
          <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3.5 py-2.5 text-[12.5px] font-medium">
            <span>
              Options <span className="font-normal text-ink-3">· tags {o.tags === 'MERGE' ? 'added' : 'replaced'}, photos {o.images === 'MERGE' ? 'added' : 'replaced'}, new as {o.newStatus === 'DRAFT' ? 'draft' : 'active'}{o.writeStock ? ', stock written' : ''}</span>
            </span>
            <ChevronDown className={`size-4 text-ink-3 transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="grid gap-x-6 gap-y-3 border-t border-line px-3.5 py-3 sm:grid-cols-2">
              <div>
                <Label>Tags in the file</Label>
                <Seg
                  value={o.tags}
                  onChange={(v) => set('tags', v)}
                  options={[
                    { value: 'MERGE', label: 'Add to existing' },
                    { value: 'REPLACE', label: 'Replace' },
                  ]}
                />
              </div>
              <div>
                <Label>Photos in the file</Label>
                <Seg
                  value={o.images}
                  onChange={(v) => set('images', v)}
                  options={[
                    { value: 'MERGE', label: 'Add new ones' },
                    { value: 'REPLACE', label: 'Replace all' },
                  ]}
                />
              </div>
              <div>
                <Label>New products with no Status</Label>
                <Seg
                  value={o.newStatus}
                  onChange={(v) => set('newStatus', v)}
                  options={[
                    { value: 'DRAFT', label: 'Draft' },
                    { value: 'ACTIVE', label: 'Active' },
                  ]}
                />
              </div>
              <div className="space-y-0.5">
                <Toggle on={o.publishNew} onChange={(v) => set('publishNew', v)} label="Put new products on the Online Store" />
                <Toggle on={o.emptyClears} onChange={(v) => set('emptyClears', v)} label="An empty cell clears the field" hint="Off: empty cells leave the store as it is" />
              </div>
              <div className="sm:col-span-2 space-y-0.5 border-t border-line pt-2">
                <Toggle on={o.writeStock} onChange={(v) => set('writeStock', v)} disabled={!canManage} label="Write stock quantities" hint="Lucida keeps stock in the stores; only for a correction. Needs Delete & revert access." />
                <Toggle on={o.safeDelete} onChange={(v) => set('safeDelete', v)} disabled={!canManage} label="Safe delete: Command DELETE archives" hint="Off: DELETE removes the product for good. Needs Delete & revert access." />
              </div>
            </div>
          )}
        </div>

        {error && <div className="rounded-[12px] bg-[var(--b-critical)] px-3 py-2 text-[12px] text-[var(--b-critical-ink)]">{error}</div>}

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
            <ShieldCheck className="size-3.5 text-[var(--sage)]" /> A dry run first: nothing is written yet.
          </span>
          <button className="btn btn-primary" disabled={!file || !targets.length || pending} onClick={go}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Check the file
          </button>
        </div>
      </div>
    </Panel>
  );
}
