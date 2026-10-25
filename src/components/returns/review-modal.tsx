'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { money, toMajor, toMinor } from '@/lib/format';
import {
  CONDITIONS,
  DECLINE_REASONS,
  FAULTS,
  REFUND_KINDS,
  REVIEW_CHECKS,
  reviewProblem,
  type CheckAnswer,
  type Condition,
  type Fault,
  type RefundKind,
  type ReturnReview,
  type ReviewContext,
} from '@/lib/domain/return-review';

export type { ReviewContext } from '@/lib/domain/return-review';


const METHOD: Record<string, string> = { original: 'back the way they paid', store_credit: 'as account credit', cash_at_store: 'in cash at a branch' };

/**
 * Approving or declining a return: the checks the desk made, what the photos show, whose fault it was
 * and what should go back, with a note in their own words, all of it shown to the refund team.
 */
export function ReviewModal({
  number,
  decision,
  ctx,
  pending,
  onClose,
  onSubmit,
}: {
  number: string;
  decision: 'approved' | 'rejected';
  ctx: ReviewContext | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (review: ReturnReview) => void;
}) {
  const approve = decision === 'approved';
  const [checks, setChecks] = useState<ReturnReview['checks']>(() => (ctx && ctx.daysLeft != null ? { window: ctx.daysLeft >= 0 ? 'yes' : 'no', ...(ctx.photos === 0 ? { photos: 'na' as const } : {}) } : {}));
  const [condition, setCondition] = useState<Condition | undefined>();
  const [fault, setFault] = useState<Fault | undefined>();
  const [paidBy, setPaidBy] = useState<'customer' | 'us' | undefined>();
  const [kind, setKind] = useState<RefundKind | undefined>(ctx?.resolution === 'credit' ? 'credit' : ctx?.resolution === 'exchange' ? 'exchange' : undefined);
  const [part, setPart] = useState('');
  const [reason, setReason] = useState('');
  const [told, setTold] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const review: ReturnReview = {
    decision,
    checks,
    condition,
    fault,
    shippingPaidBy: paidBy,
    refundKind: kind,
    refundAmount: kind === 'partial' && ctx ? toMinor(part || 0, ctx.currency) : undefined,
    reason,
    toldCustomer: told,
    note,
  };
  const problem = reviewProblem(review, { amount: ctx?.amount ?? Number.MAX_SAFE_INTEGER });

  const chip = (on: boolean) => `h-8 rounded-full border px-3 text-[12px] transition ${on ? 'border-ink bg-ink text-bg' : 'border-line-2 text-ink-2 hover:border-line-3 hover:text-ink'}`;
  const answer = (k: string, v: CheckAnswer) => setChecks((c) => ({ ...c, [k]: v }));

  return (
    <Modal title={`${approve ? 'Approve' : 'Decline'} ${number}`} sub="The refund team sees everything you record here." onClose={onClose} wide>
      {ctx && (
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-elev-2 px-3.5 py-2.5 text-[12px] text-ink-2">
          <span>
            Worth <b className="font-semibold text-ink">{money(ctx.amount, ctx.currency)}</b>, {METHOD[ctx.refundMethod] ?? ctx.refundMethod.replace(/_/g, ' ')}
          </span>
          <span>{ctx.daysLeft == null ? 'Delivery date unknown' : ctx.daysLeft >= 0 ? `${ctx.daysLeft} day${ctx.daysLeft === 1 ? '' : 's'} left in the window` : `Window closed ${-ctx.daysLeft} day${ctx.daysLeft === -1 ? '' : 's'} ago`}</span>
          <span>{ctx.photos ? `${ctx.photos} photo${ctx.photos > 1 ? 's' : ''} from the customer` : 'No photos attached'}</span>
        </div>
      )}

      {approve ? (
        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-[12.5px] font-medium">What you checked</h3>
            <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
              {REVIEW_CHECKS.map((c) => (
                <li key={c.key} className="flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px]">{c.label}</div>
                    <div className="text-[11.5px] text-ink-3">{c.hint}</div>
                  </div>
                  <div className="flex gap-1">
                    {(['yes', 'no', 'na'] as const).map((v) => (
                      <button key={v} onClick={() => answer(c.key, v)} className={chip(checks[c.key] === v)}>
                        {v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'N/A'}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-[12.5px] font-medium">What the photos show</h3>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(CONDITIONS) as Condition[]).map((k) => (
                  <button key={k} onClick={() => setCondition(k)} className={chip(condition === k)}>
                    {CONDITIONS[k]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-[12.5px] font-medium">Whose fault</h3>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(FAULTS) as Fault[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      setFault(k);
                      setPaidBy((p) => p ?? (k === 'customer' ? 'customer' : 'us'));
                    }}
                    className={chip(fault === k)}
                  >
                    {FAULTS[k]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-[12.5px] font-medium">Paying the customer back</h3>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(REFUND_KINDS) as RefundKind[]).map((k) => (
                  <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>
                    {REFUND_KINDS[k]}
                  </button>
                ))}
              </div>
              {kind === 'partial' && ctx && (
                <label className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
                  Refund
                  <input className="field !h-8 !w-32 font-mono text-[12px]" inputMode="decimal" value={part} onChange={(e) => setPart(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(toMajor(ctx.amount, ctx.currency))} />
                  {ctx.currency} of {money(ctx.amount, ctx.currency)}
                </label>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-[12.5px] font-medium">Who pays for the trip back</h3>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setPaidBy('customer')} className={chip(paidBy === 'customer')}>
                  The customer
                </button>
                <button onClick={() => setPaidBy('us')} className={chip(paidBy === 'us')}>
                  We do
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-[12.5px] font-medium">Why it is declined</h3>
            <div className="flex flex-wrap gap-1.5">
              {DECLINE_REASONS.map((r) => (
                <button key={r} onClick={() => setReason(r)} className={chip(reason === r)}>
                  {r}
                </button>
              ))}
            </div>
            <input className="field mt-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or write the reason" />
          </section>
          <section>
            <h3 className="mb-2 text-[12.5px] font-medium">What the customer was told</h3>
            <textarea className="field" rows={2} value={told} onChange={(e) => setTold(e.target.value)} placeholder="e.g. Called her, explained bras are final sale, offered 10% off the next order" />
          </section>
        </div>
      )}

      <section className="mt-4">
        <h3 className="mb-2 text-[12.5px] font-medium">Note for the refund team</h3>
        <textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={approve ? 'e.g. Stitching open on the left strap, clear in photo 2. Refund to KNET, she has the receipt.' : 'e.g. Photos show it was worn; nothing to refund.'} />
      </section>

      {tried && problem && <p className="mt-3 text-[12.5px] text-[var(--b-critical-ink)]">{problem}</p>}
      <div className="mt-5 flex items-center justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">
          Back
        </button>
        <button
          disabled={pending}
          onClick={() => {
            setTried(true);
            if (!problem) onSubmit(review);
          }}
          className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {approve ? 'Approve return' : 'Decline return'}
        </button>
      </div>
    </Modal>
  );
}
