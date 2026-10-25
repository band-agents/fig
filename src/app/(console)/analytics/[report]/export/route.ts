import { currentUser } from '@/lib/auth/session';
import { mayOpen, reportById, resultSheets, runReport, type Query } from '@/lib/reports';
import { sheetResponse } from '@/lib/sheet-response';

/** Any report as Excel or CSV, for the same filters as the page: every row and every column. */
export async function GET(req: Request, ctx: RouteContext<'/analytics/[report]/export'>) {
  const me = await currentUser();
  const { report } = await ctx.params;
  const r = reportById(report);
  if (!me || !r || !mayOpen(me, r)) return new Response('Not allowed', { status: 403 });
  const u = new URL(req.url).searchParams;
  const get = (k: string) => u.get(k)?.trim() || undefined;
  const q: Query = { period: get('period'), from: get('from'), to: get('to'), compare: get('compare'), brand: get('brand'), channel: get('channel'), category: get('category'), branch: get('branch') };
  const { ctx: c, result } = await runReport(me, r, q);
  // the file name carries today's date already; a period report adds which period
  const when = r.snapshot ? '' : `-${c.range.preset === 'custom' ? `${q.from}-to-${q.to}` : c.range.label.toLowerCase().replace(/\s+/g, '-')}`;
  const sheets = resultSheets(r, c, result);
  // a CSV holds one sheet: the report's main table, not its summary
  const ordered = u.get('format') === 'csv' && sheets.length > 1 ? [...sheets.slice(1), sheets[0]] : sheets;
  return sheetResponse(ordered, `${r.id}${q.brand ? `-${q.brand}` : ''}${when}`, u.get('format'));
}
