/**
 * Labesny's couriers: what each one charges us, and which to pick for a parcel. Price first (Moody,
 * 25 Oct 2026), then speed. Pure: amounts are KWD fils (1 KWD = 1000).
 *
 * Sources, all D&H's own:
 * - "Courier Charges Comparison 2026.xlsx" (Jessy, logistics, forwarded by Moody 21 Oct): domestic Kuwait
 *   (up to 5 kg, same/next day, within/outside city limits) and international (8 countries, 0.5–5 kg).
 * - UPS proposal (Ahmad Serhan, GMTC, 21 Oct): freight only; plus fuel surcharge (variable, % not given)
 *   and a temporary surge fee of 0.300 KD per kg on export.
 * - Aramex (same sheet): war risk USD 2 up to 4 kg, USD 0.5 more per kg above.
 * - Posta Plus (same sheet, domestic): 0.250 per extra kg, 0.250 per cash-on-delivery parcel.
 * - Moody, WhatsApp 25 Oct: inside Kuwait only UPS and Aramex (Posta is not competitive); outside Kuwait all
 *   four, whichever is cheapest for the country. Customer price abroad by pieces (CUSTOMER_PRICE below).
 */

export type Courier = 'UPS' | 'Aramex' | 'Posta Plus' | 'FedEx';
export type Speed = 'same_day' | 'next_day';
export type Destination = 'KW' | 'JO' | 'LB' | 'AE' | 'BH' | 'QA' | 'OM' | 'SA' | 'EG';

export const COUNTRY_NAME: Record<Destination, string> = { KW: 'Kuwait', JO: 'Jordan', LB: 'Lebanon', AE: 'UAE', BH: 'Bahrain', QA: 'Qatar', OM: 'Oman', SA: 'Saudi Arabia', EG: 'Egypt' };
/**
 * Where Labesny ships abroad (Dan, 25 Oct 2026): the Gulf, Jordan and Lebanon. Not Egypt, although the
 * rate sheet prices it (kept in INTL for reference). No free shipping abroad; 5–10 business days; the
 * customer pays any customs, and the return shipping unless the piece is damaged, defective or wrong.
 */
export const INTERNATIONAL: Exclude<Destination, 'KW'>[] = ['AE', 'SA', 'QA', 'BH', 'OM', 'JO', 'LB'];
export const ABROAD_DELIVERY = '5–10 business days';

const CODES: Record<string, Destination> = { kw: 'KW', kuwait: 'KW', jo: 'JO', jordan: 'JO', lb: 'LB', lebanon: 'LB', ae: 'AE', uae: 'AE', 'united arab emirates': 'AE', bh: 'BH', bahrain: 'BH', qa: 'QA', qatar: 'QA', om: 'OM', oman: 'OM', sa: 'SA', ksa: 'SA', 'saudi arabia': 'SA', eg: 'EG', egypt: 'EG' };

/** An address's country as one of the destinations on the rate sheet, or null. */
export const destinationOf = (country: string | null | undefined): Destination | null => CODES[(country ?? '').trim().toLowerCase()] ?? null;

// ── Domestic (Kuwait), flat up to 5 kg ─────────────────────────────────────────────────────────
type DomesticRow = { withinSame: number | null; withinNext: number; offSame: number | null; offNext: number };
/** Aramex has two tiers by monthly parcels: 2–50 and 50–100. */
export const DOMESTIC: Record<'UPS' | 'Aramex' | 'Aramex 50+' | 'Posta Plus', DomesticRow> = {
  UPS: { withinSame: 1400, withinNext: 1000, offSame: null, offNext: 1400 },
  Aramex: { withinSame: 1500, withinNext: 1250, offSame: 1250, offNext: 1250 },
  'Aramex 50+': { withinSame: 1400, withinNext: 1000, offSame: 1000, offNext: 1000 },
  'Posta Plus': { withinSame: 1750, withinNext: 1250, offSame: 2750, offNext: 1750 },
};
export const DOMESTIC_MAX_KG = 5;
/** Moody 25 Oct: inside Kuwait only these two; Posta stays in the table for comparison only. */
export const DOMESTIC_IN_USE: Courier[] = ['UPS', 'Aramex'];

/**
 * Areas outside the couriers' "city limits". ASSUMPTION to confirm with Jessy/GMTC/Aramex: the usual
 * outer areas (south and north of the metro). Everything else counts as within city limits.
 */
export const OFF_CITY = ['Wafra', 'Khairan', 'Nuwaiseeb', 'Zour', 'Kabd', 'Abdali', 'Mutlaa', 'Subiya', 'Salmi', 'Sabah Al Ahmad', 'Julaia', 'Bnaider', 'Mina Abdullah', 'Shuaiba'];
const OFF = new Set(OFF_CITY.map((a) => a.toLowerCase()));
export const isOffCity = (area: string | null | undefined) => Boolean(area && OFF.has(area.trim().toLowerCase()));

// ── International: freight by weight bracket (kg) and country ──────────────────────────────────
export const BRACKETS = [0.5, 1, 2, 3, 4, 5] as const;
type Table = Record<Exclude<Destination, 'KW'>, number[]>; // one price per bracket, fils
const t = (rows: Record<string, number[]>) => rows as Table;
export const INTL: Record<Courier, Table> = {
  UPS: t({ JO: [5770, 6470, 8320, 9860, 11470, 13010], LB: [5770, 6470, 8320, 9860, 11470, 13010], AE: [3430, 3710, 4790, 5730, 6630, 7290], BH: [5470, 5930, 7650, 9150, 10580, 11630], QA: [5620, 6800, 7850, 9390, 10860, 11940], OM: [3360, 3630, 4690, 5610, 6490, 7130], SA: [4010, 4340, 5610, 6710, 7750, 8520], EG: [5470, 6340, 8210, 9860, 11660, 13610] }),
  'Posta Plus': t({ JO: [5390, 6930, 10100, 13090, 16170, 19250], LB: [3430, 4730, 7350, 10370, 13450, 16490], AE: [2420, 3360, 5220, 7060, 8930, 10830], BH: [2500, 3900, 6690, 9460, 12250, 14430], QA: [3790, 4810, 6860, 8920, 10890, 12820], OM: [3780, 4390, 5610, 6380, 8040, 9260], SA: [3400, 4532, 6921, 9310, 11699, 14088], EG: [5390, 6930, 10100, 13090, 16170, 19250] }),
  FedEx: t({ JO: [4760, 7370, 12820, 18760, 24400, 29530], LB: [4760, 7370, 12820, 18760, 24400, 29530], AE: [4460, 6940, 11480, 17260, 21680, 26110], BH: [4640, 6940, 11480, 17260, 21680, 26110], QA: [4640, 6940, 11480, 17260, 21680, 26110], OM: [4640, 6940, 11480, 17260, 21680, 26110], SA: [7000, 23710, 40540, 60820, 76840, 38860], EG: [4760, 7370, 12820, 19280, 24400, 29530] }),
  Aramex: t({ JO: [4900, 5650, 9250, 10950, 16500, 20100], LB: [3400, 4300, 7600, 12850, 14250, 17550], AE: [3400, 4300, 7600, 12850, 14250, 17550], BH: [3400, 4300, 7600, 12850, 14250, 17550], QA: [3400, 4300, 7600, 12850, 14250, 17550], OM: [3400, 4300, 7600, 12850, 14250, 17550], SA: [4900, 5650, 9250, 10950, 16500, 20100], EG: [6000, 7050, 11850, 16600, 21400, 26100] }),
};

/** Surcharges on top of freight. Editable later; the UPS fuel % is unknown until GMTC states it. */
export type Surcharges = { upsSurgePerKg: number; upsFuelPct: number; aramexWarRiskUsdUpTo4Kg: number; aramexWarRiskUsdPerKgAbove: number; usdToKwd: number; postaCod: number; postaPerExtraKg: number };
export const SURCHARGES: Surcharges = { upsSurgePerKg: 300, upsFuelPct: 0, aramexWarRiskUsdUpTo4Kg: 2, aramexWarRiskUsdPerKgAbove: 0.5, usdToKwd: 0.307, postaCod: 250, postaPerExtraKg: 250 };

// ── Weight ─────────────────────────────────────────────────────────────────────────────────────
/** Planning estimate (25 Oct): 1 piece ≈ 0.5 kg, 3 ≈ 1 kg, 6 ≈ 2, 9 ≈ 3, 12 ≈ 4, 15 ≈ 5 (0.3 kg a piece + 0.1 kg box). */
export const KG_PER_PIECE = 0.3;
export const KG_PER_PARCEL = 0.1;
export const estimateKg = (pieces: number) => Math.round((Math.max(1, pieces) * KG_PER_PIECE + KG_PER_PARCEL) * 100) / 100;

/** The bracket a weight is charged at; above 5 kg the 4→5 kg step repeats per extra kilo. */
export function bracketPrice(row: number[], kg: number): { kg: number; price: number } {
  for (let i = 0; i < BRACKETS.length; i++) if (kg <= BRACKETS[i] + 1e-9) return { kg: BRACKETS[i], price: row[i] };
  const step = Math.max(0, row[5] - row[4]);
  const extra = Math.ceil(kg - 5);
  return { kg: 5 + extra, price: row[5] + step * extra };
}

// ── Quotes ─────────────────────────────────────────────────────────────────────────────────────
export type Quote = {
  courier: Courier;
  label: string; // "Aramex (2–50 orders)", "UPS"
  freight: number;
  surcharges: { label: string; amount: number }[];
  total: number;
  chargedKg: number;
  speed?: Speed;
  inUse: boolean; // allowed for this route by D&H's decision
  hasApi: boolean; // the console can book it today
  note?: string;
};

export type ParcelInput = {
  to: Destination;
  pieces: number;
  kg?: number | null; // when known; else estimated from pieces
  area?: string | null; // Kuwait area (for city limits)
  speed?: Speed; // Kuwait only; default next day
  codAmount?: number; // fils collected in cash (Kuwait only)
  aramexMonthlyParcels?: number; // decides Aramex's tier
};

const usd = (dollars: number, s: Surcharges) => Math.round(dollars * s.usdToKwd * 1000);

function domesticQuotes(p: ParcelInput, kg: number, opts: { apis: Courier[] }): Quote[] {
  const speed = p.speed ?? 'next_day';
  const off = isOffCity(p.area);
  const over = kg > DOMESTIC_MAX_KG;
  const aramexKey = (p.aramexMonthlyParcels ?? 0) >= 50 ? 'Aramex 50+' : 'Aramex';
  const rows: [Courier, keyof typeof DOMESTIC, string][] = [
    ['UPS', 'UPS', 'UPS'],
    ['Aramex', aramexKey, aramexKey === 'Aramex' ? 'Aramex (2–50 orders/month)' : 'Aramex (50–100 orders/month)'],
    ['Posta Plus', 'Posta Plus', 'Posta Plus'],
  ];
  const out: Quote[] = [];
  for (const [courier, key, label] of rows) {
    const r = DOMESTIC[key];
    const price = off ? (speed === 'same_day' ? r.offSame : r.offNext) : speed === 'same_day' ? r.withinSame : r.withinNext;
    if (price == null) continue; // UPS has no same-day outside city limits
    const surcharges: Quote['surcharges'] = [];
    if (courier === 'Posta Plus') {
      if (kg > 1) surcharges.push({ label: `${Math.ceil(kg - 1)} extra kg`, amount: Math.ceil(kg - 1) * SURCHARGES.postaPerExtraKg });
      if ((p.codAmount ?? 0) > 0) surcharges.push({ label: 'Cash on delivery', amount: SURCHARGES.postaCod });
    }
    const total = price + surcharges.reduce((s, x) => s + x.amount, 0);
    out.push({ courier, label, freight: price, surcharges, total, chargedKg: Math.min(kg, DOMESTIC_MAX_KG), speed, inUse: DOMESTIC_IN_USE.includes(courier), hasApi: opts.apis.includes(courier), note: over ? 'Over 5 kg: the card covers up to 5 kg, ask the courier' : off ? 'Outside city limits' : undefined });
  }
  return out;
}

function internationalQuotes(p: ParcelInput, kg: number, opts: { apis: Courier[]; s: Surcharges }): Quote[] {
  const to = p.to as Exclude<Destination, 'KW'>;
  const out: Quote[] = [];
  for (const courier of Object.keys(INTL) as Courier[]) {
    const row = INTL[courier][to];
    if (!row) continue;
    const { kg: charged, price } = bracketPrice(row, kg);
    const surcharges: Quote['surcharges'] = [];
    if (courier === 'UPS') {
      surcharges.push({ label: `Surge fee ${charged} kg`, amount: Math.round(charged * opts.s.upsSurgePerKg) });
      if (opts.s.upsFuelPct > 0) surcharges.push({ label: `Fuel ${Math.round(opts.s.upsFuelPct * 100)}%`, amount: Math.round(price * opts.s.upsFuelPct) });
    }
    if (courier === 'Aramex') {
      const war = opts.s.aramexWarRiskUsdUpTo4Kg + Math.max(0, Math.ceil(charged - 4)) * opts.s.aramexWarRiskUsdPerKgAbove;
      surcharges.push({ label: `War risk USD ${war}`, amount: usd(war, opts.s) });
    }
    const total = price + surcharges.reduce((s, x) => s + x.amount, 0);
    out.push({ courier, label: courier, freight: price, surcharges, total, chargedKg: charged, inUse: true, hasApi: opts.apis.includes(courier), note: courier === 'UPS' && opts.s.upsFuelPct === 0 ? 'Plus UPS fuel surcharge (% not given yet)' : undefined });
  }
  return out;
}

export type Recommendation = { kg: number; estimated: boolean; options: Quote[]; pick: Quote | null; why: string };

/**
 * Every courier priced for this parcel, cheapest first, and the pick: the cheapest allowed courier;
 * between equal prices, the one the console can book by itself, then the faster.
 */
export function recommend(p: ParcelInput, opts: { apis?: Courier[]; surcharges?: Surcharges } = {}): Recommendation {
  const kg = p.kg && p.kg > 0 ? p.kg : estimateKg(p.pieces);
  const apis = opts.apis ?? [];
  const options = (p.to === 'KW' ? domesticQuotes(p, kg, { apis }) : internationalQuotes(p, kg, { apis, s: opts.surcharges ?? SURCHARGES })).sort(
    (a, b) => a.total - b.total || Number(b.hasApi) - Number(a.hasApi) || a.courier.localeCompare(b.courier),
  );
  const pick = options.find((o) => o.inUse) ?? null;
  const next = pick ? options.find((o) => o.inUse && o !== pick) : undefined;
  const why = !pick
    ? 'No courier on the card serves this route.'
    : next
      ? next.total === pick.total
        ? `Same price as ${next.label}${pick.hasApi && !next.hasApi ? '; booked by the console' : ''}.`
        : `Cheapest: ${fmt(next.total - pick.total)} KWD less than ${next.label}.`
      : 'Only courier on this route.';
  return { kg, estimated: !(p.kg && p.kg > 0), options, pick, why };
}

// ── What the customer pays abroad (Moody, 25 Oct) ──────────────────────────────────────────────
/** 1 pc 5 · 2 6 · 3 7 · 4 8 · 5 10 · 6 12 · 7 13 · 8 14 · 9 15 · 10 15 · 11–12 17, then +2 KD per 2 pieces. */
const CUSTOMER_PRICE = [0, 5000, 6000, 7000, 8000, 10000, 12000, 13000, 14000, 15000, 15000, 17000, 17000];
export function customerPriceAbroad(pieces: number): number {
  const n = Math.max(1, Math.round(pieces));
  if (n < CUSTOMER_PRICE.length) return CUSTOMER_PRICE[n];
  return 17000 + Math.ceil((n - 12) / 2) * 2000;
}

export const fmt = (fils: number) => (fils / 1000).toFixed(3);
