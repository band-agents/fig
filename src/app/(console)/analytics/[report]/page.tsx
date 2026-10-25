import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can } from '@/lib/domain/perms';
import { filterOptions, GROUPS, mayOpen, PRESETS, reportById, runReport, type Query } from '@/lib/reports';
import { branchReadCost } from '@/lib/branch-stock';
import { lucidaConfigured } from '@/lib/connectors/lucida';
import { marketsFor } from '@/lib/stock/views/common';
import type { Market } from '@/lib/domain/stock/calendar';
import { PageHeader } from '@/components/ui/bits';
import { ExportButton } from '@/components/ui/export-button';
import { ReportFilters } from '@/components/analytics/filters';
import { ReportResult } from '@/components/analytics/result';
import { ReadBranches } from '@/components/analytics/read-branches';

const one = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export async function generateMetadata(props: PageProps<'/analytics/[report]'>) {
  const { report } = await props.params;
  return { title: reportById(report)?.title ?? 'Report' };
}

export default async function ReportPage(props: PageProps<'/analytics/[report]'>) {
  const me = await requireUser();
  const { report } = await props.params;
  const r = reportById(report);
  if (!r) notFound();
  if (!mayOpen(me, r)) sendHome(me);
  const sp = await props.searchParams;
  const q: Query = { period: one(sp.period), from: one(sp.from), to: one(sp.to), compare: one(sp.compare), brand: one(sp.brand), channel: one(sp.channel), category: one(sp.category), branch: one(sp.branch) };
  const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const [{ ctx, result }, opts] = await Promise.all([runReport(me, r, q), filterOptions(me, r)]);
  const group = GROUPS.find((g) => g.key === r.group);
  const exportHref = `/analytics/${r.id}/export${qs ? `?${qs}` : ''}`;
  const branchRead = r.id === 'stock-by-branch' && lucidaConfigured() && (me.role === 'admin' || can(me, 'stock', 2) || can(me, 'overview', 1)) ? await branchReadCost(marketsFor(me) as Market[]) : null;
  const lists = [
    ...(r.filters.includes('channel') && opts.channels.length > 1 ? [{ key: 'channel' as const, label: 'Stores', options: opts.channels.map((c) => ({ value: c.id, label: c.label })) }] : []),
    ...(r.filters.includes('brand') && (opts.brands.length > 1 || q.brand) ? [{ key: 'brand' as const, label: 'Brands', options: opts.brands.map((b) => ({ value: b, label: b })) }] : []),
    ...(r.filters.includes('category') && opts.categories.length > 1 ? [{ key: 'category' as const, label: 'Categories', options: opts.categories.map((c) => ({ value: c, label: c })) }] : []),
    ...(r.filters.includes('branch') && opts.branches.length > 1 ? [{ key: 'branch' as const, label: 'Branches', options: opts.branches.map((b) => ({ value: b.code, label: b.name })) }] : []),
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            <Link href="/analytics" className="hover:underline">
              Reports
            </Link>{' '}
            · {group?.label}
          </>
        }
        title={r.title}
        sub={`${r.blurb}${r.snapshot ? '' : ` ${ctx.range.label}${q.brand ? ` · ${q.brand}` : ''}.`}`}
        right={
          <>
            {branchRead && <ReadBranches calls={branchRead.calls} />}
            <ExportButton name={r.id} href={exportHref} />
          </>
        }
      />
      <ReportFilters presets={[...PRESETS]} snapshot={Boolean(r.snapshot)} lists={lists} />
      <ReportResult result={result} ctx={ctx} exportHref={exportHref} />
    </div>
  );
}
