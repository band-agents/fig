'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Check, Loader2, PackageCheck, Plus, Search, Send } from 'lucide-react';
import { acceptManyAction, addPoLinesAction, createPoAction, dismissRecAction, movePoAction, poCandidatesAction, receivePoAction, setPoLineAction } from '@/app/(console)/stock/actions';
import type { PoCandidate } from '@/lib/stock/views/purchasing';
import { toast } from '@/components/ui/toast';
import { useNow } from '@/lib/hooks';
import { Modal } from '@/components/ui/modal';
import type { Rec } from './rec-card';
import { bySize } from '@/lib/domain/stock/sizes';

type Group = {
  key: string;
  supplier: string;
  country: string;
  market: string;
  leadDays: number;
  units: number;
  cost: number | null;
  risk: number | null;
  urgent: number;
  orderBy: string | null;
  lines: Rec[];
};

const egp = (v: number) => `EGP ${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v / 100)}`;
const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));

/** One supplier's share of the plan: tick the lines to buy, and they go onto that supplier's draft order. */
export function PlanGroup({ g, canAct }: { g: Group; canAct: boolean }) {
  const [picked, setPicked] = useState<string[]>(() => g.lines.filter((l) => l.priority <= 2).map((l) => l.id));
  const [gone, setGone] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const lines = g.lines.filter((l) => !gone.includes(l.id));
  const units = lines.filter((l) => picked.includes(l.id)).reduce((a, l) => a + Number(l.payload.qty ?? 0), 0);
  const now = useNow();
  const late = g.orderBy != null && now != null && Date.parse(g.orderBy) < now;
  if (!lines.length) return null;
  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-medium">{g.supplier}</h3>
          <div className="text-[11.5px] text-ink-3">
            {g.market === 'EG' ? 'Egypt' : 'Kuwait'} · {g.leadDays} days to deliver · {lines.length} style{lines.length > 1 ? 's' : ''}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          {g.urgent > 0 && <span className="font-medium text-critical">{g.urgent} urgent</span>}
          {g.orderBy && <span className={late ? 'text-critical' : 'text-ink-2'}>{late ? 'Order today' : `Order by ${day(g.orderBy)}`}</span>}
          {g.cost != null && <span className="font-mono text-ink-2">{egp(g.cost)} at cost</span>}
          {g.risk != null && g.risk > 0 && <span className="font-mono text-ink-3">{egp(g.risk)} at risk</span>}
        </div>
      </header>
      <div className="scroll-thin overflow-x-auto">
        <table className="table text-[12.5px]">
          <thead>
            <tr>
              {canAct && (
                <th className="w-8">
                  <input type="checkbox" aria-label="All" className="accent-[var(--ink)]" checked={picked.length === lines.length} onChange={(e) => setPicked(e.target.checked ? lines.map((l) => l.id) : [])} />
                </th>
              )}
              <th>Style</th>
              <th className="text-right">Buy</th>
              <th>Sizes</th>
              <th className="text-right">Runs out</th>
              <th>Numbers</th>
              {canAct && <th />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const sizes = Object.entries((l.payload.sizes as Record<string, number>) ?? {})
                .filter(([, n]) => n > 0)
                .sort(([a], [b]) => bySize(a, b));
              const out = l.payload.stockout as string | null;
              return (
                <tr key={l.id}>
                  {canAct && (
                    <td>
                      <input type="checkbox" aria-label={`Buy ${l.product?.title}`} className="accent-[var(--ink)]" checked={picked.includes(l.id)} onChange={(e) => setPicked((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} />
                    </td>
                  )}
                  <td className="max-w-[300px]">
                    <Link href={`/stock/inventory/${l.product?.id}`} className="flex items-center gap-2.5 hover:underline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {l.product?.image ? <img src={l.product.image} alt="" className="h-10 w-8 shrink-0 rounded object-cover" /> : <span className="h-10 w-8 shrink-0 rounded bg-elev-3" />}
                      <span className="min-w-0">
                        <span className="block truncate">{l.product?.title}</span>
                        <span className="block text-[11px] text-ink-4">
                          {l.priority === 1 && <b className="mr-1 font-medium text-critical">Urgent</b>}
                          {l.reasons.find((r) => r.label === 'Rate')?.value} · {l.reasons.find((r) => r.label === 'Class')?.value}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="text-right font-mono font-medium">{Number(l.payload.qty ?? 0)}</td>
                  <td className="whitespace-nowrap font-mono text-[11px] text-ink-3">{sizes.map(([s, n]) => `${s} ${n}`).join(' · ')}</td>
                  <td className={`whitespace-nowrap text-right font-mono text-[11.5px] ${l.priority === 1 ? 'text-critical' : ''}`}>{out ? day(out) : '—'}</td>
                  <td className="max-w-[340px]">
                    <span className="flex flex-wrap gap-1">
                      {l.reasons
                        .filter((r) => r.label !== 'Rate' && r.label !== 'Class')
                        .slice(0, 3)
                        .map((r) => (
                          <span key={r.label} className="inline-flex items-center gap-1 rounded-md bg-elev-2 px-1.5 py-0.5 text-[10.5px] text-ink-3">
                            {r.label} <b className={`font-mono font-medium ${r.tone === 'bad' ? 'text-critical' : r.tone === 'good' ? 'text-good' : 'text-ink'}`}>{r.value}</b>
                          </span>
                        ))}
                    </span>
                  </td>
                  {canAct && (
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          start(async () => {
                            const r = await dismissRecAction(l.id, 'Not buying it this time');
                            if (r.ok) setGone((s) => [...s, l.id]);
                            else toast(r.error, { tone: 'error' });
                          })
                        }
                      >
                        Skip
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canAct && (
        <footer className="flex items-center justify-between gap-3 border-t border-line bg-inset/40 px-5 py-3">
          <span className="text-[12px] text-ink-3">
            {picked.length} of {lines.length} ticked · {units} pieces
          </span>
          <button
            disabled={pending || !picked.length}
            onClick={() =>
              start(async () => {
                const r = await acceptManyAction(picked.filter((id) => lines.some((l) => l.id === id)));
                if (r.ok) {
                  toast(`Added to the draft order for ${g.supplier}`);
                  setGone((s) => [...s, ...picked]);
                  setPicked([]);
                } else toast(r.error, { tone: 'error' });
              })
            }
            className="btn btn-primary btn-sm"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Add to the {g.supplier.split(' ')[0]} draft order
          </button>
        </footer>
      )}
    </section>
  );
}

export function NewPoButton({ suppliers, markets }: { suppliers: { id: string; name: string }[]; markets: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState(suppliers[0]?.id ?? '');
  const [market, setMarket] = useState(markets[0] ?? 'EG');
  const [pending, start] = useTransition();
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        <Plus className="size-4" /> New purchase order
      </button>
      {open && (
        <Modal title="New purchase order" sub="It starts as a draft for that supplier, delivered to the market's warehouse. Add styles from the plan or the style pages." onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-3">Supplier</span>
              <select className="field" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-3">Market</span>
              <select className="field" value={market} onChange={(e) => setMarket(e.target.value)}>
                {markets.map((m) => (
                  <option key={m} value={m}>
                    {m === 'EG' ? 'Egypt' : 'Kuwait'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={pending || !supplier}
              onClick={() =>
                start(async () => {
                  const r = await createPoAction(supplier, market);
                  if (r.ok) {
                    toast(r.message ?? 'Started');
                    setOpen(false);
                    if (r.href) router.push(r.href);
                  } else toast(r.error, { tone: 'error' });
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Start the draft
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The status buttons a person's access allows on this order. */
export function PoSteps({ id, steps, empty = false }: { id: string; steps: { to: string; label: string }[]; empty?: boolean }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  if (!steps.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((s) => {
        const danger = s.to === 'cancelled';
        const primary = ['approved', 'approval', 'sent', 'confirmed', 'closed'].includes(s.to) && !danger;
        return (
          <button
            key={s.to}
            disabled={pending || (empty && !danger)}
            title={empty && !danger ? 'Add at least one style first' : undefined}
            onClick={() => {
              if (danger && !confirm('Cancel this purchase order?')) return;
              setBusy(s.to);
              start(async () => {
                const r = await movePoAction(id, s.to as never);
                setBusy(null);
                if (r.ok) toast(r.message ?? 'Done');
                else toast(r.error, { tone: 'error' });
              });
            }}
            className={`btn btn-sm ${danger ? 'btn-danger' : primary ? 'btn-primary' : 'btn-quiet'}`}
          >
            {busy === s.to ? <Loader2 className="size-3.5 animate-spin" /> : s.to === 'sent' ? <Send className="size-3.5" /> : null}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

type Style = { productId: string; title: string; image: string | null; sizes: { lineId: string; size: string; qty: number; received: number; damaged: number }[] };

/** Booking in a delivery: what arrived in good order, and what arrived damaged, size by size. */
export function ReceiveButton({ id, number, styles }: { id: string; number: string; styles: Style[] }) {
  const [open, setOpen] = useState(false);
  const due = useMemo(() => Object.fromEntries(styles.flatMap((s) => s.sizes.map((z) => [z.lineId, Math.max(0, z.qty - z.received - z.damaged)]))), [styles]);
  const [good, setGood] = useState<Record<string, number>>(due);
  const [bad, setBad] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();
  const total = Object.values(good).reduce((a, b) => a + (b || 0), 0);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
        <PackageCheck className="size-3.5" /> Receive
      </button>
      {open && (
        <Modal title={`Receive ${number}`} sub="Everything still expected is filled in. Change what is different and book it; the rest stays open." onClose={() => setOpen(false)} wide>
          <div className="scroll-thin max-h-[52vh] space-y-3 overflow-y-auto pr-1">
            {styles.map((s) => (
              <div key={s.productId} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.image ? <img src={s.image} alt="" className="h-10 w-8 rounded object-cover" /> : null}
                  <span className="truncate text-[12.5px] font-medium">{s.title}</span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
                  {s.sizes.map((z) => (
                    <div key={z.lineId} className="rounded-lg bg-elev-2 p-2">
                      <div className="mb-1 flex justify-between text-[11px] text-ink-3">
                        <span>{z.size}</span>
                        <span className="font-mono">{due[z.lineId]} due</span>
                      </div>
                      <input aria-label={`${z.size} good`} className="field !h-8 font-mono text-[12.5px]" inputMode="numeric" value={good[z.lineId] ?? 0} onChange={(e) => setGood((g) => ({ ...g, [z.lineId]: Number(e.target.value.replace(/\D/g, '')) || 0 }))} />
                      <input aria-label={`${z.size} damaged`} placeholder="damaged" className="field mt-1 !h-7 font-mono text-[11.5px]" inputMode="numeric" value={bad[z.lineId] || ''} onChange={(e) => setBad((g) => ({ ...g, [z.lineId]: Number(e.target.value.replace(/\D/g, '')) || 0 }))} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-[12px] text-ink-3">{total} good pieces to stock</span>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const lines = Object.keys(due).map((lineId) => ({ lineId, good: good[lineId] ?? 0, damaged: bad[lineId] ?? 0 }));
                    const r = await receivePoAction(id, lines);
                    if (r.ok) {
                      toast(r.message ?? 'Received');
                      setOpen(false);
                    } else toast(r.error, { tone: 'error' });
                  })
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                Book it in
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** A draft's quantity, edited where it stands. Zero removes the size. */
export function LineQty({ lineId, qty }: { lineId: string; qty: number }) {
  const [v, setV] = useState(String(qty));
  const [pending, start] = useTransition();
  const save = () => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === qty) return;
    start(async () => {
      const r = await setPoLineAction(lineId, n);
      if (!r.ok) {
        toast(r.error, { tone: 'error' });
        setV(String(qty));
      }
    });
  };
  return <input aria-label="Quantity" className={`field !h-7 !w-16 !px-2 text-right font-mono text-[12px] ${pending ? 'opacity-50' : ''}`} inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

/**
 * Adding styles to a draft by hand: the supplier's best sellers to start with (each with a suggested
 * quantity), or a search by name, style code, SKU or barcode. The quantity is spread over the sizes
 * by the style's usual size mix; each size can be changed on its line afterwards.
 */
export function PoAddLines({ poId }: { poId: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PoCandidate[] | null>(null);
  const [loading, startLoad] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => startLoad(async () => setItems(await poCandidatesAction(poId, q))), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [poId, q]);
  return (
    <div className="border-t border-line px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold">Add styles</h3>
        <span className="text-[11.5px] text-ink-3">{q ? 'Search results' : 'This supplier’s best sellers first'}</span>
      </div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a style by name, style code, SKU or barcode" className="field !pl-9" />
        {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" />}
      </label>
      <ul className="mt-3 divide-y divide-[var(--line)]">
        {items?.length === 0 && <li className="py-6 text-center text-[12.5px] text-ink-3">{q ? 'No style matches that.' : 'No styles found for this supplier yet. Search for one above.'}</li>}
        {items?.map((it) => (
          <CandidateRow key={it.productId} poId={poId} it={it} onAdded={() => router.refresh()} />
        ))}
      </ul>
    </div>
  );
}

function CandidateRow({ poId, it, onAdded }: { poId: string; it: PoCandidate; onAdded: () => void }) {
  const [qty, setQty] = useState(String(it.suggest));
  const [pending, start] = useTransition();
  const add = () => {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return;
    start(async () => {
      const r = await addPoLinesAction(poId, it.productId, n);
      if (r.ok) {
        toast(`Added ${n} × ${it.title}`);
        onAdded();
      } else toast(r.error, { tone: 'error' });
    });
  };
  return (
    <li className="flex items-center gap-3 py-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {it.image ? <img src={it.image} alt="" className="h-12 w-9 shrink-0 rounded-md object-cover" /> : <span className="h-12 w-9 shrink-0 rounded-md bg-elev-3" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium">{it.title}</div>
        <div className="truncate text-[11.5px] text-ink-3">
          {it.brand} · {it.sizes || 'One size'}
        </div>
        <div className="text-[11px] text-ink-4">
          {it.rate > 0 ? `sells ${it.rate.toFixed(it.rate < 10 ? 1 : 0)} a week` : 'no recent sales'}
          {it.cover != null ? ` · ${it.cover >= 100 ? '99+' : Math.round(it.cover)} weeks of cover` : ''}
        </div>
      </div>
      <input aria-label="Pieces" className="field !h-8 !w-16 !px-2 text-right font-mono text-[12px]" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && add()} />
      <button onClick={add} disabled={pending} className="btn btn-quiet btn-sm">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add
      </button>
    </li>
  );
}
