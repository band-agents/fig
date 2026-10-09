// Autopilot clears the hand-offs nobody needs to touch, and says why on the timeline. Everything
// it skips is a rule an operations manager can switch off in Rules.
import type { OrderStage } from './stages';
import { toMajor } from '../format';

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

const prepaidAndPaid = (o: AutopilotSubject) => o.paymentMethod !== 'cod' && o.paymentStatus === 'paid';

/** The next automatic step from where the order stands, or null when a person has to decide. */
export function nextAutoStep(o: AutopilotSubject, h: History, rules: AutopilotRules = DEFAULT_AUTOPILOT): { to: OrderStage; why: string } | null {
  if (!rules.enabled || o.onHold) return null;
  switch (o.stage) {
    case 'new': {
      if (prepaidAndPaid(o) && rules.skipConfirmPrepaid) return { to: 'finance', why: 'Paid online, no confirmation call needed' };
      const trusted = h && h.delivered >= rules.trustedMinDelivered && h.refused === 0;
      if (o.paymentMethod === 'cod' && trusted && o.riskLevel === 'low' && rules.skipConfirmTrusted) {
        return { to: 'finance', why: `Trusted customer: ${h!.delivered} delivered, never refused` };
      }
      return { to: 'confirming', why: o.riskLevel === 'high' ? 'High delivery risk: confirm before anything moves' : 'Cash on delivery: confirm with the customer' };
    }
    case 'finance': {
      if (!rules.financeAutoApprove) return null;
      if (prepaidAndPaid(o)) return { to: 'ready', why: 'Payment captured' };
      if (o.paymentMethod === 'cod') {
        const cap = rules.financeMaxCod[o.currency];
        const major = toMajor(o.total, o.currency);
        if (o.risk < rules.financeMaxRisk && (cap == null || major <= cap)) return { to: 'ready', why: `Cash on delivery within limits (risk ${o.risk})` };
      }
      return null;
    }
    case 'delivered':
      if (rules.autoSettlePrepaid && o.paymentMethod !== 'cod' && o.paymentStatus === 'paid') return { to: 'settled', why: 'Paid online, nothing to collect' };
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
    if (s.to === 'confirming') break; // confirmation is a person's job by definition
  }
  return steps;
}
