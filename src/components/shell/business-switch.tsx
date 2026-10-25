'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { setBusinessAction } from '@/app/actions';
import type { Business, BusinessView } from '@/lib/business';

const LABEL: Record<BusinessView, string> = { labesny: 'Labesny', fig: 'FIG', all: 'Both' };

/**
 * FIG or Labesny, at the top of every page: the whole console (lists, figures, exports) follows the
 * pick. Only the businesses this person covers are offered; with one, it just names it.
 */
export function BusinessSwitch({ businesses, current, compact = false }: { businesses: Business[]; current: BusinessView; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(current);
  if (businesses.length < 2) {
    if (!businesses.length) return null;
    return <span className={`inline-flex items-center rounded-full bg-elev px-3 font-semibold shadow-[var(--card-shadow)] ${compact ? 'h-8 text-[11.5px]' : 'h-[38px] text-[12px]'}`}>{LABEL[businesses[0]]}</span>;
  }
  const options: BusinessView[] = [...businesses, 'all'];
  const pick = (v: BusinessView) => {
    if (v === shown) return;
    start(async () => {
      setShown(v);
      await setBusinessAction(v);
      router.refresh();
    });
  };
  return (
    <div role="radiogroup" aria-label="Business" className={`relative inline-flex items-center gap-0.5 rounded-full bg-elev p-1 shadow-[var(--card-shadow)] ${compact ? 'h-8' : 'h-[38px]'}`}>
      {options.map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={shown === v}
          onClick={() => pick(v)}
          className={`h-full rounded-full font-semibold transition ${compact ? 'px-2.5 text-[11px]' : 'px-3.5 text-[12px]'} ${shown === v ? 'bg-inv text-inv-ink' : 'text-ink-3 hover:text-ink'}`}
        >
          {LABEL[v]}
        </button>
      ))}
      {pending && <Loader2 className="absolute -right-5 size-3.5 animate-spin text-ink-3" />}
    </div>
  );
}
