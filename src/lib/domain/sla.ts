import { ORDER_STAGE, RETURN_STAGE, type OrderStage, type ReturnStage } from './stages';

export type SlaTargets = { orders: Partial<Record<OrderStage, number>>; returns: Partial<Record<ReturnStage, number>> };

export const DEFAULT_SLA: SlaTargets = {
  orders: Object.fromEntries(Object.entries(ORDER_STAGE).filter(([, m]) => m.slaHours != null).map(([k, m]) => [k, m.slaHours])) as SlaTargets['orders'],
  returns: Object.fromEntries(Object.entries(RETURN_STAGE).filter(([, m]) => m.slaHours != null).map(([k, m]) => [k, m.slaHours])) as SlaTargets['returns'],
};

const H = 3600_000;

export function dueFor(kind: 'orders' | 'returns', stage: string, enteredAt: Date, targets: SlaTargets = DEFAULT_SLA): Date | null {
  const hours = (targets[kind] as Record<string, number | undefined>)[stage];
  if (hours == null) return null;
  return new Date(enteredAt.getTime() + hours * H);
}

export type SlaState = 'none' | 'ok' | 'soon' | 'late' | 'held';

export function slaState(due: Date | null | undefined, enteredAt: Date, now = new Date(), onHold = false): SlaState {
  if (onHold) return 'held';
  if (!due) return 'none';
  const left = due.getTime() - now.getTime();
  if (left < 0) return 'late';
  const span = due.getTime() - enteredAt.getTime();
  if (left < Math.max(span * 0.25, 0.5 * H)) return 'soon';
  return 'ok';
}

/** "2h 14m", "3d 4h", "12m" */
export function span(ms: number) {
  const abs = Math.abs(ms);
  const m = Math.floor(abs / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24 ? `${h % 24}h` : ''}`.trim();
}
