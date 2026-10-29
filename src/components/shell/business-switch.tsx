'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Store } from 'lucide-react';
import { setBusinessAction } from '@/app/actions';
import type { Business, BusinessView } from '@/lib/business';

const LABEL: Record<BusinessView, string> = { labesny: 'Labesny', fig: 'FIG', all: 'Both' };

/**
 * FIG or Labesny, at the top of every page: the whole console (lists, figures, exports) follows the
 * pick. Drawn as the Ghattas admin's language switch. Only the businesses this person covers are
 * offered; with one, it just names it.
 */
export function BusinessSwitch({ businesses, current, compact = false }: { businesses: Business[]; current: BusinessView; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(current);
  if (businesses.length < 2) {
    if (!businesses.length) return null;
    return (
      <span className="app-switch" data-compact={compact ? 'true' : undefined}>
        <Store strokeWidth={1.6} />
        <button role="radio" aria-checked="true">
          {LABEL[businesses[0]]}
        </button>
      </span>
    );
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
    <div role="radiogroup" aria-label="Business" className="app-switch relative" data-compact={compact ? 'true' : undefined}>
      {pending ? <Loader2 className="animate-spin" /> : <Store strokeWidth={1.6} />}
      {options.map((v) => (
        <button key={v} role="radio" aria-checked={shown === v} onClick={() => pick(v)}>
          {LABEL[v]}
        </button>
      ))}
    </div>
  );
}
