'use client';

import { createContext, useContext, useState } from 'react';

export type Measure = 'value' | 'units';
export const MEASURE_COOKIE = 'relay_measure';

const Ctx = createContext<{ by: Measure; set: (m: Measure) => void }>({ by: 'value', set: () => {} });

/**
 * Value or pieces, for every report that shows sales (Dan, 24 Oct: each one can switch). One choice for
 * the whole console, kept in a cookie so the server draws the right one first and nothing flickers.
 */
export function MeasureProvider({ initial, children }: { initial: Measure; children: React.ReactNode }) {
  const [by, setBy] = useState<Measure>(initial);
  const set = (m: Measure) => {
    setBy(m);
    document.cookie = `${MEASURE_COOKIE}=${m}; path=/; max-age=31536000; samesite=lax`;
  };
  return <Ctx.Provider value={{ by, set }}>{children}</Ctx.Provider>;
}

export const useMeasure = () => useContext(Ctx);

/** The Value | Pieces switch for a report's corner. Hidden for someone who does not see money: they only get pieces. */
export function MeasureToggle({ money = true, className = '' }: { money?: boolean; className?: string }) {
  const { by, set } = useMeasure();
  if (!money) return null;
  return (
    <div role="radiogroup" aria-label="Show sales as" className={`inline-flex h-7 items-center gap-0.5 rounded-full bg-elev-2 p-0.5 text-[11px] font-semibold ${className}`}>
      {(['value', 'units'] as const).map((m) => (
        <button key={m} role="radio" aria-checked={by === m} onClick={() => set(m)} className={`h-full rounded-full px-2.5 transition ${by === m ? 'bg-elev text-ink shadow-[var(--card-shadow)]' : 'text-ink-3 hover:text-ink'}`}>
          {m === 'value' ? 'Value' : 'Pieces'}
        </button>
      ))}
    </div>
  );
}

/** Shows the value version or the pieces version of a report, whichever is picked; pieces when value is not given. */
export function ByMeasure({ value, units }: { value?: React.ReactNode; units: React.ReactNode }) {
  const { by } = useMeasure();
  return <>{by === 'value' && value !== undefined ? value : units}</>;
}
