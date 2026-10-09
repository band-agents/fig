// Demo floor: about a month of believable trading across the six live storefronts, pushed through the
// real engine (risk, Autopilot, stage rules, SLAs) by the fictional team in people.ts. It stops at "now",
// so whatever is still in flight becomes today's work. Never runs against a live connector's orders.
import { inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../lib/db';
import { CHANNEL, CHANNELS, channelConfigured } from '../lib/channels';
import type { IncomingItem, IncomingOrder } from '../lib/connectors/types';
import { scopesFor } from '../lib/domain/perms';
import { RTO_REASONS, type ReturnReason } from '../lib/domain/stages';
import { toMinor } from '../lib/format';
import {
  addNote,
  flagException,
  ingestOrder,
  invalidateRiskContext,
  moveOrder,
  moveReturn,
  openReturn,
  setHold,
  type Actor,
} from '../lib/engine';
import catalog from './catalog.json';
import { DEMO_STAFF, EG_FIRST_F, EG_FIRST_M, EG_LAST, EG_PLACES, EG_STREETS, KW_FIRST_F, KW_FIRST_M, KW_LAST, KW_PLACES, KW_STREETS } from './people';

type Product = { title: string; brand: string; type: string; tags: string[]; price: number; compareAt: number | null; currency: string; sku: string; sizes: string[]; image: string | null };

// ── deterministic randomness ──
let seed = 20261008;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const between = (a: number, b: number) => a + rnd() * (b - a);
const weighted = <T extends { weight: number }>(a: T[]) => {
  const total = a.reduce((s, x) => s + x.weight, 0);
  let r = rnd() * total;
  for (const x of a) if ((r -= x.weight) <= 0) return x;
  return a[a.length - 1];
};

const MIN = 60_000;
const HOUR = 3_600_000;
const OFFSET = 3 * HOUR; // Cairo (EEST) and Kuwait are both UTC+3 across this window
const localHour = (t: number) => new Date(t + OFFSET).getUTCHours() + new Date(t + OFFSET).getUTCMinutes() / 60;

/** Moves t into working hours [from, to) local time, adding a little human slack. Warehouses and
 *  couriers in both countries rest on Fridays, so floor work rolls over to Saturday. */
function workTime(t: number, from: number, to: number, restFriday = false) {
  const h = localHour(t);
  const friday = (x: number) => new Date(x + OFFSET).getUTCDay() === 5;
  if (h >= from && h < to && !(restFriday && friday(t))) return t;
  const startOfLocalDay = t - ((t + OFFSET) % (24 * HOUR));
  let next = startOfLocalDay + from * HOUR;
  if (h >= to || (restFriday && friday(t))) next += 24 * HOUR;
  while (restFriday && friday(next)) next += 24 * HOUR;
  return next + between(5, 50) * MIN;
}

type Archetype = 'loyal' | 'regular' | 'returner' | 'refuser' | 'oneoff';
type Person = { name: string; phone: string; email: string | null; country: 'EG' | 'KW'; region: string; city: string; rto: number; line1: string; type: Archetype };

function makePerson(country: 'EG' | 'KW', i: number): Person {
  const female = chance(0.82);
  const first = country === 'EG' ? pick(female ? EG_FIRST_F : EG_FIRST_M) : pick(female ? KW_FIRST_F : KW_FIRST_M);
  const last = country === 'EG' ? pick(EG_LAST) : pick(KW_LAST);
  const place = weighted(country === 'EG' ? EG_PLACES : KW_PLACES);
  const city = pick(place.cities);
  const type = weighted([
    { t: 'loyal' as const, weight: 14 },
    { t: 'regular' as const, weight: 60 },
    { t: 'returner' as const, weight: 9 },
    { t: 'refuser' as const, weight: country === 'EG' ? 8 : 1 },
    { t: 'oneoff' as const, weight: 9 },
  ]).t;
  const digits = () => String(Math.floor(rnd() * 1e8)).padStart(8, '0');
  let phone = country === 'EG' ? `0${pick(['10', '11', '12', '15'])}${digits()}` : `${pick(['5', '6', '9'])}${digits().slice(1)}`;
  if (chance(0.025)) phone = phone.slice(0, -3); // a few mistyped numbers, as in real life
  const street = country === 'EG' ? pick(EG_STREETS) : pick(KW_STREETS);
  const line1 = chance(0.04)
    ? city
    : country === 'EG'
      ? `${Math.ceil(rnd() * 140)} ${street}, Building ${Math.ceil(rnd() * 30)}, Apt ${Math.ceil(rnd() * 24)}`
      : `Block ${Math.ceil(rnd() * 12)}, ${street}, House ${Math.ceil(rnd() * 90)}`;
  const handle = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
  return {
    name: `${first} ${last}`,
    phone,
    email: chance(0.9) ? `${handle}${i % 97}@${pick(['gmail.com', 'yahoo.com', 'hotmail.com', 'icloud.com', 'outlook.com'])}` : null,
    country,
    region: place.region,
    city,
    rto: place.rto,
    line1,
    type,
  };
}

const CATALOG = {
  fig: (catalog as { fig: Product[] }).fig,
  wsEg: (catalog as { wsEg: Product[] }).wsEg,
  labesny: (catalog as { labesny: Product[] }).labesny,
};
const wsKw: Product[] = CATALOG.wsEg.map((p) => ({ ...p, currency: 'KWD', price: Math.max(2, Math.round((p.price / 158) * 4) / 4), compareAt: p.compareAt ? Math.round((p.compareAt / 158) * 4) / 4 : null }));
const productsFor: Record<string, Product[]> = { 'fig-web': CATALOG.fig, 'fig-app': CATALOG.fig, 'ws-eg': CATALOG.wsEg, 'labesny-web': CATALOG.labesny, 'labesny-app': CATALOG.labesny, 'ws-kw': wsKw };

const PER_DAY: Record<string, number> = { 'fig-web': 15, 'fig-app': 5, 'ws-eg': 6, 'labesny-web': 8, 'labesny-app': 3, 'ws-kw': 3 };
const PREFIX: Record<string, [string, number]> = { 'fig-web': ['FIG-', 24100], 'fig-app': ['FIGAPP-', 1200], 'ws-eg': ['WSE-', 3100], 'labesny-web': ['LB-', 81200], 'labesny-app': ['LBAPP-', 900], 'ws-kw': ['WSK-', 1400] };
const WEEKDAY = [0.92, 0.9, 0.95, 1.0, 1.25, 1.15, 1.05]; // Sun..Sat, Cairo shopping rhythm

function basket(channelId: string, sizeRunsSmall: string): IncomingItem[] {
  const pool = productsFor[channelId];
  const lines = weighted([{ n: 1, weight: 52 }, { n: 2, weight: 28 }, { n: 3, weight: 13 }, { n: 4, weight: 7 }]).n;
  const items: IncomingItem[] = [];
  const currency = CHANNEL[channelId].currency;
  const bracket = chance(0.06);
  for (let i = 0; i < lines; i++) {
    // the product that runs small sells well: it's the one the return pattern will expose
    const p = chance(0.05) ? pool.find((x) => x.sku === sizeRunsSmall) ?? pick(pool) : pick(pool);
    const sizes = p.sizes.length ? p.sizes : [null];
    const make = (size: string | null) => ({
      sku: size ? `${p.sku}-${size}` : p.sku,
      barcode: /^\d{12,13}$/.test(p.sku) ? p.sku : null,
      title: p.title,
      variant: size,
      size,
      brand: p.brand,
      category: p.type || null,
      image: p.image,
      quantity: chance(0.07) ? 2 : 1,
      unitPrice: toMinor(p.price, currency),
    });
    if (bracket && i === 0 && sizes.length >= 2 && sizes[0]) {
      const n = Math.min(sizes.length, chance(0.4) ? 3 : 2);
      const start = Math.floor(rnd() * (sizes.length - n + 1));
      for (const s of sizes.slice(start, start + n)) items.push({ ...make(s), quantity: 1 });
      continue;
    }
    items.push(make(pick(sizes)));
  }
  return items;
}

export async function seedDemo(opts: { days?: number; log?: (m: string) => void } = {}) {
  const days = opts.days ?? 30;
  const log = opts.log ?? (() => {});
  const db = await getDb();
  seed = 20261008;
  const t0 = Date.now();

  log('Clearing demo data…');
  await db.execute(sql`delete from events where order_id in (select id from orders where source = 'demo') or return_id in (select r.id from returns r join orders o on o.id = r.order_id where o.source = 'demo')`);
  await db.execute(sql`delete from orders where source = 'demo'`);
  await db.execute(sql`delete from events where order_id is null and return_id is null and kind <> 'sync'`);
  await db.execute(sql`delete from customers where id not in (select distinct customer_id from orders where customer_id is not null)`);
  await db.execute(sql`delete from settlements where reference like 'ARX-%'`);

  // Team
  const staff: Record<string, Actor> = {};
  for (const s of DEMO_STAFF) {
    const [u] = await db
      .insert(schema.users)
      .values({ email: s.email, name: s.name, title: s.title, role: s.role, scopes: scopesFor(s.role), channels: s.channels ?? [], hue: s.hue })
      .onConflictDoUpdate({ target: schema.users.email, set: { name: s.name, title: s.title, role: s.role, scopes: scopesFor(s.role), channels: s.channels ?? [], hue: s.hue, active: true } })
      .returning();
    staff[s.email.split('@')[0]] = { id: u.id, name: u.name, dept: s.title };
  }
  const careEG = [staff.salma, staff.youssef];
  const careKW = [staff.abdullah];
  const pickEG = [staff.omar, staff.karim];
  const pickKW = [staff.fatma];
  const aramex: Actor = { id: null, name: 'Aramex', dept: null };
  const aramexKW: Actor = { id: null, name: 'Aramex KW', dept: null };

  for (const c of CHANNELS) {
    const mode = c.parked ? 'off' : channelConfigured(c) ? 'live' : PER_DAY[c.id] ? 'demo' : 'off';
    await db
      .insert(schema.channels)
      .values({ id: c.id, mode, lastSyncAt: mode === 'demo' ? new Date() : null, lastSyncOk: mode === 'demo' ? true : null, lastSyncNote: mode === 'demo' ? 'Demo data' : null })
      .onConflictDoUpdate({ target: schema.channels.id, set: { mode } });
  }

  const people = { EG: Array.from({ length: 700 }, (_, i) => makePerson('EG', i)), KW: Array.from({ length: 300 }, (_, i) => makePerson('KW', i)) };
  const runsSmall = CATALOG.labesny.find((p) => /bra|balconette|plunge/i.test(p.title)) ?? CATALOG.labesny[0];
  const runsSmallEg = CATALOG.fig.find((p) => /dress|trouser|jean/i.test(p.title)) ?? CATALOG.fig[0];

  // Plan every order first, then play them in time order so customer history builds up naturally.
  const now = Date.now();
  const start = now - days * 24 * HOUR;
  const plan: { channelId: string; at: number }[] = [];
  for (let d = 0; d <= days; d++) {
    const dayStart = start - ((start + OFFSET) % (24 * HOUR)) + d * 24 * HOUR;
    const wd = new Date(dayStart + OFFSET + 12 * HOUR).getUTCDay();
    const trend = d > days - 7 ? 1.12 : 1;
    for (const [channelId, rate] of Object.entries(PER_DAY)) {
      const n = Math.round(rate * WEEKDAY[wd] * trend * between(0.8, 1.2));
      for (let i = 0; i < n; i++) {
        const hour = weighted([
          { h: between(0, 2), weight: 9 },
          { h: between(2, 9), weight: 4 },
          { h: between(9, 13), weight: 12 },
          { h: between(13, 18), weight: 18 },
          { h: between(18, 21), weight: 22 },
          { h: between(21, 24), weight: 30 },
        ]).h;
        const at = dayStart + hour * HOUR;
        if (at < now - 5 * MIN && at > start) plan.push({ channelId, at });
      }
    }
  }
  plan.sort((a, b) => a.at - b.at);
  log(`Simulating ${plan.length} orders over ${days} days…`);

  const counters = Object.fromEntries(Object.entries(PREFIX).map(([k, [, n]]) => [k, n]));
  const regulars: Record<'EG' | 'KW', Person[]> = { EG: [], KW: [] };
  const deliveredCod: { id: string; at: number; total: number }[] = [];
  const delivered: { id: string; at: number; person: Person; channelId: string; skus: string[] }[] = [];
  let done = 0;

  for (const { channelId, at } of plan) {
    const ch = CHANNEL[channelId];
    const country = ch.country as 'EG' | 'KW';
    const reuse = regulars[country].length > 20 && chance(0.42);
    const person = reuse ? pick(regulars[country].filter((p) => p.type !== 'oneoff')) ?? pick(people[country]) : pick(people[country]);
    if (!reuse && person.type !== 'oneoff') regulars[country].push(person);
    const items = basket(channelId, country === 'KW' ? runsSmall.sku : runsSmallEg.sku);
    const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const discount = chance(0.12) ? Math.round(subtotal * pick([0.1, 0.15, 0.2])) : 0;
    const shipping = country === 'KW' && subtotal - discount < toMinor(20, 'KWD') ? toMinor(2, 'KWD') : 0;
    const method: IncomingOrder['paymentMethod'] =
      country === 'KW' ? (chance(0.72) ? 'knet' : 'card') : person.type === 'refuser' ? 'cod' : weighted([{ m: 'cod' as const, weight: 62 }, { m: 'card' as const, weight: 31 }, { m: 'wallet' as const, weight: 5 }, { m: 'instapay' as const, weight: 2 }]).m;
    const [prefix] = PREFIX[channelId];
    const number = `${prefix}${++counters[channelId]}`;
    const inc: IncomingOrder = {
      channelId,
      externalId: `demo-${number}`,
      number,
      source: 'demo',
      placedAt: new Date(at),
      customerName: person.name,
      phone: person.phone,
      email: person.email,
      address: { name: person.name, line1: person.line1, city: person.city, region: person.region, country, phone: person.phone },
      currency: ch.currency,
      subtotal,
      shipping,
      discount,
      total: subtotal - discount + shipping,
      paymentMethod: method,
      paymentStatus: method === 'cod' ? 'cod_due' : 'paid',
      items,
      note: chance(0.06) ? pick(['Please call before delivery', 'Gift, please no invoice in the box', 'Deliver after 5 pm', 'Leave with the doorman']) : null,
      tags: [],
    };
    const { id } = await ingestOrder(inc, { at: new Date(at), quiet: true });
    await play(id, at, person, channelId, items.map((i) => i.sku ?? ''));
    if (++done % 150 === 0) {
      invalidateRiskContext(true);
      log(`  ${done}/${plan.length} orders · ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }

  async function play(id: string, placed: number, person: Person, channelId: string, skus: string[]) {
    const kw = CHANNEL[channelId].country === 'KW';
    const care = kw ? careKW : careEG;
    const pickers = kw ? pickKW : pickEG;
    const courier = kw ? aramexKW : aramex;
    let [o] = await db.select().from(schema.orders).where(sql`id = ${id}`);
    let t = Math.max(placed, o.stageAt.getTime());
    let picker = pick(pickers);
    const step = async (to: Parameters<typeof moveOrder>[2], who: Actor, input: Parameters<typeof moveOrder>[3] = {}) => {
      if (t >= now) return false;
      await moveOrder(who, id, to, input, { at: new Date(t), quiet: true });
      [o] = await db.select().from(schema.orders).where(sql`id = ${id}`);
      t = Math.max(t, o.stageAt.getTime());
      return true;
    };
    for (let guard = 0; guard < 14; guard++) {
      switch (o.stage) {
        case 'confirming': {
          t = workTime(t + between(8, 150) * MIN, 10, 22);
          if (t >= now) return;
          const who = pick(care);
          if ((person.type === 'refuser' && chance(0.3)) || chance(0.035)) {
            await addNote(who, { orderId: id }, 'No answer on two calls, WhatsApp unread', 'call', { at: new Date(t), quiet: true });
            t += between(3, 6) * HOUR;
            await step('cancelled', who, { reason: pick(['Failed confirmation', 'Customer cancelled']) });
            return;
          }
          await addNote(who, { orderId: id }, pick(['Confirmed size and address by phone', 'Customer confirmed, prefers evening delivery', 'Confirmed on WhatsApp', 'Confirmed, asked for a call before delivery']), 'call', { at: new Date(t), quiet: true });
          t += between(1, 4) * MIN;
          if (!(await step('finance', who))) return;
          break;
        }
        case 'finance': {
          t = workTime(t + between(15, 240) * MIN, 10, 19);
          if (o.riskLevel === 'high' && chance(0.12)) {
            await step('cancelled', staff.mariam, { reason: 'Suspected fraud' });
            return;
          }
          if (!(await step('ready', staff.mariam))) return;
          break;
        }
        case 'ready': {
          // now and then a piece isn't where the system says it is
          const waitStock = chance(0.06) ? between(20, 50) * HOUR : 0;
          t = workTime(t + between(20, 420) * MIN + waitStock, 10, 19, true);
          picker = pick(pickers);
          if (!(await step('picking', picker))) return;
          break;
        }
        case 'picking': {
          t += between(6, 40) * MIN;
          if (!(await step('packed', picker))) return;
          break;
        }
        case 'packed': {
          // couriers collect once a day, late afternoon
          let pickup = workTime(t + 30 * MIN, 16, 18, true);
          if (localHour(pickup) < 16) pickup = workTime(pickup + 6 * HOUR, 16, 18, true);
          t = pickup;
          const waybill = `${kw ? '5' : '4'}${String(Math.floor(rnd() * 1e10)).padStart(10, '0')}`;
          if (!(await step('shipped', staff.hady, { tracking: waybill, courier: kw ? 'Aramex KW' : 'Aramex' }))) return;
          break;
        }
        case 'shipped': {
          const far = ['Minya', 'Assiut', 'Sohag', 'Luxor', 'Aswan', 'Red Sea'].includes(person.region);
          t = workTime(t + (kw ? between(14, 20) : far ? between(40, 70) : between(15, 40)) * HOUR, 9, 13, true);
          if (!(await step('delivering', courier))) return;
          break;
        }
        case 'delivering': {
          const cod = o.paymentMethod === 'cod';
          const mult = person.type === 'refuser' ? 3.4 : person.type === 'loyal' ? 0.2 : 1;
          if (cod && chance(person.rto * mult)) {
            t += between(2, 7) * HOUR;
            if (t >= now) return;
            await flagException(courier, id, 'Delivery attempt failed · customer unreachable', { at: new Date(t), quiet: true, attempt: true });
            t += between(18, 30) * HOUR;
            await step('rto', courier, { reason: pick(RTO_REASONS) });
            break;
          }
          t += between(1.5, 8) * HOUR;
          if (!(await step('delivered', courier))) return;
          if (cod) deliveredCod.push({ id, at: t, total: o.total });
          delivered.push({ id, at: t, person, channelId, skus });
          return;
        }
        case 'rto': {
          t = workTime(t + between(3, 6) * 24 * HOUR, 10, 18);
          await step('rto_closed', staff.rana);
          return;
        }
        default:
          return;
      }
    }
  }

  // ── Returns ──
  log('Playing returns…');
  const reasonPool: { r: ReturnReason; weight: number }[] = [
    { r: 'too_small', weight: 26 },
    { r: 'too_large', weight: 18 },
    { r: 'not_as_pictured', weight: 15 },
    { r: 'changed_mind', weight: 17 },
    { r: 'quality', weight: 9 },
    { r: 'damaged', weight: 6 },
    { r: 'wrong_item', weight: 4 },
    { r: 'late', weight: 5 },
  ];
  for (const d of delivered) {
    const smallOne = d.skus.some((s) => s.startsWith(runsSmall.sku) || s.startsWith(runsSmallEg.sku));
    const p = smallOne ? 0.45 : d.person.type === 'returner' ? 0.42 : d.person.type === 'loyal' ? 0.04 : 0.075;
    if (!chance(p)) continue;
    let t = d.at + between(1, 9) * 24 * HOUR;
    if (t >= now) continue;
    t = workTime(t, 10, 22);
    const lines = await db.select().from(schema.orderItems).where(sql`order_id = ${d.id} and returnable = true`);
    if (!lines.length) continue;
    const chosen = smallOne ? lines.filter((l) => (l.sku ?? '').startsWith(runsSmall.sku) || (l.sku ?? '').startsWith(runsSmallEg.sku)) : [pick(lines)];
    const reason = smallOne ? 'too_small' : weighted(reasonPool).r;
    const kw = CHANNEL[d.channelId].country === 'KW';
    const care = kw ? careKW : careEG;
    let ret;
    try {
      ret = await openReturn(pick(care), d.id, { items: (chosen.length ? chosen : [lines[0]]).map((l) => ({ orderItemId: l.id, quantity: l.quantity })), reason, resolution: chance(0.15) ? 'exchange' : 'refund' }, { at: new Date(t), quiet: true });
    } catch {
      continue;
    }
    const r = ret;
    const go = async (to: Parameters<typeof moveReturn>[2], who: Actor, gap: [number, number], input: Parameters<typeof moveReturn>[3] = {}) => {
      t = workTime(t + between(gap[0], gap[1]) * HOUR, 10, 19);
      if (t >= now) return false;
      await moveReturn(who, r.id, to, input, { at: new Date(t), quiet: true });
      return true;
    };
    if (!(await go('approved', staff.rana, [1, 20]))) continue;
    if (kw || r.method === 'store') {
      if (!(await go('received', staff.rana, [20, 70]))) continue;
    } else {
      if (!(await go('pickup', staff.hady, [3, 26], { tracking: `7${String(Math.floor(rnd() * 1e10)).padStart(10, '0')}` }))) continue;
      if (!(await go('in_transit', aramex, [18, 40]))) continue;
      if (!(await go('received', staff.rana, [20, 50]))) continue;
    }
    const inspection = weighted([{ v: 'pass' as const, weight: 85 }, { v: 'damaged' as const, weight: 7 }, { v: 'wrong_item' as const, weight: 3 }, { v: 'partial' as const, weight: 5 }]).v;
    if (!(await go('inspected', staff.rana, [2, 20], { inspection }))) continue;
    if (r.resolution === 'exchange') {
      await go('closed', staff.rana, [1, 6], { note: 'Exchanged for another size, new parcel sent' });
      continue;
    }
    if (!(await go('refund_pending', staff.rana, [0.2, 3]))) continue;
    await go('refunded', staff.mariam, [10, 60]);
  }

  // ── Courier cash settlements (COD, Egypt): Aramex remits on Sundays and Wednesdays ──
  log('Reconciling courier cash…');
  deliveredCod.sort((a, b) => a.at - b.at);
  const cycles: number[] = [];
  for (let t = start; t < now; t += 24 * HOUR) {
    const local = new Date(t + OFFSET);
    if ([0, 3].includes(local.getUTCDay())) cycles.push(t - ((t + OFFSET) % (24 * HOUR)) + 13 * HOUR);
  }
  let cursor = 0;
  const pendingFrom = now - 2.5 * 24 * HOUR;
  for (const [i, cycle] of cycles.entries()) {
    const batch: typeof deliveredCod = [];
    while (cursor < deliveredCod.length && deliveredCod[cursor].at <= cycle - 2 * 24 * HOUR) batch.push(deliveredCod[cursor++]);
    if (!batch.length) continue;
    const live = await db.select({ id: schema.orders.id, total: schema.orders.total, stage: schema.orders.stage }).from(schema.orders).where(inArray(schema.orders.id, batch.map((b) => b.id)));
    const open = live.filter((o) => o.stage === 'delivered');
    if (!open.length) continue;
    const expected = open.reduce((s, o) => s + o.total, 0);
    const pending = cycle > pendingFrom;
    const short = !pending && i === cycles.length - 4 ? open.slice(0, 2).reduce((s, o) => s + o.total, 0) : 0;
    const ref = `ARX-EG-${new Date(cycle + OFFSET).toISOString().slice(0, 10)}`;
    const [s] = await db
      .insert(schema.settlements)
      .values({
        reference: ref,
        courier: 'Aramex',
        currency: 'EGP',
        periodFrom: new Date(batch[0].at),
        periodTo: new Date(batch[batch.length - 1].at),
        expected,
        remitted: pending ? null : expected - short,
        orderCount: open.length,
        status: pending ? 'pending' : short ? 'discrepancy' : 'matched',
        createdAt: new Date(cycle),
        matchedAt: pending ? null : new Date(cycle + 3 * HOUR),
      })
      .returning();
    for (const [k, o] of open.entries()) {
      await db.update(schema.orders).set({ settlementId: s.id }).where(sql`id = ${o.id}`);
      if (pending || (short && k < 2)) continue;
      await moveOrder(staff.mariam, o.id, 'settled', {}, { at: new Date(cycle + 3 * HOUR + k * 1000), quiet: true });
    }
  }

  // ── A few live problems for the floor to find ──
  log('Setting today’s exceptions…');
  const openOrders = await db.select().from(schema.orders).where(sql`source = 'demo' and stage in ('ready','finance','confirming') and on_hold = false`).limit(40);
  for (const [k, o] of openOrders.slice(0, 3).entries()) {
    await setHold(k === 1 ? staff.mariam : staff.nour, o.id, true, ['Waiting for stock', 'Customer asked to delay', 'Payment check'][k], { at: new Date(now - between(1, 5) * HOUR), quiet: true });
  }
  const stuck = await db.select().from(schema.orders).where(sql`source = 'demo' and stage = 'shipped' and shipped_at < now() - interval '60 hours'`).limit(4);
  for (const o of stuck) await flagException(aramex, o.id, 'No courier scan for 3 days', { at: new Date(now - between(2, 8) * HOUR), quiet: true });

  invalidateRiskContext(true);
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from orders where source = 'demo'`)).rows;
  log(`Done: ${n} orders in ${Math.round((Date.now() - t0) / 1000)}s.`);
  return { orders: n };
}
