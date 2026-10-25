import { CONDITIONS, FAULTS, REFUND_KINDS, REVIEW_CHECKS, type ReturnReview } from '@/lib/domain/return-review';
import { money, when } from '@/lib/format';

const ANSWER = { yes: 'Yes', no: 'No', na: 'N/A' } as const;

/** What the desk recorded when it approved or declined a return, as the refund team reads it. */
export function ReviewCard({ review, currency, seesMoney, compact = false }: { review: ReturnReview | null; currency: string; seesMoney: boolean; compact?: boolean }) {
  if (!review) {
    if (compact) return <p className="text-[11.5px] text-ink-4">No review recorded (decided before reviews were asked for).</p>;
    return null;
  }
  const approved = review.decision === 'approved';
  const back =
    review.refundKind === 'full' || review.refundKind === 'partial'
      ? `${REFUND_KINDS[review.refundKind]}${seesMoney && review.refundAmount != null ? `: ${money(review.refundAmount, currency)}` : ''}`
      : review.refundKind
        ? REFUND_KINDS[review.refundKind]
        : null;

  if (compact) {
    return (
      <div className="space-y-1 text-[12px]">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ink-2">
          {approved ? (
            <>
              {back && <span className="font-medium text-ink">{back}</span>}
              {review.fault && <span>{review.fault === 'customer' ? 'Customer’s choice' : review.fault === 'ours' ? 'Our fault' : 'Courier’s fault'}</span>}
              {review.condition && <span>{CONDITIONS[review.condition]}</span>}
              {review.shippingPaidBy && <span>{review.shippingPaidBy === 'us' ? 'We pay the trip back' : 'Customer pays the trip back'}</span>}
            </>
          ) : (
            <span className="font-medium text-ink">Declined: {review.reason}</span>
          )}
        </div>
        <p className="text-ink-2">“{review.note}”</p>
        <p className="text-[11px] text-ink-4">
          {review.byName ?? 'Returns desk'}
          {review.at ? `, ${when(review.at)}` : ''}
        </p>
      </div>
    );
  }

  return (
    <section className="panel">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-medium">{approved ? 'Approval review' : 'Why it was declined'}</h2>
        <span className="pill ml-auto" data-tone={approved ? 'success' : 'critical'}>
          {approved ? 'Approved' : 'Declined'}
        </span>
      </header>
      <div className="space-y-3 px-5 py-4 text-[12.5px]">
        {approved ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {back && (
              <>
                <dt className="text-ink-3">Pay back</dt>
                <dd className="font-medium">{back}</dd>
              </>
            )}
            {review.fault && (
              <>
                <dt className="text-ink-3">Fault</dt>
                <dd>{FAULTS[review.fault]}</dd>
              </>
            )}
            {review.condition && (
              <>
                <dt className="text-ink-3">Photos show</dt>
                <dd>{CONDITIONS[review.condition]}</dd>
              </>
            )}
            {review.shippingPaidBy && (
              <>
                <dt className="text-ink-3">Trip back</dt>
                <dd>{review.shippingPaidBy === 'us' ? 'We pay' : 'The customer pays'}</dd>
              </>
            )}
          </dl>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-ink-3">Reason</dt>
            <dd className="font-medium">{review.reason}</dd>
            {review.toldCustomer && (
              <>
                <dt className="text-ink-3">Customer told</dt>
                <dd>{review.toldCustomer}</dd>
              </>
            )}
          </dl>
        )}
        {approved && (
          <ul className="grid gap-1 border-t border-line pt-3">
            {REVIEW_CHECKS.map((c) => {
              const a = review.checks[c.key];
              return (
                <li key={c.key} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-ink-2">{c.label}</span>
                  <span className={a === 'no' ? 'font-medium text-[var(--b-critical-ink)]' : a === 'yes' ? 'text-ink' : 'text-ink-4'}>{a ? ANSWER[a] : '—'}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="rounded-xl bg-elev-2 px-3.5 py-2.5">
          <div className="mb-0.5 text-[11px] text-ink-3">Note for the refund team</div>
          <p className="whitespace-pre-line">{review.note}</p>
        </div>
        <p className="text-[11px] text-ink-4">
          {review.byName ?? 'Returns desk'}
          {review.at ? `, ${when(review.at)}` : ''}
        </p>
      </div>
    </section>
  );
}
