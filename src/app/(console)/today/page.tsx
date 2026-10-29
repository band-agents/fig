import Link from 'next/link';
import { ArrowRight, Banknote, CircleCheck, Clock, Droplets, Lightbulb, PhoneCall, Undo2, type LucideIcon } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { can, canSee } from '@/lib/domain/perms';
import { todayFor, type Task, type TaskKind } from '@/lib/smart/today';
import { viewCurrency } from '@/lib/stock/views/common';
import { greeting, moneyIn, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';
import { DoneButton } from '@/components/smart/done-button';

export const metadata = { title: 'Today' };

// Dan, 28 Oct: one list per person of what to do now, from every part of the console, biggest money first.

const KIND: Record<TaskKind, { icon: LucideIcon; tint: string; label: string }> = {
  leak: { icon: Droplets, tint: 'rose', label: 'Money leak' },
  late: { icon: Clock, tint: 'amber', label: 'Late' },
  suggestion: { icon: Lightbulb, tint: 'violet', label: 'Suggestion' },
  refunds: { icon: Banknote, tint: 'amber', label: 'Refunds' },
  review: { icon: Undo2, tint: 'rose', label: 'Returns' },
  cash: { icon: Banknote, tint: 'red', label: 'Cash' },
  risk: { icon: PhoneCall, tint: 'amber', label: 'Refusal risk' },
};

export default async function TodayPage() {
  const me = await requireUser();
  const cur = viewCurrency(me);
  const t = await todayFor(me);
  const seesMoney = can(me, 'money', 1);
  const m = (v: number) => moneyIn(v, cur, { compact: true });
  const first = me.name.split(' ')[0] || me.name;
  const leaks = t.leaks.leaks.filter((l) => !l.off && l.weekly > 0).sort((a, b) => b.weekly - a.weekly);
  const maxLeak = Math.max(1, ...leaks.map((l) => l.weekly));

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Today" title={`${greeting()}, ${first}`} sub="What needs you now, from every part of the console, the biggest money first." />

      <section className="panel inv-board grid grid-cols-1 overflow-hidden sm:grid-cols-3">
        <div className="inv-stat flex items-baseline justify-between gap-3 p-4 sm:block">
          <div className="text-[12.5px] text-ink-3">To do</div>
          <div className="mt-1.5 font-mono text-[24px] font-semibold leading-none">{num(t.tasks.length)}</div>
          <div className="mt-1.5 text-[11.5px] text-ink-3">{t.late ? <span className="text-[var(--t-amber)]">{t.late} running late</span> : 'nothing running late'}</div>
        </div>
        <div className="inv-stat flex items-baseline justify-between gap-3 p-4 sm:block">
          <div className="text-[12.5px] text-ink-3">Leaking a week</div>
          <div className="mt-1.5 font-mono text-[24px] font-semibold leading-none text-[var(--t-rose)]">{seesMoney ? `≈ ${m(t.weekly)}` : '—'}</div>
          <div className="mt-1.5 text-[11.5px] text-ink-3">in the leaks on your list</div>
        </div>
        <div className="inv-stat flex items-baseline justify-between gap-3 p-4 sm:block">
          <div className="text-[12.5px] text-ink-3">At stake now</div>
          <div className="mt-1.5 font-mono text-[24px] font-semibold leading-none">{seesMoney ? m(t.stake) : '—'}</div>
          <div className="mt-1.5 text-[11.5px] text-ink-3">orders, refunds, suggestions</div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel overflow-hidden">
          {t.tasks.length === 0 ? (
            <Empty icon={CircleCheck} title="Nothing needs you right now" body="Every queue is on time and nothing in your areas is leaking money. Enjoy it." />
          ) : (
            <ol className="divide-y divide-[var(--line)]">
              {t.tasks.map((x, i) => (
                <TaskRow key={x.key} x={x} rank={i + 1} money={seesMoney ? m : null} readOnly={Boolean(me.previewing)} />
              ))}
            </ol>
          )}
          {t.done.length > 0 && (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-3 text-[12.5px] text-ink-3 hover:text-ink">Done this week ({t.done.length})</summary>
              <ol className="divide-y divide-[var(--line)] opacity-70">
                {t.done.map((x) => (
                  <TaskRow key={x.key} x={x} money={seesMoney ? m : null} done readOnly={Boolean(me.previewing)} />
                ))}
              </ol>
            </details>
          )}
        </section>

        {seesMoney && canSee(me, 'leaks') && (
          <aside className="panel h-fit overflow-hidden">
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center gap-2 text-[12px] text-ink-3">
                <Droplets className="size-3.5 text-[var(--t-rose)]" /> Money leaks
              </div>
              <div className="mt-1 font-mono text-[26px] font-semibold leading-none tracking-[-0.5px]">≈ {m(t.leaks.total)}</div>
              <div className="mt-1 text-[11.5px] text-ink-3">a week, across what you can see</div>
            </div>
            <ul className="px-2 pb-2">
              {leaks.slice(0, 6).map((l) => (
                <li key={l.key}>
                  <Link href={l.href} className="block rounded-xl px-3 py-2 hover:bg-elev-2">
                    <div className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="truncate">{l.short}</span>
                      <span className="font-mono font-semibold">{m(l.weekly)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elev-3">
                      <div className="lk-fill h-full rounded-full" data-leak={l.key} style={{ width: `${Math.max(2, (l.weekly / maxLeak) * 100)}%` }} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/leaks" className="flex items-center justify-between border-t border-line px-5 py-3 text-[12.5px] font-medium hover:bg-elev-2">
              Every leak and how it is counted <ArrowRight className="size-3.5" />
            </Link>
          </aside>
        )}
      </div>
    </div>
  );
}

function TaskRow({ x, rank, money, done = false, readOnly }: { x: Task; rank?: number; money: ((v: number) => string) | null; done?: boolean; readOnly: boolean }) {
  const k = KIND[x.kind];
  const Icon = k.icon;
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:items-center sm:px-5">
      {rank != null && <span className="hidden w-5 shrink-0 text-right font-mono text-[11.5px] text-ink-4 sm:block">{rank}</span>}
      {x.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={x.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
      ) : (
        <span className="td-icon" data-tint={k.tint}>
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-[13px] font-medium">{x.title}</span>
          {x.late && <span className="pill" data-tone="attention">Late</span>}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">
          <span className="text-ink-2">{x.team}</span> · {x.why}
        </div>
        {money && (
          <div className="mt-1 font-mono text-[12px] font-semibold sm:hidden">
            {x.per === 'week' ? `≈ ${money(x.money)} a week` : `${money(x.money)} at stake`}
          </div>
        )}
      </div>
      {money && (
        <div className="hidden shrink-0 text-right sm:block">
          <div className="font-mono text-[14px] font-semibold">{x.per === 'week' ? '≈ ' : ''}{money(x.money)}</div>
          <div className="text-[11px] text-ink-4">{x.per === 'week' ? 'a week' : 'at stake'}</div>
        </div>
      )}
      <span className="hidden shrink-0 md:block">
        <Link href={x.href} className="btn btn-quiet btn-sm">
          {x.action} <ArrowRight className="size-3.5" />
        </Link>
      </span>
      <Link href={x.href} aria-label={x.action} className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-elev-2 hover:text-ink md:hidden">
        <ArrowRight className="size-4" />
      </Link>
      <DoneButton id={x.key} done={done} disabled={readOnly} />
    </li>
  );
}
