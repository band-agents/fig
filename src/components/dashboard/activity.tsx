import Link from 'next/link';
import { ActorAvatar } from '@/components/ui/avatar';
import { ChannelChip } from '@/components/ui/bits';
import { ago } from '@/lib/format';
import { ORDER_STAGE, RETURN_STAGE, type OrderStage, type ReturnStage } from '@/lib/domain/stages';

export type FeedRow = {
  id: string;
  at: Date;
  actorName: string;
  actorHue: number | null;
  kind: string;
  toStage: string | null;
  message: string;
  orderId: string | null;
  returnId: string | null;
  number: string | null;
  channelId: string | null;
};

function line(e: FeedRow) {
  if (e.kind === 'stage' && e.toStage) {
    const m = ORDER_STAGE[e.toStage as OrderStage] ?? RETURN_STAGE[e.toStage as ReturnStage];
    if (e.actorName === 'Relay Autopilot') return <>cleared it to <b className="font-medium">{m?.label}</b></>;
    if (e.returnId) return <>{e.message}</>;
    return (
      <>
        moved it to <b className="font-medium">{m?.label}</b>
      </>
    );
  }
  if (e.kind === 'call') return <>called the customer · {e.message}</>;
  if (e.kind === 'note') return <>noted · {e.message}</>;
  return <>{e.message}</>;
}

export function ActivityFeed({ rows }: { rows: FeedRow[] }) {
  return (
    <ol className="relative space-y-0.5">
      {rows.map((e, i) => (
        <li key={e.id} className={`relative flex gap-3 rounded-lg px-2 py-2 ${i === 0 ? 'flash' : ''}`}>
          <ActorAvatar name={e.actorName} hue={e.actorHue} size={26} />
          <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
            <div className="text-ink-2">
              <span className="font-medium text-ink">{e.actorName}</span> {line(e)}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
              {e.number && (
                <Link href={e.returnId ? `/returns/${e.returnId}` : `/orders/${e.orderId}`} className="font-mono text-ink-2 hover:text-ink hover:underline">
                  {e.number}
                </Link>
              )}
              {e.channelId && <ChannelChip id={e.channelId} compact />}
              <span className="ml-auto shrink-0">{ago(e.at)}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
