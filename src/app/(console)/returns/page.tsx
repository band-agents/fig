import Link from 'next/link';
import { Undo2 } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { listReturns, returnViewCounts, RETURN_VIEWS } from '@/lib/return-query';
import { RETURN_REASONS, type ReturnReason } from '@/lib/domain/stages';
import { can } from '@/lib/domain/perms';
import { ago, money, num } from '@/lib/format';
import { ChannelChip, Empty, PageHeader, ReturnPill } from '@/components/ui/bits';
import { SlaChip } from '@/components/ui/sla';
import { DeskActions } from '@/components/returns/desk-actions';

export const metadata = { title: 'Returns' };

export default async function ReturnsPage(props: PageProps<'/returns'>) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const view = typeof sp.view === 'string' ? sp.view : 'open';
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const [data, counts] = await Promise.all([listReturns(me, { view, q, limit: 100 }), returnViewCounts(me)]);
  return (
    <div>
      <PageHeader eyebrow="Returns desk" title="Returns" sub="From the customer’s request to the money going back. Every return knows its order, its reason and who has it now." />
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {RETURN_VIEWS.map((v) => (
          <Link key={v.key} href={`/returns?view=${v.key}`} className={`flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[13px] transition ${view === v.key ? 'bg-inv text-inv-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
            {v.label}
            <span className={`font-mono text-[11px] ${view === v.key ? 'opacity-70' : 'text-ink-4'}`}>{num(counts[v.key] ?? 0)}</span>
          </Link>
        ))}
      </div>
      <div className="panel overflow-hidden">
        {data.rows.length === 0 ? (
          <Empty icon={Undo2} title="No returns here" body="Returns open from a delivered order’s page or from customer care." />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {data.rows.map((r) => (
              <li key={r.id} className="grid gap-3 px-4 py-3.5 md:grid-cols-[1.2fr_1fr_auto] md:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex -space-x-2">
                    {r.items.slice(0, 2).map((it, i) =>
                      // eslint-disable-next-line @next/next/no-img-element
                      it.image ? <img key={i} src={it.image} alt="" className="h-12 w-10 rounded-md object-cover ring-2 ring-[var(--bg-elev)]" /> : <span key={i} className="h-12 w-10 rounded-md bg-elev-3" />,
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/returns/${r.id}`} className="font-mono text-[13.5px] hover:underline">
                        {r.number}
                      </Link>
                      <Link href={`/orders/${r.orderId}`} className="font-mono text-[12px] text-ink-3 hover:text-ink">
                        {r.orderNumber}
                      </Link>
                      <ChannelChip id={r.channelId} compact />
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-ink-3">
                      {r.customer} · {r.items.map((i) => `${i.title}${i.size ? ` (${i.size})` : ''}`).join(', ')}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  <ReturnPill stage={r.stage} />
                  <span className="text-ink-2">{RETURN_REASONS[r.reason as ReturnReason]}</span>
                  <span className="text-ink-3">{r.resolution}</span>
                  {can(me, 'money', 1) && r.amount != null && <span className="font-mono">{money(r.amount, r.currency)}</span>}
                  <span className="text-ink-4">{ago(r.requestedAt)}</span>
                </div>
                <div className="flex items-center gap-3 md:justify-end">
                  <SlaChip due={r.dueAt} since={r.stageAt} />
                  <DeskActions id={r.id} number={r.number} stage={r.stage} method={r.method} scopes={me.scopes} compact />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
