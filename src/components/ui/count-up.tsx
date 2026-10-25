'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A figure in its own format: "EGP 25.9K", "1,115", "48%". It shows its real value at once (Dan,
 * 22 Oct: no waiting on the screen); when it changes later (a live refresh) the first number in the
 * text rolls quickly from the old value to the new one, everything around it staying put.
 */
export function CountUp({ text, ms = 450, className = '' }: { text: string; ms?: number; className?: string }) {
  const m = text.match(/-?\d[\d,]*(\.\d+)?/);
  const target = m ? Number(m[0].replace(/,/g, '')) : null;
  const decimals = m?.[1] ? m[1].length - 1 : 0;
  const grouped = m ? m[0].includes(',') || (target != null && Math.abs(target) >= 1000) : false;
  const [v, setV] = useState(target);
  const shown = useRef(target ?? 0);

  useEffect(() => {
    if (target == null || shown.current === target) return;
    let raf = 0;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      raf = requestAnimationFrame(() => {
        shown.current = target;
        setV(target);
      });
      return () => cancelAnimationFrame(raf);
    }
    const from = shown.current;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 4);
      const now = from + (target - from) * eased;
      shown.current = now;
      setV(now);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  if (!m || v == null) return <span className={className}>{text}</span>;
  const out = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
  return (
    <span className={`tabular ${className}`}>
      {text.slice(0, m.index)}
      {out}
      {text.slice((m.index ?? 0) + m[0].length)}
    </span>
  );
}
