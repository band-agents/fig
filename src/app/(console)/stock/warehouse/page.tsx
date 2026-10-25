import Link from 'next/link';
import { Sparkles, Truck } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { can, canSee } from '@/lib/domain/perms';
import { floor, myWork } from '@/lib/stock/views/warehouse';
import { peopleToday } from '@/lib/stock/views/people';
import { num, when } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { Ring, ShiftStrip } from '@/components/charts/stock-charts';
import { AddTaskButton, RebalanceButton, TaskList, TransferActions } from '@/components/stock/tasks';
import { PersonCard } from '@/components/stock/people';
import { ReceiveButton } from '@/components/stock/purchasing';
import { poDetail } from '@/lib/stock/views/purchasing';
import { servedAt } from '@/lib/stock/views/common';
import { CountUp } from '@/components/ui/count-up';

export const metadata = { title: 'Warehouse' };

export default async function WarehousePage(props: PageProps<'/stock/warehouse'>) {
  const me = await requireUser();
  if (!canSee(me, 'warehouse')) sendHome(me);
  const manage = can(me, 'warehouse', 3);
  const sp = await props.searchParams;
  const tab = (typeof sp.tab === 'string' ? sp.tab : null) ?? (manage ? 'floor' : 'mine');
  const now = servedAt();
  const [mine, fl, people] = await Promise.all([myWork(me, ['warehouse']), floor(me), peopleToday(me, ['warehouse'])]);
  const self = people.find((x) => x.id === me.id);
  const tabs = [
    { key: 'mine', label: 'My work', n: mine.open.length, show: can(me, 'warehouse', 2) },
    { key: 'floor', label: 'The floor', n: fl.all.length, show: manage },
    { key: 'deliveries', label: 'Deliveries', n: fl.deliveries.length, show: true },
    { key: 'transfers', label: 'Transfers', n: fl.transfers.filter((t) => !['received', 'cancelled'].includes(t.status)).length, show: true },
  ].filter((t) => t.show);
  // receiving needs the order's lines; only the deliveries tab loads them
  const receiving = tab === 'deliveries' ? await Promise.all(fl.deliveries.slice(0, 12).map((d) => poDetail(me, d.id))) : [];
  const onShift = people.filter((x) => x.onShift);
  const avgUtil = onShift.length ? onShift.reduce((a, x) => a + (x.util.rate ?? 0), 0) / onShift.length : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Stock & buying"
        title="Warehouse"
        sub={manage ? 'Who is on what, right now, in the warehouses and the shops. New work goes to whoever has the least on.' : 'Your work for today, most urgent first. Start a task when you pick it up and mark it done when it is finished: that is all the board needs.'}
        right={
          <div className="flex flex-wrap gap-2">
            {manage && <RebalanceButton />}
            <AddTaskButton people={fl.assignable} locations={fl.locations} areas={['warehouse']} manage={manage} />
          </div>
        }
      />

      <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <Link key={t.key} href={`/stock/warehouse?tab=${t.key}`} className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[12.5px] ${tab === t.key ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
            {t.label} <span className="font-mono text-[11px] opacity-70">{t.n}</span>
          </Link>
        ))}
      </nav>

      {tab === 'mine' && (
        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-3">
            <TaskList tasks={mine.open} empty="Nothing waiting for you. Take one from the right, or ask your lead." />
          </div>
          <aside className="space-y-5">
            {self && (
              <section className="panel p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="eyebrow mb-1">Your shift</div>
                    <div className="text-[12.5px] text-ink-2">
                      {self.today.n + self.today.picks} done today · {num(self.today.units)} pieces
                    </div>
                  </div>
                  <Ring value={self.util.rate} size={54} />
                </div>
                <div className="mt-4">{self.shift ? <ShiftStrip from={self.shift.from} to={self.shift.to} blocks={self.strip} now={now} /> : <p className="text-[12.5px] text-ink-3">Rest day.</p>}</div>
                <p className="mt-3 text-[11.5px] text-ink-3">The ring is the share of your shift so far spent on recorded work. Starting and finishing tasks is what fills it.</p>
              </section>
            )}
            {mine.grabs.length > 0 && (
              <section className="space-y-2.5">
                <h2 className="flex items-center gap-2 text-[13px] font-medium">
                  <Sparkles className="size-4 text-ink-3" /> Up for grabs near you
                </h2>
                <TaskList tasks={mine.grabs} empty="" />
              </section>
            )}
            {mine.done.length > 0 && (
              <section className="panel p-5">
                <div className="eyebrow mb-3">Done today</div>
                <ul className="space-y-2">
                  {mine.done.map((t) => (
                    <li key={t.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span className="truncate text-ink-2">{t.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-4">{t.spentMinutes ?? t.estMinutes} min</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}

      {tab === 'floor' && manage && (
        <div className="space-y-5">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'On shift now', value: `${onShift.length} of ${people.length}`, note: `${people.filter((x) => x.doing).length} on a task this minute` },
              { label: 'Busy, on shift', value: avgUtil == null ? '—' : `${Math.round(avgUtil * 100)}%`, note: 'recorded work over shift time so far' },
              { label: 'Waiting', value: num(fl.all.filter((t) => t.status !== 'doing').length), note: `${fl.loose.length} not given to anyone` },
              { label: 'Late or blocked', value: num(fl.all.filter((t) => (t.dueAt && Date.parse(t.dueAt) < now) || t.status === 'blocked').length), note: 'see the red on the cards below', alert: true },
            ].map((k) => (
              <div key={k.label} className="panel p-4">
                <div className="text-[11.5px] text-ink-3">{k.label}</div>
                <div className={`mt-2 font-display text-[17px] leading-none ${'alert' in k && k.alert && k.value !== '0' ? 'text-critical' : ''}`}>{typeof k.value === 'string' ? <CountUp text={k.value} /> : k.value}</div>
                <div className="mt-2 text-[11px] text-ink-3">{k.note}</div>
              </div>
            ))}
          </section>
          <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {people.map((d) => (
              <PersonCard key={d.id} d={d} now={now} />
            ))}
          </section>
          <section className="grid gap-5 xl:grid-cols-2">
            <div>
              <h2 className="mb-3 text-[14px] font-medium">Not given to anyone</h2>
              <TaskList tasks={fl.loose.filter((t) => t.area === 'warehouse')} manage people={fl.assignable} empty="Everything has an owner." />
            </div>
            <div>
              <h2 className="mb-3 text-[14px] font-medium">Everything open</h2>
              <TaskList tasks={fl.all.filter((t) => t.assigneeId)} manage people={fl.assignable} empty="No open work." />
            </div>
          </section>
        </div>
      )}

      {tab === 'deliveries' && (
        <section className="panel overflow-hidden">
          <header className="border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-medium">Due in the next ten days</h2>
            <p className="mt-0.5 text-[11.5px] text-ink-3">Book a delivery in as it is unpacked: good pieces go straight to stock, damaged ones are recorded against the supplier.</p>
          </header>
          <ul className="divide-y divide-[var(--line)]">
            {fl.deliveries.map((d, i) => {
              const r = receiving[i];
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                  <Truck className="size-4 text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/stock/purchasing/${d.id}`} className="font-mono text-[12.5px] hover:underline">
                      {d.number}
                    </Link>
                    <div className="truncate text-[11.5px] text-ink-3">
                      {d.supplier} → {d.location}
                    </div>
                  </div>
                  <span className="font-mono text-[12.5px]">{num(d.left)} pieces</span>
                  <span className={`w-28 text-right text-[12px] ${d.late ? 'text-critical' : 'text-ink-2'}`}>{d.expectedAt ? `${d.late ? 'late · ' : ''}${when(d.expectedAt)}` : '—'}</span>
                  {r && r.canReceive && <ReceiveButton id={d.id} number={d.number} styles={r.styles} />}
                </li>
              );
            })}
            {!fl.deliveries.length && <li className="px-5 py-8 text-center text-[12.5px] text-ink-3">Nothing due in the next ten days.</li>}
          </ul>
        </section>
      )}

      {tab === 'transfers' && (
        <section className="panel overflow-hidden">
          <div className="scroll-thin overflow-x-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>From → to</th>
                  <th>Status</th>
                  <th className="text-right">Pieces</th>
                  <th>Why</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {fl.transfers.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="font-mono">{t.number}</div>
                      <div className="text-[11px] text-ink-4">
                        {t.source === 'ai' && <Sparkles className="mr-1 inline size-3" />}
                        {t.createdByName} · {when(t.createdAt)}
                      </div>
                    </td>
                    <td className="max-w-[320px]">
                      <div className="truncate">{t.from}</div>
                      <div className="truncate text-ink-3">→ {t.to}</div>
                    </td>
                    <td>
                      <span className="pill" data-tint={t.tint}>
                        <span className="dot" />
                        {t.label}
                      </span>
                    </td>
                    <td className="text-right font-mono">{num(t.units)}</td>
                    <td className="max-w-[260px] truncate text-[12px] text-ink-3">{t.reason}</td>
                    <td>
                      <TransferActions id={t.id} status={t.status} canAct={can(me, 'warehouse', 2) || can(me, 'stock', 2)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
