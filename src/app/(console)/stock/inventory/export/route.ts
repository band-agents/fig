import { type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { stockroom, type StockFilters, type StyleRow } from '@/lib/stock/views/stockroom';
import { viewCurrency } from '@/lib/stock/views/common';
import { VELOCITY_LABEL } from '@/lib/domain/stock/classify';
import { inView } from '@/lib/brands-sheets';
import { moneyDecimals } from '@/lib/sheet';
import { sheetResponse } from '@/lib/sheet-response';

const WORD: Record<string, string> = { in: 'In stock', broken: 'Sizes missing', low: 'Running low', out: 'Out of stock', over: 'Overstock', dead: 'Not selling', new: 'New in' };

/** The stock count sheet: every SKU the filters hold, with its pieces in each place and its bin, then the styles. */
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me || !canSee(me, 'inventory')) return new Response('Not allowed', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const str = (k: string) => sp.get(k) ?? undefined;
  const f: StockFilters = { q: str('q'), market: str('market'), brand: str('brand'), category: str('category'), season: str('season'), location: str('location'), status: str('status'), sort: str('sort'), mode: 'skus', all: true };
  const d = await stockroom(me, f);
  const cur = viewCurrency(me);
  const dec = d.skus.some((z) => moneyDecimals(z.style.currency) === 3) ? 3 : 2;
  const places = f.location ? d.locations.filter((l) => l.id === f.location) : d.locations;
  const price = (r: StyleRow) => (r.price == null ? null : r.price / 10 ** moneyDecimals(r.currency));
  const styles = [...new Map(d.skus.map((z) => [z.style.id, z.style])).values()];
  return sheetResponse(
    [
      {
        name: 'SKUs',
        columns: [
          { key: 'barcode', label: 'Barcode' },
          { key: 'sku', label: 'SKU' },
          { key: 'styleCode', label: 'Style code' },
          { key: 'title', label: 'Style' },
          { key: 'brand', label: 'Brand' },
          { key: 'category', label: 'Category' },
          { key: 'season', label: 'Season' },
          { key: 'market', label: 'Market' },
          { key: 'size', label: 'Size' },
          { key: 'qty', label: f.location ? `Pieces at ${places[0]?.name ?? f.location}` : 'Pieces on hand', kind: 'int' },
          ...(f.location || places.length < 2 ? [] : places.map((l) => ({ key: `at:${l.id}`, label: l.name, kind: 'int' as const }))),
          { key: 'bins', label: 'Bin' },
          { key: 'counted', label: 'Last counted', kind: 'date' },
          { key: 'state', label: 'Status' },
          ...(d.seesMoney ? [{ key: 'currency', label: 'Currency' }, { key: 'price', label: 'Price', kind: 'num' as const, decimals: dec }] : []),
        ],
        rows: d.skus.map((z) => ({
          barcode: z.barcode,
          sku: z.sku,
          styleCode: z.style.styleCode,
          title: z.style.title,
          brand: z.style.brand,
          category: z.style.category,
          season: z.style.season,
          market: z.style.market,
          size: z.size,
          qty: z.qty,
          ...Object.fromEntries(places.map((l) => [`at:${l.id}`, z.places[l.id] ?? null])),
          bins: z.bins,
          counted: z.counted,
          state: z.qty <= 0 ? 'Out of stock' : z.qty <= 2 ? 'Running low' : 'In stock',
          currency: z.style.currency,
          price: price(z.style),
        })),
      },
      {
        name: 'Styles',
        columns: [
          { key: 'styleCode', label: 'Style code' },
          { key: 'title', label: 'Style' },
          { key: 'brand', label: 'Brand' },
          { key: 'category', label: 'Category' },
          { key: 'season', label: 'Season' },
          { key: 'market', label: 'Market' },
          { key: 'skus', label: 'SKUs', kind: 'int' },
          { key: 'skusIn', label: 'SKUs in stock', kind: 'int' },
          { key: 'missing', label: 'Sizes sold out', kind: 'int' },
          { key: 'onHand', label: 'Pieces on hand', kind: 'int' },
          { key: 'warehouse', label: 'In the warehouse', kind: 'int' },
          { key: 'shops', label: 'In the shops', kind: 'int' },
          { key: 'incoming', label: 'Incoming', kind: 'int' },
          { key: 'rate', label: 'Pieces a week (forecast)', kind: 'num', decimals: 1 },
          { key: 'cover', label: 'Weeks of cover', kind: 'num', decimals: 1 },
          { key: 'pace', label: 'Pace' },
          { key: 'state', label: 'Status' },
          ...(d.seesMoney ? [{ key: 'value', label: `Stock at retail (${cur})`, kind: 'num' as const, decimals: moneyDecimals(cur) }] : []),
        ],
        rows: styles.map((r) => ({
          ...r,
          missing: r.skus - r.skusIn,
          cover: Number.isFinite(r.cover) ? r.cover : null,
          pace: VELOCITY_LABEL[r.velocity],
          state: WORD[r.status] ?? r.status,
          value: inView(r.retail, cur),
        })),
      },
    ],
    `inventory-${f.location ?? 'all'}-skus`,
    sp.get('format'),
  );
}
