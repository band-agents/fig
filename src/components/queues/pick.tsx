'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useLocal } from '@/lib/hooks';
import { Boxes, Check, Loader2, PackageCheck, Printer, ScanLine, SearchX, Undo2, X } from 'lucide-react';
import { lookupCodeAction, type CodeLookup } from '@/app/(console)/stock/actions';
import type { OrderRow } from '@/lib/order-query';
import type { Scopes } from '@/lib/domain/perms';
import { CHANNEL, warehouseLabel } from '@/lib/channels';
import { ago } from '@/lib/format';
import { ChannelChip, Empty } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { OrderLink, ReasonModal, Spin, useMover } from './shared';

type Ticks = Record<string, number[]>; // orderId → indices of lines picked
type Line = OrderRow['lines'][number];
/** What a scan turned up when it was not a piece of an order being picked. */
type Found = { kind: 'order'; order: OrderRow; line: Line } | { kind: 'product'; code: string; items: CodeLookup[] } | { kind: 'none'; code: string } | null;

/** A scan is a barcode (exact) or a SKU (exact, or the scanner's code and the SKU sharing a stem). */
const matches = (l: Line, raw: string) => {
  const c = raw.toLowerCase();
  const sku = l.sku?.toLowerCase();
  return (!!l.barcode && l.barcode.toLowerCase() === c) || (!!sku && (sku === c || sku.startsWith(c) || c.startsWith(sku)));
};
const NO_TICKS: Ticks = {};

export function PickQueue({ ready, picking, scopes, meName }: { ready: OrderRow[]; picking: OrderRow[]; scopes: Scopes; meName: string }) {
  const m = useMover();
  const acts = (scopes.fulfilment ?? 0) >= 2;
  const houses = useMemo(() => [...new Set([...ready, ...picking].map((o) => CHANNEL[o.channelId]?.warehouse).filter(Boolean))] as string[], [ready, picking]);
  const [house, setHouse] = useState<string>('all');
  const [ticks, setTicks] = useLocal<Ticks>('relay:ticks', NO_TICKS);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [putBack, setPutBack] = useState<OrderRow | null>(null);
  const [found, setFound] = useState<Found>(null);
  const [looking, startLook] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);

  const save = (t: Ticks) => setTicks(t);
  const inHouse = (o: OrderRow) => house === 'all' || CHANNEL[o.channelId]?.warehouse === house;
  const r = ready.filter(inHouse);
  const p = picking.filter(inHouse);

  const toggle = (o: OrderRow, i: number) => {
    const cur = new Set(ticks[o.id] ?? []);
    if (cur.has(i)) cur.delete(i);
    else cur.add(i);
    save({ ...ticks, [o.id]: [...cur] });
  };

  // A scanner types the code and presses Enter. First it ticks a piece of an order being picked; if
  // none, it finds the order waiting for it; if none, it says what the piece is and where it sits.
  const onScan = (code: string) => {
    const c = code.trim();
    if (!c) return;
    for (const o of p) {
      const idx = o.lines.findIndex((l, i) => !(ticks[o.id] ?? []).includes(i) && matches(l, c));
      if (idx >= 0) {
        toggle(o, idx);
        setFound(null);
        setFlash(`${o.number}:${idx}`);
        setTimeout(() => setFlash(null), 900);
        setScan('');
        return;
      }
    }
    const waiting = ready.find((o) => o.lines.some((l) => matches(l, c)));
    if (waiting) {
      setFound({ kind: 'order', order: waiting, line: waiting.lines.find((l) => matches(l, c))! });
      setScan('');
      return;
    }
    startLook(async () => {
      const items = await lookupCodeAction(c);
      if (!items.length) {
        setFlash('miss');
        setTimeout(() => setFlash(null), 900);
      }
      setFound(items.length ? { kind: 'product', code: c, items } : { kind: 'none', code: c });
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center">
        <label className={`relative flex-1 transition ${flash === 'miss' ? 'animate-[shake_.3s]' : ''}`}>
          {looking ? <Loader2 className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 animate-spin text-ink-3" /> : <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-3" />}
          <input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onScan(scan)}
            placeholder="Scan a barcode or type a SKU, then Enter"
            className={`field !h-12 !pl-11 font-mono text-[14px] ${flash === 'miss' ? '!border-[var(--critical)]' : ''}`}
            data-editing={scan ? 'true' : undefined}
          />
        </label>
        <div className="flex gap-2">
          {houses.length > 1 && (
            <select className="field !h-12 !w-auto" value={house} onChange={(e) => setHouse(e.target.value)} aria-label="Warehouse">
              <option value="all">Both warehouses</option>
              {houses.map((h) => (
                <option key={h} value={h}>
                  {warehouseLabel(h)}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => window.print()} className="btn btn-quiet !h-12">
            <Printer className="size-4" /> Pick list
          </button>
        </div>
      </div>

      {found && (
        <ScanResult
          found={found}
          acts={acts}
          pending={m.pending}
          onClose={() => setFound(null)}
          onStart={(o) =>
            m.order(o.id, 'picking', {}, () => {
              setFound(null);
              scanRef.current?.focus();
            })
          }
        />
      )}

      <section className="print:hidden">
        <div className="mb-3 flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--t-blue)]" />
          <h2 className="text-[14px] font-medium">Picking now</h2>
          <span className="font-mono text-[11.5px] text-ink-3">{p.length}</span>
        </div>
        {p.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-2 px-4 py-8 text-center text-[12.5px] text-ink-3">Start an order from the queue below and its pick list opens here.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {p.map((o) => {
              const done = new Set(ticks[o.id] ?? []);
              const all = o.lines.length > 0 && o.lines.every((_, i) => done.has(i));
              return (
                <article key={o.id} className={`panel overflow-hidden ${all ? 'ring-1 ring-[color-mix(in_oklab,var(--good)_50%,transparent)]' : ''}`}>
                  <header className="flex items-center gap-2 border-b border-line px-4 py-3">
                    <OrderLink id={o.id} number={o.number} />
                    <ChannelChip id={o.channelId} compact />
                    {o.shipFrom && <span className="truncate text-[11.5px] text-ink-3">from {o.shipFrom}</span>}
                    <span className="ml-auto font-mono text-[11.5px] text-ink-3">
                      {done.size}/{o.lines.length}
                    </span>
                    <SlaChip due={o.dueAt} since={o.stageAt} />
                  </header>
                  <ul className="divide-y divide-[var(--line)]">
                    {o.lines.map((l, i) => {
                      const ok = done.has(i);
                      return (
                        <li key={i}>
                          <button onClick={() => toggle(o, i)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${ok ? 'bg-[color-mix(in_oklab,var(--good)_7%,transparent)]' : 'hover:bg-elev-2'} ${flash === `${o.number}:${i}` ? 'flash' : ''}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {l.image ? <img src={l.image} alt="" className={`h-[72px] w-14 shrink-0 rounded-lg object-cover ${ok ? 'opacity-50' : ''}`} /> : <span className="h-[72px] w-14 rounded-lg bg-elev-3" />}
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{l.brand}</div>
                              <div className={`truncate text-[13px] ${ok ? 'text-ink-3 line-through' : ''}`}>{l.title}</div>
                              <div className="mt-1 font-mono text-[11px] text-ink-3">{l.sku}</div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {l.size && <span className="rounded-md border border-line-2 px-2 py-0.5 font-mono text-[14px] font-medium">{l.size}</span>}
                              {l.quantity > 1 && <span className="font-mono text-[11.5px] text-[var(--warn)]">×{l.quantity}</span>}
                            </div>
                            <span className={`grid size-7 shrink-0 place-items-center rounded-full border-2 ${ok ? 'border-[var(--good)] bg-[var(--good)] text-white' : 'border-line-3'}`}>{ok && <Check className="size-4" strokeWidth={3} />}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {acts && (
                    <footer className="flex gap-2 border-t border-line p-3">
                      <button onClick={() => m.order(o.id, 'packed', {}, () => save({ ...ticks, [o.id]: [] }))} disabled={!all || m.pending} className="btn btn-primary flex-1">
                        <Spin on={m.busy === `${o.id}:packed`} />
                        <PackageCheck className="size-4" /> {all ? 'Packed, ready for courier' : `Pick ${o.lines.length - done.size} more`}
                      </button>
                      <button onClick={() => setPutBack(o)} className="btn btn-ghost" aria-label="Put back in queue">
                        <Undo2 className="size-4" />
                      </button>
                    </footer>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="print:hidden">
        <div className="mb-3 flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--t-blue)] opacity-50" />
          <h2 className="text-[14px] font-medium">Ready to pick</h2>
          <span className="font-mono text-[11.5px] text-ink-3">{r.length}</span>
          <span className="text-[11.5px] text-ink-4">oldest first</span>
        </div>
        {r.length === 0 ? (
          <div className="panel">
            <Empty icon={Boxes} title="Queue is clear" body="Approved orders drop in here the moment Finance or Autopilot clears them." />
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <ul className="divide-y divide-[var(--line)]">
              {r.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex -space-x-2">
                    {o.lines.slice(0, 3).map((l, i) =>
                      // eslint-disable-next-line @next/next/no-img-element
                      l.image ? <img key={i} src={l.image} alt="" className="size-10 rounded-md object-cover ring-2 ring-[var(--bg-elev)]" /> : <span key={i} className="size-10 rounded-md bg-elev-3" />,
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap">
                      <OrderLink id={o.id} number={o.number} />
                      <ChannelChip id={o.channelId} compact />
                      {o.shipFrom && <span className="text-[11.5px] text-ink-3">from {o.shipFrom}</span>}
                    </div>
                    {o.onHold && <div className="text-[11px] text-[var(--warn)]">on hold · {o.holdReason}</div>}
                    <div className="mt-0.5 truncate text-[11.5px] text-ink-3">
                      {o.lines.map((l) => `${l.title}${l.size ? ` (${l.size})` : ''}`).join(' · ')}
                    </div>
                  </div>
                  <span className="hidden text-[11px] text-ink-4 sm:inline" suppressHydrationWarning>approved {ago(o.stageAt)}</span>
                  <SlaChip due={o.dueAt} since={o.stageAt} held={o.onHold} />
                  {acts && (
                    <button onClick={() => m.order(o.id, 'picking', {}, () => scanRef.current?.focus())} disabled={m.pending || o.onHold} className="btn btn-quiet btn-sm">
                      <Spin on={m.busy === `${o.id}:picking`} /> Start picking
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* printable pick list */}
      <div className="hidden print:block">
        <h1 className="text-xl" suppressHydrationWarning>Pick list · {new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })} · {meName}</h1>
        {[...p, ...r].map((o) => (
          <div key={o.id} className="mt-3 border-b pb-2 text-sm">
            <b>{o.number}</b>
            {o.lines.map((l, i) => (
              <div key={i}>
                ☐ {l.sku} · {l.title} · {l.size ?? ''} × {l.quantity}
              </div>
            ))}
          </div>
        ))}
      </div>

      {putBack && (
        <ReasonModal
          title={`Put ${putBack.number} back`}
          reasons={['Item not found on the shelf', 'Damaged piece', 'Wrong size in the bin', 'End of shift']}
          cta="Put back in queue"
          onClose={() => setPutBack(null)}
          onSubmit={(reason) => m.order(putBack.id, 'ready', { reason }, () => setPutBack(null))}
        />
      )}
    </div>
  );
}

/** Says what a scan found: the order waiting for that piece, or the piece itself and where it sits. */
function ScanResult({ found, acts, pending, onClose, onStart }: { found: NonNullable<Found>; acts: boolean; pending: boolean; onClose: () => void; onStart: (o: OrderRow) => void }) {
  return (
    <div className="panel relative p-4 print:hidden">
      <button onClick={onClose} className="absolute right-3 top-3 grid size-7 place-items-center rounded-full text-ink-3 hover:bg-elev-2" aria-label="Close">
        <X className="size-4" />
      </button>
      {found.kind === 'order' && (
        <div className="flex flex-wrap items-center gap-3 pr-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {found.line.image ? <img src={found.line.image} alt="" className="h-14 w-11 rounded-md object-cover" /> : <span className="h-14 w-11 rounded-md bg-elev-3" />}
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] text-ink-3">Waiting to be picked in</div>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <OrderLink id={found.order.id} number={found.order.number} />
              <ChannelChip id={found.order.channelId} compact />
            </div>
            <div className="mt-0.5 truncate text-[12.5px] text-ink-2">
              {found.line.title}
              {found.line.size ? ` · ${found.line.size}` : ''}
              {found.line.quantity > 1 ? ` · ×${found.line.quantity}` : ''}
            </div>
            {found.order.onHold && <div className="mt-0.5 text-[11.5px] text-[var(--warn)]">On hold · {found.order.holdReason}</div>}
          </div>
          {acts && (
            <button onClick={() => onStart(found.order)} disabled={pending || found.order.onHold} className="btn btn-primary btn-sm">
              Start picking {found.order.number}
            </button>
          )}
        </div>
      )}
      {found.kind === 'product' && (
        <div className="space-y-3 pr-8">
          <div className="text-[11.5px] text-ink-3">
            Not in any order waiting to be picked · <span className="font-mono">{found.code}</span>
          </div>
          {found.items.map((it) => {
            const total = it.stock.reduce((a, st) => a + st.onHand, 0);
            return (
              <div key={it.sku} className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.image ? <img src={it.image} alt="" className="h-16 w-12 rounded-md object-cover" /> : <span className="h-16 w-12 rounded-md bg-elev-3" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-ink-3">{it.brand}</div>
                  <div className="truncate text-[13px] font-medium">{it.title}</div>
                  <div className="mt-0.5 text-[12px] text-ink-2">
                    {it.size ? `Size ${it.size} · ` : ''}
                    <span className="font-mono">{it.sku}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {it.stock.length === 0 && <span className="pill">No stock recorded</span>}
                    {it.stock.map((st) => (
                      <span key={st.location} className="pill" data-tone={st.onHand > 0 ? 'neutral' : 'critical'}>
                        {st.location}: {st.onHand}
                        {st.bin ? ` · bin ${st.bin}` : ''}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-[11.5px] text-ink-3">{total} on hand in all</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {found.kind === 'none' && (
        <div className="flex items-center gap-3 pr-8 text-[12.5px] text-ink-2">
          <SearchX className="size-5 text-ink-3" />
          <span>
            Nothing matches <span className="font-mono">{found.code}</span>: not in an order being picked, not waiting in the queue, not in the catalogue.
          </span>
        </div>
      )}
    </div>
  );
}
