import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { GROUPS, PAGE_REPORTS, reportsFor } from '@/lib/reports';
import { PageHeader } from '@/components/ui/bits';
import { ReportLibrary, type LibraryItem } from '@/components/analytics/library';

export const metadata = { title: 'Reports' };

export default async function AnalyticsPage() {
  const me = await requireUser();
  if (!canSee(me, 'analytics')) sendHome(me);
  const items: LibraryItem[] = [
    ...reportsFor(me).map((r) => ({ href: `/analytics/${r.id}`, title: r.title, blurb: r.blurb, group: r.group, for: r.for })),
    ...PAGE_REPORTS.filter((p) => canSee(me, p.page)).map((p) => ({ href: p.href, title: p.title, blurb: p.blurb, group: p.group, for: p.group === 'finance' ? ['finance', 'management'] : ['brand', 'management'], page: true })),
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" sub={`${items.length} reports for your access: pick a period, filter by store, brand or category, switch value and pieces, export any of them.`} />
      <ReportLibrary groups={GROUPS} items={items} />
    </div>
  );
}
