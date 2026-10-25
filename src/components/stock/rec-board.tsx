'use client';

import { useMemo, useState, useTransition } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { runPlannerAction } from '@/app/(console)/stock/actions';
import { toast } from '@/components/ui/toast';
import { RecCard, type Rec } from './rec-card';

const TEAMS: { key: string; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'procurement', label: 'Buying' },
  { key: 'stock', label: 'Stock & planning' },
  { key: 'merch', label: 'Websites' },
  { key: 'warehouse', label: 'Warehouse' },
];

/** The planner's proposals, one tab per team, the most urgent and valuable first. */
export function RecBoard({ recs, publishLevel, channelNames, initial = 'all', pageSize = 6, columns = 2 }: { recs: Rec[]; publishLevel: number; channelNames: Record<string, string>; initial?: string; pageSize?: number; columns?: 1 | 2 }) {
  const [team, setTeam] = useState(initial);
  const [shown, setShown] = useState(pageSize);
  const counts = useMemo(() => recs.reduce<Record<string, number>>((a, r) => ((a[r.area] = (a[r.area] ?? 0) + 1), a), {}), [recs]);
  const list = team === 'all' ? recs : recs.filter((r) => r.area === team);
  // a mix on the "everything" tab: the top of each team, so one team's long list does not bury the rest
  const ordered = useMemo(() => {
    if (team !== 'all') return list;
    // what must happen today first (a few at most), then each team's best in turn
    const urgent = recs.filter((r) => r.priority === 1).slice(0, 3);
    const rest = recs.filter((r) => !urgent.includes(r));
    const byTeam = TEAMS.slice(1).map((t) => rest.filter((r) => r.area === t.key));
    const out: Rec[] = [...urgent];
    for (let i = 0; ; i++) {
      let added = false;
      for (const q of byTeam) {
        if (!q[i]) continue;
        out.push(q[i]);
        added = true;
      }
      if (!added) break;
    }
    return out;
  }, [team, list, recs]);
  return (
    <div>
      <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-3">
        {TEAMS.filter((t) => t.key === 'all' || counts[t.key]).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTeam(t.key);
              setShown(pageSize);
            }}
            className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] transition ${team === t.key ? 'bg-elev-3 font-semibold text-ink' : 'text-ink-2 hover:bg-elev-2 hover:text-ink'}`}
          >
            {t.label}
            <span className={`font-mono text-[11px] ${team === t.key ? 'opacity-70' : 'text-ink-4'}`}>{t.key === 'all' ? recs.length : counts[t.key]}</span>
          </button>
        ))}
      </div>
      {ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-2 px-6 py-12 text-center">
          <Sparkles className="mx-auto size-5 text-ink-3" />
          <div className="mt-3 font-display text-xl">Nothing to decide</div>
          <p className="mt-1 text-[12.5px] text-ink-3">The planner has no open proposals for this team. It reads the range again on its next pass.</p>
        </div>
      ) : (
        <div className={`grid gap-3 ${columns === 2 ? 'xl:grid-cols-2' : ''}`}>
          {ordered.slice(0, shown).map((r) => (
            <RecCard key={r.id} rec={r} publishLevel={publishLevel} channelNames={channelNames} dense />
          ))}
        </div>
      )}
      {ordered.length > shown && (
        <button onClick={() => setShown((s) => s + pageSize * 2)} className="btn btn-quiet btn-sm mt-3 w-full">
          Show more · {ordered.length - shown} left
        </button>
      )}
    </div>
  );
}

export function RunPlannerButton({ label = 'Run the planner now' }: { label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() =>
        start(async () => {
          const r = await runPlannerAction();
          if (r.ok) toast(r.message ?? 'Done');
          else toast(r.error, { tone: 'error' });
        })
      }
      disabled={pending}
      className="btn btn-quiet"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {pending ? 'Reading the range…' : label}
    </button>
  );
}
