'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { openReturnAction } from '@/app/actions';
import { RETURN_REASONS, type ReturnReason } from '@/lib/domain/stages';
import { money } from '@/lib/format';
import { toast } from '@/components/ui/toast';

type Line = { id: string; title: string; size: string | null; image: string | null; quantity: number; unitPrice: number | null; returnable: boolean };

export function ReturnDialog({ orderId, lines, currency, policy, canOverride, onClose }: { orderId: string; lines: Line[]; currency: string; policy: { label: string; ok: boolean; why: string; storeOnly: boolean }; canOverride: boolean; onClose: () => void }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason>('too_small');
  const [resolution, setResolution] = useState<'refund' | 'exchange' | 'credit'>('refund');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(false);
  const [pending, start] = useTransition();
  const picked = lines.filter((l) => (qty[l.id] ?? 0) > 0);
  const amount = picked.reduce((s, l) => s + (l.unitPrice ?? 0) * (qty[l.id] ?? 0), 0);
  const blocked = (!policy.ok || picked.some((l) => !l.returnable)) && !override;

  return (
    <Modal title="Open a return" sub={policy.label} onClose={onClose} wide>
      {!policy.ok && <div className="mb-3 rounded-lg border border-[color-mix(in_oklab,var(--warn)_40%,transparent)] px-3 py-2 text-[13px] text-[var(--warn)]">{policy.why}</div>}
      <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
        {lines.map((l) => (
          <li key={l.id} className={`flex items-center gap-3 p-3 ${!l.returnable ? 'opacity-60' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {l.image ? <img src={l.image} alt="" className="size-11 rounded-md object-cover" /> : <span className="size-11 rounded-md bg-elev-3" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{l.title}</div>
              <div className="text-[11.5px] text-ink-3">
                {l.size ? `Size ${l.size} · ` : ''}
                {l.unitPrice != null ? money(l.unitPrice, currency) : ''}
                {!l.returnable && (
                  <span className="ml-1 inline-flex items-center gap-1 text-critical">
                    <Ban className="size-3" /> final sale
                  </span>
                )}
              </div>
            </div>
            <select
              className="field !h-9 !w-20"
              value={qty[l.id] ?? 0}
              onChange={(e) => setQty((q) => ({ ...q, [l.id]: Number(e.target.value) }))}
              aria-label={`Quantity to return of ${l.title}`}
              disabled={!l.returnable && !canOverride}
            >
              {Array.from({ length: l.quantity + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs text-ink-3">Reason</span>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
            {Object.entries(RETURN_REASONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Customer wants</span>
          <select className="field" value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
            <option value="refund">Refund</option>
            <option value="exchange">Exchange</option>
            <option value="credit">Store credit</option>
          </select>
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-xs text-ink-3">Note {override && <span className="text-critical">(required for an override)</span>}</span>
        <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={policy.storeOnly ? 'Returns go back through a brand store in this market' : 'What the customer said'} />
      </label>
      {canOverride && (!policy.ok || picked.some((l) => !l.returnable)) && (
        <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="accent-[var(--signal)]" /> Override the policy for this customer (goes on the timeline)
        </label>
      )}
      <div className="mt-5 flex items-center justify-between gap-2">
        <span className="text-[13px] text-ink-3">{picked.length ? <>Refund value {amount ? <b className="font-mono text-ink">{money(amount, currency)}</b> : '—'}</> : 'Pick what is coming back'}</span>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn btn-ghost">
            Back
          </button>
          <button
            className="btn btn-primary"
            disabled={pending || !picked.length || blocked}
            onClick={() =>
              start(async () => {
                const r = await openReturnAction(orderId, { items: picked.map((l) => ({ orderItemId: l.id, quantity: qty[l.id] })), reason, note: note || undefined, resolution, override });
                if (r.ok) {
                  toast(`Return ${r.message} opened`);
                  onClose();
                  router.refresh();
                } else toast(r.error, { tone: 'error' });
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Open return
          </button>
        </div>
      </div>
    </Modal>
  );
}
