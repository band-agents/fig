// The relay: every order and every return moves through these stages, and each stage belongs to one
// department. A transition is allowed only to someone holding the right level in the right area.
import type { Area, Level } from './perms';

export const ORDER_STAGES = [
  'new',
  'confirming',
  'finance',
  'ready',
  'picking',
  'packed',
  'shipped',
  'delivering',
  'delivered',
  'settled',
  'cancelled',
  'rto',
  'rto_closed',
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export type Dept = 'care' | 'finance' | 'fulfilment' | 'shipping' | 'returns' | 'none';

export const DEPTS: Record<Exclude<Dept, 'none'>, { label: string; area: Area; tint: string }> = {
  care: { label: 'Customer care', area: 'intake', tint: 'violet' },
  finance: { label: 'Finance', area: 'finance', tint: 'amber' },
  fulfilment: { label: 'Fulfilment', area: 'fulfilment', tint: 'blue' },
  shipping: { label: 'Shipping', area: 'shipping', tint: 'cyan' },
  returns: { label: 'Returns desk', area: 'returns', tint: 'rose' },
};

type StageMeta = {
  label: string;
  verb: string; // what is happening, for timelines: "Picking"
  dept: Dept;
  group: 'intake' | 'finance' | 'fulfilment' | 'shipping' | 'done' | 'exception';
  tint: string;
  slaHours: number | null; // default target for leaving this stage (overridable in Rules)
  open: boolean; // still needs someone's work
};

export const ORDER_STAGE: Record<OrderStage, StageMeta> = {
  new: { label: 'New', verb: 'Received', dept: 'care', group: 'intake', tint: 'violet', slaHours: 0.5, open: true },
  confirming: { label: 'Confirming', verb: 'Confirming with customer', dept: 'care', group: 'intake', tint: 'violet', slaHours: 2, open: true },
  finance: { label: 'Finance check', verb: 'Finance check', dept: 'finance', group: 'finance', tint: 'amber', slaHours: 4, open: true },
  ready: { label: 'Ready to pick', verb: 'Queued for the warehouse', dept: 'fulfilment', group: 'fulfilment', tint: 'blue', slaHours: 12, open: true },
  picking: { label: 'Picking', verb: 'Picking', dept: 'fulfilment', group: 'fulfilment', tint: 'blue', slaHours: 3, open: true },
  packed: { label: 'Packed', verb: 'Packed, waiting for courier', dept: 'shipping', group: 'shipping', tint: 'cyan', slaHours: 8, open: true },
  shipped: { label: 'Shipped', verb: 'With the courier', dept: 'shipping', group: 'shipping', tint: 'cyan', slaHours: 48, open: true },
  delivering: { label: 'Out for delivery', verb: 'Out for delivery', dept: 'shipping', group: 'shipping', tint: 'cyan', slaHours: 12, open: true },
  delivered: { label: 'Delivered', verb: 'Delivered, cash to settle', dept: 'finance', group: 'done', tint: 'green', slaHours: 168, open: true },
  settled: { label: 'Settled', verb: 'Settled', dept: 'none', group: 'done', tint: 'green', slaHours: null, open: false },
  cancelled: { label: 'Cancelled', verb: 'Cancelled', dept: 'none', group: 'exception', tint: 'neutral', slaHours: null, open: false },
  rto: { label: 'Returning to origin', verb: 'Refused, coming back', dept: 'returns', group: 'exception', tint: 'red', slaHours: 96, open: true },
  rto_closed: { label: 'RTO closed', verb: 'Back in stock', dept: 'none', group: 'exception', tint: 'neutral', slaHours: null, open: false },
};

/** The happy path, in order: drives progress trackers and the pipeline board. */
export const ORDER_TRACK: OrderStage[] = ['new', 'confirming', 'finance', 'ready', 'picking', 'packed', 'shipped', 'delivering', 'delivered', 'settled'];

export type Need = 'reason' | 'tracking' | 'note';
export type Transition<S extends string> = {
  to: S;
  label: string;
  area: Area;
  level?: Level;
  tone?: 'primary' | 'danger' | 'quiet';
  needs?: Need[];
};

const cancel = (area: Area): Transition<OrderStage> => ({ to: 'cancelled', label: 'Cancel order', area, tone: 'danger', needs: ['reason'] });

export const ORDER_FLOW: Record<OrderStage, Transition<OrderStage>[]> = {
  new: [
    { to: 'confirming', label: 'Send to confirmation', area: 'intake', tone: 'primary' },
    { to: 'finance', label: 'Skip confirmation', area: 'intake', tone: 'quiet' },
    cancel('intake'),
  ],
  confirming: [
    { to: 'finance', label: 'Customer confirmed', area: 'intake', tone: 'primary' },
    cancel('intake'),
  ],
  finance: [
    { to: 'ready', label: 'Approve for fulfilment', area: 'finance', tone: 'primary' },
    { to: 'confirming', label: 'Send back to Customer care', area: 'finance', tone: 'quiet', needs: ['reason'] },
    cancel('finance'),
  ],
  ready: [
    { to: 'picking', label: 'Start picking', area: 'fulfilment', tone: 'primary' },
    cancel('fulfilment'),
  ],
  picking: [
    { to: 'packed', label: 'Mark packed', area: 'fulfilment', tone: 'primary' },
    { to: 'ready', label: 'Put back in queue', area: 'fulfilment', tone: 'quiet', needs: ['reason'] },
  ],
  packed: [
    { to: 'shipped', label: 'Hand to courier', area: 'shipping', tone: 'primary', needs: ['tracking'] },
    { to: 'picking', label: 'Reopen packing', area: 'fulfilment', tone: 'quiet', needs: ['reason'] },
  ],
  shipped: [
    { to: 'delivering', label: 'Out for delivery', area: 'shipping', tone: 'primary' },
    { to: 'delivered', label: 'Mark delivered', area: 'shipping', tone: 'quiet' },
    { to: 'rto', label: 'Returning to origin', area: 'shipping', tone: 'danger', needs: ['reason'] },
  ],
  delivering: [
    { to: 'delivered', label: 'Mark delivered', area: 'shipping', tone: 'primary' },
    { to: 'rto', label: 'Refused / undeliverable', area: 'shipping', tone: 'danger', needs: ['reason'] },
  ],
  delivered: [{ to: 'settled', label: 'Mark settled', area: 'finance', tone: 'primary' }],
  settled: [],
  cancelled: [],
  rto: [{ to: 'rto_closed', label: 'Received back & restocked', area: 'returns', tone: 'primary' }],
  rto_closed: [],
};

// ── Returns ────────────────────────────────────────────────────────────────────────────────────
export const RETURN_STAGES = ['requested', 'approved', 'pickup', 'in_transit', 'received', 'inspected', 'refund_pending', 'refunded', 'closed', 'rejected'] as const;
export type ReturnStage = (typeof RETURN_STAGES)[number];

export const RETURN_STAGE: Record<ReturnStage, StageMeta> = {
  requested: { label: 'Requested', verb: 'Return requested', dept: 'care', group: 'intake', tint: 'violet', slaHours: 24, open: true },
  approved: { label: 'Approved', verb: 'Approved, awaiting pickup', dept: 'shipping', group: 'shipping', tint: 'cyan', slaHours: 24, open: true },
  pickup: { label: 'Pickup booked', verb: 'Courier pickup booked', dept: 'shipping', group: 'shipping', tint: 'cyan', slaHours: 48, open: true },
  in_transit: { label: 'In transit', verb: 'On its way back', dept: 'shipping', group: 'shipping', tint: 'cyan', slaHours: 72, open: true },
  received: { label: 'Received', verb: 'At the returns desk', dept: 'returns', group: 'fulfilment', tint: 'rose', slaHours: 24, open: true },
  inspected: { label: 'Inspected', verb: 'Inspected', dept: 'returns', group: 'fulfilment', tint: 'rose', slaHours: 12, open: true },
  refund_pending: { label: 'Refund pending', verb: 'Waiting for refund', dept: 'finance', group: 'finance', tint: 'amber', slaHours: 72, open: true },
  refunded: { label: 'Refunded', verb: 'Refunded', dept: 'none', group: 'done', tint: 'green', slaHours: null, open: false },
  closed: { label: 'Closed', verb: 'Closed', dept: 'none', group: 'done', tint: 'green', slaHours: null, open: false },
  rejected: { label: 'Rejected', verb: 'Rejected', dept: 'none', group: 'exception', tint: 'neutral', slaHours: null, open: false },
};

export const RETURN_TRACK: ReturnStage[] = ['requested', 'approved', 'pickup', 'in_transit', 'received', 'inspected', 'refund_pending', 'refunded'];

export const RETURN_FLOW: Record<ReturnStage, Transition<ReturnStage>[]> = {
  requested: [
    { to: 'approved', label: 'Approve return', area: 'returns', tone: 'primary' },
    { to: 'rejected', label: 'Reject', area: 'returns', tone: 'danger', needs: ['reason'] },
  ],
  approved: [
    { to: 'pickup', label: 'Book courier pickup', area: 'shipping', tone: 'primary', needs: ['tracking'] },
    { to: 'received', label: 'Dropped at a store', area: 'returns', tone: 'quiet' },
  ],
  pickup: [{ to: 'in_transit', label: 'Collected from customer', area: 'shipping', tone: 'primary' }],
  in_transit: [{ to: 'received', label: 'Received at warehouse', area: 'returns', tone: 'primary' }],
  received: [{ to: 'inspected', label: 'Record inspection', area: 'returns', tone: 'primary' }],
  inspected: [
    { to: 'refund_pending', label: 'Send for refund', area: 'returns', tone: 'primary' },
    { to: 'closed', label: 'Close (exchange / credit)', area: 'returns', tone: 'quiet', needs: ['note'] },
  ],
  refund_pending: [{ to: 'refunded', label: 'Refund issued', area: 'finance', level: 3, tone: 'primary' }],
  refunded: [],
  closed: [],
  rejected: [],
};

export const RETURN_REASONS = {
  too_small: 'Too small',
  too_large: 'Too large',
  not_as_pictured: 'Not as pictured',
  quality: 'Quality issue',
  damaged: 'Arrived damaged',
  wrong_item: 'Wrong item sent',
  changed_mind: 'Changed mind',
  late: 'Arrived too late',
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;

export const RTO_REASONS = ['Customer refused at door', 'Customer unreachable', 'Wrong address', 'Customer asked to cancel', 'Payment not ready (COD)'] as const;
export const CANCEL_REASONS = ['Customer cancelled', 'Duplicate order', 'Out of stock', 'Failed confirmation', 'Suspected fraud', 'Address not serviceable'] as const;
export const HOLD_REASONS = ['Waiting for stock', 'Customer asked to delay', 'Address check', 'Payment check', 'Gift wrap / special request'] as const;

export function transitionsFor<S extends string>(flow: Record<S, Transition<S>[]>, stage: S) {
  return flow[stage] ?? [];
}

export function isAllowed<S extends string>(flow: Record<S, Transition<S>[]>, from: S, to: S) {
  return (flow[from] ?? []).find((t) => t.to === to) ?? null;
}
