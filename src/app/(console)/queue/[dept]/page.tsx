import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/domain/perms';
import { DEPTS } from '@/lib/domain/stages';
import { listOrders } from '@/lib/order-query';
import { listReturns } from '@/lib/return-query';
import { PageHeader } from '@/components/ui/bits';
import { CareQueue } from '@/components/queues/care';
import { FinanceQueue } from '@/components/queues/finance';
import { PickQueue } from '@/components/queues/pick';
import { ShippingQueue } from '@/components/queues/shipping';
import { num } from '@/lib/format';

const COPY = {
  care: { eyebrow: 'Customer care', title: 'Confirm', sub: 'Cash orders and anything risky get a call before the warehouse touches them. Riskiest and most overdue first.' },
  finance: { eyebrow: 'Finance', title: 'Clear payments', sub: 'Orders Autopilot couldn’t clear on its own, and refunds waiting for you. Approve to send to the warehouse.' },
  fulfilment: { eyebrow: 'Warehouse', title: 'Pick & pack', sub: 'Scan or tap each piece as you pick it. Oldest first, so nothing misses today’s courier.' },
  shipping: { eyebrow: 'Shipping', title: 'Courier desk', sub: 'Hand packed parcels to the courier, chase the quiet ones, and catch refusals coming back.' },
} as const;

export async function generateMetadata(props: PageProps<'/queue/[dept]'>) {
  const { dept } = await props.params;
  return { title: COPY[dept as keyof typeof COPY]?.title ?? 'Queue' };
}

export default async function QueuePage(props: PageProps<'/queue/[dept]'>) {
  const me = await requireUser();
  const { dept } = await props.params;
  const sp = await props.searchParams;
  if (!(dept in COPY)) notFound();
  const d = dept as keyof typeof COPY;
  if (!can(me, DEPTS[d].area, 1)) notFound();
  const view = typeof sp.view === 'string' ? sp.view : undefined;
  const copy = COPY[d];

  if (d === 'care') {
    const [orders, rets] = await Promise.all([listOrders(me, { view: 'all', stage: undefined, sort: 'due', limit: 120, q: undefined }).then((r) => r.rows.filter((o) => ['new', 'confirming'].includes(o.stage))), listReturns(me, { view: 'requested', limit: 60 })]);
    return (
      <div>
        <PageHeader eyebrow={copy.eyebrow} title={copy.title} sub={copy.sub} right={<Tabs base="/queue/care" view={view ?? 'calls'} tabs={[['calls', 'To call', orders.length], ['returns', 'Returns to approve', rets.rows.length]]} />} />
        <CareQueue orders={orders} returns={rets.rows} view={view === 'returns' ? 'returns' : 'calls'} me={{ scopes: me.scopes }} />
      </div>
    );
  }
  if (d === 'finance') {
    const [orders, rets] = await Promise.all([listOrders(me, { view: 'all', stage: 'finance', sort: 'due', limit: 200 }), listReturns(me, { view: 'refund', limit: 100 })]);
    return (
      <div>
        <PageHeader eyebrow={copy.eyebrow} title={copy.title} sub={copy.sub} right={<Tabs base="/queue/finance" view={view ?? 'clear'} tabs={[['clear', 'To clear', orders.total], ['refunds', 'Refunds to issue', rets.rows.length]]} />} />
        <FinanceQueue orders={orders.rows} returns={rets.rows} view={view === 'refunds' ? 'refunds' : 'clear'} scopes={me.scopes} />
      </div>
    );
  }
  if (d === 'fulfilment') {
    const [ready, picking] = await Promise.all([listOrders(me, { view: 'all', stage: 'ready', sort: 'old', limit: 120 }), listOrders(me, { view: 'all', stage: 'picking', sort: 'old', limit: 60 })]);
    return (
      <div>
        <PageHeader eyebrow={copy.eyebrow} title={copy.title} sub={copy.sub} />
        <PickQueue ready={ready.rows} picking={picking.rows} scopes={me.scopes} meName={me.name} />
      </div>
    );
  }
  const { packed, road, rto, pickups, exceptions } = await shippingLists(me);
  const v = view ?? 'handover';
  return (
    <div>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        sub={copy.sub}
        right={
          <Tabs
            base="/queue/shipping"
            view={v}
            tabs={[
              ['handover', 'Hand over', packed.total],
              ['road', 'On the road', road.length],
              ['exceptions', 'Exceptions', exceptions.length],
              ['rto', 'Coming back', rto.total],
              ['pickups', 'Return pickups', pickups.rows.length],
            ]}
          />
        }
      />
      <ShippingQueue view={v as 'handover'} packed={packed.rows} road={road} exceptions={exceptions} rto={rto.rows} pickups={pickups.rows} scopes={me.scopes} />
    </div>
  );
}

function Tabs({ base, view, tabs }: { base: string; view: string; tabs: [string, string, number][] }) {
  return (
    <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-elev p-1">
      {tabs.map(([k, label, n]) => (
        <Link key={k} href={`${base}?view=${k}`} className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] transition ${view === k ? 'bg-inv text-inv-ink' : 'text-ink-2 hover:text-ink'}`}>
          {label}
          <span className={`font-mono text-[11px] ${view === k ? 'opacity-70' : 'text-ink-4'}`}>{num(n)}</span>
        </Link>
      ))}
    </div>
  );
}

async function shippingLists(me: Awaited<ReturnType<typeof requireUser>>) {
  const [packed, road, rto, pickups] = await Promise.all([
    listOrders(me, { view: 'all', stage: 'packed', sort: 'old', limit: 150 }),
    listOrders(me, { view: 'open', sort: 'due', limit: 200 }).then((r) => r.rows.filter((o) => ['shipped', 'delivering'].includes(o.stage))),
    listOrders(me, { view: 'all', stage: 'rto', sort: 'old', limit: 100 }),
    listReturns(me, { view: 'pickups', limit: 100 }),
  ]);
  const quietSince = Date.now() - 72 * 3600_000;
  const exceptions = road.filter((o) => o.exception || o.stageAt.getTime() < quietSince);
  return { packed, road, rto, pickups, exceptions };
}
