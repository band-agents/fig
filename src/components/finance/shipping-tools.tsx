'use client';

import { useMemo, useState, useTransition } from 'react';
import { Calculator, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { money, toMajor, toMinor } from '@/lib/format';
import { cardFor, parcelCost, pickupCost, zoneFor, type RateCard, type ShippingRates } from '@/lib/domain/shipping-cost';
import { saveShippingRatesAction } from '@/app/(console)/financials/actions';

const MARKET: Record<string, string> = { EG: 'Egypt', KW: 'Kuwait' };

/** Price one parcel on the couriers' cards: pick where it goes, how heavy, and the cash to collect. */
export function ShippingCalculator({ rates, canEdit }: { rates: ShippingRates; canEdit: boolean }) {
  const markets = [...new Set(rates.cards.map((c) => c.market))];
  const [market, setMarket] = useState(markets[0] ?? 'EG');
  const couriers = rates.cards.filter((c) => c.market === market);
  const [courier, setCourier] = useState(couriers[0]?.courier ?? '');
  const card = cardFor(rates, market, courier);
  const [zone, setZone] = useState('');
  const [city, setCity] = useState('');
  const [pieces, setPieces] = useState('2');
  const [kg, setKg] = useState('');
  const [cod, setCod] = useState('');
  const [refused, setRefused] = useState(false);
  const [editing, setEditing] = useState(false);

  const z = card ? (zone ? card.zones.find((x) => x.key === zone) : city ? zoneFor(card, city) : card.zones[0]) : null;
  const cost = useMemo(() => {
    if (!card || !z) return null;
    // a chosen zone is priced by naming one of its places, so the card's own rule picks it
    // a chosen zone (or, with nothing chosen, the first one) is priced by naming one of its places
    const where = zone || !city ? (z.places[0] ?? z.label) : city;
    return parcelCost(rates, { market, courier: card.courier, city: where || null, pieces: Math.max(1, Number(pieces) || 1), kg: kg ? Number(kg) : null, cod: cod ? toMinor(cod, card.currency) : 0, refused });
  }, [rates, card, z, zone, city, market, pieces, kg, cod, refused]);
  const pick = card ? pickupCost(rates, market, card.courier) : null;

  const line = (label: string, v: number, cur: string) =>
    v ? (
      <div className="flex justify-between text-[12px]">
        <span className="text-ink-3">{label}</span>
        <span className="font-mono">{money(v, cur)}</span>
      </div>
    ) : null;

  return (
    <div className="panel p-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-1.5">
            <Calculator className="size-3.5" /> Calculator
          </div>
          <h2 className="mt-0.5 text-[14px]">What one parcel costs us</h2>
        </div>
        {canEdit && (
          <button onClick={() => setEditing(true)} className="btn btn-quiet btn-sm ml-auto">
            <Pencil className="size-3.5" /> Rate cards
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 text-[12px]">
        {markets.length > 1 && (
          <label>
            <span className="mb-1 block text-[11px] text-ink-3">Market</span>
            <select
              className="field !h-9"
              value={market}
              onChange={(e) => {
                setMarket(e.target.value as 'EG' | 'KW');
                setCourier(rates.cards.find((c) => c.market === e.target.value)?.courier ?? '');
                setZone('');
              }}
            >
              {markets.map((m) => (
                <option key={m} value={m}>
                  {MARKET[m] ?? m}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span className="mb-1 block text-[11px] text-ink-3">Courier</span>
          <select className="field !h-9" value={courier} onChange={(e) => setCourier(e.target.value)}>
            {couriers.map((c) => (
              <option key={c.courier} value={c.courier}>
                {c.courier}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11px] text-ink-3">Zone</span>
          <select className="field !h-9" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">{city ? 'From the city' : 'Choose…'}</option>
            {card?.zones.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11px] text-ink-3">or city</span>
          <input className="field !h-9" value={city} onChange={(e) => (setCity(e.target.value), setZone(''))} placeholder="e.g. Mansoura" />
        </label>
        <label>
          <span className="mb-1 block text-[11px] text-ink-3">Pieces</span>
          <input className="field !h-9 font-mono" inputMode="numeric" value={pieces} onChange={(e) => setPieces(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label>
          <span className="mb-1 block text-[11px] text-ink-3">Weight, kg (optional)</span>
          <input className="field !h-9 font-mono" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^\d.]/g, ''))} placeholder={`≈ ${(Math.max(1, Number(pieces) || 1) * rates.kgPerPiece + rates.kgPerParcel).toFixed(2)}`} />
        </label>
        <label>
          <span className="mb-1 block text-[11px] text-ink-3">Cash to collect ({card?.currency})</span>
          <input className="field !h-9 font-mono" inputMode="decimal" value={cod} onChange={(e) => setCod(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0 if prepaid" />
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input type="checkbox" checked={refused} onChange={(e) => setRefused(e.target.checked)} className="accent-[var(--ink)]" />
          <span>Refused, comes back</span>
        </label>
      </div>

      {cost && (
        <div className="mt-4 space-y-1 rounded-xl bg-elev-2 px-3.5 py-3">
          {line(`${cost.zone}, first kilo`, cost.base, cost.currency)}
          {line(`Extra weight (${cost.kg} kg)`, cost.extraKg, cost.currency)}
          {line('Cash collection fee', cost.cod, cost.currency)}
          {line('Trip back', cost.rto, cost.currency)}
          {line('Fuel surcharge', cost.fuel, cost.currency)}
          <div className="flex justify-between border-t border-line pt-1.5 text-[13px] font-medium">
            <span>We pay</span>
            <span className="font-mono">{money(cost.total, cost.currency)}</span>
          </div>
          {pick && <p className="pt-1 text-[11px] text-ink-3">Collecting a return from a customer: {money(pick.total, pick.currency)}</p>}
        </div>
      )}
      {card?.placeholder && <p className="mt-2 text-[11.5px] text-ink-3">Placeholder rates until the courier’s own card is in{canEdit ? ': change them under Rate cards.' : '.'}</p>}
      {editing && <RatesEditor rates={rates} onClose={() => setEditing(false)} />}
    </div>
  );
}

type Draft = Omit<RateCard, 'zones'> & { zones: { key: string; label: string; places: string; base: string }[]; perKgS: string; codPctS: string; codMinS: string; rtoPctS: string; pickupS: string; fuelPctS: string };

const toDraft = (c: RateCard): Draft => ({
  ...c,
  zones: c.zones.map((z) => ({ key: z.key, label: z.label, places: z.places.join(', '), base: String(toMajor(z.base, c.currency)) })),
  perKgS: String(toMajor(c.perKg, c.currency)),
  codPctS: String(Math.round(c.codPct * 10000) / 100),
  codMinS: String(toMajor(c.codMin, c.currency)),
  rtoPctS: String(Math.round(c.rtoPct * 100)),
  pickupS: String(toMajor(c.pickup, c.currency)),
  fuelPctS: String(Math.round(c.fuelPct * 10000) / 100),
});

const fromDraft = (d: Draft): RateCard => {
  const n = (s: string) => Number(s) || 0;
  const zones = d.zones
    .filter((z) => z.label.trim())
    .map((z, i) => ({ key: z.key || `zone-${i + 1}`, label: z.label.trim(), places: z.places.split(',').map((p) => p.trim()).filter(Boolean), base: toMinor(n(z.base), d.currency) }));
  return {
    courier: d.courier.trim() || 'Courier',
    market: d.market,
    currency: d.currency,
    zones,
    fallbackZone: zones.some((z) => z.key === d.fallbackZone) ? d.fallbackZone : (zones[0]?.key ?? ''),
    perKg: toMinor(n(d.perKgS), d.currency),
    codPct: n(d.codPctS) / 100,
    codMin: toMinor(n(d.codMinS), d.currency),
    rtoPct: n(d.rtoPctS) / 100,
    pickup: toMinor(n(d.pickupS), d.currency),
    fuelPct: n(d.fuelPctS) / 100,
    placeholder: d.placeholder,
  };
};

/** The couriers' cards: price per zone, extra kilos, the cash fee, the trip back, collecting a return. */
function RatesEditor({ rates, onClose }: { rates: ShippingRates; onClose: () => void }) {
  const [cards, setCards] = useState<Draft[]>(() => rates.cards.map(toDraft));
  const [kgPiece, setKgPiece] = useState(String(rates.kgPerPiece));
  const [kgParcel, setKgParcel] = useState(String(rates.kgPerParcel));
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<Draft>) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setZone = (i: number, k: number, patch: Partial<Draft['zones'][number]>) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, zones: c.zones.map((z, q) => (q === k ? { ...z, ...patch } : z)) } : c)));
  const num = 'field !h-8 font-mono text-[12px]';
  const small = (label: string, value: string, onChange: (v: string) => void, unit?: string) => (
    <label className="text-[11px] text-ink-3">
      {label}
      <span className="mt-0.5 flex items-center gap-1">
        <input className={num} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
        {unit && <span className="shrink-0 text-ink-4">{unit}</span>}
      </span>
    </label>
  );

  return (
    <Modal title="Courier rate cards" sub="What each courier charges us. Every shipping figure on this page is priced on these." onClose={onClose} wide>
      <div className="space-y-5">
        {cards.map((c, i) => (
          <section key={i} className="rounded-xl border border-line">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
              <input className="field !h-8 !w-40 text-[12.5px] font-medium" value={c.courier} onChange={(e) => set(i, { courier: e.target.value })} />
              <span className="text-[12px] text-ink-3">
                {MARKET[c.market]} · {c.currency}
              </span>
              <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-2">
                <input type="checkbox" checked={c.placeholder} onChange={(e) => set(i, { placeholder: e.target.checked })} className="accent-[var(--ink)]" /> Placeholder rates
              </label>
              {cards.length > 1 && (
                <button onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))} className="btn btn-ghost btn-sm !px-2" aria-label="Remove this card">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-2 px-3.5 py-3">
              <div className="grid grid-cols-[1fr_1.6fr_90px_24px] gap-2 text-[11px] text-ink-3">
                <span>Zone</span>
                <span>Cities in it (commas)</span>
                <span>First kilo</span>
                <span />
              </div>
              {c.zones.map((z, k) => (
                <div key={k} className="grid grid-cols-[1fr_1.6fr_90px_24px] items-center gap-2">
                  <input className="field !h-8 text-[12px]" value={z.label} onChange={(e) => setZone(i, k, { label: e.target.value })} />
                  <input className="field !h-8 text-[11.5px]" value={z.places} onChange={(e) => setZone(i, k, { places: e.target.value })} placeholder="Any city not listed elsewhere" />
                  <input className={num} inputMode="decimal" value={z.base} onChange={(e) => setZone(i, k, { base: e.target.value.replace(/[^\d.]/g, '') })} />
                  <input type="radio" name={`fallback-${i}`} checked={c.fallbackZone === z.key} onChange={() => set(i, { fallbackZone: z.key })} title="Cities nobody listed go here" className="accent-[var(--ink)]" />
                </div>
              ))}
              <button onClick={() => set(i, { zones: [...c.zones, { key: `zone-${Date.now()}`, label: '', places: '', base: '0' }] })} className="btn btn-ghost btn-sm">
                <Plus className="size-3.5" /> Zone
              </button>
              <p className="text-[11px] text-ink-4">The dot marks the zone a city nobody listed falls into.</p>
              <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
                {small('Each extra kilo', c.perKgS, (v) => set(i, { perKgS: v }), c.currency)}
                {small('Cash fee', c.codPctS, (v) => set(i, { codPctS: v }), '% of cash')}
                {small('Cash fee at least', c.codMinS, (v) => set(i, { codMinS: v }), c.currency)}
                {small('Refused, trip back', c.rtoPctS, (v) => set(i, { rtoPctS: v }), '% of price')}
                {small('Collecting a return', c.pickupS, (v) => set(i, { pickupS: v }), c.currency)}
                {small('Fuel surcharge', c.fuelPctS, (v) => set(i, { fuelPctS: v }), '%')}
              </div>
            </div>
          </section>
        ))}
        <div className="flex flex-wrap gap-2">
          {(['EG', 'KW'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setCards((cs) => [...cs, toDraft({ courier: 'New courier', market: m, currency: m === 'KW' ? 'KWD' : 'EGP', zones: [{ key: 'all', label: m === 'KW' ? 'All Kuwait' : 'All Egypt', places: [], base: 0 }], fallbackZone: 'all', perKg: 0, codPct: 0, codMin: 0, rtoPct: 1, pickup: 0, fuelPct: 0, placeholder: true })])}
              className="btn btn-quiet btn-sm"
            >
              <Plus className="size-3.5" /> Courier in {MARKET[m]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
          {small('One piece weighs', kgPiece, setKgPiece, 'kg')}
          {small('Packaging per parcel', kgParcel, setKgParcel, 'kg')}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveShippingRatesAction({ cards: cards.map(fromDraft), kgPerPiece: Number(kgPiece) || 0, kgPerParcel: Number(kgParcel) || 0 });
              if (r.ok) {
                toast(r.message ?? 'Saved');
                onClose();
              } else toast(r.error, { tone: 'error' });
            })
          }
          className="btn btn-primary"
        >
          {pending && <Loader2 className="size-4 animate-spin" />} Save rate cards
        </button>
      </div>
    </Modal>
  );
}
