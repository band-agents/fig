import 'server-only';
// Courier assignment (Dan, 25 Oct): every open Kuwait-company order priced on every courier, the cheapest
// recommended, and the courier the team picks kept on the order before the waybill exists.
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL } from './channels';
import { record, type Actor } from './engine';
import { publish } from './bus';
import { forbidden, invalid, notFound } from './errors';
import { can, seesChannel, type Principal } from './domain/perms';
import { destinationOf, recommend, type Courier, type Destination, type Recommendation } from './domain/courier-rates';
import { areaFromAddress } from './connectors/kuwait-areas';
import { gmtcConfigured } from './connectors';

export const ASSIGNABLE: Courier[] = ['UPS', 'Aramex', 'Posta Plus', 'FedEx'];

/**
 * The courier the team chose for an order, or null. Orders arrive carrying their store's default
 * carrier ("Aramex KW" for Labesny) in the courier column; that is a placeholder, not a choice.
 */
export const chosenCourier = (o: { channelId: string; courier: string | null }) => (o.courier && o.courier !== CHANNEL[o.channelId]?.carrier ? o.courier : null);
const OPEN = ['new', 'confirming', 'finance', 'ready', 'picking', 'packed'];

export type AssignRow = {
  id: string;
  number: string;
  channelId: string;
  stage: string;
  placedAt: Date;
  customer: string;
  to: Destination;
  area: string | null;
  pieces: number;
  cod: number;
  deliveryPaid: number;
  assigned: string | null;
  rec: Recommendation;
};

/** Open orders, not yet with a waybill, of the person's Kuwait-company stores, each with its recommendation. */
export async function ordersToAssign(p: Principal, limit = 300): Promise<AssignRow[]> {
  const channels = (p.channels ?? []).filter((c) => CHANNEL[c]?.country === 'KW');
  if (!channels.length) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.channelId, channels), inArray(schema.orders.stage, OPEN), isNull(schema.orders.tracking)))
    .orderBy(desc(schema.orders.placedAt))
    .limit(limit);
  const apis: Courier[] = gmtcConfigured('KW') ? ['UPS'] : [];
  return rows.flatMap((o) => {
    const to = destinationOf(o.address?.country ?? 'KW');
    if (!to) return [];
    const area = to === 'KW' ? areaFromAddress(o.address) : null;
    const cod = o.paymentMethod === 'cod' && !['paid', 'cod_collected'].includes(o.paymentStatus) ? o.total : 0;
    return [{ id: o.id, number: o.number, channelId: o.channelId, stage: o.stage, placedAt: o.placedAt, customer: o.customerName, to, area, pieces: o.items, cod, deliveryPaid: o.shipping, assigned: chosenCourier(o), rec: recommend({ to, pieces: o.items, area, codAmount: cod }, { apis }) }];
  });
}

/** Keeps the chosen courier on the order (the waybill comes later, at handover or from the courier's API). */
export async function assignCourier(actor: Actor, orderId: string, courier: string) {
  if (!ASSIGNABLE.includes(courier as Courier)) throw invalid('Pick one of the couriers on the rate sheet.');
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound('Order not found.');
  if (actor.principal && (!seesChannel(actor.principal, o.channelId) || !can(actor.principal, 'shipping', 2))) throw forbidden('Assigning a courier needs Shipping access.');
  if (o.tracking) throw invalid(`This order already has a waybill (${o.courier ?? 'courier'} ${o.tracking}).`);
  if (!OPEN.includes(o.stage)) throw invalid('This order has left the warehouse or is closed.');
  // UPS inside Kuwait is GMTC's service: the same name the booking and tracking use
  const name = courier === 'UPS' && CHANNEL[o.channelId]?.country === 'KW' && destinationOf(o.address?.country ?? 'KW') === 'KW' ? 'UPS Kuwait' : courier;
  const at = new Date();
  await db.update(schema.orders).set({ courier: name, updatedAt: at }).where(eq(schema.orders.id, o.id));
  await record({ orderId: o.id, at, actorId: actor.id, actorName: actor.name, dept: actor.dept, kind: 'courier', message: `Courier assigned: ${name}` });
  publish({ kind: 'order', id: o.id, number: o.number, channelId: o.channelId, actor: actor.name, message: `${o.number} → ${name}` });
  return name;
}
