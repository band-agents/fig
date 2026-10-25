import { Truck } from 'lucide-react';
import { COUNTRY_NAME, destinationOf, fmt, recommend, type Courier } from '@/lib/domain/courier-rates';

/**
 * Which courier this parcel should go with, and what each would cost us (Labesny's rate sheet, price
 * first). Shown on Kuwait-company orders only; the pick is a recommendation, the desk still decides.
 */
export function CourierChoice({ country, area, pieces, cod, deliveryPaid, apis }: { country: string | null | undefined; area: string | null; pieces: number; cod: number; deliveryPaid: number | null; apis: Courier[] }) {
  const to = destinationOf(country);
  if (!to) return null;
  const r = recommend({ to, pieces, area, codAmount: cod }, { apis });
  if (!r.pick) return null;
  const margin = deliveryPaid != null ? deliveryPaid - r.pick.total : null;
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between">
        <div className="eyebrow">Courier choice</div>
        <span className="text-[11px] text-ink-3">{COUNTRY_NAME[to]}{to === 'KW' && area ? ` · ${area}` : ''} · {r.kg} kg{r.estimated ? ' est.' : ''}</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Truck className="size-4 text-ink-3" />
        <span className="text-[13px] font-medium">{r.pick.label}</span>
        <span className="ml-auto font-mono text-[13px]">KWD {fmt(r.pick.total)}</span>
      </div>
      <p className="mt-1 text-[11.5px] text-ink-3">{r.why}{r.pick.note ? ` · ${r.pick.note}` : ''}</p>
      {margin != null && (
        <p className={`mt-1 text-[11.5px] ${margin < 0 ? 'text-critical' : 'text-ink-3'}`}>
          Customer paid KWD {fmt(deliveryPaid!)} for delivery · {margin < 0 ? `we lose ${fmt(-margin)}` : `${fmt(margin)} left`}
        </p>
      )}
      <ul className="mt-3 divide-y divide-[var(--line)] text-[12px]">
        {r.options.map((o) => (
          <li key={o.label} className={`flex items-center gap-2 py-1.5 ${o.inUse ? '' : 'text-ink-4'}`}>
            <span className="min-w-0 flex-1 truncate" title={o.surcharges.map((s) => `${s.label} ${fmt(s.amount)}`).join(' · ') || undefined}>
              {o.label}
              {!o.inUse && ' · not used at home'}
              {o.hasApi && <span className="ml-1 text-[10.5px] text-ink-3">· books itself</span>}
            </span>
            <span className="font-mono">{fmt(o.total)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
