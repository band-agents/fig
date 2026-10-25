'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { CircleAlert, Clock, Loader2, MapPin, Pause, Play, Plus, ScanLine, Shuffle, Sparkles, Square, Truck } from 'lucide-react';
import { addTaskAction, assignTaskAction, blockTaskAction, finishTaskAction, moveTransferAction, rebalanceAction, startTaskAction } from '@/app/(console)/stock/actions';
import { toast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';
import { useNow } from '@/lib/hooks';
import { when } from '@/lib/format';
import type { TaskView } from '@/lib/stock/views/warehouse';

const KINDS: { value: string; label: string; area: string }[] = [
  { value: 'cycle_count', label: 'Cycle count', area: 'warehouse' },
  { value: 'putaway', label: 'Put away', area: 'warehouse' },
  { value: 'replenish', label: 'Replenish pick face', area: 'warehouse' },
  { value: 'quality_check', label: 'Quality check', area: 'warehouse' },
  { value: 'relabel', label: 'Re-ticket', area: 'warehouse' },
  { value: 'receive', label: 'Receive delivery', area: 'warehouse' },
  { value: 'supplier_followup', label: 'Chase supplier', area: 'procurement' },
  { value: 'po_review', label: 'Review purchase order', area: 'procurement' },
  { value: 'merch_setup', label: 'Website placement', area: 'merch' },
];

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));

export function TaskCard({ t, manage, people, compact = false }: { t: TaskView; manage?: boolean; people?: { id: string; name: string }[]; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const now = useNow();
  const late = t.dueAt && now != null && Date.parse(t.dueAt) < now && t.status !== 'done';
  const doing = t.status === 'doing';
  const elapsed = doing && t.startedAt && now ? mins(now - Date.parse(t.startedAt)) : 0;
  const over = doing && elapsed > t.estMinutes;
  const act = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast(r.message ?? 'Done');
      else toast((r as { error: string }).error, { tone: 'error' });
    });
  return (
    <article data-tint={t.tint} className={`relative rounded-2xl border bg-elev p-4 shadow-[var(--hi)] transition ${doing ? 'border-[color-mix(in_oklab,var(--tint)_45%,var(--line))] shadow-[0_0_0_3px_color-mix(in_oklab,var(--tint)_12%,transparent)]' : 'border-line'} ${t.status === 'done' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="pill !h-[21px]">
          <span className="dot" />
          {t.kindLabel}
        </span>
        <span className="font-mono text-ink-3">{t.number}</span>
        {t.priority <= 2 && (
          <span className="pill" data-tint={t.priority === 1 ? 'red' : 'amber'}>
            {t.priority === 1 ? 'Urgent' : 'High'}
          </span>
        )}
        {t.source === 'ai' && (
          <span className="inline-flex items-center gap-1 text-ink-4" title="Raised by the stock planner">
            <Sparkles className="size-3" /> Auto
          </span>
        )}
        {t.dueAt && t.status !== 'done' && (
          <span className={`ml-auto ${late ? 'font-medium text-critical' : 'text-ink-3'}`} suppressHydrationWarning>
            {late ? 'late · ' : 'due '}
            {when(t.dueAt)}
          </span>
        )}
      </div>
      <h3 className={`mt-2 font-medium leading-snug ${compact ? 'text-[13px]' : 'text-[14px]'}`}>{t.title}</h3>
      {t.detail && !compact && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{t.detail}</p>}
      {t.blockedReason && t.status === 'blocked' && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-critical">
          <CircleAlert className="size-3.5" /> {t.blockedReason}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
        {t.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" />
            {t.location}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" />
          {t.estMinutes} min standard
        </span>
        {t.units > 0 && <span>{t.units} pieces</span>}
        {t.ref && (
          <Link href={t.ref.type === 'po' ? `/stock/purchasing/${t.ref.id}` : '/stock/warehouse?tab=transfers'} className="font-mono hover:text-ink hover:underline">
            {t.ref.label}
          </Link>
        )}
        {manage && t.assignee && <span>· {t.assignee}</span>}
      </div>
      {doing && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px]">
            <span className={over ? 'text-[var(--warn)]' : 'text-ink-2'} suppressHydrationWarning>
              {elapsed} min in
            </span>
            <span className="text-ink-4">of {t.estMinutes}</span>
          </div>
          <div className="h-1.5 rounded-full bg-elev-3">
            <div className={`h-full rounded-full ${over ? 'bg-[var(--warn)]' : 'bg-[var(--tint)]'}`} style={{ width: `${Math.min(100, (elapsed / Math.max(1, t.estMinutes)) * 100)}%` }} />
          </div>
        </div>
      )}
      {t.status !== 'done' && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {manage && people && (
            <select aria-label="Assign to" className="field !h-8 !w-auto max-w-[180px] text-[12px]" value={t.assigneeId ?? ''} disabled={pending} onChange={(e) => act(() => assignTaskAction(t.id, e.target.value || null))}>
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex gap-2">
            {t.status !== 'blocked' && (
              <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setBlocking(true)}>
                <Pause className="size-3.5" /> Blocked
              </button>
            )}
            {!doing && (
              <button className="btn btn-quiet btn-sm" disabled={pending} onClick={() => act(() => startTaskAction(t.id))}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Start
              </button>
            )}
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => act(() => finishTaskAction(t.id))}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              Done
            </button>
          </div>
        </div>
      )}
      {blocking && (
        <Modal title="What is in the way?" sub="Your manager sees it at once on the floor board." onClose={() => setBlocking(false)}>
          <div className="flex flex-wrap gap-1.5">
            {['Stock not where the system says', 'Delivery has not arrived', 'Need a hand: too heavy', 'Scanner not working', 'Waiting for the supplier'].map((r) => (
              <button key={r} onClick={() => setReason(r)} className={`rounded-lg border px-2.5 py-1.5 text-[12px] ${reason === r ? 'border-ink bg-elev-3' : 'border-line-2 text-ink-2'}`}>
                {r}
              </button>
            ))}
          </div>
          <textarea className="field mt-3" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or say it in your own words" />
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setBlocking(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!reason.trim() || pending}
              onClick={() => {
                setBlocking(false);
                act(() => blockTaskAction(t.id, reason));
              }}
            >
              Flag it
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}

/** A scan or a typed number narrows the list: task, order, transfer or anything in the title. */
export function TaskList({ tasks, manage, people, empty }: { tasks: TaskView[]; manage?: boolean; people?: { id: string; name: string }[]; empty: string }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return tasks;
    return tasks.filter((t) => [t.number, t.title, t.ref?.label, t.location, t.assignee].some((x) => x?.toLowerCase().includes(s)));
  }, [q, tasks]);
  return (
    <div className="space-y-3">
      {tasks.length > 4 && (
        <label className="relative block">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scan or type a task, order or transfer number" className="field !h-10 !pl-9" data-editing={q ? 'true' : undefined} />
        </label>
      )}
      {shown.length === 0 ? <div className="rounded-2xl border border-dashed border-line-2 px-6 py-10 text-center text-[12.5px] text-ink-3">{empty}</div> : shown.map((t) => <TaskCard key={t.id} t={t} manage={manage} people={people} />)}
    </div>
  );
}

export function RebalanceButton({ area = 'warehouse' }: { area?: 'warehouse' | 'procurement' | 'merch' }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn btn-quiet"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await rebalanceAction(area);
          if (r.ok) toast(r.message ?? 'Rebalanced');
          else toast(r.error, { tone: 'error' });
        })
      }
      title="Hand every waiting task out again, so nobody sits idle while someone else has a queue"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Shuffle className="size-4" />}
      Rebalance
    </button>
  );
}

export function AddTaskButton({ people, locations, areas, manage }: { people: { id: string; name: string }[]; locations: { id: string; name: string }[]; areas: string[]; manage: boolean }) {
  const kinds = KINDS.filter((k) => areas.includes(k.area));
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(kinds[0]?.value ?? 'cycle_count');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [loc, setLoc] = useState('');
  const [units, setUnits] = useState('');
  const [who, setWho] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState(3);
  const [pending, start] = useTransition();
  if (!kinds.length) return null;
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add a task
      </button>
      {open && (
        <Modal title="Add a task" sub={manage ? 'Unassigned, it goes to whoever has the least on, at that place, on shift.' : 'It goes on your own list.'} onClose={() => setOpen(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs text-ink-3">Kind</span>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Where</span>
              <select className="field" value={loc} onChange={(e) => setLoc(e.target.value)}>
                <option value="">No particular place</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs text-ink-3">What</span>
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Count bay C-04 after the delivery" />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs text-ink-3">Notes (optional)</span>
              <textarea className="field" rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Pieces (sets the standard time)</span>
              <input className="field font-mono" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} placeholder="0" />
            </label>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Due</span>
              <input className="field" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            {manage && (
              <label>
                <span className="mb-1 block text-xs text-ink-3">Who</span>
                <select className="field" value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">Whoever has the least on</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span className="mb-1 block text-xs text-ink-3">Priority</span>
              <select className="field" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                <option value={1}>Urgent</option>
                <option value={2}>High</option>
                <option value={3}>Normal</option>
                <option value={4}>Low</option>
              </select>
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={pending || !title.trim()}
              onClick={() =>
                start(async () => {
                  const r = await addTaskAction({ kind: kind as never, title, detail: detail || undefined, locationId: loc || null, units: Number(units) || 0, dueAt: due ? new Date(due).toISOString() : null, priority, assigneeId: who || null });
                  if (r.ok) {
                    toast(r.message ?? 'Added');
                    setOpen(false);
                    setTitle('');
                    setDetail('');
                  } else toast(r.error, { tone: 'error' });
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Add it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

const NEXT: Record<string, { to: string; label: string }[]> = {
  proposed: [
    { to: 'picking', label: 'Start picking' },
    { to: 'cancelled', label: 'Cancel' },
  ],
  picking: [{ to: 'in_transit', label: 'Send it' }],
  in_transit: [{ to: 'received', label: 'Received' }],
};

export function TransferActions({ id, status, canAct }: { id: string; status: string; canAct: boolean }) {
  const [pending, start] = useTransition();
  if (!canAct) return null;
  return (
    <div className="flex justify-end gap-1.5">
      {(NEXT[status] ?? []).map((n) => (
        <button
          key={n.to}
          disabled={pending}
          className={`btn btn-sm ${n.to === 'cancelled' ? 'btn-ghost' : 'btn-quiet'}`}
          onClick={() =>
            start(async () => {
              const r = await moveTransferAction(id, n.to as never);
              if (r.ok) toast(r.message ?? 'Done');
              else toast(r.error, { tone: 'error' });
            })
          }
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : n.to === 'in_transit' ? <Truck className="size-3.5" /> : null}
          {n.label}
        </button>
      ))}
    </div>
  );
}
