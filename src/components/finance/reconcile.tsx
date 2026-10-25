'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { reconcileSettlementAction } from '@/app/actions';
import { toMajor } from '@/lib/format';
import { toast } from '@/components/ui/toast';

export function Reconcile({ id, expected, currency }: { id: string; expected: number; currency: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(String(toMajor(expected, currency)));
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="btn btn-quiet btn-sm">
        Reconcile
      </button>
    );
  return (
    <form
      className="inline-flex items-center gap-2"
      data-editing="true"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await reconcileSettlementAction(id, Number(v));
          if (r.ok) {
            toast(r.message ?? 'Saved');
            setOpen(false);
          } else toast(r.error, { tone: 'error' });
        });
      }}
    >
      <span className="text-[11.5px] text-ink-3">{currency}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} className="field !h-[30px] !w-28 text-right font-mono text-[12px]" inputMode="decimal" autoFocus />
      <button className="btn btn-primary btn-sm" disabled={pending}>
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        Save
      </button>
    </form>
  );
}
