import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { listOrders, viewCounts, VIEWS, type OrderFilters } from '@/lib/order-query';
import { CHANNELS } from '@/lib/channels';
import { ORDER_STAGE, ORDER_STAGES } from '@/lib/domain/stages';
import { can } from '@/lib/domain/perms';
import { num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { OrdersTable } from '@/components/orders/orders-table';
import { FilterBar } from '@/components/orders/filter-bar';

export const metadata = { title: 'Orders' };

export default async function OrdersPage(props: PageProps<'/orders'>) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const f: OrderFilters = { view: str('view') ?? 'open', q: str('q'), channel: str('channel'), stage: str('stage'), pay: str('pay'), risk: str('risk'), sla: str('sla'), sort: str('sort'), page: Number(str('page') ?? 1) };
  const [data, counts] = await Promise.all([listOrders(me, f), viewCounts(me)]);
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, page: undefined, ...patch })) if (v != null && v !== '' && k !== 'limit') next.set(k, String(v));
    return `/orders?${next}`;
  };
  const pages = Math.ceil(data.total / data.limit);
  const channels = CHANNELS.filter((c) => !c.parked && (!me.channels.length || me.channels.includes(c.id))).map((c) => ({ id: c.id, label: c.surface === 'App' ? `${c.name} App` : c.name }));

  return (
    <div>
      <PageHeader eyebrow="Every storefront, one list" title="Orders" sub="Search by number, name, phone, waybill, product or SKU. Everything here updates live as the floor works." />

      <div className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {VIEWS.map((v) => {
          const active = (f.view ?? 'open') === v.key;
          const n = counts[v.key];
          return (
            <Link key={v.key} href={qs({ view: v.key })} className={`flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[13px] transition ${active ? 'bg-inv text-inv-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
              {v.label}
              <span className={`font-mono text-[11px] ${active ? 'opacity-70' : 'text-ink-4'} ${v.key === 'attention' && n > 0 && !active ? '!text-critical' : ''}`}>{num(n ?? 0)}</span>
            </Link>
          );
        })}
      </div>

      <FilterBar filters={f} channels={channels} stages={ORDER_STAGES.map((s) => ({ id: s, label: ORDER_STAGE[s].label }))} />

      <div className="panel mt-4 overflow-hidden">
        {data.rows.length === 0 ? (
          <Empty icon={PackageSearch} title="Nothing here" body={f.q ? `No orders match “${f.q}”.` : 'No orders in this view right now.'} />
        ) : (
          <OrdersTable rows={data.rows} seesMoney={can(me, 'money', 1)} scopes={me.scopes} />
        )}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-[13px] text-ink-3">
          <span>
            {num((data.page - 1) * data.limit + 1)}–{num(Math.min(data.total, data.page * data.limit))} of {num(data.total)}
          </span>
          <div className="flex gap-2">
            {data.page > 1 && (
              <Link className="btn btn-quiet btn-sm" href={qs({ page: String(data.page - 1) })}>
                Previous
              </Link>
            )}
            {data.page < pages && (
              <Link className="btn btn-quiet btn-sm" href={qs({ page: String(data.page + 1) })}>
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
