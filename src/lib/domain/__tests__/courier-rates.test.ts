import { describe, expect, it } from 'vitest';
import { bracketPrice, customerPriceAbroad, destinationOf, estimateKg, INTL, isOffCity, recommend } from '../courier-rates';

describe('weights and brackets', () => {
  it('estimates a parcel from its pieces (1 ≈ 0.5 kg, 3 ≈ 1 kg, 15 ≈ 5 kg)', () => {
    expect(estimateKg(1)).toBeLessThanOrEqual(0.5);
    expect(estimateKg(3)).toBeLessThanOrEqual(1);
    expect(estimateKg(15)).toBeLessThanOrEqual(5);
  });
  it('charges the next bracket up, and repeats the last step above 5 kg', () => {
    expect(bracketPrice(INTL.UPS.AE!, 0.7)).toEqual({ kg: 1, price: 3710 });
    expect(bracketPrice(INTL.UPS.AE!, 6.2)).toEqual({ kg: 7, price: 7290 + 2 * (7290 - 6630) });
  });
});

describe('recommend: international', () => {
  it('UAE, 1 piece: Posta Plus 2.420 is the cheapest (sheet row 7)', () => {
    const r = recommend({ to: 'AE', pieces: 1 });
    expect(r.pick?.courier).toBe('Posta Plus');
    expect(r.pick?.total).toBe(2420);
  });
  it('adds UPS surge (0.300/kg on the charged bracket) and Aramex war risk', () => {
    const r = recommend({ to: 'JO', pieces: 3 }); // 1 kg
    const ups = r.options.find((o) => o.courier === 'UPS')!;
    const aramex = r.options.find((o) => o.courier === 'Aramex')!;
    expect(ups.total).toBe(6470 + 300);
    expect(aramex.total).toBe(5650 + Math.round(2 * 0.307 * 1000));
    expect(r.pick?.courier).toBe('Aramex');
  });
  it('lists every courier, cheapest first', () => {
    const r = recommend({ to: 'SA', pieces: 6 });
    expect(r.options).toHaveLength(4);
    expect(r.options.map((o) => o.total)).toEqual([...r.options.map((o) => o.total)].sort((a, b) => a - b));
  });
});

describe('recommend: outside the Gulf (28 Oct sheet)', () => {
  it('UK, 1 piece: UPS 4.410 + surge beats Aramex 4.900 + war risk', () => {
    const r = recommend({ to: 'GB', pieces: 1 });
    expect(r.pick?.courier).toBe('UPS');
    expect(r.pick?.total).toBe(4410 + 150);
  });
  it('Turkey has no FedEx', () => {
    expect(recommend({ to: 'TR', pieces: 1 }).options.map((o) => o.courier)).not.toContain('FedEx');
  });
  it('reads country names', () => {
    expect(destinationOf('United Kingdom')).toBe('GB');
    expect(destinationOf('Morocco')).toBe('MA');
  });
});

describe('recommend: Kuwait', () => {
  it('within city, next day: UPS 1.000 beats Aramex 1.250 at the 2–50 tier', () => {
    const r = recommend({ to: 'KW', pieces: 2, area: 'Salmiya' });
    expect(r.pick?.courier).toBe('UPS');
    expect(r.pick?.total).toBe(1000);
  });
  it('outside city limits: Aramex, and the only same-day courier there', () => {
    expect(isOffCity('Wafra')).toBe(true);
    expect(recommend({ to: 'KW', pieces: 2, area: 'Wafra' }).pick?.courier).toBe('Aramex');
    const same = recommend({ to: 'KW', pieces: 2, area: 'Wafra', speed: 'same_day' });
    expect(same.options.some((o) => o.courier === 'UPS')).toBe(false);
  });
  it('never picks Posta Plus at home (Moody: not competitive), but still shows it', () => {
    const r = recommend({ to: 'KW', pieces: 1, area: 'Salmiya' });
    expect(r.options.some((o) => o.courier === 'Posta Plus' && !o.inUse)).toBe(true);
    expect(r.pick?.courier).not.toBe('Posta Plus');
  });
  it('shows Frontline Express (1.000 same day, +0.150 cash on delivery) without picking it', () => {
    const r = recommend({ to: 'KW', pieces: 2, area: 'Salmiya', speed: 'same_day', codAmount: 1 });
    const fl = r.options.find((o) => o.courier === 'Frontline')!;
    expect(fl.total).toBe(1150);
    expect(fl.inUse).toBe(false);
    expect(r.pick?.courier).not.toBe('Frontline');
    expect(recommend({ to: 'KW', pieces: 2, area: 'Wafra', speed: 'same_day' }).options.some((o) => o.courier === 'Frontline')).toBe(false);
  });
  it('uses the 28 Oct Posta Plus rates', () => {
    const r = recommend({ to: 'KW', pieces: 1, area: 'Wafra', speed: 'same_day' });
    expect(r.options.find((o) => o.courier === 'Posta Plus')?.freight).toBe(2000);
  });
  it('on a tie, prefers the courier the console can book', () => {
    const r = recommend({ to: 'KW', pieces: 1, area: 'Salmiya', aramexMonthlyParcels: 60 }, { apis: ['UPS'] });
    expect(r.pick?.courier).toBe('UPS');
  });
});

describe("customer price abroad (Moody's table)", () => {
  it.each([
    [1, 5000],
    [5, 10000],
    [9, 15000],
    [10, 15000],
    [12, 17000],
    [13, 19000],
    [14, 19000],
    [16, 21000],
  ])('%i pieces → %i fils', (n, fils) => expect(customerPriceAbroad(n)).toBe(fils));
});
