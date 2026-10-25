'use client';

import { useTransition } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import { readBranchesAction } from '@/app/(console)/analytics/actions';
import { toast } from '@/components/ui/toast';

/** Stock by branch: read every branch from Lucida now instead of waiting for tonight's reading. */
export function ReadBranches({ calls }: { calls: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await readBranchesAction();
          toast(r.ok ? r.message : r.error, { tone: r.ok ? 'ok' : 'error' });
        })
      }
      className="btn btn-quiet btn-sm"
      title={`Takes ${calls} Lucida calls from this hour's budget`}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />} {pending ? 'Reading Lucida…' : 'Read every branch'}
    </button>
  );
}
