import { Bot, PauseCircle, PhoneCall, ShieldAlert, StickyNote, Truck, CreditCard, RefreshCcw, UserRound } from 'lucide-react';
import { ActorAvatar } from '@/components/ui/avatar';
import { ORDER_STAGE, RETURN_STAGE, type OrderStage, type ReturnStage } from '@/lib/domain/stages';
import { when } from '@/lib/format';
import { actorLabel, isAutopilot } from '@/lib/domain/actors';

type Ev = { id: string; at: Date; actorName: string; dept: string | null; kind: string; fromStage: string | null; toStage: string | null; message: string; data: Record<string, unknown> | null; hue: number | null; returnId: string | null };

const KIND_ICON = { call: PhoneCall, note: StickyNote, courier: Truck, payment: CreditCard, risk: ShieldAlert, hold: PauseCircle, sync: RefreshCcw, assign: UserRound } as const;

export function Timeline({ events }: { events: Ev[] }) {
  const list = [...events].reverse();
  return (
    <ol className="relative">
      <span className="absolute bottom-3 left-[13px] top-3 w-px bg-line" aria-hidden />
      {list.map((e) => {
        const Icon = KIND_ICON[e.kind as keyof typeof KIND_ICON];
        const stageMeta = e.toStage ? (e.returnId ? RETURN_STAGE[e.toStage as ReturnStage] : ORDER_STAGE[e.toStage as OrderStage]) : null;
        const auto = isAutopilot(e.actorName);
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            <span className="relative z-[1] ring-4 ring-[var(--bg-elev)] rounded-full">
              <ActorAvatar name={e.actorName} hue={e.hue} size={27} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                <span className="font-medium">{actorLabel(e.actorName)}</span>
                {e.dept && e.dept !== e.actorName && <span className="text-ink-4">{e.dept}</span>}
                <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-4">{when(e.at)}</span>
              </div>
              {e.kind === 'stage' && stageMeta ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px]">
                  {auto && <Bot className="size-3.5 text-ink-3" />}
                  <span className="pill" data-tone={stageMeta.badge}>
                    <span className="dot" />
                    {stageMeta.label}
                  </span>
                  <span className="text-ink-2">{stripLabel(e.message, stageMeta.label)}</span>
                </div>
              ) : (
                <div className={`mt-1 flex items-start gap-1.5 text-[12.5px] ${e.kind === 'risk' ? 'text-[var(--warn)]' : e.kind === 'courier' ? 'text-ink' : 'text-ink-2'}`}>
                  {Icon && <Icon className="mt-[3px] size-3.5 shrink-0 text-ink-3" />}
                  <span className={e.kind === 'note' || e.kind === 'call' ? 'rounded-lg rounded-tl-sm bg-elev-2 px-2.5 py-1.5 text-ink' : ''}>{e.message}</span>
                </div>
              )}
              {typeof e.data?.note === 'string' && <div className="mt-1.5 rounded-lg rounded-tl-sm bg-elev-2 px-2.5 py-1.5 text-[12.5px]">{e.data.note}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function stripLabel(message: string, label: string) {
  const m = message.startsWith(label) ? message.slice(label.length).replace(/^[\s:·]+/, '') : message;
  return m;
}
