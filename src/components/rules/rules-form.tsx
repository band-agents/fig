'use client';

import { useState, useTransition } from 'react';
import { Bot, Loader2, RotateCcw } from 'lucide-react';
import { ORDER_STAGE, RETURN_STAGE, type OrderStage, type ReturnStage } from '@/lib/domain/stages';
import type { SlaTargets } from '@/lib/domain/sla';
import type { AutopilotRules } from '@/lib/domain/autopilot';
import { resetDemoAction, saveRulesAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';

const ORDER_KEYS: OrderStage[] = ['new', 'ready', 'picking', 'packed', 'shipped', 'delivering', 'delivered', 'rto'];
const RETURN_KEYS: ReturnStage[] = ['requested', 'approved', 'pickup', 'in_transit', 'received', 'inspected', 'refund_pending'];
const DEPT: Record<string, string> = { care: 'Customer care', finance: 'Finance', fulfilment: 'Warehouse', shipping: 'Shipping', returns: 'Returns desk', none: '' };

export function RulesForm({ sla, autopilot, canEdit, demo }: { sla: SlaTargets; autopilot: AutopilotRules; canEdit: boolean; demo: boolean }) {
  const [s, setS] = useState(sla);
  const [a, setA] = useState(autopilot);
  const [pending, start] = useTransition();
  const save = (key: 'sla' | 'autopilot', value: unknown) =>
    start(async () => {
      const r = await saveRulesAction(key, value);
      if (r.ok) toast('Rules saved');
                else toast(r.error, { tone: 'error' });
    });
  const hours = (v: number | undefined) => (v == null ? '' : String(v));

  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]" data-editing="true">
      <section className="panel">
        <header className="border-b border-line px-5 py-3.5">
          <h2 className="text-[14px] font-medium">Stage targets (hours)</h2>
          <p className="text-[11.5px] text-ink-3">The clock starts when an order enters the stage and pauses while it is on hold.</p>
        </header>
        <div className="grid gap-6 p-5 sm:grid-cols-2">
          <div>
            <div className="eyebrow mb-2">Orders</div>
            <ul className="space-y-1.5">
              {ORDER_KEYS.map((k) => (
                <li key={k} className="flex items-center gap-3" data-tint={ORDER_STAGE[k].tint}>
                  <span className="size-1.5 rounded-full bg-[var(--tint)]" />
                  <span className="flex-1 text-[12.5px]">
                    {ORDER_STAGE[k].label}
                    <span className="ml-1.5 text-[11px] text-ink-4">{DEPT[ORDER_STAGE[k].dept]}</span>
                  </span>
                  <input
                    disabled={!canEdit}
                    type="number"
                    step="0.5"
                    min="0"
                    value={hours(s.orders[k])}
                    onChange={(e) => setS((x) => ({ ...x, orders: { ...x.orders, [k]: Number(e.target.value) } }))}
                    className="field !h-8 !w-20 text-right font-mono text-[12px]"
                  />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow mb-2">Returns</div>
            <ul className="space-y-1.5">
              {RETURN_KEYS.map((k) => (
                <li key={k} className="flex items-center gap-3" data-tint={RETURN_STAGE[k].tint}>
                  <span className="size-1.5 rounded-full bg-[var(--tint)]" />
                  <span className="flex-1 text-[12.5px]">{RETURN_STAGE[k].label}</span>
                  <input
                    disabled={!canEdit}
                    type="number"
                    step="0.5"
                    min="0"
                    value={hours(s.returns[k])}
                    onChange={(e) => setS((x) => ({ ...x, returns: { ...x.returns, [k]: Number(e.target.value) } }))}
                    className="field !h-8 !w-20 text-right font-mono text-[12px]"
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-line px-5 py-3">
            <button onClick={() => save('sla', s)} disabled={pending} className="btn btn-primary btn-sm">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Save targets
            </button>
          </div>
        )}
      </section>

      <div className="space-y-5">
        <section className="panel">
          <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <Bot className="size-4 text-ink-2" />
            <h2 className="text-[14px] font-medium">Autopilot</h2>
            <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-2">
              <input type="checkbox" disabled={!canEdit} checked={a.enabled} onChange={(e) => setA({ ...a, enabled: e.target.checked })} className="accent-[var(--ink)]" />
              {a.enabled ? 'On' : 'Off'}
            </label>
          </header>
          <div className={`space-y-3 p-5 text-[12.5px] ${!a.enabled ? 'opacity-50' : ''}`}>
            <p className="text-[12.5px] text-ink-2">Every order goes from the store straight to Pick &amp; pack: there is no confirmation call and no finance check any more. Orders on hold wait until the hold is released.</p>
            <Toggle on={a.autoSettlePrepaid} set={(v) => setA({ ...a, autoSettlePrepaid: v })} disabled={!canEdit} label="Close paid online orders as settled the moment they’re delivered" />
          </div>
          {canEdit && (
            <div className="flex justify-end border-t border-line px-5 py-3">
              <button onClick={() => save('autopilot', a)} disabled={pending} className="btn btn-primary btn-sm">
                {pending && <Loader2 className="size-3.5 animate-spin" />} Save Autopilot
              </button>
            </div>
          )}
        </section>

        {demo && (
          <section className="panel p-5">
            <h2 className="text-[14px] font-medium">Demo floor</h2>
            <p className="mt-1 text-[12px] text-ink-3">Rebuild the month of demo orders from scratch, ending at this moment. Takes about a minute and a half. Live store orders are never touched.</p>
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await resetDemoAction();
                  if (r.ok) toast(r.message ?? 'Rebuilt');
                else toast(r.error, { tone: 'error' });
                })
              }
              className="btn btn-quiet btn-sm mt-3"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Rebuild demo floor
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => set(!on)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-inv' : 'bg-elev-3 ring-1 ring-line-2'}`}
      >
        <span className={`absolute top-0.5 size-4 rounded-full transition ${on ? 'left-[18px] bg-inv-ink' : 'left-0.5 bg-ink-3'}`} />
      </button>
      <span className="text-ink-2">{label}</span>
    </label>
  );
}
