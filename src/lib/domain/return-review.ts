/**
 * What the returns desk records when it approves or declines a return, for the refund team.
 *
 * Dan, 21 Oct 2026: whoever decides a return has to leave more than a click behind, so the people who
 * send the money back can see why without opening the photos and the order again. Approving asks for
 * the checks that were made, what the photos show, whose fault it was, how much should go back and
 * how; declining asks for the reason and what the customer was told. Both need a note in the desk's
 * own words. It is stored on the return as written and never recomputed.
 */

export const REVIEW_CHECKS = [
  { key: 'photos', label: 'Checked the customer’s photos', hint: 'They show the problem the customer describes.' },
  { key: 'window', label: 'Inside the return window', hint: 'Counted from the day it was delivered.' },
  { key: 'eligible', label: 'The item can be returned', hint: 'Not final sale, not swimwear or underwear with the hygiene seal broken.' },
  { key: 'delivered', label: 'The order was delivered and paid', hint: 'Cash on delivery collected, or paid online.' },
  { key: 'contacted', label: 'Spoke to the customer', hint: 'Call or WhatsApp, so nothing here surprises them.' },
] as const;
export type CheckKey = (typeof REVIEW_CHECKS)[number]['key'];
export type CheckAnswer = 'yes' | 'no' | 'na';

export const CONDITIONS = {
  as_new: 'As new, tags on',
  worn: 'Looks worn or washed',
  damaged: 'Damaged or faulty',
  wrong: 'Not the item we sent',
  unclear: 'Photos don’t show enough',
} as const;
export type Condition = keyof typeof CONDITIONS;

export const FAULTS = {
  customer: 'Customer’s choice (size, changed mind)',
  ours: 'Ours (wrong item, faulty, not as pictured)',
  courier: 'The courier’s (damaged in transit)',
} as const;
export type Fault = keyof typeof FAULTS;

export const REFUND_KINDS = {
  full: 'Full refund',
  partial: 'Part refund',
  exchange: 'Exchange, no refund',
  credit: 'Store credit',
} as const;
export type RefundKind = keyof typeof REFUND_KINDS;

export const DECLINE_REASONS = [
  'Outside the return window',
  'Final-sale item',
  'Worn or washed',
  'Tags removed',
  'Hygiene seal broken',
  'Photos don’t match the reason',
  'Not bought from us',
] as const;

export type ReturnReview = {
  decision: 'approved' | 'rejected';
  checks: Partial<Record<CheckKey, CheckAnswer>>;
  condition?: Condition;
  fault?: Fault;
  /** Who pays the trip back. */
  shippingPaidBy?: 'customer' | 'us';
  refundKind?: RefundKind;
  /** Minor units, in the return's currency. What the desk says should go back. */
  refundAmount?: number;
  /** Declines: the reason, from the list or the desk's own. */
  reason?: string;
  /** What the customer was told, for a decline. */
  toldCustomer?: string;
  /** For the refund team, in the desk's own words. */
  note: string;
  by?: string;
  byName?: string;
  at?: string;
};

/** What the review form is told about the return in front of it. */
export type ReviewContext = {
  amount: number;
  currency: string;
  resolution: string;
  refundMethod: string;
  /** Days left in the return window when it was asked for; negative once it had closed. */
  daysLeft: number | null;
  photos: number;
};

/** The problem with a review, or null when it is complete enough to save. */
export function reviewProblem(r: ReturnReview | null | undefined, ret: { amount: number }): string | null {
  if (!r) return 'Fill in the review for the refund team first.';
  if (r.note.trim().length < 8) return 'Add a note for the refund team (a sentence is enough).';
  if (r.decision === 'rejected') {
    if (!r.reason?.trim()) return 'Say why it is declined.';
    return null;
  }
  for (const c of REVIEW_CHECKS) if (!r.checks[c.key]) return `Answer “${c.label}”.`;
  if (r.checks.photos === 'no') return 'Check the photos before approving, or decline it.';
  if (!r.condition) return 'Say what the photos show.';
  if (!r.fault) return 'Say whose fault it was.';
  if (!r.shippingPaidBy) return 'Say who pays for the trip back.';
  if (!r.refundKind) return 'Say how the customer is paid back.';
  if (r.refundKind === 'partial') {
    if (!r.refundAmount || r.refundAmount <= 0) return 'Enter the part to refund.';
    if (r.refundAmount > ret.amount) return 'The part to refund is more than the return is worth.';
  }
  return null;
}

/** The review as saved: only the fields that belong to its decision, amounts settled. */
export function cleanReview(r: ReturnReview, ret: { amount: number }, who: { id: string; name: string }, at: Date): ReturnReview {
  const base = { decision: r.decision, note: r.note.trim().slice(0, 1000), by: who.id, byName: who.name, at: at.toISOString(), checks: {} as ReturnReview['checks'] };
  if (r.decision === 'rejected') return { ...base, reason: r.reason?.trim().slice(0, 200), toldCustomer: r.toldCustomer?.trim().slice(0, 500) || undefined, checks: r.checks ?? {} };
  const amount = r.refundKind === 'full' ? ret.amount : r.refundKind === 'partial' ? Math.min(ret.amount, Math.max(0, Math.round(r.refundAmount ?? 0))) : 0;
  return { ...base, checks: r.checks, condition: r.condition, fault: r.fault, shippingPaidBy: r.shippingPaidBy, refundKind: r.refundKind, refundAmount: amount };
}

/** One line for the timeline. */
export function reviewSummary(r: ReturnReview): string {
  if (r.decision === 'rejected') return `Declined: ${r.reason}`;
  const kind = r.refundKind ? REFUND_KINDS[r.refundKind] : 'Approved';
  const fault = r.fault === 'ours' ? ', our fault' : r.fault === 'courier' ? ', courier’s fault' : '';
  return `${kind}${fault}${r.condition ? ` · ${CONDITIONS[r.condition].toLowerCase()}` : ''}`;
}
