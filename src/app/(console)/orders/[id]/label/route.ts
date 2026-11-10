import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { can, seesChannel } from '@/lib/domain/perms';
import { BOSTA_COURIER, BostaError, consignmentLabel, deliveryLabel, GMTC_COURIER, GmtcError, UPS_INTL_COURIER } from '@/lib/connectors';
import { upsIntlLabel } from '@/lib/ups-intl-shipments';

export const dynamic = 'force-dynamic';

/** The courier's label of a booked order, as the courier prints it (PDF), for the packing desk: UPS (GMTC) in Kuwait, Bosta in Egypt. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await ctx.params;
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  if (!o || !seesChannel(me, o.channelId) || !(can(me, 'shipping', 1) || can(me, 'fulfilment', 1))) return new Response('Not found', { status: 404 });
  // UPS international: the label UPS returned at booking, kept on the timeline (an image, 4x6 inches)
  if (o.courier === UPS_INTL_COURIER && o.tracking) {
    const l = await upsIntlLabel(o.id);
    if (!l) return new Response('UPS gave no label for this shipment.', { status: 404 });
    return new Response(new Uint8Array(l.bytes), { headers: { 'Content-Type': `image/${l.format}`, 'Content-Disposition': `inline; filename="UPS-${o.number.replace(/W/g, '')}-${o.tracking}.${l.format}"`, 'Cache-Control': 'private, no-store' } });
  }
  const courier = o.courier === GMTC_COURIER ? 'UPS' : o.courier === BOSTA_COURIER ? 'Bosta' : null;
  if (!courier || !o.tracking) return new Response('This order has no UPS or Bosta shipment yet.', { status: 404 });
  try {
    const pdf = courier === 'UPS' ? await consignmentLabel(o.tracking) : await deliveryLabel(o.tracking);
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${courier}-${o.number.replace(/\W/g, '')}-${o.tracking}.pdf"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return new Response(e instanceof GmtcError || e instanceof BostaError ? e.message : 'The label could not be fetched. Try again.', { status: 502 });
  }
}
