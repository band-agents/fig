// The demo catalogue, shared by the order simulation (demo.ts) and the stock world (stock.ts) so the
// website orders of the last month and two years of stock history tell the same story: the styles
// that sell online are the ones the planner sees selling.
import catalog from './catalog.json';
import { categorize, priorIndex, type Category } from '../lib/domain/stock/categories';

export type CatalogItem = { title: string; brand: string; type: string; tags: string[]; price: number; compareAt: number | null; currency: string; sku: string; sizes: string[]; image: string | null };

const fig = (catalog as { fig: CatalogItem[] }).fig;
const wsEg = (catalog as { wsEg: CatalogItem[] }).wsEg;
const labesny = (catalog as { labesny: CatalogItem[] }).labesny;
const wsKw: CatalogItem[] = wsEg.map((p) => ({ ...p, currency: 'KWD', price: Math.max(2, Math.round((p.price / 158) * 4) / 4), compareAt: p.compareAt ? Math.round((p.compareAt / 158) * 4) / 4 : null }));

export const CATALOG = { fig, wsEg, labesny, wsKw };

/** Which catalogue each website sells. */
export const POOL: Record<string, CatalogItem[]> = { 'fig-web': fig, 'fig-app': fig, 'ws-eg': wsEg, 'labesny-web': labesny, 'labesny-app': labesny, 'ws-kw': wsKw };

/** The catalogues as the stock world sees them: one market, one company, the websites that sell it. */
export const SOURCES: { key: keyof typeof CATALOG; market: 'EG' | 'KW'; channels: string[] }[] = [
  { key: 'fig', market: 'EG', channels: ['fig-web', 'fig-app'] },
  { key: 'wsEg', market: 'EG', channels: ['ws-eg'] },
  { key: 'labesny', market: 'KW', channels: ['labesny-web', 'labesny-app'] },
  { key: 'wsKw', market: 'KW', channels: ['ws-kw'] },
];

/** A stable number in [0, 1) for a string: the same style always gets the same draw. */
export function hash(s: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const normal = (s: string, salt: number) => {
  const u = Math.max(1e-9, hash(s, salt));
  const v = hash(s, salt + 7);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** How much a style sells relative to its catalogue: a long tail, as fashion does. Mean ≈ 1. */
export const popularity = (styleKey: string) => Math.exp(0.85 * normal(styleKey, 11) - 0.36);

export const categoryOf = (p: CatalogItem): Category => categorize(p.title.replace(/&amp;/g, '&'), p.tags, p.type);

export type Season = { season: string; launched: string };

/** Core lines have sold for years; AW and SS lines arrive each season, with last year's twin before them. */
export function seasonOf(p: CatalogItem, market: 'EG' | 'KW'): Season {
  const c = categoryOf(p);
  const tags = p.tags.join(' ');
  const h = hash(`${market}:${p.sku}`, 3);
  const aw = /autumn\/winter/i.test(tags) || ((c === 'nightwear' || c === 'outerwear' || c === 'knitwear') && h < 0.6);
  const ss = /spring\/summer/i.test(tags) || c === 'swimwear' || ((c === 'dresses' || c === 'tops') && h < 0.22);
  const day = (from: string, span: number) => new Date(Date.parse(`${from}T00:00:00Z`) + Math.floor(hash(p.sku, 5) * span) * 86_400_000).toISOString().slice(0, 10);
  if (aw) return { season: 'AW26', launched: day('2026-08-16', 42) };
  if (ss) return { season: 'SS26', launched: day('2026-02-15', 49) };
  return { season: 'core', launched: '2023-09-01' };
}

/**
 * What a style sells on a website this month, relative to the others: popularity, the month's
 * season for its category, and whether it is on sale yet. The order simulation picks baskets by it.
 */
export function webWeight(p: CatalogItem, market: 'EG' | 'KW', at: Date): number {
  const s = seasonOf(p, market);
  if (Date.parse(s.launched) > at.getTime()) return 0.02;
  const c = categoryOf(p);
  const month = at.getUTCMonth();
  const idx = priorIndex(market, c)[month];
  const weeksLive = (at.getTime() - Date.parse(s.launched)) / (7 * 86_400_000);
  const ramp = weeksLive < 2 ? 0.7 : 1;
  return popularity(`${market}:${p.sku}`) * idx * ramp * (isDead(p, market) ? 0.03 : 1);
}

/** A few styles that simply stopped selling: what the planner should find and clear. */
export const isDead = (p: CatalogItem, market: 'EG' | 'KW') => {
  const c = categoryOf(p);
  return (c === 'bags' || c === 'menswear' || c === 'accessories') && hash(`${market}:${p.sku}`, 41) < 0.28;
};
