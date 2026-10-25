// Purchase orders and transfers: the states they pass through, who may move them, and when a
// purchase order needs a second signature. Same shape as the order stages. Pure.

import type { Area, Level } from '../perms';

export type PoStatus = 'draft' | 'approval' | 'approved' | 'sent' | 'confirmed' | 'partial' | 'received' | 'closed' | 'cancelled';

export const PO_STATUS: Record<PoStatus, { label: string; tint: string; open: boolean }> = {
  draft: { label: 'Draft', tint: 'neutral', open: true },
  approval: { label: 'Awaiting approval', tint: 'amber', open: true },
  approved: { label: 'Approved', tint: 'violet', open: true },
  sent: { label: 'With supplier', tint: 'blue', open: true },
  confirmed: { label: 'Confirmed', tint: 'cyan', open: true },
  partial: { label: 'Part received', tint: 'cyan', open: true },
  received: { label: 'Received', tint: 'green', open: false },
  closed: { label: 'Closed', tint: 'neutral', open: false },
  cancelled: { label: 'Cancelled', tint: 'red', open: false },
};

export const PO_TRACK: PoStatus[] = ['draft', 'approval', 'approved', 'sent', 'confirmed', 'received'];

type Step = { to: PoStatus; area: Area; min: Level; label: string };

/** Receiving (confirmed → partial → received) is the warehouse's, through the receive screen. */
export const PO_FLOW: Partial<Record<PoStatus, Step[]>> = {
  draft: [
    { to: 'approval', area: 'procurement', min: 2, label: 'Send for approval' },
    { to: 'approved', area: 'procurement', min: 3, label: 'Approve' },
    { to: 'cancelled', area: 'procurement', min: 2, label: 'Cancel' },
  ],
  approval: [
    { to: 'approved', area: 'procurement', min: 3, label: 'Approve' },
    { to: 'draft', area: 'procurement', min: 3, label: 'Send back' },
    { to: 'cancelled', area: 'procurement', min: 3, label: 'Reject' },
  ],
  approved: [
    { to: 'sent', area: 'procurement', min: 2, label: 'Mark sent to supplier' },
    { to: 'cancelled', area: 'procurement', min: 3, label: 'Cancel' },
  ],
  sent: [
    { to: 'confirmed', area: 'procurement', min: 2, label: 'Supplier confirmed' },
    { to: 'cancelled', area: 'procurement', min: 3, label: 'Cancel' },
  ],
  confirmed: [{ to: 'cancelled', area: 'procurement', min: 3, label: 'Cancel' }],
  received: [{ to: 'closed', area: 'procurement', min: 2, label: 'Close' }],
};

export function poStep(from: PoStatus, to: PoStatus): Step | null {
  return PO_FLOW[from]?.find((s) => s.to === to) ?? null;
}

/**
 * A buyer may approve their own order below the limit; above it, it waits for someone with
 * approval rights. The limit is in EGP-equivalent minor units, set on the Rules page.
 */
export function needsSecondSignature(totalEgpMinor: number, limitEgpMinor: number, approverLevel: number): boolean {
  return approverLevel < 3 && totalEgpMinor > limitEgpMinor;
}

export type TransferStatus = 'proposed' | 'picking' | 'in_transit' | 'received' | 'cancelled';

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; tint: string; open: boolean }> = {
  proposed: { label: 'To pick', tint: 'neutral', open: true },
  picking: { label: 'Picking', tint: 'violet', open: true },
  in_transit: { label: 'On the way', tint: 'blue', open: true },
  received: { label: 'Received', tint: 'green', open: false },
  cancelled: { label: 'Cancelled', tint: 'red', open: false },
};

export const TRANSFER_FLOW: Record<TransferStatus, TransferStatus[]> = {
  proposed: ['picking', 'cancelled'],
  picking: ['in_transit', 'cancelled'],
  in_transit: ['received'],
  received: [],
  cancelled: [],
};

export const PO_DEFAULTS = {
  /** Above this (EGP-equivalent), a purchase order needs an approver's signature. */
  approvalLimit: 250_000_00,
  /** How often the plan is reviewed, in weeks: the cover a reorder buys beyond the lead time. */
  reviewWeeks: 2,
  /** Chase a supplier who has not confirmed after this many days. */
  chaseAfterDays: 3,
};
