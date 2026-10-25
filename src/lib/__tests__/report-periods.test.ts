import { describe, expect, it } from 'vitest';
import { bucketsOf, rangeOf } from '../reports/periods';

const NOW = new Date('2026-10-25T09:00:00Z'); // a Sunday
const day = (d: Date) => d.toISOString().slice(0, 10);

describe('report periods', () => {
  it('reads the last 30 days to the end of today, against the 30 before', () => {
    const r = rangeOf({}, NOW);
    expect(r.preset).toBe('30');
    expect(day(r.from)).toBe('2026-09-26');
    expect(day(r.to)).toBe('2026-10-26'); // exclusive: today counts
    expect(r.days).toBe(30);
    expect(day(r.prevFrom)).toBe('2026-08-27');
    expect(day(r.prevTo)).toBe('2026-09-26');
    expect(r.grain).toBe('day');
  });

  it('gives last month whole months and this month to date', () => {
    const last = rangeOf({ period: 'last' }, NOW);
    expect([day(last.from), day(last.to)]).toEqual(['2026-09-01', '2026-10-01']);
    const mtd = rangeOf({ period: 'mtd' }, NOW);
    expect([day(mtd.from), day(mtd.to)]).toEqual(['2026-10-01', '2026-10-26']);
    const qtd = rangeOf({ period: 'qtd' }, NOW);
    expect(day(qtd.from)).toBe('2026-10-01');
  });

  it('compares with the same dates last year when asked', () => {
    const r = rangeOf({ period: 'mtd', compare: 'ly' }, NOW);
    expect([day(r.prevFrom), day(r.prevTo)]).toEqual(['2025-10-01', '2025-10-26']);
  });

  it('takes two dates, both days included, and falls back on a bad pair', () => {
    const r = rangeOf({ period: 'custom', from: '2026-10-01', to: '2026-10-07' }, NOW);
    expect([day(r.from), day(r.to), r.days]).toEqual(['2026-10-01', '2026-10-08', 7]);
    expect(r.label).toBe('2026-10-01 to 2026-10-07');
    expect(rangeOf({ period: 'custom', from: '2026-10-07', to: '2026-10-01' }, NOW).preset).toBe('30');
    expect(rangeOf({ period: 'custom', from: 'yesterday' }, NOW).preset).toBe('30');
  });

  it('buckets by day, week or month with the length of the period', () => {
    expect(rangeOf({ period: '90' }, NOW).grain).toBe('week');
    expect(rangeOf({ period: '12m' }, NOW).grain).toBe('month');
    const weeks = bucketsOf(rangeOf({ period: '90' }, NOW));
    expect(new Date(`${weeks[0]}T00:00:00Z`).getUTCDay()).toBe(1); // weeks start on Monday
    expect(weeks.at(-1)).toBe('2026-10-19');
    const months = bucketsOf(rangeOf({ period: 'ytd' }, NOW));
    expect(months.length).toBe(10);
    expect(months[0]).toBe('2026-01-01');
    expect(bucketsOf(rangeOf({ period: '7' }, NOW))).toHaveLength(7);
  });
});
