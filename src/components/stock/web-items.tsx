'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { runWebItemsAction } from '@/app/(console)/stock/web-items/actions';

/** Re-read the website, or ask Lucida, for the comparison; and keep the page fresh while a run goes. */
export function WebItemsRun({ store, lucida, running, canRun, callsNeeded, accounts, callsLeft }: { store: string; lucida: boolean; running: string | null; canRun: boolean; callsNeeded: number; accounts: number; callsLeft: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [days, setDays] = useState(0);
  // while a run goes, look again every few seconds
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [running, router]);
  const go = (what: 'website' | 'lucida') =>
    start(async () => {
      const r = await runWebItemsAction(store, what, what === 'lucida' ? days : 0);
      if (r.ok) toast(r.message ?? 'Started');
      else toast(r.error, { tone: 'error' });
      router.refresh();
    });
  if (!canRun) return null;
  const need = callsNeeded + (days ? accounts : 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {running ? (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
          <Loader2 className="size-3.5 animate-spin" /> {running === 'lucida' ? 'Asking Lucida…' : 'Reading the website…'}
        </span>
      ) : (
        <>
          <button onClick={() => go('website')} disabled={pending} className="btn btn-quiet btn-sm">
            <RefreshCw className="size-3.5" /> Read the website
          </button>
          {lucida && (
            <>
              <select className="field !h-8 !w-auto text-[12px]" value={days} onChange={(e) => setDays(Number(e.target.value))} title="Also list what Lucida changed lately that the website does not have">
                <option value={0}>Website barcodes only</option>
                <option value={3}>+ Lucida items changed in 3 days</option>
                <option value={7}>+ Lucida items changed in 7 days</option>
              </select>
              <button onClick={() => go('lucida')} disabled={pending || (callsLeft != null && need > callsLeft)} className="btn btn-primary btn-sm" title={`${need} Lucida calls${callsLeft != null ? `, ${callsLeft} left this hour` : ''}`}>
                Ask Lucida ({need} call{need === 1 ? '' : 's'})
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
