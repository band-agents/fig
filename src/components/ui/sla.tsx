'use client';

import { Clock3, Hourglass, PauseCircle, TimerOff } from 'lucide-react';
import { slaState, span } from '@/lib/domain/sla';
import { useNow } from '@/lib/hooks';

/** Live countdown to the stage target. Late shows how late, in red, with an icon and the word. */
export function SlaChip({ due, since, held, big = false }: { due: string | Date | null; since: string | Date; held?: boolean; big?: boolean }) {
  const now = useNow();
  const d = due ? new Date(due) : null;
  const s = new Date(since);
  if (!d && !held) return <span className="text-xs text-ink-4">—</span>;
  if (now == null) return <span className="inline-block h-4 w-12" />;
  const state = slaState(d, s, new Date(now), held);
  const cls = big ? 'text-[12.5px] gap-1.5' : 'text-[11.5px] gap-1';
  if (state === 'held')
    return (
      <span className={`inline-flex items-center font-mono text-[var(--warn)] ${cls}`}>
        <PauseCircle className="size-3.5" /> paused
      </span>
    );
  const left = d!.getTime() - now;
  if (state === 'late')
    return (
      <span className={`inline-flex items-center font-mono font-medium text-critical ${cls}`} title="Past the stage target">
        <TimerOff className="size-3.5" /> {span(-left)} late
      </span>
    );
  if (state === 'soon')
    return (
      <span className={`inline-flex items-center font-mono text-[var(--warn)] ${cls}`} title="Due within the hour">
        <Hourglass className="size-3.5" /> {span(left)} left
      </span>
    );
  return (
    <span className={`inline-flex items-center font-mono text-ink-3 ${cls}`}>
      <Clock3 className="size-3.5" /> {span(left)}
    </span>
  );
}

export function Since({ at }: { at: string | Date }) {
  const now = useNow();
  if (now == null) return <span className="inline-block h-4 w-8" />;
  return <span className="font-mono text-xs text-ink-3">{span(now - new Date(at).getTime())}</span>;
}
