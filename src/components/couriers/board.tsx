'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { CheckCheck, Loader2, Truck } from 'lucide-react';
import { assignCourierAction, bookUpsAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';
import { ChannelChip, Empty } from '@/components/ui/bits';
import { COUNTRY_NAME, fmt } from '@/lib/domain/courier-rates';
import type { AssignRow } from '@/lib/courier-assign';

type Row = Omit<AssignRow, 'placedAt'> & { placedAt: string };

/** The courier a row is assigned to, in the rate sheet's names ("UPS Kuwait" is UPS). */
const sheetName = (c: string | null) => (c === 'UPS Kuwait' ? 'UPS' : c);

export function CourierBoard({ rows, canAssign, ups }: { rows: Row[]; canAssign: boolean; ups: boolean }) {
  const [view, setView] = useState<'todo' | 'all'>('todo');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const todo = rows.filter((r) => !r.assigned);
  const shown = view === 'todo' ? todo : rows;
  const totals = useMemo(() => {
    let cost = 0;
    let saved = 0;
    let off = 0; // assigned to something dearer than the pick
    for (const r of rows) {
      if (!r.rec.pick) continue;
      cost += r.rec.pick.total;
      const second = r.rec.options.find((o) => o.inUse && o !== r.rec.pick && o.label !== r.rec.pick!.label);
      if (second) saved += second.total - r.rec.pick.total;
      const a = sheetName(r.assigned);
      if (a && a !== r.rec.pick.courier) {
        const chosen = r.rec.options.find((o) => o.courier === a);
        if (chosen) off += chosen.total - r.rec.pick.total;
      }
    }
    return { cost, saved, off };
  }, [rows]);

  const run = (key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (r.ok) toast(r.message ?? 'Done');
      else toast(r.error ?? 'Failed', { tone: 'error' });
    });
  };

  const assignAll = () =>
    run('all', async () => {
      let n = 0;
      for (const r of todo) {
        if (!r.rec.pick) continue;
        const res = await assignCourierAction(r.id, r.rec.pick.courier);
        if (res.ok) n++;
      }
      return { ok: true, message: `${n} order${n === 1 ? '' : 's'} assigned to the recommended courier` };
    });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Waiting for a courier" value={String(todo.length)} sub={`${rows.length} open without a waybill`} />
        <Tile label="Cost at the recommended couriers" value={`KWD ${fmt(totals.cost)}`} sub="all open orders" />
        <Tile label="Saved vs the next cheapest" value={`KWD ${fmt(totals.saved)}`} sub="if every order goes with the pick" />
        <Tile label="Extra on orders assigned otherwise" value={`KWD ${fmt(totals.off)}`} sub="assigned to a dearer courier" tone={totals.off > 0 ? 'warn' : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-[var(--bg-sunk,#efeee9)] p-0.5 text-[12px]">
          {(['todo', 'all'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 ${view === v ? 'bg-[var(--bg-elev,#fff)] font-medium shadow-sm' : 'text-ink-3'}`}>
              {v === 'todo' ? `To assign (${todo.length})` : `All open (${rows.length})`}
            </button>
          ))}
        </div>
        {canAssign && todo.length > 0 && (
          <button onClick={assignAll} disabled={pending} className="btn btn-primary btn-sm ml-auto">
            {busy === 'all' ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />} Assign all to the recommended courier
          </button>
        )}
      </div>

      {!shown.length ? (
        <div className="panel">
          <Empty icon={Truck} title={view === 'todo' ? 'Every open order has a courier' : 'No open orders'} body="Open orders without a waybill show up here with the cheapest courier for each." />
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[980px] text-[12px]">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-ink-3">
                <th className="px-4 py-2 font-normal">Order</th>
                <th className="px-2 py-2 font-normal">Going to</th>
                <th className="px-2 py-2 font-normal">Parcel</th>
                <th className="px-2 py-2 font-normal">Recommended</th>
                <th className="px-2 py-2 font-normal">Other couriers</th>
                <th className="px-2 py-2 font-normal">Delivery paid</th>
                <th className="px-4 py-2 font-normal">Courier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {shown.map((r) => {
                const pick = r.rec.pick;
                const others = r.rec.options.filter((o) => o.label !== pick?.label && o.inUse);
                const assigned = sheetName(r.assigned);
                const sel = choice[r.id] ?? assigned ?? pick?.courier ?? '';
                const left = pick ? r.deliveryPaid - pick.total : 0;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link href={`/orders/${r.id}`} className="font-mono text-[12.5px] hover:underline">{r.number}</Link>
                        <ChannelChip id={r.channelId} compact />
                      </div>
                      <div className="mt-0.5 text-ink-3">{r.customer}</div>
                    </td>
                    <td className="px-2 py-2.5">
                      {COUNTRY_NAME[r.to]}
                      {r.to === 'KW' && <div className="text-ink-3">{r.area ?? 'area not recognised'}</div>}
                    </td>
                    <td className="px-2 py-2.5">
                      {r.pieces} pc · {r.rec.kg} kg{r.rec.estimated ? ' est.' : ''}
                      {r.cod > 0 && <div className="text-ink-3">cash on delivery</div>}
                    </td>
                    <td className="px-2 py-2.5" title={pick ? `${r.rec.why}${pick.surcharges.length ? ` · ${pick.surcharges.map((s) => `${s.label} ${fmt(s.amount)}`).join(' · ')}` : ''}` : r.rec.why}>
                      {pick ? (
                        <>
                          <div className="font-medium">{pick.label} · {fmt(pick.total)}</div>
                          <div className="text-ink-3">{r.rec.why}</div>
                        </>
                      ) : (
                        <span className="text-ink-3">{r.rec.why}</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-ink-3">{others.map((o) => `${o.courier} ${fmt(o.total)}`).join(' · ') || '—'}</td>
                    <td className={`px-2 py-2.5 font-mono ${left < 0 ? 'text-critical' : ''}`}>
                      {fmt(r.deliveryPaid)}
                      {pick && <div className="font-sans text-[11px] text-ink-3">{left < 0 ? `we pay ${fmt(-left)}` : `${fmt(left)} left`}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      {canAssign ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <select value={sel} onChange={(e) => setChoice((c) => ({ ...c, [r.id]: e.target.value }))} className="field !h-8 !w-32">
                            {r.rec.options.map((o) => (
                              <option key={o.label} value={o.courier}>{o.courier}{o.label === pick?.label ? ' ★' : ''}</option>
                            ))}
                          </select>
                          <button onClick={() => run(r.id, () => assignCourierAction(r.id, sel))} disabled={pending || (sel === assigned && !choice[r.id])} className="btn btn-quiet btn-sm">
                            {busy === r.id && <Loader2 className="size-3.5 animate-spin" />} {assigned ? 'Change' : 'Assign'}
                          </button>
                          {ups && r.to === 'KW' && sel === 'UPS' && (
                            <button onClick={() => run(`${r.id}:ups`, () => bookUpsAction(r.id))} disabled={pending} className="btn btn-primary btn-sm" title="Book the UPS (GMTC) shipment now">
                              {busy === `${r.id}:ups` && <Loader2 className="size-3.5 animate-spin" />} Book UPS
                            </button>
                          )}
                        </div>
                      ) : (
                        <span>{r.assigned ?? '—'}</span>
                      )}
                      {r.assigned && <div className="mt-1 text-[11px] text-ink-3">Assigned: {r.assigned}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="panel p-4">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className={`mt-2 font-display text-[17px] leading-none tabular ${tone === 'warn' ? 'text-[var(--warn)]' : ''}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-4">{sub}</div>}
    </div>
  );
}
