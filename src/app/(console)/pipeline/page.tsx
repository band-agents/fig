import { requireUser } from '@/lib/auth/session';
import { listOrders } from '@/lib/order-query';
import { PageHeader } from '@/components/ui/bits';
import { Board } from '@/components/pipeline/board';
import { CHANNELS } from '@/lib/channels';

export const metadata = { title: 'Pipeline' };

export default async function PipelinePage(props: PageProps<'/pipeline'>) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const channel = typeof sp.channel === 'string' ? sp.channel : undefined;
  const [open, delivered] = await Promise.all([listOrders(me, { view: 'open', channel, sort: 'due', limit: 200 }), listOrders(me, { view: 'delivered', channel, sort: 'old', limit: 40 })]);
  const channels = CHANNELS.filter((c) => !c.parked && (!me.channels.length || me.channels.includes(c.id))).map((c) => ({ id: c.id, label: c.surface === 'App' ? `${c.name} App` : c.name }));
  return (
    <div>
      <PageHeader eyebrow="Every open order, by stage" title="Pipeline" sub="Drag a card to hand it on. Relay only lets it land where your access and the rules allow." />
      <Board orders={[...open.rows, ...delivered.rows]} scopes={me.scopes} channels={channels} channel={channel} />
    </div>
  );
}
