// Report periods (Reports → any report): pure, so they can be tested without a database.

export type Query = { period?: string; from?: string; to?: string; compare?: string; brand?: string; channel?: string; category?: string; branch?: string };

export const PRESETS = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'mtd', label: 'This month' },
  { key: 'last', label: 'Last month' },
  { key: 'qtd', label: 'This quarter' },
  { key: 'ytd', label: 'This year' },
  { key: '12m', label: '12 months' },
] as const;
export type Preset = (typeof PRESETS)[number]['key'] | 'custom';
export type Grain = 'day' | 'week' | 'month';
export type Range = { preset: Preset; from: Date; to: Date; prevFrom: Date; prevTo: Date; days: number; label: string; grain: Grain; compare: 'prev' | 'ly' };

const DAY = 86_400_000;
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? new Date(`${s}T00:00:00Z`) : null);

/** The period a report reads, the one it compares against (the one before, or the same dates a year ago), and its bucket size. */
export function rangeOf(q: Query, now = new Date()): Range {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = new Date(Date.UTC(y, m, now.getUTCDate()));
  const end = new Date(today.getTime() + DAY); // to is exclusive
  let preset: Preset = (PRESETS.some((p) => p.key === q.period) ? q.period : q.period === 'custom' ? 'custom' : '30') as Preset;
  let from: Date;
  let to = end;
  if (preset === 'custom') {
    const f = parseDay(q.from);
    const t = parseDay(q.to);
    if (f && t && f <= t) {
      from = f;
      to = new Date(t.getTime() + DAY);
    } else {
      preset = '30';
      from = new Date(end.getTime() - 30 * DAY);
    }
  } else if (preset === 'mtd') from = new Date(Date.UTC(y, m, 1));
  else if (preset === 'last') {
    from = new Date(Date.UTC(y, m - 1, 1));
    to = new Date(Date.UTC(y, m, 1));
  } else if (preset === 'qtd') from = new Date(Date.UTC(y, m - (m % 3), 1));
  else if (preset === 'ytd') from = new Date(Date.UTC(y, 0, 1));
  else if (preset === '12m') from = new Date(Date.UTC(y - 1, m, now.getUTCDate() + 1));
  else from = new Date(end.getTime() - Number(preset) * DAY);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  const compare = q.compare === 'ly' ? 'ly' : 'prev';
  const prevFrom = compare === 'ly' ? new Date(Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth(), from.getUTCDate())) : new Date(from.getTime() - days * DAY);
  const prevTo = compare === 'ly' ? new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate())) : from;
  const grain: Grain = days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
  const label = preset === 'custom' ? `${ymd(from)} to ${ymd(new Date(to.getTime() - DAY))}` : PRESETS.find((p) => p.key === preset)!.label;
  return { preset, from, to, prevFrom, prevTo, days, label, grain, compare };
}

/** Every bucket key in the period (day, Monday of the week, or first of the month), so quiet days still show. */
export function bucketsOf(r: Pick<Range, 'from' | 'to' | 'grain'>): string[] {
  const out: string[] = [];
  let d = new Date(r.from);
  if (r.grain === 'week') d = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
  if (r.grain === 'month') d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  while (d < r.to && out.length < 400) {
    out.push(ymd(d));
    d = r.grain === 'month' ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) : new Date(d.getTime() + (r.grain === 'week' ? 7 : 1) * DAY);
  }
  return out;
}

