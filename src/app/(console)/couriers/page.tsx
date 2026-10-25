import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee } from '@/lib/domain/perms';
import { ordersToAssign } from '@/lib/courier-assign';
import { gmtcConfigured } from '@/lib/connectors';
import { PageHeader } from '@/components/ui/bits';
import { CourierBoard } from '@/components/couriers/board';
import { CourierCompare } from '@/components/finance/courier-compare';

export const metadata = { title: 'Courier assignment' };

/**
 * Which courier each open order should go with (Dan, 25 Oct 2026). Every order is priced on every
 * courier from D&H's rate sheet, by destination, area, weight, pieces, speed and cash on delivery, and
 * the cheapest allowed one is recommended. The team assigns it (or another) here, before the waybill.
 */
export default async function CouriersPage() {
  const me = await requireUser();
  if (!canSee(me, 'couriers')) sendHome(me);
  const rows = await ordersToAssign(me);
  const ups = gmtcConfigured('KW');
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Queues"
        title="Courier assignment"
        sub="Every open order priced on every courier (rate sheet 2026 + surcharges): the cheapest is recommended, price first. Assign it, or pick another."
      />
      <CourierBoard rows={JSON.parse(JSON.stringify(rows))} canAssign={can(me, 'shipping', 2)} ups={ups} />
      <CourierCompare ups={ups} />
    </div>
  );
}
