import { Coffee, Moon, Timer } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Ring, ShiftStrip } from '@/components/charts/stock-charts';
import { Sparkline } from '@/components/charts/charts';
import type { PersonDay } from '@/lib/stock/views/people';

const fmt = (t: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' }).format(new Date(t));

/** One person's day at a glance: their shift hour by hour, what they are on, and how busy they have been. */
export function PersonCard({ d, now, showMonth = false }: { d: PersonDay; now: number; showMonth?: boolean }) {
  const idle = d.onShift && !d.doing && d.util.idleNow >= 20;
  const status = d.doing ? (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-ink">
      <span className="live-dot shrink-0 !bg-[var(--t-green)] after:!border-[var(--t-green)]" />
      <span className="truncate">{d.doing.title}</span>
    </span>
  ) : !d.onShift ? (
    <span className="inline-flex items-center gap-1.5 text-ink-3">
      <Moon className="size-3.5" />
      {d.shift && now < d.shift.from ? `On at ${fmt(d.shift.from)}` : 'Off shift'}
    </span>
  ) : idle ? (
    <span className="inline-flex items-center gap-1.5 text-[var(--warn)]">
      <Coffee className="size-3.5" />
      Nothing recorded for {Math.round(d.util.idleNow)} min
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-ink-2">
      <Timer className="size-3.5" />
      Between tasks
    </span>
  );
  return (
    <article className={`rounded-2xl border bg-elev p-4 shadow-[var(--hi)] ${idle ? 'border-[color-mix(in_oklab,var(--warn)_40%,var(--line))]' : 'border-line'}`}>
      <div className="flex items-start gap-3">
        <Avatar name={d.name} hue={d.hue} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-[13.5px] font-medium">{d.name}</h3>
            {d.shift && (
              <span className="shrink-0 font-mono text-[11px] text-ink-4">
                {fmt(d.shift.from)}–{fmt(d.shift.to)}
              </span>
            )}
          </div>
          <div className="truncate text-[11.5px] text-ink-3">
            {d.title ?? d.roleLabel}
            {d.location ? ` · ${d.location}` : ''}
          </div>
          <div className="mt-1.5 text-[12px]">{status}</div>
        </div>
        <Ring value={d.util.rate} size={50} stroke={5} />
      </div>
      <div className="mt-3.5">{d.shift ? <ShiftStrip from={d.shift.from} to={d.shift.to} blocks={d.strip} now={now} /> : <div className="rounded-md bg-elev-2 px-3 py-1.5 text-[11.5px] text-ink-3">Rest day</div>}</div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="font-mono text-[14px]">{d.today.n + d.today.picks}</div>
          <div className="text-[10.5px] text-ink-3">done today</div>
        </div>
        <div>
          <div className="font-mono text-[14px]">{d.queue.n}</div>
          <div className="text-[10.5px] text-ink-3">{Math.round(d.queue.minutes / 6) / 10}h queued</div>
        </div>
        <div>
          <div className={`font-mono text-[14px] ${d.queue.late ? 'text-critical' : ''}`}>{d.queue.late}</div>
          <div className="text-[10.5px] text-ink-3">late</div>
        </div>
        <div>
          <div className={`font-mono text-[14px] ${d.month.pace != null && d.month.pace < 0.85 ? 'text-[var(--warn)]' : ''}`}>{d.month.pace == null ? '—' : `${Math.round(d.month.pace * 100)}%`}</div>
          <div className="text-[10.5px] text-ink-3">pace</div>
        </div>
      </div>
      {showMonth && (
        <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
          <div className="min-w-0 flex-1">
            <Sparkline data={d.month.trend.map((x) => (x == null ? 0 : x * 100))} color="var(--s1)" height={26} />
          </div>
          <div className="text-right text-[11px] text-ink-3">
            <div>
              <b className="font-mono text-ink">{d.month.util == null ? '—' : `${Math.round(d.month.util * 100)}%`}</b> busy, 30 days
            </div>
            <div>
              {d.month.done} tasks · {d.month.onTime == null ? '—' : `${Math.round(d.month.onTime * 100)}% on time`}
            </div>
          </div>
        </div>
      )}
      {d.queue.blocked > 0 && <div className="mt-2 text-[11.5px] text-critical">{d.queue.blocked} blocked, waiting on someone</div>}
    </article>
  );
}
