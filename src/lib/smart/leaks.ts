import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { CHANNEL, channelLabel } from '../channels';
import { canAny, type Area, type Principal } from '../domain/perms';
import { parcelCost, pickupCost } from '../domain/shipping-cost';
import { RETURN_REASONS, type ReturnReason } from '../domain/stages';
import { remember } from '../remember';
import { foldBrand, scope } from '../queries';
import { shippingRates } from '../shipping';
import { egpMinor } from '../stock/core';
import { factsFor, getFacts, type ProductFacts } from '../stock/facts';
import { marketsFor, sees } from '../stock/views/common';
import { webStylesFor } from '../web-items';

/**
 * Money leaks (Dan, 28 Oct: "smart features that help this business grow"): the money the business
 * loses each week, by cause, each one priced from the console's own data and opening the screen that
 * fixes it. Nothing is guessed beyond what the basis line says:
 *
 * - Event leaks (refusals, returns, cancellations) are the last four weeks, divided by four.
 * - Stock leaks are online sales missed, at the pace each style (or the market's stock as a whole)
 *   actually sells online. The console sees website sales only until Lucida's shop sales come in, so
 *   "dead stock" stays off: a style can sell well in the shops and look dead online.
 *
 * Amounts are EGP-equivalent minor units, like the rest of the analysis pages; pages show them in the
 * viewer's currency.
 */

export type LeakKey = 'sizes' | 'hidden' | 'photos' | 'refused' | 'returns' | 'cancelled' | 'price' | 'dead';
export type LeakItem = { key: string; title: string; sub: string; weekly: number; href: string; image?: string | null; productId?: string; handle?: string };
export type Leak = {
  key: LeakKey;
  label: string;
  short: string;
  team: string;
  weekly: number;
  count: number;
  unit: string;
  basis: string;
  href: string;
  fix: string;
  items: LeakItem[];
  off?: string; // why it is not counted yet
  byBrand?: Record<string, number>; // folded brand → weekly, where the cause is per style
};

// who may see (and is asked to fix) each leak
export const LEAK_AREAS: Record<LeakKey, Area[]> = {
  sizes: ['stock', 'procurement'],
  hidden: ['merch', 'catalog'],
  photos: ['merch', 'catalog'],
  refused: ['shipping', 'fulfilment', 'overview'],
  returns: ['returns', 'overview'],
  cancelled: ['intake', 'overview'],
  price: ['merch', 'stock'],
  dead: ['stock', 'procurement', 'merch'],
};

// Shopify's cancel reasons, in words
const CANCEL_WORDS: Record<string, string> = { customer: 'Customer changed their mind', declined: 'Payment declined', fraud: 'Looked like fraud', inventory: 'Out of stock', staff: 'Staff error', other: 'Other reason' };

const DAYS = 28;
const WEEKS = DAYS / 7;
const top = <T extends { weekly: number }>(xs: T[], n = 8) => [...xs].sort((a, b) => b.weekly - a.weekly).slice(0, n);
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/** Online demand a week for a style: the forecast, or its last eight weeks when the forecast is lower. */
const demandOf = (x: ProductFacts) => Math.max(x.rate, x.sold8 / 8);

export function moneyLeaks(p: Principal) {
  return remember(`leaks:${p.channels.join(',')}:${(p.brands ?? []).join(',')}`, 5 * 60_000, () => compute(p));
}

async function compute(p: Principal) {
  const db = await getDb();
  const markets = marketsFor(p);
  const facts = factsFor(await getFacts(), p).products.filter((x) => markets.includes(x.market));
  const s = scope(p, sql`o.channel_id`, sql`o.id`);
  const since = new Date(Date.now() - DAYS * 86400000);
  const leaks: Leak[] = [];

  // how fast stock sells online in each market: a week's sales over the pieces on hand
  const pace = new Map<string, number>();
  for (const m of markets) {
    const live = facts.filter((x) => x.market === m && x.onHand > 0);
    const onHand = sum(live, (x) => x.onHand);
    pace.set(m, onHand ? sum(live, demandOf) / onHand : 0);
  }
  const paceText = markets.map((m) => `${m === 'KW' ? 'Kuwait' : 'Egypt'} ${((pace.get(m) ?? 0) * 100).toFixed(2)}%`).join(', ');

  // 1. sizes sold out on styles that sell: the share of the style's demand those sizes carry
  const selling = facts.filter((x) => demandOf(x) > 0);
  const empty = new Map<string, { size: string; qty: number }[]>();
  for (let i = 0; i < selling.length; i += 2000) {
    const ids = selling.slice(i, i + 2000).map((x) => sql`${x.id}`);
    if (!ids.length) break;
    const r = await db.execute<{ product_id: string; size: string | null; qty: number }>(sql`
      select v.product_id, v.size, coalesce(sum(sl.on_hand), 0)::int as qty
      from variants v left join stock_levels sl on sl.variant_id = v.id
      where v.product_id in (${sql.join(ids, sql`, `)})
      group by v.id`);
    for (const x of r.rows) empty.set(x.product_id, [...(empty.get(x.product_id) ?? []), { size: x.size || 'One size', qty: x.qty }]);
  }
  const sizeItems: LeakItem[] = [];
  const sizesByBrand: Record<string, number> = {};
  let sizesOut = 0;
  for (const x of selling) {
    const vs = empty.get(x.id) ?? [];
    const gone = vs.filter((v) => v.qty <= 0);
    if (!gone.length) continue;
    const mixTotal = sum(vs, (v) => x.sizeMix[v.size] ?? 0);
    const share = (v: { size: string }) => (mixTotal > 0 ? (x.sizeMix[v.size] ?? 0) / mixTotal : 1 / vs.length);
    const lostShare = sum(gone, share);
    const weekly = Math.round(egpMinor(demandOf(x) * lostShare * x.price, x.currency));
    if (weekly <= 0) continue;
    sizesOut += gone.length;
    const fb = foldBrand(x.brand);
    sizesByBrand[fb] = (sizesByBrand[fb] ?? 0) + weekly;
    const all = gone.length === vs.length;
    sizeItems.push({
      key: `sizes:${x.id}`,
      productId: x.id,
      title: all ? `${x.title}: every size sold out` : `${x.title}: size${new Set(gone.map((g) => g.size)).size === 1 ? '' : 's'} ${[...new Set(gone.map((g) => g.size))].slice(0, 5).join(', ')} sold out`,
      sub: `${x.brand} · ${x.styleCode} · sells ${demandOf(x).toFixed(1)} a week online`,
      weekly,
      href: `/stock/inventory/${x.id}`,
      image: x.image,
    });
  }
  leaks.push({
    key: 'sizes',
    label: 'Sold-out sizes on styles that sell',
    short: 'Sold-out sizes',
    team: 'Stock & buying',
    weekly: sum(sizeItems, (i) => i.weekly),
    count: sizeItems.length,
    unit: `styles, ${sizesOut} sizes`,
    basis: 'Each style’s online sales a week × the share of its sales those sizes carry × its price.',
    href: '/stock/inventory?status=broken',
    fix: 'Reorder or move pieces in',
    items: top(sizeItems),
    byBrand: sizesByBrand,
  });

  // 2 and 3. stock the websites hold but cannot sell: not published, or no photo
  const styles = await webStylesFor(p);
  const hiddenItems: LeakItem[] = [];
  const photoItems: LeakItem[] = [];
  for (const st of styles) {
    const units = Math.max(st.webQty, st.lucidaQty ?? 0);
    const price = st.price ?? st.lucidaPrice ?? 0;
    if (units <= 0 || price <= 0) continue;
    const off = st.status !== 'active';
    if (!off && st.hasPhoto) continue;
    const weekly = Math.round(egpMinor(units * price * (pace.get(st.market) ?? 0), st.currency));
    if (weekly <= 0) continue;
    const store = CHANNEL[st.channelId];
    const item: LeakItem = {
      key: `${st.hasPhoto ? 'hidden' : 'photos'}:${st.channelId}:${st.key}`,
      title: st.title,
      sub: `${st.brand ?? 'Brand unknown'} · ${units} pcs · ${st.status === 'absent' ? 'never uploaded' : st.status === 'active' ? 'live, no photo' : st.status}${store ? ` · ${channelLabel(store.id)}` : ''}`,
      weekly,
      href: `/stock/web-items?store=${st.channelId}&group=all&q=${encodeURIComponent(st.handle ?? st.title)}`,
      handle: st.handle ?? undefined,
    };
    if (off && st.hasPhoto) hiddenItems.push(item);
    else photoItems.push(item);
  }
  // their photos, from the console's own catalogue, for the ones that will be shown
  const shown = [...top(hiddenItems), ...top(photoItems)].filter((i) => i.handle);
  if (shown.length) {
    const pics = await db.execute<{ handle: string; image: string | null }>(sql`select handle, image from products where handle in (${sql.join(
      shown.map((i) => sql`${i.handle}`),
      sql`, `,
    )}) and image is not null`);
    const img = new Map(pics.rows.map((r) => [r.handle, r.image]));
    for (const i of shown) i.image = img.get(i.handle!) ?? null;
  }
  leaks.push({
    key: 'hidden',
    label: 'Ready to sell, not on sale',
    short: 'Not on sale',
    team: 'E-commerce',
    weekly: sum(hiddenItems, (i) => i.weekly),
    count: hiddenItems.length,
    unit: 'styles',
    basis: `Draft, archived or never-uploaded styles with pieces and a photo, at the pace stock sells online (${paceText} of pieces a week).`,
    href: '/stock/web-items?group=unpublished',
    fix: 'Publish them',
    items: top(hiddenItems),
  });
  leaks.push({
    key: 'photos',
    label: 'Stock without a photo',
    short: 'No photo',
    team: 'E-commerce',
    weekly: sum(photoItems, (i) => i.weekly),
    count: photoItems.length,
    unit: 'styles',
    basis: `Styles with pieces but no photo, live or not, at the pace stock sells online (${paceText} of pieces a week).`,
    href: '/stock/web-items?group=all&reason=no_photo',
    fix: 'Shoot or upload photos',
    items: top(photoItems),
  });

  // 4. parcels refused at the door: the trip out and the trip back
  const rates = await shippingRates();
  const refused = await db.execute<{ id: string; number: string; channel_id: string; courier: string | null; city: string | null; region: string | null; items: number; total: string; payment_method: string }>(sql`
    select o.id, o.number, o.channel_id, o.courier, o.address->>'city' as city, o.address->>'region' as region, o.items, o.total::text, o.payment_method
    from orders o where ${s} and o.source <> 'demo' and o.stage in ('rto', 'rto_closed') and o.stage_at >= ${since}`);
  const byCity = new Map<string, { n: number; cost: number; channel: string }>();
  for (const o of refused.rows) {
    const market = CHANNEL[o.channel_id]?.country ?? 'EG';
    const pc = parcelCost(rates, { market, courier: o.courier, city: o.city, region: o.region, pieces: Math.max(1, Number(o.items)), cod: o.payment_method === 'cod' ? Number(o.total) : 0, refused: true });
    const cost = pc ? egpMinor(pc.total, pc.currency) : 0;
    const k = (o.city || o.region || 'Unknown area').trim();
    const x = byCity.get(k) ?? { n: 0, cost: 0, channel: o.channel_id };
    x.n += 1;
    x.cost += cost;
    byCity.set(k, x);
  }
  const refusedItems: LeakItem[] = [...byCity.entries()].map(([city, x]) => ({ key: `refused:${city}`, title: `${city}: ${x.n} refused`, sub: `${channelLabel(x.channel)} · shipping out and back`, weekly: Math.round(x.cost / WEEKS), href: '/orders?view=all&stage=rto' }));
  leaks.push({
    key: 'refused',
    label: 'Parcels refused at the door',
    short: 'Refused',
    team: 'Fulfilment',
    weekly: sum(refusedItems, (i) => i.weekly),
    count: refused.rows.length,
    unit: 'parcels in 4 weeks',
    basis: 'Shipping paid both ways on every refused parcel in the last four weeks, on the courier rate cards, ÷ 4.',
    href: '/orders?view=all&stage=rto',
    fix: 'Confirm cash orders before they ship',
    items: top(refusedItems),
  });

  // 5. returns: what we paid to collect them, credit bonuses, and pieces that came back damaged
  const rets = await db.execute<{ reason: string; channel_id: string; courier: string | null; method: string; paid_by: string | null; amount: string; bonus: string; currency: string; inspection: string | null }>(sql`
    select r.reason, r.channel_id, o.courier, r.method, r.review->>'shippingPaidBy' as paid_by, r.amount::text, r.bonus::text, r.currency, r.inspection
    from returns r join orders o on o.id = r.order_id
    where ${s} and o.source <> 'demo' and r.requested_at >= ${since} and r.stage <> 'rejected'`);
  const byReason = new Map<string, { n: number; cost: number }>();
  for (const r of rets.rows) {
    const market = CHANNEL[r.channel_id]?.country ?? 'EG';
    const pick = r.method === 'pickup' && r.paid_by !== 'customer' ? pickupCost(rates, market, r.courier) : null;
    const cost = (pick ? egpMinor(pick.total, pick.currency) : 0) + egpMinor(Number(r.bonus), r.currency) + (r.inspection === 'damaged' ? egpMinor(Number(r.amount), r.currency) : 0);
    const x = byReason.get(r.reason) ?? { n: 0, cost: 0 };
    x.n += 1;
    x.cost += cost;
    byReason.set(r.reason, x);
  }
  const returnItems: LeakItem[] = [...byReason.entries()].map(([reason, x]) => ({ key: `returns:${reason}`, title: `${RETURN_REASONS[reason as ReturnReason] ?? reason}: ${x.n} return${x.n === 1 ? '' : 's'}`, sub: 'collection, credit bonus and damaged pieces', weekly: Math.round(x.cost / WEEKS), href: '/returns' }));
  leaks.push({
    key: 'returns',
    label: 'Returns that cost us',
    short: 'Returns',
    team: 'Customer care',
    weekly: sum(returnItems, (i) => i.weekly),
    count: rets.rows.length,
    unit: 'returns in 4 weeks',
    basis: 'Collections we paid for, store-credit bonuses and pieces that came back damaged, last four weeks ÷ 4. Refunds themselves are not counted.',
    href: '/returns',
    fix: 'Fix the reasons behind them',
    items: top(returnItems.filter((i) => i.weekly > 0)),
  });

  // 6. cancelled orders: sales that were in the basket and never left
  const cancelled = await db.execute<{ reason: string | null; total: string; currency: string }>(sql`
    select o.cancel_reason as reason, o.total::text, o.currency from orders o
    where ${s} and o.source <> 'demo' and o.stage = 'cancelled' and o.stage_at >= ${since}`);
  const byCancel = new Map<string, { n: number; value: number }>();
  for (const o of cancelled.rows) {
    const k = CANCEL_WORDS[o.reason?.trim().toLowerCase() ?? ''] ?? (o.reason?.trim() || 'No reason given');
    const x = byCancel.get(k) ?? { n: 0, value: 0 };
    x.n += 1;
    x.value += egpMinor(Number(o.total), o.currency);
    byCancel.set(k, x);
  }
  const cancelItems: LeakItem[] = [...byCancel.entries()].map(([reason, x]) => ({ key: `cancelled:${reason}`, title: `${reason}: ${x.n} order${x.n === 1 ? '' : 's'}`, sub: 'cancelled in the last four weeks', weekly: Math.round(x.value / WEEKS), href: '/orders?view=all&stage=cancelled' }));
  leaks.push({
    key: 'cancelled',
    label: 'Orders cancelled',
    short: 'Cancelled',
    team: 'Customer care',
    weekly: sum(cancelItems, (i) => i.weekly),
    count: cancelled.rows.length,
    unit: 'orders in 4 weeks',
    basis: 'The value of orders cancelled in the last four weeks, ÷ 4, by the reason recorded.',
    href: '/orders?view=all&stage=cancelled',
    fix: 'Act on the top reason',
    items: top(cancelItems),
  });

  // 7. live prices below Lucida's: only once Lucida has been asked
  const asked = styles.some((x) => x.asked);
  const priceItems: LeakItem[] = asked
    ? styles
        .filter((x) => x.status === 'active' && x.price && x.lucidaPrice && x.lucidaPrice > x.price)
        .map((x) => ({ key: `price:${x.channelId}:${x.key}`, title: x.title, sub: `${x.brand ?? ''} · website below Lucida`, weekly: Math.round(egpMinor((x.lucidaPrice! - x.price!) * x.webQty * (pace.get(x.market) ?? 0), x.currency)), href: `/stock/web-items?store=${x.channelId}&verdict=live_price` }))
        .filter((i) => i.weekly > 0)
    : [];
  leaks.push({
    key: 'price',
    label: 'Website prices below Lucida',
    short: 'Under-priced',
    team: 'E-commerce',
    weekly: sum(priceItems, (i) => i.weekly),
    count: priceItems.length,
    unit: 'styles',
    basis: 'The gap to Lucida’s price × the pieces live × the pace stock sells online.',
    href: '/stock/web-items?verdict=live_price',
    fix: 'Correct the prices',
    items: top(priceItems),
    off: asked ? undefined : 'Counted once Lucida is connected and asked from Website vs Lucida.',
  });

  // 8. dead stock: off until shop sales are known
  leaks.push({
    key: 'dead',
    label: 'Stock that is not selling',
    short: 'Dead stock',
    team: 'Stock & buying',
    weekly: 0,
    count: 0,
    unit: 'styles',
    basis: 'The cost of holding stock that does not sell (about 25% of its cost a year).',
    href: '/stock/inventory?status=dead',
    fix: 'Mark down or move',
    items: [],
    off: 'Counted once Lucida’s shop sales come in: online alone, a style that sells well in the shops looks dead.',
  });

  const money = sees(p).money;
  const mine = leaks.filter((l) => canAny(p, LEAK_AREAS[l.key]) || p.role === 'brand' || p.role === 'viewer');
  return { leaks: mine, total: sum(mine, (l) => (l.off ? 0 : l.weekly)), money, pace: Object.fromEntries(pace), at: Date.now() };
}

export type MoneyLeaks = Awaited<ReturnType<typeof moneyLeaks>>;
