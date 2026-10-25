import 'server-only';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { seesBrand, type Principal } from '../../domain/perms';
import { MERCH_LABEL, MERCH_WHERE, type MerchKind } from '../../domain/stock/merch';
import { CHANNELS, channelLabel } from '../../channels';
import { money } from '../../format';
import { marketsFor, sees } from './common';
import { openRecs } from './recs';

export async function merchBoard(p: Principal) {
  const db = await getDb();
  const s = sees(p);
  const markets = marketsFor(p);
  const [rows, stats, seen] = await Promise.all([
    db.select().from(schema.placements).where(inArray(schema.placements.market, markets)).orderBy(desc(schema.placements.createdAt)),
    db.execute<{ placement_id: string; day: string; impressions: number; clicks: number; adds: number; orders: number; revenue: number }>(sql`
      select placement_id, day::text as day, impressions, clicks, adds, orders, revenue from placement_daily where day > now() - interval '45 days' order by day`),
    db.select().from(schema.settings).where(eq(schema.settings.key, 'merch.seen')),
  ]);
  const ids = [...new Set(rows.flatMap((r) => [...r.items, ...r.anchors]))];
  const prods = ids.length ? await db.select().from(schema.products).where(inArray(schema.products.id, ids)) : [];
  const piece = (id: string) => {
    const x = prods.find((q) => q.id === id);
    return x ? { id: x.id, title: x.title, brand: x.brand, image: x.image, price: money(x.price, x.currency) } : null;
  };
  // someone limited to brands sees the placements that push one of their styles
  const mine = p.brands?.length ? rows.filter((r) => [...r.items, ...r.anchors].some((id) => seesBrand(p, prods.find((q) => q.id === id)?.brand))) : rows;
  const placements = mine.map((r) => {
    const days = stats.rows.filter((x) => x.placement_id === r.id);
    const sum = (k: 'impressions' | 'clicks' | 'adds' | 'orders' | 'revenue') => days.reduce((a, x) => a + Number(x[k]), 0);
    const impressions = sum('impressions');
    const clicks = sum('clicks');
    const adds = sum('adds');
    return {
      id: r.id,
      number: r.number,
      kind: r.kind as MerchKind,
      kindLabel: MERCH_LABEL[r.kind as MerchKind] ?? r.kind,
      where: MERCH_WHERE[r.kind as MerchKind] ?? '',
      status: r.status,
      market: r.market,
      channels: r.channels.map((c) => ({ id: c, label: channelLabel(c) })),
      headline: r.headline,
      headlineAr: r.headlineAr,
      offer: r.offer,
      items: r.items.map(piece).filter((x): x is NonNullable<ReturnType<typeof piece>> => Boolean(x)),
      anchors: r.anchors.map(piece).filter((x): x is NonNullable<ReturnType<typeof piece>> => Boolean(x)),
      startsAt: r.startsAt?.toISOString() ?? null,
      endsAt: r.endsAt?.toISOString() ?? null,
      approvedByName: r.approvedByName,
      createdByName: r.createdByName,
      stats: {
        impressions,
        clicks,
        adds,
        orders: sum('orders'),
        revenue: s.money ? sum('revenue') : null,
        ctr: impressions ? clicks / impressions : null,
        addRate: clicks ? adds / clicks : null,
        spark: days.slice(-21).map((x) => x.clicks),
      },
    };
  });
  const live = placements.filter((x) => x.status === 'live');
  const lastSeen = (seen[0]?.value ?? {}) as Record<string, string>;
  return {
    proposals: await openRecs(p, { areas: ['merch'] }),
    placements,
    kpi: {
      live: live.length,
      impressions: live.reduce((a, x) => a + x.stats.impressions, 0),
      clicks: live.reduce((a, x) => a + x.stats.clicks, 0),
      orders: placements.reduce((a, x) => a + x.stats.orders, 0),
      revenue: s.money ? placements.reduce((a, x) => a + (x.stats.revenue ?? 0), 0) : null,
    },
    storefronts: CHANNELS.filter((c) => !c.parked && markets.includes(c.country as 'EG' | 'KW')).map((c) => ({ id: c.id, label: channelLabel(c.id), platform: c.platform, surface: c.surface, lastSeen: lastSeen[c.id] ?? null })),
    publishLevel: s.manage('merch') ? 3 : s.act('merch') ? 2 : 1,
    seesMoney: s.money,
  };
}
