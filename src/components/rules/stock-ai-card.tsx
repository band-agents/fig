'use client';

import { useState, useTransition } from 'react';
import { BrainCircuit, Loader2 } from 'lucide-react';
import { saveStockRulesAction } from '@/app/(console)/stock/actions';
import { toast } from '@/components/ui/toast';
import type { StockRules } from '@/lib/stock/core';

const MODES: { key: StockRules['autonomy']; label: string; says: string }[] = [
  { key: 'suggest', label: 'Suggest only', says: 'The AI proposes; people accept or dismiss every proposal.' },
  { key: 'draft', label: 'Draft for us', says: 'Urgent reorders go straight onto draft purchase orders, and transfers and counts become tasks. Buyers still send every order.' },
  { key: 'auto', label: 'Autopilot', says: 'As above, and its draft orders are sent for approval. The AI never approves spending, never changes a price and never publishes to a website.' },
];

/** How much the AI planner may do by itself, and the limits it works within. */
export function StockAiCard({ rules, canEdit, lastRun }: { rules: StockRules; canEdit: boolean; lastRun: string | null }) {
  const [r, setR] = useState(rules);
  const [pending, start] = useTransition();
  const set = <K extends keyof StockRules>(k: K, v: StockRules[K]) => setR((x) => ({ ...x, [k]: v }));
  return (
    <section className="panel mt-6 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-inv text-inv-ink">
          <BrainCircuit className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-medium">The AI planner</h2>
          <p className="mt-0.5 text-[12px] text-ink-3">It reads every style, shop and website on each pass{lastRun ? ` (last ${lastRun})` : ''} and proposes reorders, transfers, markdowns, counts and website placements. These are the limits it works within.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {MODES.map((m) => (
          <button key={m.key} disabled={!canEdit} onClick={() => set('autonomy', m.key)} className={`rounded-xl border p-3.5 text-left transition ${r.autonomy === m.key ? 'border-ink bg-elev-2 shadow-[0_0_0_1px_var(--ink)]' : 'border-line hover:border-line-2'} disabled:cursor-default`}>
            <div className="text-[12.5px] font-medium">{m.label}</div>
            <div className="mt-1 text-[11.5px] leading-snug text-ink-3">{m.says}</div>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label>
          <span className="mb-1 block text-xs text-ink-3">Approval needed above (EGP)</span>
          <input className="field font-mono" disabled={!canEdit} inputMode="numeric" value={Math.round(r.approvalLimit / 100)} onChange={(e) => set('approvalLimit', (Number(e.target.value.replace(/\D/g, '')) || 0) * 100)} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Weeks between buying reviews</span>
          <input className="field font-mono" disabled={!canEdit} inputMode="numeric" value={r.reviewWeeks} onChange={(e) => set('reviewWeeks', Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Chase a supplier after (days)</span>
          <input className="field font-mono" disabled={!canEdit} inputMode="numeric" value={r.chaseAfterDays} onChange={(e) => set('chaseAfterDays', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Count A · B · C styles every (days)</span>
          <div className="flex gap-1.5">
            {(['A', 'B', 'C'] as const).map((k) => (
              <input key={k} aria-label={`${k} styles`} className="field font-mono" disabled={!canEdit} inputMode="numeric" value={r.countEveryDays[k]} onChange={(e) => set('countEveryDays', { ...r.countEveryDays, [k]: Math.max(7, Number(e.target.value) || 7) })} />
            ))}
          </div>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-[var(--ink)]" disabled={!canEdit} checked={r.autoAssign} onChange={(e) => set('autoAssign', e.target.checked)} />
          Hand new tasks to whoever has the least on
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-[var(--ink)]" disabled={!canEdit} checked={r.autoTasks} onChange={(e) => set('autoTasks', e.target.checked)} />
          Raise receiving and supplier-chasing tasks by itself
        </label>
        {canEdit && (
          <button
            className="btn btn-primary btn-sm ml-auto"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveStockRulesAction(r);
                if (res.ok) toast('Saved. The next pass works to these.');
                else toast(res.error, { tone: 'error' });
              })
            }
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </button>
        )}
      </div>
    </section>
  );
}
