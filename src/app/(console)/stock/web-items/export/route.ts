import { type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { webItemsView } from '@/lib/web-items';
import { REASONS, VERDICTS } from '@/lib/domain/web-gap';
import { toMajor } from '@/lib/format';
import { moneyDecimals } from '@/lib/sheet';
import { sheetResponse } from '@/lib/sheet-response';

/** The styles the page lists, for the merchandisers and D&H: what is wrong with each and why. Excel or CSV. */
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me || !canSee(me, 'webItems')) return new Response('Not allowed', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const d = await webItemsView(me, { store: sp.get('store') ?? undefined, group: sp.get('group') ?? undefined, verdict: sp.get('verdict') ?? undefined, reason: sp.get('reason') ?? undefined, brand: sp.get('brand') ?? undefined, q: sp.get('q') ?? undefined });
  if (d.empty || !d.store) return new Response('No store', { status: 404 });
  const cur = d.store.currency;
  const dec = moneyDecimals(cur);
  return sheetResponse(
    [
      {
        name: 'Website vs Lucida',
        columns: [
          { key: 'title', label: 'Style' },
          { key: 'handle', label: 'Handle' },
          { key: 'brand', label: 'Brand' },
          { key: 'sizes', label: 'Sizes', kind: 'int' },
          { key: 'status', label: 'On the website' },
          { key: 'webQty', label: 'Website stock', kind: 'int' },
          { key: 'lucidaQty', label: 'Lucida stock', kind: 'int' },
          { key: 'price', label: `Price (${cur})`, kind: 'num', decimals: dec },
          { key: 'lucidaPrice', label: `Lucida price (${cur})`, kind: 'num', decimals: dec },
          { key: 'verdict', label: 'Verdict' },
          { key: 'reasons', label: 'Reasons' },
        ],
        rows: d.allRows.map((x) => ({
          title: x.title,
          handle: x.handle ?? '',
          brand: x.brand ?? '',
          sizes: x.sizes,
          status: x.status,
          webQty: x.status === 'absent' ? null : x.webQty,
          lucidaQty: x.lucidaQty ?? 'not asked',
          price: x.price ? toMajor(x.price, cur) : null,
          lucidaPrice: x.lucidaPrice ? toMajor(x.lucidaPrice, cur) : null,
          verdict: VERDICTS[x.verdict].label,
          reasons: x.reasons.map((r) => REASONS[r]).join('; '),
        })),
      },
    ],
    `website-vs-lucida-${d.store.id}`,
    sp.get('format'),
  );
}
