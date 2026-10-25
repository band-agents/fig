// Sorting the range into the piles a planner acts on: what matters most (ABC), how predictable it
// is (XYZ), and how fast it moves against its own category. Pure.

export type Abc = 'A' | 'B' | 'C';
export type Xyz = 'X' | 'Y' | 'Z';
export type Velocity = 'fast' | 'steady' | 'slow' | 'dead' | 'new';

export const VELOCITY_LABEL: Record<Velocity, string> = { fast: 'Fast mover', steady: 'Steady', slow: 'Slow mover', dead: 'Not selling', new: 'New in' };
export const VELOCITY_TINT: Record<Velocity, string> = { fast: 'green', steady: 'blue', slow: 'amber', dead: 'red', new: 'violet' };
/** Series colours for charts: identity, in the fixed categorical order, never the status colours. */
export const VELOCITY_COLOR: Record<Velocity, string> = { fast: 'var(--s3)', steady: 'var(--s1)', slow: 'var(--s4)', dead: 'var(--s2)', new: 'var(--s6)' };

/** The styles that make 80% of sales are A, the next 15% B, the long tail C. */
export function abc<T extends { id: string; revenue: number }>(rows: T[]): Record<string, Abc> {
  const sorted = [...rows].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((s, r) => s + Math.max(0, r.revenue), 0) || 1;
  const out: Record<string, Abc> = {};
  let acc = 0;
  for (const r of sorted) {
    const before = acc / total;
    acc += Math.max(0, r.revenue);
    out[r.id] = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
  }
  return out;
}

/** Steadiness of weekly demand: X sells about the same every week, Z comes in lumps. */
export function xyz(weekly: number[]): Xyz {
  const n = weekly.length;
  if (n < 4) return 'Z';
  const mean = weekly.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return 'Z';
  const sd = Math.sqrt(weekly.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const cv = sd / mean;
  return cv < 0.5 ? 'X' : cv < 1 ? 'Y' : 'Z';
}

export function velocity(i: { rate: number; categoryMedian: number; weeksLive: number; weeksSinceSale: number | null; onHand: number; cover: number }): Velocity {
  if (i.weeksLive < 6) return 'new';
  if (i.onHand > 0 && (i.weeksSinceSale == null || i.weeksSinceSale >= 10)) return 'dead';
  const med = Math.max(0.25, i.categoryMedian);
  if (i.rate >= med * 1.8 && i.rate >= 2) return 'fast';
  if (i.cover > 22 || i.rate < med * 0.45) return 'slow';
  return 'steady';
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
