'use client';

import { useState, useTransition } from 'react';
import { CircleAlert, CircleCheck, Loader2, PlugZap, RefreshCcw } from 'lucide-react';
import { checkChannelAction, syncChannelAction } from '@/app/(console)/channels/actions';
import type { ConnectionCheck } from '@/lib/connectors/types';

export function ChannelControls({ id, configured, canAct, lastRun }: { id: string; configured: boolean; canAct: boolean; lastRun: { ok: boolean | null; note: string | null } | null }) {
  const [pending, start] = useTransition();
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [sync, setSync] = useState<{ ok: boolean; note: string } | null>(null);
  return (
    <div className="space-y-2">
      {canAct && (
        <div className="flex gap-2">
          <button disabled={pending} onClick={() => start(async () => setCheck(await checkChannelAction(id)))} className="btn btn-quiet btn-sm">
            {pending && !sync ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
            Check connection
          </button>
          <button disabled={pending || !configured} onClick={() => start(async () => setSync(await syncChannelAction(id)))} className="btn btn-quiet btn-sm">
            <RefreshCcw className={`size-3.5 ${pending && sync === null ? '' : ''}`} />
            Sync now
          </button>
        </div>
      )}
      {check && (
        <div className={`rounded-lg px-3 py-2 text-[12px] ${check.ok ? 'bg-[color-mix(in_oklab,var(--good)_10%,transparent)]' : 'bg-[color-mix(in_oklab,var(--critical)_10%,transparent)]'}`}>
          <div className="flex items-start gap-2">
            {check.ok ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-good" /> : <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-critical" />}
            <span>{check.note}</span>
          </div>
          {check.missing && check.missing.length > 0 && <div className="mt-1 pl-5 font-mono text-[11px] text-ink-3">missing scopes: {check.missing.join(', ')}</div>}
          {check.shop?.name && <div className="mt-1 pl-5 text-[11px] text-ink-3">{[check.shop.name, check.shop.currency, check.shop.timezone].filter(Boolean).join(' · ')}</div>}
        </div>
      )}
      {(sync ?? (lastRun && lastRun.ok === false ? { ok: false, note: lastRun.note ?? '' } : null)) && (
        <div className={`flex items-start gap-2 text-[12px] ${(sync ?? lastRun)?.ok ? 'text-good' : 'text-critical'}`}>
          {(sync ?? lastRun)?.ok ? <CircleCheck className="mt-0.5 size-3.5" /> : <CircleAlert className="mt-0.5 size-3.5" />}
          {(sync ?? lastRun)?.note}
        </div>
      )}
    </div>
  );
}
