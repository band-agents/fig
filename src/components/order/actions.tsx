'use client';

import { useRef, useState, useTransition } from 'react';
import { Hand, Loader2, Pause, Play, PhoneCall, Undo2, UserRound } from 'lucide-react';
import { assignAction, holdAction, moveOrderAction, noteAction } from '@/app/actions';
import { CANCEL_REASONS, HOLD_REASONS, ORDER_FLOW, ORDER_STAGE, RTO_REASONS, type OrderStage, type Transition } from '@/lib/domain/stages';
import type { Scopes } from '@/lib/domain/perms';
import { toast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';

type Props = {
  orderId: string;
  stage: string;
  onHold: boolean;
  scopes: Scopes;
  me: { id: string };
  assigneeId: string | null;
  assignable: { id: string; name: string }[];
  courier: string | null;
  canReturn: boolean;
  canWork: boolean; // owns the current stage (or manages orders): may hold, take, assign
  onReturn?: () => void;
};

export function OrderActions(p: Props) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<Transition<OrderStage> | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const flows = ORDER_FLOW[p.stage as OrderStage] ?? [];
  const mine = flows.filter((t) => (p.scopes[t.area] ?? 0) >= (t.level ?? 2));
  const others = flows.filter((t) => !mine.includes(t));
  const canHold = p.canWork && !['settled', 'cancelled', 'rto_closed'].includes(p.stage);

  const run = (to: OrderStage, input: Record<string, string> = {}) =>
    start(async () => {
      const r = await moveOrderAction(p.orderId, to, input);
      if (r.ok) {
        toast(`Moved to ${ORDER_STAGE[to].label}`);
        setOpen(null);
      } else toast(r.error, { tone: 'error' });
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {p.onHold ? (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await holdAction(p.orderId, false);
              if (r.ok) toast('Hold released');
                else toast(r.error, { tone: 'error' });
            })
          }
          className="btn btn-primary"
        >
          <Play className="size-4" /> Release hold
        </button>
      ) : (
        mine.map((t) => (
          <button
            key={t.to}
            disabled={pending}
            onClick={() => (t.needs?.length ? setOpen(t) : run(t.to))}
            className={`btn ${t.tone === 'primary' ? 'btn-primary' : t.tone === 'danger' ? 'btn-danger' : 'btn-quiet'}`}
          >
            {pending && !t.needs?.length && t.tone === 'primary' && <Loader2 className="size-4 animate-spin" />}
            {t.label}
          </button>
        ))
      )}
      {!p.onHold && mine.length === 0 && others.length > 0 && (
        <span className="text-[12.5px] text-ink-3">Waiting on {[...new Set(others.map((o) => ORDER_STAGE[o.to] && areaLabel(o.area)))].join(' or ')}</span>
      )}
      <span className="mx-1 hidden h-6 w-px bg-line-2 sm:block" />
      {(p.scopes.intake ?? 0) >= 2 && (
        <button onClick={() => setCallOpen(true)} className="btn btn-ghost btn-sm">
          <PhoneCall className="size-4" /> Log call
        </button>
      )}
      {canHold && !p.onHold && (
        <button onClick={() => setHoldOpen(true)} className="btn btn-ghost btn-sm">
          <Pause className="size-4" /> Hold
        </button>
      )}
      {p.assigneeId !== p.me.id && canHold && (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await assignAction(p.orderId, p.me.id);
              if (r.ok) toast('It’s yours');
                else toast(r.error, { tone: 'error' });
            })
          }
          className="btn btn-ghost btn-sm"
        >
          <Hand className="size-4" /> Take it
        </button>
      )}
      {p.assignable.length > 0 && canHold && <AssignMenu orderId={p.orderId} people={p.assignable} current={p.assigneeId} />}
      {p.canReturn && p.onReturn && (
        <button onClick={p.onReturn} className="btn btn-ghost btn-sm">
          <Undo2 className="size-4" /> Open return
        </button>
      )}

      {open && <MoveDialog t={open} courier={p.courier} pending={pending} onClose={() => setOpen(null)} onSubmit={(input) => run(open.to, input)} />}
      {holdOpen && (
        <ReasonDialog
          title="Put on hold"
          sub="The target clock pauses until the hold is released."
          reasons={[...HOLD_REASONS]}
          cta="Hold order"
          pending={pending}
          onClose={() => setHoldOpen(false)}
          onSubmit={(reason) =>
            start(async () => {
              const r = await holdAction(p.orderId, true, reason);
              if (r.ok) {
                toast('On hold');
                setHoldOpen(false);
              } else toast(r.error, { tone: 'error' });
            })
          }
        />
      )}
      {callOpen && (
        <ReasonDialog
          title="Log a call"
          sub="What did the customer say? It goes on the timeline for everyone."
          reasons={['Confirmed size and address', 'No answer', 'Asked to call back later', 'Wants to change the address', 'Wants to cancel', 'Confirmed on WhatsApp']}
          cta="Save call"
          pending={pending}
          onClose={() => setCallOpen(false)}
          onSubmit={(text) =>
            start(async () => {
              const r = await noteAction({ orderId: p.orderId }, text, 'call');
              if (r.ok) {
                toast('Call logged');
                setCallOpen(false);
              } else toast(r.error, { tone: 'error' });
            })
          }
        />
      )}
    </div>
  );
}

const AREA_NAMES: Record<string, string> = { intake: 'Customer care', finance: 'Finance', fulfilment: 'the warehouse', shipping: 'Shipping', returns: 'the returns desk' };
const areaLabel = (a: string) => AREA_NAMES[a] ?? a;

function AssignMenu({ orderId, people, current }: { orderId: string; people: { id: string; name: string }[]; current: string | null }) {
  const [pending, start] = useTransition();
  return (
    <label className="relative inline-flex items-center">
      <UserRound className="pointer-events-none absolute left-2.5 size-4 text-ink-3" />
      <select
        disabled={pending}
        value={current ?? ''}
        onChange={(e) =>
          start(async () => {
            const r = await assignAction(orderId, e.target.value || null);
            if (r.ok) toast('Assigned');
                else toast(r.error, { tone: 'error' });
          })
        }
        className="field !h-[30px] !w-auto !rounded-lg !pl-8 text-[12.5px]"
        aria-label="Assign to"
      >
        <option value="">Unassigned</option>
        {people.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MoveDialog({ t, courier, pending, onClose, onSubmit }: { t: Transition<OrderStage>; courier: string | null; pending: boolean; onClose: () => void; onSubmit: (i: Record<string, string>) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const reasons = t.to === 'cancelled' ? CANCEL_REASONS : t.to === 'rto' ? RTO_REASONS : null;
  return (
    <Modal title={t.label} onClose={onClose}>
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const reason = [fd.get('reasonPick'), fd.get('reason')].filter(Boolean).join(' · ');
          onSubmit({ reason, tracking: String(fd.get('tracking') ?? ''), courier: String(fd.get('courier') ?? ''), note: String(fd.get('note') ?? '') });
        }}
        className="space-y-3"
      >
        {t.needs?.includes('tracking') && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label>
              <span className="mb-1 block text-xs text-ink-3">Waybill number</span>
              <input name="tracking" className="field font-mono" autoFocus required inputMode="numeric" placeholder="e.g. 41234567890" />
            </label>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Courier</span>
              <input name="courier" className="field w-32" defaultValue={courier ?? 'Aramex'} />
            </label>
          </div>
        )}
        {t.needs?.includes('reason') && (
          <>
            {reasons && (
              <div className="flex flex-wrap gap-1.5">
                {reasons.map((r) => (
                  <label key={r} className="cursor-pointer">
                    <input type="radio" name="reasonPick" value={r} className="peer sr-only" />
                    <span className="inline-flex h-8 items-center rounded-lg border border-line-2 px-2.5 text-[12.5px] text-ink-2 transition peer-checked:border-ink peer-checked:bg-elev-3 peer-checked:text-ink">{r}</span>
                  </label>
                ))}
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-xs text-ink-3">{reasons ? 'Anything to add' : 'Reason'}</span>
              <input name="reason" className="field" autoFocus={!reasons} required={!reasons} />
            </label>
          </>
        )}
        {t.needs?.includes('note') && (
          <label className="block">
            <span className="mb-1 block text-xs text-ink-3">Note</span>
            <textarea name="note" className="field" rows={3} required />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Back
          </button>
          <button className={`btn ${t.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t.label}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReasonDialog({ title, sub, reasons, cta, pending, onClose, onSubmit }: { title: string; sub: string; reasons: string[]; cta: string; pending: boolean; onClose: () => void; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Modal title={title} sub={sub} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <button key={r} type="button" onClick={() => setText(r)} className={`h-8 rounded-lg border px-2.5 text-[12.5px] transition ${text === r ? 'border-ink bg-elev-3 text-ink' : 'border-line-2 text-ink-2 hover:text-ink'}`}>
            {r}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} className="field mt-3" rows={3} placeholder="Or write it in your own words" autoFocus />
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onClose} className="btn btn-ghost">
          Back
        </button>
        <button onClick={() => onSubmit(text)} disabled={pending || !text.trim()} className="btn btn-primary">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {cta}
        </button>
      </div>
    </Modal>
  );
}
