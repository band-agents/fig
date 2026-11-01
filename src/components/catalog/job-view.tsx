'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowDownToLine, Copy, Download, Loader2, Play, RotateCcw, Square, Wand2 } from 'lucide-react';
import { cancelJobAction, copyExportAction, reanalyseAction, revertAction, runImportAction } from '@/app/(console)/catalog/actions';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import type { JobRow } from '@/lib/catalog/jobs';
import { Bar, StoreMark, num } from './bits';

type Progress = { phase?: string; done?: number; total?: number; message?: string; perStore?: Record<string, { done: number; ok: number; failed: number; skipped: number; total: number }>; counts?: Record<string, number> };
const PHASE: Record<string, string> = { reading: 'Reading the file', checking: 'Comparing with the store', images: 'Checking photo links', writing: 'Writing to Shopify', exporting: 'Shopify is preparing the export', building: 'Writing the workbook', reverting: 'Undoing the import' };

/** A job that is working: its progress, live, until it finishes (then the page reloads with the outcome). */
export function JobLive({ id, status: first, progress: start, stores, canStop }: { id: string; status: string; progress: Progress; stores: { id: string; name: string; brand: string }[]; canStop: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(first);
  const [p, setP] = useState<Progress>(start);
  const [stopping, startStop] = useTransition();
  const [eta, setEta] = useState<number | null>(null);
  useEffect(() => {
    const since = Date.now();
    const t = setInterval(async () => {
      try {
        const r = await fetch('/api/catalog/jobs', { cache: 'no-store' });
        if (!r.ok) return;
        const job = ((await r.json()) as { jobs: JobRow[] }).jobs.find((j) => j.id === id);
        if (!job) return;
        const next = (job.progress ?? {}) as Progress;
        setP(next);
        // time left, from the pace so far on this page
        const f = next.total ? (next.done ?? 0) / next.total : 0;
        setEta(f > 0.04 && f < 1 ? Math.round(((Date.now() - since) / 1000 / f) * (1 - f)) : null);
        if (job.status !== status) {
          setStatus(job.status);
          router.refresh();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [id, status, router]);
  const frac = p.total ? Math.min(1, (p.done ?? 0) / p.total) : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <section className="panel cat-hero relative overflow-hidden p-6">
      <div className="relative z-[1] flex flex-wrap items-center gap-6">
        <div className="relative grid size-[132px] place-items-center">
          <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" stroke="var(--bg-elev-3)" strokeWidth="9" />
            <circle cx="60" cy="60" r={R} fill="none" stroke="url(#cat-ring)" strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - (p.total ? frac : 0.12))} className={p.total ? 'transition-[stroke-dashoffset] duration-700' : 'cat-spin origin-center'} />
            <defs>
              <linearGradient id="cat-ring" x1="0" x2="1">
                <stop offset="0" stopColor="var(--t-violet)" />
                <stop offset="1" stopColor="var(--sage)" />
              </linearGradient>
            </defs>
          </svg>
          <div className="text-center">
            <div className="font-mono text-[26px] font-semibold">{p.total ? `${Math.round(frac * 100)}%` : '…'}</div>
            <div className="text-[11px] text-ink-3">{p.total ? `${num(p.done)} of ${num(p.total)}` : 'starting'}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold">{PHASE[p.phase ?? ''] ?? (status === 'analysing' ? 'Checking the file' : 'Working')}</div>
          <div className="mt-1 truncate text-[12.5px] text-ink-3">{p.message ?? 'This keeps running if you leave the page.'}</div>
          {eta != null && <div className="mt-1 text-[12px] text-ink-3">About {eta < 60 ? `${eta} s` : `${Math.round(eta / 60)} min`} left</div>}
          {p.perStore && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(p.perStore).map(([sid, s]) => {
                const st = stores.find((x) => x.id === sid);
                return (
                  <div key={sid} className="rounded-[6px] bg-elev-2/70 p-3">
                    <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium">
                      <StoreMark name={st?.name ?? sid} brand={st?.brand} size={20} /> {st?.name ?? sid}
                      <span className="ml-auto font-mono text-[11.5px] text-ink-3">
                        {num(s.done)}/{num(s.total)}
                      </span>
                    </div>
                    <Bar value={s.total ? s.done / s.total : 0} live />
                    <div className="mt-1.5 flex gap-3 text-[11px] text-ink-3">
                      <span className="text-good">{num(s.ok)} done</span>
                      <span>{num(s.skipped)} skipped</span>
                      {s.failed > 0 && <span className="text-critical">{num(s.failed)} failed</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {canStop && (
          <button
            className="btn btn-quiet"
            disabled={stopping}
            onClick={() =>
              startStop(async () => {
                const r = await cancelJobAction(id);
                if (!r.ok) toast(r.error, { tone: 'error' });
              })
            }
          >
            {stopping ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-3.5" />} Stop
          </button>
        )}
      </div>
    </section>
  );
}

/** The bar under a dry run: what Run will do, per store, and the Run itself (asked once more). */
export function RunBar({ id, lines, blocked, canRun, errors }: { id: string; lines: { store: string; name: string; brand: string; create: number; update: number; remove: number }[]; blocked: string[]; canRun: boolean; errors: number }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const writes = lines.reduce((a, l) => a + l.create + l.update + l.remove, 0);
  const run = () =>
    start(async () => {
      const r = await runImportAction(id);
      if (!r.ok) toast(r.error, { tone: 'error' });
      setConfirm(false);
    });
  return (
    <>
      <div className="sticky bottom-3 z-30 mt-6">
        <div className="panel flex flex-wrap items-center gap-3 border border-line px-4 py-3 shadow-[var(--shadow-lg)] backdrop-blur">
          <div className="min-w-0 flex-1 text-[12.5px]">
            {writes ? (
              <span>
                Run writes{' '}
                {lines
                  .filter((l) => l.create + l.update + l.remove)
                  .map((l) => `${[l.create && `${num(l.create)} new`, l.update && `${num(l.update)} updated`, l.remove && `${num(l.remove)} removed`].filter(Boolean).join(', ')} to ${l.name}`)
                  .join(' · ')}
                .
              </span>
            ) : (
              <span className="text-ink-3">Nothing to write: every product already matches the file.</span>
            )}
            {errors > 0 && <span className="ml-2 text-critical">{num(errors)} with errors stay out.</span>}
            {blocked.length > 0 && <span className="ml-2 text-ink-3">{blocked.join(', ')}: dry run only.</span>}
          </div>
          <a href={`/catalog/${id}/results`} className="btn btn-quiet">
            <Download className="size-4" /> Dry run sheet
          </a>
          {canRun && (
            <button className="btn btn-primary" disabled={!writes || pending} onClick={() => setConfirm(true)}>
              <Play className="size-4" /> Run import
            </button>
          )}
        </div>
      </div>
      {confirm && (
        <Modal title="Run the import?" sub="Shopify is changed product by product, as the dry run shows. It keeps going if you leave the page." onClose={() => setConfirm(false)}>
          <div className="space-y-2">
            {lines
              .filter((l) => l.create + l.update + l.remove)
              .map((l) => (
                <div key={l.store} className="flex items-center gap-3 rounded-[6px] bg-elev-2 px-3 py-2.5 text-[13px]">
                  <StoreMark name={l.name} brand={l.brand} size={26} />
                  <span className="font-semibold">{l.name}</span>
                  <span className="ml-auto text-ink-3">
                    {[l.create && `${num(l.create)} new`, l.update && `${num(l.update)} updated`, l.remove && `${num(l.remove)} removed`].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            <p className="pt-1 text-[12px] text-ink-3">Every product’s result goes in the results sheet. A finished import can be reverted from its page.</p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-quiet" onClick={() => setConfirm(false)}>
              Not yet
            </button>
            <button className="btn btn-primary" disabled={pending} onClick={run}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run now
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

type Col = { index: number; header: string; pick: string; how: string; problem?: string; sample: string[] };

/** The columns as read, each one changeable, and the import's options; "Check again" redoes the dry run with them. */
export function MappingEditor({ id, columns, choices, options, canEdit }: { id: string; columns: Col[]; choices: { value: string; label: string }[]; options: { mode: string; tags: string; images: string; newStatus: string; publishNew: boolean; emptyClears: boolean }; canEdit: boolean }) {
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [o, setO] = useState(options);
  const [pending, start] = useTransition();
  const [all, setAll] = useState(false);
  const changed = Object.keys(picks).length > 0 || JSON.stringify(o) !== JSON.stringify(options);
  const again = () =>
    start(async () => {
      const r = await reanalyseAction(id, { mapping: picks, options: o as never });
      if (!r.ok) toast(r.error, { tone: 'error' });
    });
  const shown = all ? columns : columns.filter((c) => c.how === 'unknown' || c.problem || c.pick === 'ignore').concat(columns.filter((c) => !(c.how === 'unknown' || c.problem || c.pick === 'ignore'))).slice(0, all ? undefined : 12);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((c) => {
          const value = picks[c.index] ?? c.pick;
          const bad = value === 'ignore' && c.header;
          return (
            <div key={c.index} className={`rounded-[6px] border p-3 ${bad ? 'border-[color-mix(in_oklab,var(--t-amber)_45%,transparent)] bg-[color-mix(in_oklab,var(--t-amber)_7%,transparent)]' : 'border-line bg-elev-2/40'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12.5px] font-semibold" title={c.header}>
                  {c.header || `Column ${c.index + 1}`}
                </span>
                <span className="shrink-0 text-[10.5px] text-ink-3">{c.how === 'exact' ? 'exact' : c.how === 'alias' ? 'recognised' : c.how === 'metafield' ? 'metafield' : c.how === 'option' ? 'option' : 'not known'}</span>
              </div>
              {c.pick === 'metafield' ? (
                <div className="mt-1.5 text-[12px] text-[var(--sage-ink)]">Metafield</div>
              ) : (
                <select className="field mt-1.5 !h-8 !text-[12px]" value={value} disabled={!canEdit} onChange={(e) => setPicks({ ...picks, [c.index]: e.target.value })}>
                  {choices.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              )}
              <div className="mt-1.5 truncate text-[11px] text-ink-4">{c.sample.filter(Boolean).slice(0, 3).join(' · ') || 'empty in the first rows'}</div>
            </div>
          );
        })}
      </div>
      {columns.length > 12 && (
        <button className="text-[12px] text-[var(--link)] hover:underline" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${columns.length} columns`}
        </button>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[6px] bg-elev-2/60 px-3.5 py-3 text-[12.5px]">
          <label className="flex items-center gap-2">
            Tags
            <select className="field !h-8 !w-auto !text-[12px]" value={o.tags} onChange={(e) => setO({ ...o, tags: e.target.value })}>
              <option value="MERGE">Add to existing</option>
              <option value="REPLACE">Replace</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            This file
            <select className="field !h-8 !w-auto !text-[12px]" value={o.mode} onChange={(e) => setO({ ...o, mode: e.target.value })}>
              <option value="both">Adds new and updates existing</option>
              <option value="new">Only adds new products</option>
              <option value="update">Only updates existing products</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Photos
            <select className="field !h-8 !w-auto !text-[12px]" value={o.images} onChange={(e) => setO({ ...o, images: e.target.value })}>
              <option value="MERGE">Add new ones</option>
              <option value="REPLACE">Replace all</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            New products
            <select className="field !h-8 !w-auto !text-[12px]" value={o.newStatus} onChange={(e) => setO({ ...o, newStatus: e.target.value })}>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={o.publishNew} onChange={(e) => setO({ ...o, publishNew: e.target.checked })} /> On the Online Store
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={o.emptyClears} onChange={(e) => setO({ ...o, emptyClears: e.target.checked })} /> Empty cells clear
          </label>
          <button className="btn btn-quiet btn-sm ml-auto" disabled={!changed || pending} onClick={again}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Check again
          </button>
        </div>
      )}
    </div>
  );
}

export function RevertButton({ id, count }: { id: string; count: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn btn-quiet" onClick={() => setConfirm(true)}>
        <RotateCcw className="size-4" /> Revert
      </button>
      {confirm && (
        <Modal title="Revert this import?" sub={`${num(count)} product${count === 1 ? '' : 's'} go back to how they were. Products the import created are archived, not deleted.`} onClose={() => setConfirm(false)}>
          <div className="flex items-start gap-2 rounded-[6px] bg-[var(--b-attention)] px-3 py-2.5 text-[12px] text-[var(--b-attention-ink)]">
            <AlertTriangle className="mt-px size-4 shrink-0" /> Changes made in Shopify after the import, on the same products, are undone too.
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-quiet" onClick={() => setConfirm(false)}>
              Keep it
            </button>
            <button
              className="btn btn-primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await revertAction(id);
                  if (r.ok) router.push(`/catalog/${r.id}`);
                  else toast(r.error, { tone: 'error' });
                })
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Revert
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** An export's products into other stores: a new import from this file, with its own dry run. */
export function CopyExport({ id, stores }: { id: string; stores: { id: string; name: string; brand: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [pending, start] = useTransition();
  if (!stores.length) return null;
  return (
    <>
      <button className="btn btn-quiet" onClick={() => setOpen(true)}>
        <Copy className="size-4" /> Copy into another store
      </button>
      {open && (
        <Modal title="Copy these products into…" sub="A new import is made from this export and checked against the store first (matched by handle). Nothing is written until you run it." onClose={() => setOpen(false)}>
          <div className="flex flex-wrap gap-2">
            {stores.map((s) => {
              const on = targets.includes(s.id);
              return (
                <button key={s.id} onClick={() => setTargets(on ? targets.filter((x) => x !== s.id) : [...targets, s.id])} className={`flex items-center gap-2 rounded-[6px] border px-3 py-2 text-[13px] transition ${on ? 'border-[var(--t-violet)] bg-[color-mix(in_oklab,var(--t-violet)_14%,transparent)] font-semibold' : 'border-line'}`}>
                  <StoreMark name={s.name} brand={s.brand} size={22} /> {s.name}
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-quiet" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!targets.length || pending}
              onClick={() =>
                start(async () => {
                  const r = await copyExportAction(id, targets);
                  if (r.ok) router.push(`/catalog/${r.id}`);
                  else toast(r.error, { tone: 'error' });
                })
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />} Check against them
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
