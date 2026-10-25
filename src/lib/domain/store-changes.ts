// The store changes each stage brings (Dan's choices, 24 Oct). Pure: tested on its own, used by writeback.ts.
import type { WriteBackChange } from '../connectors/types';
import type { Order } from '../db/schema';

export type StageInput = { tracking?: string; courier?: string; trackingUrl?: string; reason?: string };

/** The store changes one stage brings, beyond its tag. */
export function changesForStage(o: Pick<Order, 'paymentMethod' | 'tracking' | 'courier' | 'trackingUrl'>, stage: string, input: StageInput, carrier: string): WriteBackChange[] {
  const out: WriteBackChange[] = [{ kind: 'stage_tag', stage }];
  const tracking = input.tracking ?? o.tracking;
  if (stage === 'shipped' && tracking) out.push({ kind: 'fulfil', tracking, company: input.courier ?? o.courier ?? carrier, url: input.trackingUrl ?? o.trackingUrl, notifyCustomer: true });
  if (stage === 'delivering') out.push({ kind: 'delivery', status: 'OUT_FOR_DELIVERY' });
  if (stage === 'delivered') out.push({ kind: 'delivery', status: 'DELIVERED' });
  if (stage === 'rto') out.push({ kind: 'delivery', status: 'FAILURE', message: input.reason });
  if (stage === 'settled' && o.paymentMethod === 'cod') out.push({ kind: 'mark_paid' });
  if (stage === 'cancelled') out.push({ kind: 'cancel', reason: input.reason ?? 'Cancelled in the console', notifyCustomer: true });
  return out;
}
