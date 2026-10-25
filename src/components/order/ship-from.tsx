'use client';

import { useState, useTransition } from 'react';
import { Loader2, MapPinned, RefreshCw } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { checkBranchesAction, shipFromAction } from '@/app/actions';
import { ago } from '@/lib/format';
import type { ShipFromOptions } from '@/lib/ship-from';

/**
 * Which branch the parcel leaves from: what Lucida says each branch holds, the one that can fill the
 * whole order, and the branch the team settles on.
 */
export function ShipFrom({ orderId, data, canSet }: { orderId: string; data: ShipFromOptions; canSet: boolean }) {
  const [pending, start] = useTransition();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState<'check' | 'set' | null>(null);
  const choices = [
    ...data.options.map((o) => ({ code: o.code, name: o.name, sub: o.complete ? 'has every piece' : `${o.lines} of ${data.perLine.length} pieces` })),
    ...data.places.filter((p) => !data.options.some((o) => o.code === p.code)).map((p) => ({ code: p.code, name: p.name, sub: p.kind === 'warehouse' ? 'warehouse' : p.sells ? 'sells this brand' : 'other brands' })),
  ];
  const set = (b: { code: string; name: string } | null) => {
    setBusy('set');
    start(async () => {
      const r = await shipFromAction(orderId, b);
      setBusy(null);
      if (r.ok) toast(r.message ?? 'Saved');
      else toast(r.error, { tone: 'error' });
    });
  };
  const check = () => {
    setBusy('check');
    start(async () => {
      const r = await checkBranchesAction(orderId);
      setBusy(null);
      if (r.ok) toast(r.message ?? 'Checked');
      else toast(r.error, { tone: 'error' });
    });
  };

  return (
    <section className="panel p-5">
      <div className="flex items-start gap-2">
        <div className="eyebrow mb-3 flex items-center gap-1.5">
          <MapPinned className="size-3.5" /> Ships from
        </div>
        {data.lucida && canSet && (
          <button onClick={check} disabled={pending} className="btn btn-ghost btn-sm -mt-1 ml-auto" title={data.budget ? `${data.budget.left} of ${data.budget.limit} Lucida calls left this hour` : undefined}>
            {busy === 'check' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Ask Lucida
          </button>
        )}
      </div>

      {data.current ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">{data.current.name}</div>
            <div className="text-[11.5px] text-ink-3">
              Set by {data.current.by ?? 'someone'}
              {data.current.at ? `, ${ago(data.current.at)}` : ''}
            </div>
          </div>
          {canSet && (
            <button onClick={() => set(null)} disabled={pending} className="btn btn-ghost btn-sm">
              Change
            </button>
          )}
        </div>
      ) : (
        <>
          {data.suggestion ? (
            <div className="rounded-xl bg-elev-2 px-3.5 py-2.5">
              <div className="text-[11px] text-ink-3">Lucida says this branch has every piece</div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[13.5px] font-medium">{data.suggestion.name}</span>
                {canSet && (
                  <button onClick={() => set({ code: data.suggestion!.code, name: data.suggestion!.name })} disabled={pending} className="btn btn-primary btn-sm">
                    {busy === 'set' && <Loader2 className="size-3.5 animate-spin" />} Ship from here
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-2">
              {!data.lucida
                ? 'Not decided. Lucida is not connected yet, so the branches holding each piece cannot be shown.'
                : data.checkedAt
                  ? data.options.length
                    ? 'No single branch holds every piece: it ships from more than one, or waits for a transfer.'
                    : 'Lucida holds none of these pieces in any branch.'
                  : 'Not decided. Ask Lucida which branches hold the pieces.'}
            </p>
          )}
          {canSet && choices.length > 0 && (
            <div className="mt-3 flex gap-2">
              <select className="field !h-9 flex-1 text-[12.5px]" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose the branch…</option>
                {choices.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} · {c.sub}
                  </option>
                ))}
              </select>
              <button
                disabled={pending || !pick}
                onClick={() => {
                  const c = choices.find((x) => x.code === pick);
                  if (c) set({ code: c.code, name: c.name });
                }}
                className="btn btn-quiet btn-sm !h-9"
              >
                Set
              </button>
            </div>
          )}
        </>
      )}

      {data.checkedAt && data.perLine.length > 0 && (
        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-[12px] text-ink-2">Where each piece is ({ago(data.checkedAt)})</summary>
          <ul className="mt-2 space-y-2 text-[12px]">
            {data.perLine.map((l, i) => (
              <li key={`${l.code}-${i}`}>
                <div className="truncate">
                  {l.title} <span className="font-mono text-[11px] text-ink-4">{l.code}</span>
                </div>
                <div className="text-[11.5px] text-ink-3">{l.branches.length ? l.branches.slice(0, 6).map((b) => `${b.name} ${b.qty}`).join(' · ') : 'In no branch'}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!data.lucida && <p className="mt-3 text-[11px] text-ink-4">Lucida logins go in this console’s own settings (LUCIDA_ACCOUNTS); then Ask Lucida appears here.</p>}
    </section>
  );
}
