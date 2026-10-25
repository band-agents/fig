import { type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { financials, PERIODS } from '@/lib/financials';
import { inView } from '@/lib/brands-sheets';
import { moneyDecimals, type Col } from '@/lib/sheet';
import { sheetResponse } from '@/lib/sheet-response';

/**
 * Finance & analysis for the accountants: an Excel workbook with one sheet per table (the totals,
 * margin by brand, sales by place and store, suppliers owed, courier cash), or the totals as CSV.
 */
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me || !canSee(me, 'financials')) return new Response('Not allowed', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const d = await financials(me, { period: sp.get('period') ?? undefined, market: sp.get('market') ?? undefined });
  const c = d.currency;
  const out = (v: number | null) => inView(v, c);
  const m = (key: string, label: string): Col => ({ key, label: `${label} (${c})`, kind: 'num', decimals: moneyDecimals(c) });
  const period = PERIODS.find((p) => p.key === d.period)?.label ?? d.period;
  const k = d.kpi;
  const summary = [
    ['Period', period],
    ['Markets', d.markets.join(' + ')],
    ['Currency', `${c}${c === 'EGP' && d.markets.length > 1 ? ' (equivalent)' : ''}`],
    ['Net sales', out(k.netSales)],
    ['Cost of goods', out(k.cogs)],
    ['Gross margin', out(k.grossMargin)],
    ['Gross margin %', k.marginPct],
    ['Pieces sold', k.units],
    ['Online orders', k.orders],
    ['Average online order', out(k.aov)],
    ['Discounts given', out(k.discounts)],
    ['Shipping charged', out(k.shipping)],
    ['Refunds paid', out(k.refunded)],
    ['Refused cash orders', out(k.refused)],
    ['Paid online', out(k.paidOnline)],
    ['With the courier (today)', out(d.cash.withCourier)],
    ['Still to collect (today)', out(d.cash.toCollect)],
    ['Refunds owed (today)', out(d.cash.refundsOwed)],
    ['Owed to suppliers (today)', out(d.cash.supplierOpen)],
    ['Stock at cost (today)', out(d.cash.stockCost)],
    ['Stock at retail (today)', out(d.cash.stockRetail)],
  ].map(([label, value]) => ({ label, value }));

  return sheetResponse(
    [
      { name: 'Summary', columns: [{ key: 'label', label: 'Figure' }, { key: 'value', label: 'Value', kind: 'num', decimals: moneyDecimals(c) }], rows: summary },
      {
        name: 'Margin by brand',
        columns: [{ key: 'brand', label: 'Brand' }, m('revenue', 'Net sales'), { key: 'share', label: 'Share', kind: 'pct' }, { key: 'units', label: 'Pieces', kind: 'int' }, m('cost', 'Cost'), m('margin', 'Margin'), { key: 'marginPct', label: 'Margin %', kind: 'pct' }, { key: 'mdShare', label: 'On markdown', kind: 'pct' }],
        rows: d.brands.map((b) => ({ brand: b.brand, revenue: out(b.revenue), share: b.share, units: b.units, cost: out(b.cost), margin: out(b.margin), marginPct: b.marginPct, mdShare: b.mdShare })),
      },
      { name: 'Sales by place', columns: [{ key: 'label', label: 'Place' }, m('revenue', 'Sales'), { key: 'units', label: 'Pieces', kind: 'int' }], rows: d.places.map((x) => ({ label: x.label, revenue: out(x.revenue), units: x.units })) },
      { name: 'Online stores', columns: [{ key: 'label', label: 'Store' }, { key: 'count', label: 'Orders', kind: 'int' }, m('total', 'Order value')], rows: d.channels.map((x) => ({ label: x.label, count: x.count, total: out(x.total) })) },
      {
        name: 'Months',
        columns: [{ key: 'label', label: 'Month' }, m('thisYear', 'Sales this year'), m('lastYear', 'Sales last year'), { key: 'unitsThisYear', label: 'Pieces this year', kind: 'int' }, { key: 'unitsLastYear', label: 'Pieces last year', kind: 'int' }],
        rows: d.months.map((x) => ({ label: x.label, thisYear: out(x.thisYear), lastYear: out(x.lastYear), unitsThisYear: x.unitsThisYear, unitsLastYear: x.unitsLastYear })),
      },
      { name: 'Suppliers owed', columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'terms', label: 'Terms' }, { key: 'orders', label: 'Open orders', kind: 'int' }, m('due30', 'Next 30 days'), m('total', 'Open')], rows: d.payables.map((x) => ({ supplier: x.supplier, terms: x.terms ?? '', orders: x.orders, due30: out(x.due30), total: out(x.total) })) },
      { name: 'Courier cash', columns: [{ key: 'courier', label: 'Courier' }, { key: 'reference', label: 'Remittance' }, { key: 'status', label: 'Status' }, { key: 'orders', label: 'Orders', kind: 'int' }, m('expected', 'Expected'), m('gap', 'Short by')], rows: d.settlements.map((x) => ({ courier: x.courier, reference: x.reference, status: x.status, orders: x.orders, expected: out(x.expected), gap: out(x.gap) })) },
    ],
    `finance-${d.period}-${d.markets.join('-').toLowerCase()}`,
    sp.get('format'),
  );
}
