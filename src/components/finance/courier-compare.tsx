'use client';

import { useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import { COUNTRY_NAME, customerPriceAbroad, fmt, INTERNATIONAL, OFF_CITY, recommend, WORLD, type Destination, type Speed } from '@/lib/domain/courier-rates';
import { gmtcArea } from '@/lib/connectors/kuwait-areas';

const PIECES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15];

/**
 * Labesny's couriers side by side (D&H's 2026 rate sheet, the surcharges in the couriers' emails and
 * Moody's customer price abroad): the calculator for one parcel, and the cheapest courier and our margin
 * for every country by number of pieces.
 */
export function CourierCompare({ ups }: { ups: boolean }) {
  const [to, setTo] = useState<Destination>('KW');
  const [pieces, setPieces] = useState('2');
  const [kg, setKg] = useState('');
  const [area, setArea] = useState('Salmiya');
  const [speed, setSpeed] = useState<Speed>('next_day');
  const [cod, setCod] = useState(false);
  const n = Math.max(1, Number(pieces) || 1);
  const r = useMemo(
    () => recommend({ to, pieces: n, kg: Number(kg) || null, area: gmtcArea(area, { within: true }) ?? area, speed, codAmount: cod ? 1 : 0 }, { apis: ups ? ['UPS'] : [] }),
    [to, n, kg, area, speed, cod, ups],
  );
  const price = to === 'KW' ? null : customerPriceAbroad(n);

  return (
    <div className="space-y-4">
      <div className="panel p-5">
        <div className="mb-3 flex items-center gap-2">
          <Scale className="size-4 text-ink-3" />
          <h3 className="text-[14px] font-semibold">Which courier? Labesny, price first</h3>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-[12px]">
          <label className="grid gap-1">
            <span className="text-ink-3">Going to</span>
            <select value={to} onChange={(e) => setTo(e.target.value as Destination)} className="field !h-9">
              <option value="KW">Kuwait (domestic)</option>
              {INTERNATIONAL.map((c) => (
                <option key={c} value={c}>{COUNTRY_NAME[c]}</option>
              ))}
              <optgroup label="Not open on the website">
                {WORLD.map((c) => (
                  <option key={c} value={c}>{COUNTRY_NAME[c]}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-ink-3">Pieces</span>
            <input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" className="field !h-9 !w-20" />
          </label>
          <label className="grid gap-1">
            <span className="text-ink-3">Weight kg (if known)</span>
            <input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="decimal" placeholder={String(r.kg)} className="field !h-9 !w-24" />
          </label>
          {to === 'KW' && (
            <>
              <label className="grid gap-1">
                <span className="text-ink-3">Area</span>
                <input value={area} onChange={(e) => setArea(e.target.value)} list="kw-off-city" className="field !h-9 !w-40" />
                <datalist id="kw-off-city">{OFF_CITY.map((a) => <option key={a} value={a} />)}</datalist>
              </label>
              <label className="grid gap-1">
                <span className="text-ink-3">Speed</span>
                <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)} className="field !h-9">
                  <option value="next_day">Next day</option>
                  <option value="same_day">Same day</option>
                </select>
              </label>
              <label className="flex h-9 items-center gap-2">
                <input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} /> Cash on delivery
              </label>
            </>
          )}
        </div>

        {r.pick ? (
          <div className="mt-4 rounded-xl bg-[var(--bg-sunk,#f4f3ef)] p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[12px] text-ink-3">Pick</span>
              <span className="text-[16px] font-semibold">{r.pick.label}</span>
              <span className="font-mono text-[16px]">KWD {fmt(r.pick.total)}</span>
              <span className="text-[12px] text-ink-3">· {r.kg} kg{r.estimated ? ' estimated' : ''}, charged as {r.pick.chargedKg} kg</span>
            </div>
            <p className="mt-1 text-[12px] text-ink-3">{r.why}{r.pick.note ? ` · ${r.pick.note}` : ''}</p>
            {price != null && (
              <p className={`mt-1 text-[12px] ${price - r.pick.total < 0 ? 'text-critical' : 'text-ink-2'}`}>
                Customer pays KWD {fmt(price)} for {n} piece{n > 1 ? 's' : ''} (Moody&apos;s table) · {price - r.pick.total < 0 ? `we lose ${fmt(r.pick.total - price)}` : `${fmt(price - r.pick.total)} left`}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-[12px] text-ink-3">{r.why}</p>
        )}

        <table className="mt-3 w-full text-[12px]">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-1 font-normal">Courier</th>
              <th className="py-1 text-right font-normal">Freight</th>
              <th className="py-1 pl-4 font-normal">Surcharges</th>
              <th className="py-1 text-right font-normal">Total KWD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {r.options.map((o) => (
              <tr key={o.label} className={o === r.pick ? 'font-semibold' : o.inUse ? '' : 'text-ink-4'}>
                <td className="py-1.5">
                  {o.label}
                  {!o.inUse && ' (not used in Kuwait)'}
                  {o.hasApi && <span className="ml-1 text-[10.5px] font-normal text-ink-3">· books itself</span>}
                </td>
                <td className="py-1.5 text-right font-mono">{fmt(o.freight)}</td>
                <td className="py-1.5 pl-4 text-ink-3">{o.surcharges.map((s) => `${s.label} ${fmt(s.amount)}`).join(' · ') || '—'}</td>
                <td className="py-1.5 text-right font-mono">{fmt(o.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel overflow-x-auto p-5">
        <h3 className="text-[14px] font-semibold">Abroad: cheapest courier, and what is left from the customer&apos;s price</h3>
        <p className="mt-1 text-[12px] text-ink-3">Cost includes UPS surge 0.300/kg and Aramex war risk; UPS fuel surcharge not included (GMTC has not said the %). Red = the customer price is below our cost.</p>
        <table className="mt-3 min-w-[760px] text-[11.5px]">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-1 pr-3 font-normal">Pieces → customer pays</th>
              {INTERNATIONAL.map((c) => (
                <th key={c} className="py-1 pr-3 font-normal">{COUNTRY_NAME[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {PIECES.map((p) => {
              const charge = customerPriceAbroad(p);
              return (
                <tr key={p}>
                  <td className="py-1.5 pr-3 font-mono">{p} → {fmt(charge)}</td>
                  {INTERNATIONAL.map((c) => {
                    const q = recommend({ to: c, pieces: p }).pick;
                    const left = q ? charge - q.total : 0;
                    return (
                      <td key={c} className={`py-1.5 pr-3 ${left < 0 ? 'text-critical' : ''}`} title={q ? `${q.courier} costs ${fmt(q.total)}` : ''}>
                        <div>{q?.courier ?? '—'} {q ? fmt(q.total) : ''}</div>
                        <div className="text-ink-3">{left < 0 ? '−' : '+'}{fmt(Math.abs(left))}</div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
