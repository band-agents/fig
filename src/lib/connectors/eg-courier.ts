// Egypt has two couriers wired in, Bosta and Aramex. The team books either by hand from Shipping; this says
// which one books an order by itself when it reaches the booking stage. One switch, so an order is never booked twice.
export type EgyptCourier = 'bosta' | 'aramex';

/** EG_AUTO_COURIER=aramex hands the automatic booking to Aramex; anything else keeps Bosta (Dan, 3 Nov). */
export const egyptAutoCourier = (): EgyptCourier => (process.env.EG_AUTO_COURIER?.trim().toLowerCase() === 'aramex' ? 'aramex' : 'bosta');
