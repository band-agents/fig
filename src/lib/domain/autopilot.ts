// Autopilot clears the hand-offs nobody needs to touch, and says why on the timeline. Everything
// it skips is a rule an operations manager can switch off in Rules.
import type { OrderStage } from './stages';

export type AutopilotRules = {
  enabled: boolean;
  skipConfirmPrepaid: boolean;
  skipConfirmTrusted: boolean;
  trustedMinDelivered: number;
  financeAutoApprove: boolean;
  financeMaxRisk: number;
  financeMaxCod: Record<string, number>; // major units per currency
  autoSettlePrepaid: boolean;
};

export const DEFAULT_AUTOPILOT: AutopilotRules = {
  enabled: true,
  skipConfirmPrepaid: true,
  skipConfirmTrusted: true,
  trustedMinDelivered: 2,
  financeAutoApprove: true,
  financeMaxRisk: 30,
  financeMaxCod: { EGP: 6000, KWD: 60, JOD: 60 },
  autoSettlePrepaid: true,
};

export type AutopilotSubject = {
  stage: OrderStage | string;
  paymentMethod: string;
  paymentStatus: string;
  risk: number;
  riskLevel: string;
  total: number;
  currency: string;
  onHold?: boolean;
};

export type History = { orders: number; delivered: number; refused: number; returned: number } | null | undefined;


/**
 * The next automatic step from where the order stands, or null when a person has to decide.
 *
 * Confirmation calls and the finance check are retired (Dan, 21 Oct 2026): every order that is not on
 * hold goes from the store straight to Pick & pack, whatever the other rules say, and an order left in
 * one of the retired steps is sent on the same way. The confirmation and finance switches below are
 * kept in the stored rules only so an older setting still reads.
 */
export function nextAutoStep(o: AutopilotSubject, h: History, rules: AutopilotRules = DEFAULT_AUTOPILOT): { to: OrderStage; why: string } | null {
  void h;
  if (o.onHold) return null;
  switch (o.stage) {
    case 'new':
    case 'confirming':
    case 'finance':
      return { to: 'ready', why: 'Straight to Pick & pack' };
    case 'delivered':
      if (rules.enabled && rules.autoSettlePrepaid && o.paymentMethod !== 'cod' && o.paymentStatus === 'paid') return { to: 'settled', why: 'Paid online, nothing to collect' };
      return null;
    default:
      return null;
  }
}

/** Runs the rules until a person is needed; returns every step taken. */
export function autopilotRun(o: AutopilotSubject, h: History, rules: AutopilotRules = DEFAULT_AUTOPILOT) {
  const steps: { from: string; to: OrderStage; why: string }[] = [];
  let cur = { ...o };
  for (let i = 0; i < 4; i++) {
    const s = nextAutoStep(cur, h, rules);
    if (!s) break;
    steps.push({ from: cur.stage, ...s });
    cur = { ...cur, stage: s.to };
  }
  return steps;
}
