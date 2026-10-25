import { type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { inventoryList, type InvFilters } from '@/lib/stock/views/inventory';
import { viewCurrency } from '@/lib/stock/views/common';
import { VELOCITY_LABEL } from '@/lib/domain/stock/classify';
import { inView } from '@/lib/brands-sheets';
import { moneyDecimals } from '@/lib/sheet';
import { sheetResponse } from '@/lib/sheet-response';

/** Every style the inventory list holds for these filters, not just the page on screen. */
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me || !canSee(me, 'inventory')) return new Response('Not allowed', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const str = (k: string) => sp.get(k) ?? undefined;
  const f: InvFilters = { q: str('q'), market: str('market'), company: str('company'), brand: str('brand'), category: str('category'), velocity: str('velocity'), view: str('view'), location: str('location'), sort: str('sort'), all: true };
  const d = await inventoryList(me, f);
  const cur = viewCurrency(me);
  const dec = d.rows.some((r) => moneyDecimals(r.currency) === 3) ? 3 : 2;
  return sheetResponse(
    [
      {
        name: 'Inventory',
        columns: [
          { key: 'title', label: 'Style' },
          { key: 'styleCode', label: 'Style code' },
          { key: 'brand', label: 'Brand' },
          { key: 'category', label: 'Category' },
          { key: 'season', label: 'Season' },
          { key: 'market', label: 'Market' },
          { key: 'company', label: 'Company' },
          ...(d.seesMoney ? [{ key: 'currency', label: 'Currency' }, { key: 'price', label: 'Price', kind: 'num' as const, decimals: dec }] : []),
          { key: 'onHand', label: 'Pieces on hand', kind: 'int' },
          { key: 'warehouse', label: 'In the warehouse', kind: 'int' },
          { key: 'shops', label: 'In the shops', kind: 'int' },
          { key: 'places', label: 'Places holding it', kind: 'int' },
          { key: 'rate', label: 'Pieces a week (forecast)', kind: 'num', decimals: 1 },
          { key: 'cover', label: 'Weeks of cover', kind: 'num', decimals: 1 },
          { key: 'stockout', label: 'Runs out', kind: 'date' },
          { key: 'sellThrough', label: 'Sell-through, 8 weeks', kind: 'pct' },
          { key: 'pace', label: 'Pace' },
          { key: 'abc', label: 'ABC' },
          { key: 'onOrder', label: 'On order', kind: 'int' },
          { key: 'inDraft', label: 'In draft orders', kind: 'int' },
          ...(d.seesMoney ? [{ key: 'value', label: `Stock at retail (${cur})`, kind: 'num' as const, decimals: moneyDecimals(cur) }] : []),
          { key: 'next', label: 'Next step' },
        ],
        rows: d.rows.map((r) => ({
          ...r,
          price: r.priceMinor == null ? null : r.priceMinor / 10 ** moneyDecimals(r.currency),
          cover: Number.isFinite(r.cover) ? r.cover : null,
          pace: VELOCITY_LABEL[r.velocity],
          value: inView(r.value, cur),
        })),
      },
    ],
    `inventory-${f.view ?? 'all'}`,
    sp.get('format'),
  );
}
