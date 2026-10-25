/**
 * What delivering an order costs us, from the courier's rate card.
 *
 * Dan, 21 Oct 2026: Finance needs to see the shipping we pay, beside the shipping customers pay us.
 * The real rate cards are still being collected (Walaa has Egypt's), so the cards below are
 * PLACEHOLDERS, marked as such everywhere they show, and editable on the Finance & analysis page.
 * Nothing here is invented as fact: change a card and every figure follows.
 *
 * A parcel costs the zone's price for the first kilo, plus each kilo after it, plus the courier's
 * cash-collection fee on cash orders, plus a fuel surcharge on the lot. A refused parcel coming back
 * costs the return fee on top; a return the desk agreed we pay for costs one collection trip.
 * Pure: amounts are minor units of the card's currency.
 */

export type Zone = {
  key: string;
  label: string;
  /** Cities and governorates in this zone, matched loosely ("Cairo", "New Cairo", "القاهرة"). */
  places: string[];
  /** First kilo, minor units. */
  base: number;
};

export type RateCard = {
  courier: string;
  market: 'EG' | 'KW';
  currency: string;
  zones: Zone[];
  /** The zone for a city nobody listed. */
  fallbackZone: string;
  /** Each kilo after the first, minor units. */
  perKg: number;
  /** Cash on delivery: a share of what is collected, never less than the minimum. */
  codPct: number;
  codMin: number;
  /** A refused parcel coming back, as a share of its outbound price. */
  rtoPct: number;
  /** Collecting a return from a customer, minor units. */
  pickup: number;
  fuelPct: number;
  placeholder: boolean;
};

export type ShippingRates = {
  cards: RateCard[];
  /** Weight of one piece when the order does not say, in kilos. */
  kgPerPiece: number;
  /** The packaging's own weight per parcel, in kilos. */
  kgPerParcel: number;
  updatedBy?: string;
  updatedAt?: string;
};

/** Placeholder cards, to be replaced by the couriers' own (Egypt: Walaa is collecting them). */
export const DEFAULT_RATES: ShippingRates = {
  kgPerPiece: 0.35,
  kgPerParcel: 0.15,
  cards: [
    {
      courier: 'Aramex',
      market: 'EG',
      currency: 'EGP',
      placeholder: true,
      zones: [
        { key: 'greater-cairo', label: 'Cairo & Giza', places: ['cairo', 'giza', 'new cairo', '6th of october', 'october', 'sheikh zayed', 'nasr city', 'heliopolis', 'maadi', 'القاهرة', 'الجيزة'], base: 6500 },
        { key: 'alex-delta', label: 'Alexandria & Delta', places: ['alexandria', 'alex', 'tanta', 'mansoura', 'zagazig', 'damanhour', 'banha', 'kafr', 'menoufia', 'gharbia', 'dakahlia', 'sharqia', 'beheira', 'qalyubia', 'damietta', 'الإسكندرية'], base: 7500 },
        { key: 'canal-upper', label: 'Canal & Upper Egypt', places: ['ismailia', 'suez', 'port said', 'fayoum', 'beni suef', 'minya', 'assiut', 'sohag', 'qena', 'luxor', 'aswan'], base: 9000 },
        { key: 'remote', label: 'Red Sea, Sinai & remote', places: ['hurghada', 'red sea', 'sharm', 'sinai', 'dahab', 'marsa matrouh', 'matrouh', 'new valley', 'el gouna', 'gouna', 'el alamein', 'alamein', 'north coast', 'sahel'], base: 11000 },
      ],
      fallbackZone: 'alex-delta',
      perKg: 1000,
      codPct: 0.01,
      codMin: 500,
      rtoPct: 1,
      pickup: 6500,
      fuelPct: 0,
    },
    {
      courier: 'Courier',
      market: 'KW',
      currency: 'KWD',
      placeholder: true,
      zones: [{ key: 'kuwait', label: 'All Kuwait', places: [], base: 1500 }],
      fallbackZone: 'kuwait',
      perKg: 250,
      codPct: 0,
      codMin: 250,
      rtoPct: 1,
      pickup: 1500,
      fuelPct: 0,
    },
  ],
};

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

/** The rate card for a courier in a market: its own, else the market's first. */
export function cardFor(rates: ShippingRates, market: string, courier?: string | null): RateCard | null {
  const inMarket = rates.cards.filter((c) => c.market === market);
  if (!inMarket.length) return null;
  const c = courier ? fold(courier) : '';
  return (c && inMarket.find((x) => fold(x.courier) === c || c.includes(fold(x.courier)) || fold(x.courier).includes(c))) || inMarket[0];
}

/** The zone a city falls in on this card. */
export function zoneFor(card: RateCard, city?: string | null, region?: string | null): Zone {
  const where = fold(`${city ?? ''} ${region ?? ''}`);
  if (where) {
    for (const z of card.zones) if (z.places.some((p) => where.includes(fold(p)))) return z;
  }
  return card.zones.find((z) => z.key === card.fallbackZone) ?? card.zones[0];
}

export type Parcel = {
  market: string;
  courier?: string | null;
  city?: string | null;
  region?: string | null;
  pieces: number;
  /** Kilos, when known. Otherwise estimated from the pieces. */
  kg?: number | null;
  /** Minor units collected in cash on delivery; 0 for a prepaid order. */
  cod: number;
  /** The parcel was refused and came back. */
  refused?: boolean;
};

export type ParcelCost = { courier: string; zone: string; kg: number; base: number; extraKg: number; cod: number; rto: number; fuel: number; total: number; currency: string; placeholder: boolean };

export function parcelCost(rates: ShippingRates, p: Parcel): ParcelCost | null {
  const card = cardFor(rates, p.market, p.courier);
  if (!card) return null;
  const zone = zoneFor(card, p.city, p.region);
  const kg = Math.max(0.1, p.kg ?? p.pieces * rates.kgPerPiece + rates.kgPerParcel);
  const extra = Math.max(0, Math.ceil(kg - 1)) * card.perKg;
  const cod = p.cod > 0 ? Math.max(card.codMin, Math.round(p.cod * card.codPct)) : 0;
  const outbound = zone.base + extra;
  // a refused parcel pays the trip back; no cash was collected, so no cash fee
  const rto = p.refused ? Math.round(outbound * card.rtoPct) : 0;
  const before = outbound + (p.refused ? 0 : cod) + rto;
  const fuel = Math.round(before * card.fuelPct);
  return { courier: card.courier, zone: zone.label, kg: Math.round(kg * 100) / 100, base: zone.base, extraKg: extra, cod: p.refused ? 0 : cod, rto, fuel, total: before + fuel, currency: card.currency, placeholder: card.placeholder };
}

/** Collecting one return from a customer. */
export function pickupCost(rates: ShippingRates, market: string, courier?: string | null): { total: number; currency: string; placeholder: boolean } | null {
  const card = cardFor(rates, market, courier);
  if (!card) return null;
  return { total: Math.round(card.pickup * (1 + card.fuelPct)), currency: card.currency, placeholder: card.placeholder };
}

/** A stored set of cards, made safe to compute with: anything missing or broken falls back to the defaults. */
export function normaliseRates(v: unknown): ShippingRates {
  const r = (v ?? {}) as Partial<ShippingRates>;
  const cards = Array.isArray(r.cards) && r.cards.length ? r.cards.filter((c) => c && Array.isArray(c.zones) && c.zones.length && (c.market === 'EG' || c.market === 'KW')) : DEFAULT_RATES.cards;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
  return {
    kgPerPiece: num(r.kgPerPiece, DEFAULT_RATES.kgPerPiece),
    kgPerParcel: num(r.kgPerParcel, DEFAULT_RATES.kgPerParcel),
    cards: (cards.length ? cards : DEFAULT_RATES.cards).map((c) => ({
      ...c,
      zones: c.zones.map((z) => ({ ...z, base: num(z.base, 0), places: Array.isArray(z.places) ? z.places.map(String) : [] })),
      perKg: num(c.perKg, 0),
      codPct: num(c.codPct, 0),
      codMin: num(c.codMin, 0),
      rtoPct: num(c.rtoPct, 1),
      pickup: num(c.pickup, 0),
      fuelPct: num(c.fuelPct, 0),
      placeholder: c.placeholder !== false,
    })),
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  };
}
