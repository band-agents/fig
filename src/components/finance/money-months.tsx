'use client';

import { MonthCompare, type MonthBar } from '@/components/charts/stock-charts';
import { TO_EGP } from '@/lib/format';
import { useMeasure } from '@/components/ui/measure';

const short = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

type Month = MonthBar & { unitsThisYear?: number | null; unitsLastYear?: number | null };

/**
 * Net sales by month, this year against last, in the page's currency (amounts arrive EGP-equivalent
 * minor), or in pieces when the Value | Pieces switch says so.
 */
export function MoneyMonths({ months, currency }: { months: Month[]; currency: string }) {
  const { by } = useMeasure();
  if (by === 'units') {
    const bars = months.map((m) => ({ ...m, thisYear: m.unitsThisYear ?? null, lastYear: m.unitsLastYear ?? null }));
    return <MonthCompare months={bars} height={230} format={(v) => `${short.format(v)} pcs`} showForecast={false} />;
  }
  const major = (v: number | null) => (v == null ? null : v / 100 / (TO_EGP[currency] ?? 1));
  const bars = months.map((m) => ({ ...m, thisYear: major(m.thisYear), lastYear: major(m.lastYear) }));
  return <MonthCompare months={bars} height={230} format={(v) => `${currency} ${short.format(v)}`} showForecast={false} />;
}
