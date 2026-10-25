import { type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { listOrders, type OrderFilters } from '@/lib/order-query';
import { channelLabel } from '@/lib/channels';
import { ORDER_STAGE, type OrderStage } from '@/lib/domain/stages';
import { moneyDecimals } from '@/lib/sheet';
import { sheetResponse } from '@/lib/sheet-response';

const MAX = 20_000;

/**
 * Every order the list holds for these filters, as the person may see them (names, phones and money
 * are masked by listOrders exactly as on the page): one sheet of orders and one of their lines.
 */
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me || !canSee(me, 'orders')) return new Response('Not allowed', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const str = (k: string) => sp.get(k) ?? undefined;
  const f: OrderFilters = { view: str('view') ?? 'open', q: str('q'), channel: str('channel'), stage: str('stage'), pay: str('pay'), risk: str('risk'), sla: str('sla'), sort: str('sort'), from: str('from') };
  const rows: Awaited<ReturnType<typeof listOrders>>['rows'] = [];
  for (let page = 1; rows.length < MAX; page++) {
    const r = await listOrders(me, { ...f, page, limit: 200 });
    rows.push(...r.rows);
    if (r.rows.length < r.limit || rows.length >= r.total) break;
  }
  const money = rows.some((r) => r.total != null);
  const dec = rows.some((r) => moneyDecimals(r.currency) === 3) ? 3 : 2;
  const major = (v: number | null, cur: string) => (v == null ? null : v / 10 ** moneyDecimals(cur));
  return sheetResponse(
    [
      {
        name: 'Orders',
        columns: [
          { key: 'number', label: 'Order' },
          { key: 'store', label: 'Store' },
          { key: 'placed', label: 'Placed', kind: 'date' },
          { key: 'customer', label: 'Customer' },
          { key: 'phone', label: 'Phone' },
          { key: 'city', label: 'City' },
          { key: 'stage', label: 'Stage' },
          { key: 'due', label: 'Due', kind: 'date' },
          { key: 'held', label: 'On hold' },
          { key: 'items', label: 'Pieces', kind: 'int' },
          ...(money ? [{ key: 'currency', label: 'Currency' }, { key: 'total', label: 'Total', kind: 'num' as const, decimals: dec }] : []),
          { key: 'payment', label: 'Payment' },
          { key: 'paid', label: 'Payment status' },
          { key: 'shipFrom', label: 'Ships from' },
          { key: 'courier', label: 'Courier' },
          { key: 'tracking', label: 'Tracking' },
          { key: 'risk', label: 'Risk' },
          { key: 'assignee', label: 'Assigned to' },
        ],
        rows: rows.map((r) => ({
          number: r.number,
          store: channelLabel(r.channelId),
          placed: r.placedAt,
          customer: r.customer,
          phone: r.phone,
          city: r.city,
          stage: ORDER_STAGE[r.stage as OrderStage]?.label ?? r.stage,
          due: r.dueAt,
          held: r.onHold ? r.holdReason || 'yes' : '',
          items: r.items,
          currency: r.currency,
          total: major(r.total, r.currency),
          payment: r.paymentMethod,
          paid: r.paymentStatus,
          shipFrom: r.shipFrom,
          courier: r.courier,
          tracking: r.tracking,
          risk: r.riskLevel,
          assignee: r.assignee,
        })),
      },
      {
        name: 'Lines',
        columns: [
          { key: 'number', label: 'Order' },
          { key: 'title', label: 'Item' },
          { key: 'brand', label: 'Brand' },
          { key: 'size', label: 'Size' },
          { key: 'sku', label: 'SKU' },
          { key: 'barcode', label: 'Barcode' },
          { key: 'quantity', label: 'Quantity', kind: 'int' },
        ],
        rows: rows.flatMap((r) => r.lines.map((l) => ({ number: r.number, title: l.title, brand: l.brand, size: l.size, sku: l.sku, barcode: l.barcode, quantity: l.quantity }))),
      },
    ],
    `orders-${f.view}`,
    sp.get('format'),
  );
}
