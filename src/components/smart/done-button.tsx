'use client';

import { useTransition } from 'react';
import { Check, Loader2, Undo2 } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { todayDoneAction } from '@/app/(console)/today/actions';

/** Done (gone for a week) or Undo, for one of Today's items. */
export function DoneButton({ id, done = false, disabled = false }: { id: string; done?: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || disabled}
      title={done ? 'Put it back on the list' : 'Done: off the list for a week, back if it is still true then'}
      onClick={() =>
        start(async () => {
          const r = await todayDoneAction(id, !done);
          if (!r.ok) toast(r.error, { tone: 'error' });
        })
      }
      className={`grid size-8 shrink-0 place-items-center rounded-full transition ${done ? 'text-ink-3 hover:bg-elev-2 hover:text-ink' : 'td-done'}`}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : done ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
    </button>
  );
}
