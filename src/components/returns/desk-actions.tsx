'use client';

import { useState } from 'react';
import { Loader2, ScanSearch } from 'lucide-react';
import { mayTake, RETURN_FLOW, type ReturnStage, type Transition } from '@/lib/domain/stages';
import type { Scopes } from '@/lib/domain/perms';
import { Modal } from '@/components/ui/modal';
import { ReasonModal, useMover } from '@/components/queues/shared';
import { ReviewModal, type ReviewContext } from '@/components/returns/review-modal';

const INSPECT = [
  { v: 'pass', label: 'Passed', sub: 'Unworn, tags on. Back to stock.' },
  { v: 'partial', label: 'Partly accepted', sub: 'Some pieces pass, some don’t.' },
  { v: 'damaged', label: 'Damaged', sub: 'Worn, washed or broken. Not restocked.' },
  { v: 'wrong_item', label: 'Wrong item', sub: 'Not what we sent.' },
] as const;

export function DeskActions({ id, number, stage, method, scopes, review, compact = false }: { id: string; number: string; stage: string; method: string; scopes: Scopes; review?: ReviewContext | null; compact?: boolean }) {
  const m = useMover();
  const [need, setNeed] = useState<Transition<ReturnStage> | null>(null);
  // approving or declining a request asks for the review the refund team reads
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const [inspect, setInspect] = useState(false);
  const flows = (RETURN_FLOW[stage as ReturnStage] ?? []).filter((t) => mayTake(scopes, t)).filter((t) => !(t.to === 'pickup' && method === 'store'));
  if (!flows.length) return null;
  const shown = compact ? flows.slice(0, 1) : flows;
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((t) => (
        <button
          key={t.to}
          disabled={m.pending}
          onClick={() => (t.to === 'approved' || t.to === 'rejected' ? setDeciding(t.to) : t.to === 'inspected' ? setInspect(true) : t.needs?.length ? setNeed(t) : m.ret(id, t.to))}
          className={`btn ${compact ? 'btn-sm' : ''} ${t.tone === 'primary' ? 'btn-primary' : t.tone === 'danger' ? 'btn-danger' : 'btn-quiet'}`}
        >
          {m.busy === `${id}:${t.to}` && <Loader2 className="size-3.5 animate-spin" />}
          {t.to === 'inspected' && <ScanSearch className="size-3.5" />}
          {t.label}
        </button>
      ))}
      {need && (
        <ReasonModal
          title={`${need.label} · ${number}`}
          reasons={need.to === 'rejected' ? ['Outside the return window', 'Final-sale item', 'Worn or washed', 'Tags removed'] : need.to === 'closed' ? ['Exchanged for another size', 'Store credit issued', 'Customer kept it after all'] : []}
          withTracking={need.needs?.includes('tracking')}
          cta={need.label}
          danger={need.tone === 'danger'}
          onClose={() => setNeed(null)}
          onSubmit={(reason, tracking) => m.ret(id, need.to, { reason, tracking, note: need.needs?.includes('note') ? reason : undefined }, () => setNeed(null))}
        />
      )}
      {deciding && (
        <ReviewModal
          number={number}
          decision={deciding}
          ctx={review ?? null}
          pending={m.pending}
          onClose={() => setDeciding(null)}
          onSubmit={(rv) => m.ret(id, deciding, { review: rv }, () => setDeciding(null))}
        />
      )}
      {inspect && <InspectModal number={number} onClose={() => setInspect(false)} onSubmit={(inspection, restock, note) => m.ret(id, 'inspected', { inspection, restock, note: note || undefined }, () => setInspect(false))} pending={m.pending} />}
    </div>
  );
}

function InspectModal({ number, onClose, onSubmit, pending }: { number: string; onClose: () => void; onSubmit: (v: (typeof INSPECT)[number]['v'], restock: boolean, note: string) => void; pending: boolean }) {
  const [v, setV] = useState<(typeof INSPECT)[number]['v']>('pass');
  const [restock, setRestock] = useState(true);
  const [note, setNote] = useState('');
  return (
    <Modal title={`Inspect ${number}`} sub="What came back, and can it be sold again?" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {INSPECT.map((o) => (
          <button
            key={o.v}
            onClick={() => {
              setV(o.v);
              setRestock(o.v === 'pass' || o.v === 'partial');
            }}
            className={`rounded-xl border p-3 text-left transition ${v === o.v ? 'border-ink bg-elev-3' : 'border-line-2 hover:border-line-3'}`}
          >
            <div className="text-[12.5px] font-medium">{o.label}</div>
            <div className="mt-0.5 text-[11.5px] text-ink-3">{o.sub}</div>
          </button>
        ))}
      </div>
      <label className="mt-4 flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="accent-[var(--ink)]" /> Put back into sellable stock
      </label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} className="field mt-3" rows={2} placeholder="Notes for finance (optional)" />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">
          Back
        </button>
        <button onClick={() => onSubmit(v, restock, note)} disabled={pending} className="btn btn-primary">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save inspection
        </button>
      </div>
    </Modal>
  );
}
