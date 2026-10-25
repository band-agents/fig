'use client';

import { useState, useTransition } from 'react';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { adjustStockAction } from '@/app/(console)/stock/actions';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';

/** Book a correction against one size in one place, with the reason on the ledger. */
export function AdjustStock({ sizes, places }: { sizes: { id: string; size: string }[]; places: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState(sizes[0]?.id ?? '');
  const [place, setPlace] = useState(places[0]?.id ?? '');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-quiet btn-sm">
        <SlidersHorizontal className="size-3.5" /> Adjust stock
      </button>
      {open && (
        <Modal title="Adjust stock" sub="For what a count found, damage, samples and anything else the system did not see. It goes on the ledger with your name." onClose={() => setOpen(false)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs text-ink-3">Where</span>
              <select className="field" value={place} onChange={(e) => setPlace(e.target.value)}>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Size</span>
              <select className="field" value={variant} onChange={(e) => setVariant(e.target.value)}>
                {sizes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.size}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Pieces (+ found, − missing)</span>
              <input className="field font-mono" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ''))} placeholder="-2" />
            </label>
            <label>
              <span className="mb-1 block text-xs text-ink-3">Reason</span>
              <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged in the store" list="adjust-reasons" />
              <datalist id="adjust-reasons">
                <option value="Count difference" />
                <option value="Damaged" />
                <option value="Found in the back" />
                <option value="Used as a sample" />
                <option value="Lost" />
              </datalist>
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button
              disabled={pending || !Number(delta) || !reason.trim()}
              onClick={() =>
                start(async () => {
                  const r = await adjustStockAction({ variantId: variant, locationId: place, delta: Number(delta), reason });
                  if (r.ok) {
                    toast(r.message ?? 'Adjusted');
                    setOpen(false);
                    setDelta('');
                    setReason('');
                  } else toast(r.error, { tone: 'error' });
                })
              }
              className="btn btn-primary"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Book it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
