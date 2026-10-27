import { currentUser } from '@/lib/auth/session';
import { CHANNEL } from '@/lib/channels';
import { adminUrl, getJob, type ImportPlan, type JobResult } from '@/lib/catalog/jobs';
import { planRows, resultsSheet } from '@/lib/catalog/sheets';
import { sheetResponse } from '@/lib/sheet-response';

/** An import's results (Import Result and Import Comment per product per store), or its dry run before it ran. */
export async function GET(req: Request, ctx: RouteContext<'/catalog/[id]/results'>) {
  const me = await currentUser();
  if (!me) return new Response('Signed out', { status: 401 });
  const job = await getJob(me, (await ctx.params).id).catch(() => null);
  if (!job) return new Response('Not found', { status: 404 });
  const name = (id: string) => CHANNEL[id]?.name ?? id;
  const link = (store: string, id?: string) => (CHANNEL[store] ? adminUrl(CHANNEL[store], id) : undefined);
  const results = job.results as JobResult[];
  const base = (job.fileName ?? 'import').replace(/\.(xlsx|csv)$/i, '');
  const format = new URL(req.url).searchParams.get('format');
  if (results.length) {
    const rows = results.map((r) => ({ handle: r.handle, title: r.title, store: r.store, storeName: name(r.store), action: r.action, result: r.result, message: r.message, productId: r.productId, adminUrl: link(r.store, r.productId), lines: r.lines }));
    return sheetResponse([resultsSheet(rows)], `${base}-results`, format);
  }
  const plan = job.plan as unknown as ImportPlan | null;
  if (!plan) return new Response('Not checked yet', { status: 404 });
  const rows = planRows(
    Object.values(plan.stores).flatMap((s) => s.items),
    name,
  ).map((r) => ({ ...r, adminUrl: link(r.store, r.productId) }));
  return sheetResponse([resultsSheet(rows)], `${base}-dry-run`, format);
}
