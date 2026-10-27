import { sql } from 'drizzle-orm';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee, READ_ONLY_ROLES } from '@/lib/domain/perms';
import { getDb } from '@/lib/db';
import { catalogStores, listJobs } from '@/lib/catalog/jobs';
import { CatalogHome, type StoreCard } from '@/components/catalog/catalog-home';

export const metadata = { title: 'Import & export' };

/** Catalogue import & export (Dan, 27 Oct): Matrixify inside the console, for every website. */
export default async function CatalogPage() {
  const me = await requireUser();
  if (!canSee(me, 'catalog')) sendHome(me);
  const stores = catalogStores(me);
  const db = await getDb();
  // how many products each store holds, from the last website reading (Website vs Lucida keeps it)
  const counts = await db.execute<{ channel_id: string; products: number; live: number; read_at: string | null; brands: string[] | null }>(sql`
    select channel_id, count(distinct product_id)::int as products,
      count(distinct product_id) filter (where status = 'active')::int as live,
      max(checked_at)::text as read_at,
      array_agg(distinct brand) filter (where brand is not null and brand <> '') as brands
    from web_items where product_id is not null group by 1`);
  const byStore = new Map(counts.rows.map((r) => [r.channel_id, r]));
  const cards: StoreCard[] = stores.map((s) => ({ ...s, products: byStore.get(s.id)?.products ?? 0, live: byStore.get(s.id)?.live ?? 0, readAt: byStore.get(s.id)?.read_at ?? null }));
  const brands = [...new Set(counts.rows.flatMap((r) => (stores.some((s) => s.id === r.channel_id) ? (r.brands ?? []) : [])))].sort();
  const jobs = await listJobs(me, 30);
  const acts = !me.previewing && !READ_ONLY_ROLES.includes(me.role);
  return <CatalogHome stores={cards} jobs={jobs} brands={brands} canImport={acts && can(me, 'catalog', 2)} canManage={acts && can(me, 'catalog', 3)} />;
}
