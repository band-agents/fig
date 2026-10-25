import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { CHANNEL } from '../channels';
import { money } from '../format';

// What the storefronts read: the live placements for one website, shaped for the embed script.
// Public and read-only: titles, pictures and prices the shop already shows, nothing else.

export type PublicPiece = { id: string; title: string; brand: string; image: string | null; price: string; url: string };
export type PublicPlacement = { id: string; kind: string; headline: string; headlineAr: string | null; offer: string | null; items: PublicPiece[] };

const live = sql`${schema.placements.status} = 'live' and (${schema.placements.startsAt} is null or ${schema.placements.startsAt} <= now()) and (${schema.placements.endsAt} is null or ${schema.placements.endsAt} > now())`;

/** Live placements for a storefront, narrowed to the product page the shopper is on. */
export async function placementsFor(channelId: string, page: { product?: string | null }) {
  const ch = CHANNEL[channelId];
  if (!ch) return null;
  const db = await getDb();
  const rows = (await db.select().from(schema.placements).where(and(live, sql`${schema.placements.channels} ? ${channelId}`))).filter((r) => r.market === ch.country);
  const ids = [...new Set(rows.flatMap((r) => [...r.items, ...r.anchors]))];
  if (!ids.length) return { product: null, placements: [] as PublicPlacement[], popup: null as PublicPlacement | null };
  const prods = await db.select().from(schema.products).where(inArray(schema.products.id, ids));
  // the page's product, by its handle or its style code
  const here = page.product ? prods.find((x) => x.handle === page.product || x.styleCode.toLowerCase() === page.product!.toLowerCase()) : undefined;
  const piece = (id: string): PublicPiece | null => {
    const x = prods.find((q) => q.id === id);
    if (!x || x.status !== 'active') return null;
    return { id: x.id, title: x.title, brand: x.brand, image: x.image, price: money(x.price, x.currency), url: x.handle ? `/products/${x.handle}` : '#' };
  };
  const shape = (r: (typeof rows)[number]): PublicPlacement => ({ id: r.id, kind: r.kind, headline: r.headline, headlineAr: r.headlineAr, offer: r.offer, items: r.items.map(piece).filter((x): x is PublicPiece => Boolean(x)).slice(0, 4) });
  const onPage = here ? rows.filter((r) => r.kind !== 'popup' && r.anchors.includes(here.id) && !r.items.includes(here.id)).map(shape).filter((p) => p.items.length) : [];
  const popup = rows.filter((r) => r.kind === 'popup').map(shape).find((p) => p.items.length) ?? null;
  return { product: here ? { id: here.id, title: here.title } : null, placements: onPage, popup };
}

const COLS = { view: 'impressions', click: 'clicks', add: 'adds' } as const;

/** One shopper event against a live placement: counted per day, nothing about the shopper kept. */
export async function track(placementId: string, event: keyof typeof COLS, channelId: string) {
  const db = await getDb();
  const [pl] = await db.select({ id: schema.placements.id, channels: schema.placements.channels }).from(schema.placements).where(and(eq(schema.placements.id, placementId), live));
  if (!pl || !pl.channels.includes(channelId)) return false;
  const col = sql.raw(COLS[event]);
  await db.execute(sql`
    insert into placement_daily (placement_id, day, ${col}) values (${placementId}, (now() at time zone 'Asia/Kuwait')::date, 1)
    on conflict (placement_id, day) do update set ${col} = placement_daily.${col} + 1`);
  return true;
}

/** Records that a storefront's embed is alive, at most once a minute per storefront. */
const lastPing = new Map<string, number>();
export async function seen(channelId: string) {
  if (!CHANNEL[channelId] || Date.now() - (lastPing.get(channelId) ?? 0) < 60_000) return;
  lastPing.set(channelId, Date.now());
  const db = await getDb();
  await db.execute(sql`
    insert into settings (key, value) values ('merch.seen', jsonb_build_object(${channelId}::text, ${new Date().toISOString()}::text))
    on conflict (key) do update set value = settings.value || excluded.value, updated_at = now()`);
}
