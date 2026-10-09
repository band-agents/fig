import { Check, RotateCcw, XCircle } from 'lucide-react';
import { ORDER_STAGE, ORDER_TRACK, type OrderStage } from '@/lib/domain/stages';
import { when } from '@/lib/format';

/** The baton's path: every leg it has run, who carried it and when, and where it is now. */
export function StageTracker({ stage, reached, onHold }: { stage: string; reached: Record<string, { at: Date; by: string }>; onHold: boolean }) {
  const off = stage === 'cancelled' || stage === 'rto' || stage === 'rto_closed';
  const lastOnTrack = off ? [...ORDER_TRACK].reverse().find((s) => reached[s]) ?? 'new' : stage;
  const idx = ORDER_TRACK.indexOf(lastOnTrack as OrderStage);
  return (
    <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
      <ol className="flex min-w-[760px] items-start">
        {ORDER_TRACK.map((s, i) => {
          const m = ORDER_STAGE[s];
          const done = i < idx || (i === idx && (s === 'settled' || off));
          const current = i === idx && !off && s !== 'settled';
          const r = reached[s];
          const skipped = !r && i < idx;
          return (
            <li key={s} className="relative flex flex-1 flex-col items-center text-center" data-tint={m.tint}>
              {i > 0 && <span className={`absolute right-1/2 top-[11px] h-[2px] w-full ${i <= idx ? 'bg-[var(--tint)]' : 'bg-line-2'} ${skipped ? 'opacity-40' : ''}`} style={{ marginRight: 12 }} />}
              <span
                className={`relative z-[1] grid size-6 place-items-center rounded-full border-2 ${
                  current ? 'border-[var(--tint)] bg-bg shadow-[0_0_0_5px_color-mix(in_oklab,var(--tint)_18%,transparent)]' : done || r ? 'border-[var(--tint)] bg-[var(--tint)]' : 'border-line-2 bg-bg'
                } ${skipped ? 'opacity-40' : ''}`}
              >
                {current ? <span className={`size-2 rounded-full bg-[var(--tint)] ${onHold ? '' : 'animate-pulse'}`} /> : (done || r) && <Check className="size-3.5 text-bg" strokeWidth={3} />}
              </span>
              <span className={`mt-2 text-[12px] ${current ? 'font-medium text-ink' : r ? 'text-ink-2' : 'text-ink-4'}`}>{m.label}</span>
              {r && !skipped && (
                <span className="mt-0.5 text-[10.5px] leading-tight text-ink-3">
                  {when(r.at).replace('Today ', '')}
                  <br />
                  {r.by === 'Relay Autopilot' ? 'Autopilot' : r.by.split(' ')[0]}
                </span>
              )}
              {skipped && <span className="mt-0.5 text-[10.5px] text-ink-4">skipped</span>}
            </li>
          );
        })}
      </ol>
      {off && (
        <div className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] ${stage === 'cancelled' ? 'border-line-2 text-ink-2' : 'border-[color-mix(in_oklab,var(--t-red)_40%,transparent)] text-critical'}`}>
          {stage === 'cancelled' ? <XCircle className="size-4" /> : <RotateCcw className="size-4" />}
          {ORDER_STAGE[stage as OrderStage].label}
          {reached[stage] && <span className="text-ink-3">· {when(reached[stage].at)} by {reached[stage].by}</span>}
        </div>
      )}
    </div>
  );
}
