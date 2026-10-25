import { moneyIn, num } from '@/lib/format';
import { share } from '@/components/reports/bits';
import type { Fmt, Grain } from '@/lib/reports/engine';

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A report value as people read it: money in the view's currency, pieces with separators, hours that turn into days. */
export function show(v: unknown, fmt: Fmt, currency: string, opts: { grain?: Grain; compact?: boolean } = {}): string {
  if (v == null || v === '') return '—';
  if (fmt === 'text') return String(v);
  if (fmt === 'date') {
    const s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    if (opts.grain === 'month') return MONTH.format(d);
    if (opts.grain === 'week') return `w/c ${SHORT.format(d)}`;
    if (opts.grain === 'day') return DAY.format(d);
    return DATE.format(d);
  }
  const x = Number(v);
  if (!Number.isFinite(x)) return String(v);
  if (fmt === 'money') return moneyIn(x, currency, { compact: opts.compact });
  if (fmt === 'int') return num(Math.round(x));
  if (fmt === 'pct') return share(x);
  if (fmt === 'hours') return x >= 48 ? `${(x / 24).toFixed(1)} d` : `${x.toFixed(x < 10 ? 1 : 0)} h`;
  if (fmt === 'days') return `${x.toFixed(1)} d`;
  if (fmt === 'weeks') return x < 1 ? '<1 wk' : x > 104 ? '2 yr+' : `${Math.round(x)} wk`;
  return x >= 100 ? num(Math.round(x)) : x.toFixed(1);
}
