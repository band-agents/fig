import Link from 'next/link';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { getDb, schema } from '@/lib/db';
import { peopleToday, type WorkArea } from '@/lib/stock/views/people';
import { servedAt } from '@/lib/stock/views/common';
import { when } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { Avatar } from '@/components/ui/avatar';
import { PersonCard } from '@/components/stock/people';
import { RebalanceButton } from '@/components/stock/tasks';
import { CountUp } from '@/components/ui/count-up';

export const metadata = { title: 'Team pulse' };

const AREAS: { key: string; label: string; areas: WorkArea[] }[] = [
  { key: 'all', label: 'Everyone', areas: ['warehouse', 'procurement', 'merch'] },
  { key: 'warehouse', label: 'Warehouse & shops', areas: ['warehouse'] },
  { key: 'procurement', label: 'Buying & planning', areas: ['procurement'] },
  { key: 'merch', label: 'Websites', areas: ['merch'] },
];

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export default async function TeamPulsePage(props: PageProps<'/stock/team'>) {
  const me = await requireUser();
  if (!canSee(me, 'teamPulse')) sendHome(me);
  const sp = await props.searchParams;
  const key = typeof sp.area === 'string' ? sp.area : 'all';
  const person = typeof sp.person === 'string' ? sp.person : undefined;
  const area = AREAS.find((a) => a.key === key) ?? AREAS[0];
  const now = servedAt();
  const people = await peopleToday(me, area.areas);
  const db = await getDb();
  const ids = people.map((p) => p.id);
  const [log, decisions] = await Promise.all([
    db
      .select()
      .from(schema.activity)
      .where(and(person ? eq(schema.activity.actorId, person) : inArray(schema.activity.actorId, ids.length ? ids : ['-']), gte(schema.activity.at, new Date(now - 3 * 86_400_000))))
      .orderBy(desc(schema.activity.at))
      .limit(80),
    db.execute<{ decided_by: string; n: number; accepted: number; hours: number }>(sql`
      select decided_by, count(*)::int as n, count(*) filter (where status in ('accepted','done'))::int as accepted, avg(extract(epoch from decided_at - created_at) / 3600)::float8 as hours
      from recommendations where decided_at > now() - interval '30 days' and decided_by is not null group by 1`),
  ]);
  const onShift = people.filter((p) => p.onShift);
  const util = onShift.length ? onShift.reduce((a, p) => a + (p.util.rate ?? 0), 0) / onShift.length : null;
  const month = people.filter((p) => p.month.util != null);
  const util30 = month.length ? month.reduce((a, p) => a + (p.month.util ?? 0), 0) / month.length : null;
  const doneToday = people.reduce((a, p) => a + p.today.n + p.today.picks, 0);
  const late = people.reduce((a, p) => a + p.queue.late, 0);
  const blocked = people.reduce((a, p) => a + p.queue.blocked, 0);
  const idle = onShift.filter((p) => !p.doing && p.util.idleNow >= 20);
  const days = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86_400_000));
  const dec = (id: string) => decisions.rows.find((d) => d.decided_by === id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stock & buying"
        title="Team pulse"
        sub="Everyone in the warehouses, the shops, buying and the websites: what they are on now, how busy their shift has been, and the last thirty days. Busy means time on recorded work, from tasks started and finished and orders picked and packed."
        right={key === 'warehouse' || key === 'all' ? <RebalanceButton /> : undefined}
      />

      <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {AREAS.map((a) => (
          <Link key={a.key} href={`/stock/team?area=${a.key}`} className={`flex h-9 shrink-0 items-center rounded-lg px-3.5 text-[12.5px] ${key === a.key ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}>
            {a.label}
          </Link>
        ))}
      </nav>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'On shift', value: `${onShift.length}/${people.length}`, note: `${people.filter((p) => p.doing).length} on a task right now` },
          { label: 'Busy today', value: pct(util), note: 'of shift time so far, on shift' },
          { label: 'Busy, 30 days', value: pct(util30), note: 'average working day' },
          { label: 'Done today', value: String(doneToday), note: 'tasks, picks and packs' },
          { label: 'Late', value: String(late), note: `${blocked} blocked`, alert: late > 0 },
          { label: 'Idle 20 min+', value: String(idle.length), note: idle.map((p) => p.name.split(' ')[0]).join(', ') || 'nobody', alert: idle.length > 0 },
        ].map((k) => (
          <div key={k.label} className="panel p-4">
            <div className="text-[11.5px] text-ink-3">{k.label}</div>
            <div className={`mt-2 font-display text-[17px] leading-none ${'alert' in k && k.alert ? 'text-critical' : ''}`}>{typeof k.value === 'string' ? <CountUp text={k.value} /> : k.value}</div>
            <div className="mt-2 truncate text-[11px] text-ink-3">{k.note}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {people.map((d) => (
          <PersonCard key={d.id} d={d} now={now} showMonth />
        ))}
      </section>

      <section className="panel overflow-hidden">
        <header className="border-b border-line px-5 py-3.5">
          <div className="eyebrow mb-1">Thirty days</div>
          <h2 className="text-[14px] font-medium">How busy each person was, day by day</h2>
        </header>
        <div className="scroll-thin overflow-x-auto p-5">
          <div className="min-w-[760px]">
            <div className="grid gap-[3px]" style={{ gridTemplateColumns: '170px repeat(30, minmax(0, 1fr))' }}>
              <div />
              {days.map((d, i) => (
                <div key={i} className="pb-1 text-center font-mono text-[9.5px] text-ink-4">
                  {i % 3 === 0 ? d.getUTCDate() : ''}
                </div>
              ))}
              {people.map((p) => (
                <div key={p.id} className="contents">
                  <Link href={`/stock/team?area=${key}&person=${p.id}#log`} className="truncate pr-2 text-[11.5px] leading-[22px] text-ink-2 hover:text-ink">
                    {p.name}
                  </Link>
                  {p.month.trend.map((v, i) => (
                    <div
                      key={i}
                      title={`${p.name}, ${days[i].toDateString().slice(4, 10)}: ${v == null ? 'off' : `${Math.round(v * 100)}% busy`}`}
                      className="h-[22px] rounded-[4px]"
                      style={{ background: v == null ? 'repeating-linear-gradient(135deg, transparent 0 4px, var(--line) 4px 5px)' : `color-mix(in oklab, var(--s1) ${Math.round(8 + v * 88)}%, var(--bg-elev-2))` }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-ink-3">
              <span>Idle</span>
              <span className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--s1) 8%, var(--bg-elev-2)), var(--s1))' }} />
              <span>Busy the whole shift</span>
              <span className="ml-3 inline-block h-2.5 w-4 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg, transparent 0 4px, var(--line) 4px 5px)' }} />
              <span>Rest day or not scheduled</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="panel overflow-hidden">
          <header className="border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-medium">The month, person by person</h2>
          </header>
          <div className="scroll-thin overflow-x-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="text-right">Busy</th>
                  <th className="text-right">Pace</th>
                  <th className="text-right">Tasks</th>
                  <th className="text-right">Pieces</th>
                  <th className="text-right">On time</th>
                  <th className="text-right">Suggestions</th>
                </tr>
              </thead>
              <tbody>
                {[...people]
                  .sort((a, b) => (b.month.util ?? 0) - (a.month.util ?? 0))
                  .map((p) => {
                    const d = dec(p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={p.name} hue={p.hue} size={26} />
                            <div className="min-w-0">
                              <div className="truncate">{p.name}</div>
                              <div className="truncate text-[11px] text-ink-4">{p.title ?? p.roleLabel}</div>
                            </div>
                          </div>
                        </td>
                        <td className={`text-right font-mono ${p.month.util != null && p.month.util < 0.55 ? 'text-[var(--warn)]' : ''}`}>{pct(p.month.util)}</td>
                        <td className={`text-right font-mono ${p.month.pace != null && p.month.pace < 0.85 ? 'text-[var(--warn)]' : ''}`}>{pct(p.month.pace)}</td>
                        <td className="text-right font-mono">{p.month.done}</td>
                        <td className="text-right font-mono text-ink-2">{new Intl.NumberFormat('en').format(p.month.units)}</td>
                        <td className="text-right font-mono">{pct(p.month.onTime)}</td>
                        <td className="whitespace-nowrap text-right font-mono text-ink-2">{d ? `${d.n} · ${d.hours < 1 ? '<1' : Math.round(d.hours)}h` : '—'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-3 text-[11px] text-ink-3">Pace is standard minutes earned against minutes taken: over 100% is faster than standard. Suggestions: decided, and how long they waited.</p>
        </div>

        <div className="panel overflow-hidden" id="log">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-medium">{person ? `${people.find((p) => p.id === person)?.name ?? 'One person'}, last three days` : 'Who did what, last three days'}</h2>
            {person && (
              <Link href={`/stock/team?area=${key}#log`} className="text-[12px] text-ink-3 hover:text-ink">
                Everyone
              </Link>
            )}
          </header>
          <ol className="scroll-thin max-h-[640px] divide-y divide-[var(--line)] overflow-y-auto">
            {log.map((a) => {
              const p = people.find((x) => x.id === a.actorId);
              return (
                <li key={a.id} className="flex gap-3 px-5 py-2.5">
                  <Avatar name={a.actorName} hue={p?.hue ?? 220} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="font-medium">{a.actorName}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-4">{when(a.at)}</span>
                    </div>
                    <div className="truncate text-[12px] text-ink-2">{a.message}</div>
                  </div>
                </li>
              );
            })}
            {!log.length && <li className="px-5 py-8 text-center text-[12.5px] text-ink-3">Nothing recorded.</li>}
          </ol>
        </div>
      </section>
    </div>
  );
}
