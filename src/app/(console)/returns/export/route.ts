import { type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { listReturns } from '@/lib/return-query';
import { channelLabel } from '@/lib/channels';
import { RETURN_STAGE, type ReturnStage } from '@/lib/domain/stages';
import { moneyDecimals } from '@/lib/sheet';
import { sheetResponse } from '@/lib/sheet-response';

const MAX = 20_000;

/** Every return in this view, masked as the page masks it: one sheet of returns and one of their pieces. */
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me || !canSee(me, 'returns')) return new Response('Not allowed', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const view = sp.get('view') ?? 'open';
  const q = sp.get('q') ?? undefined;
  const rows: Awaited<ReturnType<typeof listReturns>>['rows'] = [];
  for (let page = 1; rows.length < MAX; page++) {
    const r = await listReturns(me, { view, q, page, limit: 200 });
    rows.push(...r.rows);
    if (r.rows.length < r.limit || rows.length >= r.total) break;
  }
  const money = rows.some((r) => r.amount != null);
  const dec = rows.some((r) => moneyDecimals(r.currency) === 3) ? 3 : 2;
  return sheetResponse(
    [
      {
        name: 'Returns',
        columns: [
          { key: 'number', label: 'Return' },
          { key: 'order', label: 'Order' },
          { key: 'store', label: 'Store' },
          { key: 'requested', label: 'Requested', kind: 'date' },
          { key: 'customer', label: 'Customer' },
          { key: 'phone', label: 'Phone' },
          { key: 'city', label: 'City' },
          { key: 'reason', label: 'Reason' },
          { key: 'note', label: 'Customer note' },
          { key: 'resolution', label: 'Resolution' },
          { key: 'refundMethod', label: 'Refund to' },
          ...(money ? [{ key: 'currency', label: 'Currency' }, { key: 'amount', label: 'Amount', kind: 'num' as const, decimals: dec }] : []),
          { key: 'stage', label: 'Stage' },
          { key: 'due', label: 'Due', kind: 'date' },
          { key: 'tracking', label: 'Tracking' },
          { key: 'photos', label: 'Photos', kind: 'int' },
          { key: 'pieces', label: 'Pieces', kind: 'int' },
        ],
        rows: rows.map((r) => ({
          number: r.number,
          order: r.orderNumber,
          store: channelLabel(r.channelId),
          requested: r.requestedAt,
          customer: r.customer,
          phone: r.phone,
          city: r.city,
          reason: r.reason,
          note: r.reasonNote,
          resolution: r.resolution,
          refundMethod: r.refundMethod,
          currency: r.currency,
          amount: r.amount == null ? null : r.amount / 10 ** moneyDecimals(r.currency),
          stage: RETURN_STAGE[r.stage as ReturnStage]?.label ?? r.stage,
          due: r.dueAt,
          tracking: r.tracking,
          photos: r.photos,
          pieces: r.items.reduce((a, i) => a + (i.quantity ?? 0), 0),
        })),
      },
      {
        name: 'Pieces',
        columns: [{ key: 'number', label: 'Return' }, { key: 'title', label: 'Item' }, { key: 'brand', label: 'Brand' }, { key: 'size', label: 'Size' }, { key: 'quantity', label: 'Quantity', kind: 'int' }],
        rows: rows.flatMap((r) => r.items.map((i) => ({ number: r.number, title: i.title, brand: i.brand, size: i.size, quantity: i.quantity }))),
      },
    ],
    `returns-${view}`,
    sp.get('format'),
  );
}
