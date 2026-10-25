import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import type { Principal } from '../../domain/perms';
import type { Reason } from '../../db/schema';
import { factsFor, getFacts } from '../facts';
import { marketsFor, sees } from './common';
import { money } from '../../format';
import { CATEGORY_LABEL } from '../../domain/stock/categories';

export type Piece = { id: string; title: string; brand: string; image: string | null; price: string; category: string };

export type RecView = {
  id: string;
  kind: string;
  area: string;
  market: string;
  title: string;
  body: string;
  reasons: Reason[];
  impact: number;
  impactLabel: string | null;
  confidence: number;
  priority: number;
  createdAt: string;
  canAct: boolean;
  product: { id: string; title: string; image: string | null; brand: string } | null;
  images: string[]; // the pieces involved, for the card
  items: Piece[]; // what a placement shows
  anchors: Piece[]; // the pages it shows on
  payload: Record<string, unknown>;
};

/** Open proposals this person may see, most urgent and most valuable first. */
export async function openRecs(p: Principal, o: { areas?: string[]; kinds?: string[]; limit?: number } = {}): Promise<RecView[]> {
  const db = await getDb();
  const s = sees(p);
  const markets = marketsFor(p);
  const areas = (o.areas ?? ['procurement', 'stock', 'warehouse', 'merch']).filter((a) => s.view(a as never));
  if (!areas.length) return [];
  const rows = await db
    .select()
    .from(schema.recommendations)
    .where(and(eq(schema.recommendations.status, 'open'), inArray(schema.recommendations.area, areas), inArray(schema.recommendations.market, markets), ...(o.kinds?.length ? [inArray(schema.recommendations.kind, o.kinds)] : [])))
    .orderBy(asc(schema.recommendations.priority), desc(schema.recommendations.impact))
    .limit(o.limit ?? 400);
  const f = factsFor(await getFacts(), p);
  // someone limited to brands sees the proposals about their styles only
  const mine = p.brands?.length ? rows.filter((r) => (r.productId ? f.byId.has(r.productId) : ((r.payload as { lines?: { productId: string }[] }).lines ?? []).some((l) => f.byId.has(l.productId)))) : rows;
  return mine.map((r) => {
    const p0 = r.productId ? f.byId.get(r.productId) : undefined;
    const pl = r.payload as Record<string, unknown>;
    const ids = [...((pl.items as string[]) ?? []), ...((pl.anchors as string[]) ?? []), ...((pl.lines as { productId: string }[]) ?? []).map((l) => l.productId), ...((pl.products as string[]) ?? [])];
    const piece = (id: string): Piece | null => {
      const x = f.byId.get(id);
      return x ? { id: x.id, title: x.title, brand: x.brand, image: x.image, price: money(x.price, x.currency), category: CATEGORY_LABEL[x.category] } : null;
    };
    const images = [...new Set([p0?.image, ...ids.map((id) => f.byId.get(id)?.image)].filter((x): x is string => Boolean(x)))].slice(0, 5);
    return {
      id: r.id,
      kind: r.kind,
      area: r.area,
      market: r.market,
      title: r.title,
      body: r.body,
      reasons: r.reasons,
      impact: s.money ? r.impact : 0,
      impactLabel: s.money ? r.impactLabel : null,
      confidence: r.confidence,
      priority: r.priority,
      createdAt: r.createdAt.toISOString(),
      canAct: s.act(r.area as never),
      product: p0 ? { id: p0.id, title: p0.title, image: p0.image, brand: p0.brand } : null,
      images,
      items: ((pl.items as string[]) ?? []).map(piece).filter((x): x is Piece => Boolean(x)),
      anchors: ((pl.anchors as string[]) ?? []).map(piece).filter((x): x is Piece => Boolean(x)),
      payload: s.cost ? pl : { ...pl, unitCost: undefined },
    };
  });
}
