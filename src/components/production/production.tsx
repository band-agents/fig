'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Factory, Loader2, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { money, toMajor, toMinor } from '@/lib/format';
import { aqlPlan, aqlVerdict, COST_PARTS, MAKER_SKILLS, type CostKey, type Payment, type StepKey } from '@/lib/domain/production';
import { createProductionAction, inspectionAction, paidAction, paymentAction, saveMakerAction, stepAction, updateProductionAction, type Result } from '@/app/(console)/production/actions';

const today = () => new Date().toISOString().slice(0, 10);
const CURRENCY: Record<string, string> = { EG: 'EGP', KW: 'KWD' };

function useRun() {
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<Result>, done?: (r: Result & { ok: true }) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast(r.message);
        done?.(r);
      } else toast(r.error, { tone: 'error' });
    });
  return { pending, go };
}

const RUNS: Record<string, string[]> = {
  'Women XS–XL': ['XS', 'S', 'M', 'L', 'XL'],
  'Women 34–44': ['34', '36', '38', '40', '42', '44'],
  'Men S–XXL': ['S', 'M', 'L', 'XL', 'XXL'],
  'Kids 2–12': ['2', '4', '6', '8', '10', '12'],
  'One size': ['One size'],
};

// ── Placing an order ──────────────────────────────────────────────────────────────────────────

export function NewProductionButton({ makers, brands, markets, seesCost }: { makers: { id: string; name: string }[]; brands: string[]; markets: ('EG' | 'KW')[]; seesCost: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
        <Plus className="size-3.5" /> New production order
      </button>
      {open && <NewProduction makers={makers} brands={brands} markets={markets} seesCost={seesCost} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewProduction({ makers, brands, markets, seesCost, onClose }: { makers: { id: string; name: string }[]; brands: string[]; markets: ('EG' | 'KW')[]; seesCost: boolean; onClose: () => void }) {
  const router = useRouter();
  const { pending, go } = useRun();
  const [maker, setMaker] = useState(makers[0]?.id ?? '');
  const [brand, setBrand] = useState('');
  const [market, setMarket] = useState<'EG' | 'KW'>(markets[0] ?? 'EG');
  const [season, setSeason] = useState('');
  const [style, setStyle] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [colour, setColour] = useState('');
  const [image, setImage] = useState('');
  const [run, setRun] = useState('Women XS–XL');
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Partial<Record<CostKey, string>>>({});
  const [retail, setRetail] = useState('');
  const [start, setStart] = useState(today());
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const currency = CURRENCY[market];
  const runSizes = RUNS[run] ?? [];
  const qty = runSizes.reduce((a, s) => a + (Number(sizes[s]) || 0), 0);
  const perPiece = COST_PARTS.reduce((a, c) => a + toMinor(costs[c.key] || 0, currency), 0);

  if (!makers.length) {
    return (
      <Modal title="New production order" onClose={onClose}>
        <p className="text-[12.5px] text-ink-2">Add the factory first, under Factories, then place the order with it.</p>
      </Modal>
    );
  }

  return (
    <Modal title="New production order" sub="One style (or colourway) with one factory. The steps are planned from today; move any date later." onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs text-ink-3">Factory</span>
          <select className="field" value={maker} onChange={(e) => setMaker(e.target.value)}>
            {makers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Brand</span>
          <input className="field" list="prod-brands" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Forever 21" />
          <datalist id="prod-brands">
            {brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Style code</span>
          <input className="field font-mono" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. F21-AW26-0142" />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Name</span>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ribbed knit midi dress" />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Colour</span>
          <input className="field" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="e.g. Black" />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Category</span>
          <input className="field" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Dresses" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="mb-1 block text-xs text-ink-3">Sold in</span>
            <select className="field" value={market} onChange={(e) => setMarket(e.target.value as 'EG' | 'KW')}>
              {markets.map((m) => (
                <option key={m} value={m}>
                  {m === 'EG' ? 'Egypt' : 'Kuwait'}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-ink-3">Season</span>
            <input className="field" value={season} onChange={(e) => setSeason(e.target.value)} placeholder="AW26" />
          </label>
        </div>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Photo or sketch link (optional)</span>
          <input className="field" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          Quantity per size
          <select className="field !h-8 !w-auto text-[12px]" value={run} onChange={(e) => setRun(e.target.value)}>
            {Object.keys(RUNS).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <span className="ml-auto font-mono text-ink-2">{qty.toLocaleString('en')} pieces</span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {runSizes.map((s) => (
            <label key={s} className="text-[11px] text-ink-3">
              {s}
              <input className="field mt-0.5 !h-8 font-mono text-[12px]" inputMode="numeric" value={sizes[s] ?? ''} onChange={(e) => setSizes((x) => ({ ...x, [s]: e.target.value.replace(/\D/g, '') }))} />
            </label>
          ))}
        </div>
      </div>

      {seesCost && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center text-xs text-ink-3">
            Cost per piece ({currency}), as agreed or estimated
            <span className="ml-auto font-mono text-ink-2">{money(perPiece, currency)} a piece</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COST_PARTS.map((c) => (
              <label key={c.key} className="text-[11px] text-ink-3">
                {c.label}
                <input className="field mt-0.5 !h-8 font-mono text-[12px]" inputMode="decimal" value={costs[c.key] ?? ''} onChange={(e) => setCosts((x) => ({ ...x, [c.key]: e.target.value.replace(/[^\d.]/g, '') }))} />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label>
          <span className="mb-1 block text-xs text-ink-3">Brief sent</span>
          <input type="date" className="field" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Ex-factory promised</span>
          <input type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-3">Retail price ({currency})</span>
          <input className="field font-mono" inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
      </div>
      <textarea className="field mt-3" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes for the team (fabric composition, lab dips, packing instructions…)" />

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button
          disabled={pending || !maker || !brand.trim() || !style.trim() || !title.trim() || !qty}
          onClick={() =>
            go(
              () =>
                createProductionAction({
                  makerId: maker,
                  brand,
                  market,
                  season,
                  styleCode: style,
                  title,
                  category,
                  colour,
                  image,
                  sizes: Object.fromEntries(runSizes.map((s) => [s, Number(sizes[s]) || 0])),
                  currency,
                  costs: Object.fromEntries(COST_PARTS.map((c) => [c.key, toMinor(costs[c.key] || 0, currency)])),
                  retailPrice: retail ? toMinor(retail, currency) : null,
                  start,
                  dueAt: due || null,
                  note,
                }),
              (r) => {
                onClose();
                if (r.href) router.push(r.href);
              },
            )
          }
          className="btn btn-primary"
        >
          {pending && <Loader2 className="size-4 animate-spin" />} Place order
        </button>
      </div>
    </Modal>
  );
}

// ── The steps ─────────────────────────────────────────────────────────────────────────────────

type StepView = { key: StepKey; label: string; owner: string; planned: string | null; done: string | null; by?: string | null; note?: string | null };

export function Steps({ id, steps, canStep, current }: { id: string; steps: StepView[]; canStep: boolean; current: StepKey }) {
  const { pending, go } = useRun();
  const [busy, setBusy] = useState<string | null>(null);
  const [noting, setNoting] = useState<StepView | null>(null);
  const t = today();
  const act = (key: StepKey, change: Parameters<typeof stepAction>[2]) => {
    setBusy(key);
    go(() => stepAction(id, key, change), () => setBusy(null));
  };
  return (
    <ol className="divide-y divide-[var(--line)]">
      {steps.map((s) => {
        const late = !s.done && s.planned && s.planned < t;
        const isCur = s.key === current && !s.done;
        return (
          <li key={s.key} className={`flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center ${isCur ? 'bg-elev-2/60' : ''}`}>
            <button
              disabled={!canStep || pending}
              onClick={() => act(s.key, { done: s.done ? null : t })}
              className={`grid size-6 shrink-0 place-items-center rounded-full border-2 transition ${s.done ? 'border-ink bg-ink text-bg' : isCur ? 'border-ink' : 'border-line-2'} ${canStep ? 'hover:border-ink' : ''}`}
              aria-label={s.done ? `Reopen ${s.label}` : `Mark ${s.label} done`}
              title={canStep ? (s.done ? 'Reopen' : 'Mark done today') : undefined}
            >
              {busy === s.key ? <Loader2 className="size-3 animate-spin" /> : s.done ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <div className={`text-[12.5px] ${s.done ? 'text-ink-2' : isCur ? 'font-medium' : ''}`}>{s.label}</div>
              <div className="text-[11px] text-ink-3">
                {s.owner === 'maker' ? 'The factory' : s.owner === 'us' ? 'Us' : 'Both'}
                {s.done ? ` · done ${s.done}${s.by ? ` by ${s.by}` : ''}` : ''}
                {s.note ? ` · ${s.note}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 pl-8 sm:pl-0">
              {late && (
                <span className="pill" data-tone="critical">
                  {Math.round((Date.parse(t) - Date.parse(s.planned!)) / 86_400_000)}d late
                </span>
              )}
              {canStep ? (
                <input type="date" className="field !h-8 !w-[140px] text-[12px]" value={s.planned ?? ''} onChange={(e) => act(s.key, { planned: e.target.value || null })} aria-label={`Planned day for ${s.label}`} />
              ) : (
                <span className="font-mono text-[11.5px] text-ink-3">{s.planned ?? '—'}</span>
              )}
              {canStep && (
                <button onClick={() => setNoting(s)} className="btn btn-ghost btn-sm">
                  Note
                </button>
              )}
            </div>
          </li>
        );
      })}
      {noting && <NoteModal step={noting} onClose={() => setNoting(null)} onSave={(note) => go(() => stepAction(id, noting.key, { note }), () => setNoting(null))} pending={pending} />}
    </ol>
  );
}

function NoteModal({ step, onClose, onSave, pending }: { step: StepView; onClose: () => void; onSave: (n: string) => void; pending: boolean }) {
  const [note, setNote] = useState(step.note ?? '');
  return (
    <Modal title={step.label} sub="A note on this step: what was approved, what to fix, what the factory said." onClose={onClose}>
      <textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fit sample: shorten hem 2 cm, approved otherwise" />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">
          Back
        </button>
        <button onClick={() => onSave(note)} disabled={pending} className="btn btn-primary">
          {pending && <Loader2 className="size-4 animate-spin" />} Save note
        </button>
      </div>
    </Modal>
  );
}

// ── Inspections ───────────────────────────────────────────────────────────────────────────────

export function InspectButton({ id, qty }: { id: string; qty: number }) {
  const [open, setOpen] = useState(false);
  const { pending, go } = useRun();
  const [kind, setKind] = useState<'inline' | 'final'>('final');
  const [lot, setLot] = useState(String(qty));
  const plan = aqlPlan(Number(lot) || qty);
  const [sampled, setSampled] = useState('');
  const [major, setMajor] = useState('0');
  const [minor, setMinor] = useState('0');
  const [note, setNote] = useState('');
  const verdict = aqlVerdict(Number(lot) || qty, Number(major) || 0, Number(minor) || 0);
  const [override, setOverride] = useState<'' | 'pass' | 'fail' | 'rework'>('');
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-quiet btn-sm">
        <Plus className="size-3.5" /> Inspection
      </button>
      {open && (
        <Modal title="Record an inspection" sub="AQL 2.5 for major defects, 4.0 for minor (general level II)." onClose={() => setOpen(false)}>
          <div className="flex gap-1.5">
            {(['inline', 'final'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`h-8 rounded-full border px-3 text-[12px] ${kind === k ? 'border-ink bg-ink text-bg' : 'border-line-2 text-ink-2'}`}>
                {k === 'inline' ? 'During production' : 'Final, before packing'}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 text-[11px] text-ink-3">
            <label>
              Lot size (pieces)
              <input className="field mt-0.5 !h-8 font-mono text-[12px]" inputMode="numeric" value={lot} onChange={(e) => setLot(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label>
              Pieces checked
              <input className="field mt-0.5 !h-8 font-mono text-[12px]" inputMode="numeric" value={sampled} placeholder={String(plan.sample)} onChange={(e) => setSampled(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label>
              Major defects (accept ≤ {plan.majorAccept})
              <input className="field mt-0.5 !h-8 font-mono text-[12px]" inputMode="numeric" value={major} onChange={(e) => setMajor(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label>
              Minor defects (accept ≤ {plan.minorAccept})
              <input className="field mt-0.5 !h-8 font-mono text-[12px]" inputMode="numeric" value={minor} onChange={(e) => setMinor(e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-ink-3">Verdict</span>
            <span className="pill" data-tone={(override || verdict) === 'pass' ? 'success' : 'critical'}>
              {override || verdict}
            </span>
            <select className="field !h-8 !w-auto text-[12px]" value={override} onChange={(e) => setOverride(e.target.value as typeof override)}>
              <option value="">By the AQL limits</option>
              <option value="pass">Pass anyway</option>
              <option value="rework">Send back for rework</option>
              <option value="fail">Fail</option>
            </select>
          </div>
          <textarea className="field mt-3" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was found: open seams, shade variation, measurements out…" />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn btn-ghost">
              Back
            </button>
            <button
              disabled={pending}
              onClick={() => go(() => inspectionAction(id, { kind, lot: Number(lot) || qty, sampled: Number(sampled) || plan.sample, major: Number(major) || 0, minor: Number(minor) || 0, result: override || undefined, note }), () => setOpen(false))}
              className="btn btn-primary"
            >
              {pending && <Loader2 className="size-4 animate-spin" />} Save inspection
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Money ─────────────────────────────────────────────────────────────────────────────────────

export function CostEditor({ id, costs, currency, retailPrice }: { id: string; costs: { key: CostKey; label: string; value: number }[]; currency: string; retailPrice: number | null }) {
  const [open, setOpen] = useState(false);
  const { pending, go } = useRun();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(costs.map((c) => [c.key, c.value ? String(toMajor(c.value, currency)) : ''])));
  const [retail, setRetail] = useState(retailPrice ? String(toMajor(retailPrice, currency)) : '');
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-ghost btn-sm">
        Edit
      </button>
      {open && (
        <Modal title="Cost per piece" sub={`In ${currency}. The margin follows from the retail price.`} onClose={() => setOpen(false)}>
          <div className="grid grid-cols-2 gap-2.5">
            {costs.map((c) => (
              <label key={c.key} className="text-[11px] text-ink-3">
                {c.label}
                <input className="field mt-0.5 !h-8 font-mono text-[12px]" inputMode="decimal" value={v[c.key] ?? ''} onChange={(e) => setV((x) => ({ ...x, [c.key]: e.target.value.replace(/[^\d.]/g, '') }))} />
              </label>
            ))}
            <label className="col-span-2 text-[11px] text-ink-3">
              Retail price
              <input className="field mt-0.5 !h-8 font-mono text-[12px]" inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn btn-ghost">
              Back
            </button>
            <button
              disabled={pending}
              onClick={() => go(() => updateProductionAction(id, { costs: Object.fromEntries(costs.map((c) => [c.key, toMinor(v[c.key] || 0, currency)])), retailPrice: retail ? toMinor(retail, currency) : null }), () => setOpen(false))}
              className="btn btn-primary"
            >
              {pending && <Loader2 className="size-4 animate-spin" />} Save
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Payments({ id, payments, currency, canManage, canPay }: { id: string; payments: Payment[]; currency: string; canManage: boolean; canPay: boolean }) {
  const { pending, go } = useRun();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Payment['kind']>('deposit');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [ref, setRef] = useState('');
  return (
    <div>
      {payments.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-ink-3">No payments agreed yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {payments.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <div className="capitalize">{x.kind}</div>
                <div className="text-[11px] text-ink-3">
                  {x.paidAt ? `Paid ${x.paidAt}` : x.due ? `Due ${x.due}` : 'Due on agreement'}
                  {x.ref ? ` · ${x.ref}` : ''}
                </div>
              </div>
              <span className="font-mono">{money(x.amount, currency)}</span>
              {canPay && (
                <button onClick={() => go(() => paidAction(id, x.id, x.paidAt ? null : today()))} disabled={pending} className={`btn btn-sm ${x.paidAt ? 'btn-ghost' : 'btn-quiet'}`}>
                  {x.paidAt ? 'Undo' : 'Mark paid'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="border-t border-line px-5 py-3">
          {adding ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <select className="field !h-8 text-[12px]" value={kind} onChange={(e) => setKind(e.target.value as Payment['kind'])}>
                <option value="deposit">Deposit</option>
                <option value="balance">Balance</option>
                <option value="other">Other</option>
              </select>
              <input className="field !h-8 font-mono text-[12px]" inputMode="decimal" placeholder={`Amount ${currency}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
              <input type="date" className="field !h-8 text-[12px]" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
              <input className="field !h-8 text-[12px]" placeholder="Invoice / ref" value={ref} onChange={(e) => setRef(e.target.value)} />
              <button
                disabled={pending || !amount}
                onClick={() =>
                  go(() => paymentAction(id, { kind, amount: toMinor(amount, currency), due: due || null, ref }), () => {
                    setAdding(false);
                    setAmount('');
                    setRef('');
                  })
                }
                className="btn btn-primary btn-sm"
              >
                Add
              </button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="btn btn-ghost btn-sm">
              <Plus className="size-3.5" /> Payment
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Receiving and closing ─────────────────────────────────────────────────────────────────────

export function ReceiveForm({ id, received, rejected, qty }: { id: string; received: number; rejected: number; qty: number }) {
  const { pending, go } = useRun();
  const [r, setR] = useState(String(received || ''));
  const [x, setX] = useState(String(rejected || ''));
  return (
    <div className="flex flex-wrap items-end gap-2 text-[11px] text-ink-3">
      <label>
        Received
        <input className="field mt-0.5 !h-8 !w-24 font-mono text-[12px]" inputMode="numeric" value={r} placeholder={String(qty)} onChange={(e) => setR(e.target.value.replace(/\D/g, ''))} />
      </label>
      <label>
        Rejected
        <input className="field mt-0.5 !h-8 !w-24 font-mono text-[12px]" inputMode="numeric" value={x} placeholder="0" onChange={(e) => setX(e.target.value.replace(/\D/g, ''))} />
      </label>
      <button disabled={pending} onClick={() => go(() => updateProductionAction(id, { received: Number(r) || 0, rejected: Number(x) || 0 }))} className="btn btn-quiet btn-sm">
        {pending && <Loader2 className="size-3.5 animate-spin" />} Save
      </button>
    </div>
  );
}

export function CancelButton({ id, cancelled }: { id: string; cancelled: boolean }) {
  const { pending, go } = useRun();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!cancelled && !confirm('Cancel this production order? The factory should be told separately.')) return;
        go(() => updateProductionAction(id, cancelled ? { reopen: true } : { cancel: true }));
      }}
      className={`btn btn-sm ${cancelled ? 'btn-quiet' : 'btn-ghost'}`}
    >
      {cancelled ? 'Reopen' : 'Cancel order'}
    </button>
  );
}

// ── Factories ─────────────────────────────────────────────────────────────────────────────────

export type MakerForm = { id?: string; name: string; country: string; city: string | null; contactName: string | null; phone: string | null; email: string | null; skills: string[]; capacity: number | null; leadDays: number | null; paymentTerms: string | null; notes: string | null; active: boolean };

export function MakerButton({ maker, label }: { maker?: MakerForm; label?: string }) {
  const [open, setOpen] = useState(false);
  const { pending, go } = useRun();
  const [f, setF] = useState<MakerForm>(maker ?? { name: '', country: 'EG', city: '', contactName: '', phone: '', email: '', skills: [], capacity: null, leadDays: null, paymentTerms: '', notes: '', active: true });
  const text = (k: keyof MakerForm, placeholder?: string) => <input className="field" value={(f[k] as string | null) ?? ''} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
  return (
    <>
      <button onClick={() => setOpen(true)} className={maker ? 'btn btn-ghost btn-sm' : 'btn btn-quiet btn-sm'}>
        {maker ? (label ?? 'Edit') : (
          <>
            <Factory className="size-3.5" /> Add factory
          </>
        )}
      </button>
      {open && (
        <Modal title={maker ? maker.name : 'Add a factory'} sub="The manufacturer we place production with." onClose={() => setOpen(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs text-ink-3">Name</span>
              {text('name', 'e.g. Delta Garments')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1 block text-xs text-ink-3">Country</span>
                {text('country', 'EG')}
              </label>
              <label>
                <span className="mb-1 block text-xs text-ink-3">City</span>
                {text('city', '10th of Ramadan')}
              </label>
            </div>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Contact</span>
              {text('contactName', 'Name')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1 block text-xs text-ink-3">Phone</span>
                {text('phone')}
              </label>
              <label>
                <span className="mb-1 block text-xs text-ink-3">Email</span>
                {text('email')}
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1 block text-xs text-ink-3">Pieces a month</span>
                <input className="field font-mono" inputMode="numeric" value={f.capacity ?? ''} onChange={(e) => setF({ ...f, capacity: Number(e.target.value.replace(/\D/g, '')) || null })} />
              </label>
              <label>
                <span className="mb-1 block text-xs text-ink-3">Lead time, days</span>
                <input className="field font-mono" inputMode="numeric" value={f.leadDays ?? ''} onChange={(e) => setF({ ...f, leadDays: Number(e.target.value.replace(/\D/g, '')) || null })} />
              </label>
            </div>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Payment terms</span>
              {text('paymentTerms', 'e.g. 30% deposit, 70% before shipping')}
            </label>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-xs text-ink-3">What they make</div>
            <div className="flex flex-wrap gap-1.5">
              {MAKER_SKILLS.map((s) => (
                <button key={s} onClick={() => setF({ ...f, skills: f.skills.includes(s) ? f.skills.filter((x) => x !== s) : [...f.skills, s] })} className={`h-8 rounded-full border px-3 text-[12px] ${f.skills.includes(s) ? 'border-ink bg-ink text-bg' : 'border-line-2 text-ink-2'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <textarea className="field mt-3" rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes: certifications, minimums, who to call when it is late" />
          {maker && (
            <label className="mt-3 flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="accent-[var(--ink)]" /> Still working with them
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button disabled={pending || !f.name.trim()} onClick={() => go(() => saveMakerAction({ ...f, city: f.city ?? undefined, contactName: f.contactName ?? undefined, phone: f.phone ?? undefined, email: f.email ?? undefined, paymentTerms: f.paymentTerms ?? undefined, notes: f.notes ?? undefined }), () => setOpen(false))} className="btn btn-primary">
              {pending && <Loader2 className="size-4 animate-spin" />} Save factory
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
