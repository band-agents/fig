'use client';

import { useTransition } from 'react';
import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { retryStoreAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';

/**
 * When the store refused an update from here: what it said, and one click to send it again. Also the
 * changes made during the dry run, once write-back is live: they were only recorded, never sent.
 */
export function StoreStatus({ orderId, failed, unsent = [], canRetry }: { orderId: string; failed: { key: string; why: string }[]; unsent?: string[]; canRetry: boolean }) {
  const [pending, start] = useTransition();
  if (!failed.length && !unsent.length) return null;
  return (
    <div className="flex max-w-md items-start gap-2.5 rounded-xl border border-[color-mix(in_oklab,var(--signal)_35%,transparent)] bg-[color-mix(in_oklab,var(--signal)_8%,transparent)] px-3 py-2.5 text-[12px]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-critical" />
      <div className="min-w-0 flex-1">
        {failed.length ? (
          <>
            <div className="font-medium text-ink">Shopify did not take {failed.length === 1 ? 'the last update' : `${failed.length} updates`}</div>
            <div className="mt-0.5 line-clamp-2 text-ink-3" title={failed.map((f) => f.why).join(' · ')}>
              {failed[0].why}
            </div>
          </>
        ) : (
          <>
            <div className="font-medium text-ink">Not sent to Shopify yet</div>
            <div className="mt-0.5 line-clamp-2 text-ink-3">Done here while store updates were only being tested. Send it so Shopify matches.</div>
          </>
        )}
      </div>
      {canRetry && (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await retryStoreAction(orderId);
              toast(r.ok ? (r.message ?? 'Sent again') : r.error, { tone: r.ok ? 'ok' : 'error' });
            })
          }
          className="btn btn-quiet btn-sm shrink-0"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} {failed.length ? 'Retry' : 'Send to Shopify'}
        </button>
      )}
    </div>
  );
}
