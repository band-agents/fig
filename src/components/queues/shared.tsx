'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { moveOrderAction, moveReturnAction, noteAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';
import { ORDER_STAGE, RETURN_STAGE, type OrderStage, type ReturnStage } from '@/lib/domain/stages';

export function useMover() {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const order = (id: string, to: OrderStage, input: Record<string, string> = {}, done?: () => void) => {
    setBusy(`${id}:${to}`);
    start(async () => {
      const r = await moveOrderAction(id, to, input);
      setBusy(null);
      if (r.ok) {
        toast(`→ ${ORDER_STAGE[to].label}`);
        done?.();
      } else toast(r.error, { tone: 'error' });
    });
  };
  const ret = (id: string, to: ReturnStage, input: Parameters<typeof moveReturnAction>[2] = {}, done?: () => void) => {
    setBusy(`${id}:${to}`);
    start(async () => {
      const r = await moveReturnAction(id, to, input);
      setBusy(null);
      if (r.ok) {
        toast(`→ ${RETURN_STAGE[to].label}`);
        done?.();
      } else toast(r.error, { tone: 'error' });
    });
  };
  const call = (orderId: string, text: string) => {
    setBusy(`${orderId}:call`);
    start(async () => {
      const r = await noteAction({ orderId }, text, 'call');
      setBusy(null);
      if (r.ok) toast('Call logged');
      else toast(r.error, { tone: 'error' });
    });
  };
  return { pending, busy, order, ret, call };
}

export function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 className="size-3.5 animate-spin" /> : null;
}

export function OrderLink({ id, number }: { id: string; number: string }) {
  return (
    <Link href={`/orders/${id}`} className="font-mono text-[13.5px] hover:underline">
      {number}
    </Link>
  );
}

/** Pick-a-reason dialog used across queues. */
export function ReasonModal({ title, reasons, cta, danger, onClose, onSubmit, withTracking }: { title: string; reasons: readonly string[]; cta: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string, tracking?: string) => void; withTracking?: boolean }) {
  const [pick, setPick] = useState<string>('');
  const [extra, setExtra] = useState('');
  const [tracking, setTracking] = useState('');
  const reason = [pick, extra].filter(Boolean).join(' · ');
  return (
    <Modal title={title} onClose={onClose}>
      {withTracking && (
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-ink-3">Waybill</span>
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} className="field font-mono" autoFocus />
        </label>
      )}
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((r) => (
            <button key={r} onClick={() => setPick(r)} className={`h-8 rounded-lg border px-2.5 text-[12.5px] ${pick === r ? 'border-ink bg-elev-3 text-ink' : 'border-line-2 text-ink-2'}`}>
              {r}
            </button>
          ))}
        </div>
      )}
      {!(withTracking && !reasons.length) && <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={reasons.length ? 'Anything to add (optional)' : 'Reason'} className="field mt-3" autoFocus={!withTracking} />}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">
          Back
        </button>
        <button onClick={() => onSubmit(reason, tracking)} disabled={withTracking ? !tracking.trim() : !reason} className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}>
          {cta}
        </button>
      </div>
    </Modal>
  );
}
