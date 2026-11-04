import { Truck } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee } from '@/lib/domain/perms';
import { ordersToAssign, kuwaitStores } from '@/lib/courier-assign';
import { bostaConfigured, gmtcConfigured } from '@/lib/connectors';
import { Empty, PageHeader } from '@/components/ui/bits';
import { CourierBoard } from '@/components/couriers/board';
import { CourierCompare } from '@/components/finance/courier-compare';

export const metadata = { title: 'Courier assignment' };

/**
 * Which courier each open order should go with (Dan, 25 Oct 2026). Every order is priced on every
 * courier from D&H's rate sheet, by destination, area, weight, pieces, speed and cash on delivery, and
 * the cheapest allowed one is recommended. The team assigns it (or another) here, before the waybill.
 * The rate sheet is Labesny's (Kuwait, KWD). FIG ships every order with Bosta (Dan, 4 Nov: no KWD on FIG),
 * so with only FIG in view the page says so instead of showing Kuwait's prices.
 */
export default async function CouriersPage() {
  const me = await requireUser();
  if (!canSee(me, 'couriers')) sendHome(me);
  if (!kuwaitStores(me).length)
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Queues" title="Courier assignment" sub="FIG ships every order with Bosta, so there is no courier to choose." />
        <div className="panel">
          <Empty
            icon={Truck}
            title="FIG goes with Bosta"
            body={
              bostaConfigured('EG')
                ? 'Each FIG order is booked with Bosta when it reaches Ready, with its waybill and tracking. Orders that missed it have a Book Bosta button in Shipping.'
                : 'Each FIG order is booked with Bosta from the Shipping queue.'
            }
            action={{ href: '/queue/shipping', label: 'Open Shipping' }}
          />
        </div>
      </div>
    );
  const rows = await ordersToAssign(me);
  const ups = gmtcConfigured('KW');
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Queues"
        title="Courier assignment"
        sub="Labesny's open orders (Kuwait, KWD) priced on every courier (rate sheet 2026 + surcharges): the cheapest is recommended, price first. Assign it, or pick another. FIG ships with Bosta."
      />
      <CourierBoard rows={JSON.parse(JSON.stringify(rows))} canAssign={can(me, 'shipping', 2)} ups={ups} />
      <CourierCompare ups={ups} />
    </div>
  );
}
