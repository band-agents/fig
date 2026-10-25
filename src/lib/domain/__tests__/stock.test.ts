import { describe, expect, it } from 'vitest';
import { addWeeks, eventLift, monthOfWeek, weekOf, weekRange, weeksBetween } from '../stock/calendar';
import { categorize, indexOn, learnIndex, priorIndex } from '../stock/categories';
import { baseRate, project, reorderQty, safetyStock, sellThrough, splitSizes, stockoutWeek, trendFactor, unconstrained, weeksOfCover } from '../stock/forecast';
import { abc, velocity, xyz } from '../stock/classify';
import { rebalance } from '../stock/rebalance';
import { anchorsFor, crossSellUplift, upsellFor, worthPushing, type Piece } from '../stock/merch';
import { estimateMinutes, merge, pace, pickAssignee, utilisation, type Candidate } from '../stock/work';
import { needsSecondSignature, poStep } from '../stock/flows';

describe('the retail calendar', () => {
  it('starts weeks on Sunday, in Gulf time', () => {
    // Tuesday 13 Oct 2026, 10:00 Kuwait
    expect(weekOf(Date.UTC(2026, 9, 13, 7))).toBe('2026-10-11');
    // Saturday 23:30 Kuwait is still the old week; Sunday 00:30 is the new one
    expect(weekOf(Date.UTC(2026, 9, 17, 20, 30))).toBe('2026-10-11');
    expect(weekOf(Date.UTC(2026, 9, 17, 21, 30))).toBe('2026-10-18');
  });

  it('counts and walks weeks', () => {
    expect(addWeeks('2026-10-11', 2)).toBe('2026-10-25');
    expect(weeksBetween('2026-10-11', '2026-11-08')).toBe(4);
    expect(weekRange('2026-10-04', '2026-10-25')).toHaveLength(4);
  });

  it('puts a week in the month its Wednesday falls in', () => {
    expect(monthOfWeek('2026-11-29')).toBe(11); // Wed 2 Dec
    expect(monthOfWeek('2026-11-22')).toBe(10);
  });

  it('lifts White Friday week, and quietens Kuwait malls in August but not the websites', () => {
    expect(eventLift('EG', 'lingerie', '2026-11-22', 'online')).toBeGreaterThan(1.8);
    // away for the summer (×0.64) even with the summer sale on top (×1.18)
    expect(eventLift('KW', 'tops', '2026-08-02', 'store')).toBeCloseTo(0.64 * 1.18, 2);
    expect(eventLift('KW', 'tops', '2026-08-02', 'online')).toBeCloseTo(1.18 ** (7 / 7), 1);
    expect(eventLift('EG', 'tops', '2026-10-11', 'store')).toBe(1);
  });
});

describe('categories and seasons', () => {
  it('reads the category from the title and tags', () => {
    expect(categorize('Snoopy soft fleece long pajamas')).toBe('nightwear');
    expect(categorize('Striped Satin Shorts - Vert', ['cat:sleep-and-homewear'])).toBe('nightwear');
    expect(categorize('Triangle bikini top')).toBe('swimwear');
    expect(categorize('Carpisa medium trolley')).toBe('bags');
    expect(categorize('Bebe Women’s Sequined Lace Yoke Top')).toBe('tops');
    expect(categorize('Trousers', ['Junior-F', 'Kids'])).toBe('kids');
  });

  it('keeps every seasonal curve averaging 1', () => {
    for (const c of ['swimwear', 'outerwear', 'tops'] as const) {
      const idx = priorIndex('EG', c);
      expect(idx.reduce((a, b) => a + b, 0) / 12).toBeCloseTo(1, 6);
    }
    expect(priorIndex('EG', 'swimwear')[6]).toBeGreaterThan(priorIndex('EG', 'swimwear')[0] * 10);
  });

  it('learns its own curve where there is evidence and leans on the prior where there is not', () => {
    const prior = Array(12).fill(1);
    const units = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 600, 100];
    const learned = learnIndex(units, Array(12).fill(1), prior);
    expect(learned[10]).toBeGreaterThan(3);
    const thin = learnIndex(units.map((u) => u / 100), Array(12).fill(1), prior);
    expect(thin[10]).toBeLessThan(1.35);
    expect(thin[10]).toBeLessThan(learned[10] / 2);
  });

  it('eases between months', () => {
    const idx = [1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(indexOn(idx, 0, 15)).toBeCloseTo(1);
    expect(indexOn(idx, 0, 30)).toBeCloseTo(1.5);
  });
});

describe('forecasting', () => {
  const flat = () => 1;

  it('reads a sold-out week as the demand it would have had', () => {
    expect(unconstrained({ week: 'w', units: 4, stockoutDays: 3 })).toBeCloseTo(7);
    expect(unconstrained({ week: 'w', units: 0, stockoutDays: 7 })).toBeNull();
  });

  it('takes the season out of the base rate', () => {
    const obs = Array.from({ length: 8 }, (_, i) => ({ week: `w${i}`, units: 20 }));
    expect(baseRate(obs, () => 2).rate).toBeCloseTo(10);
    expect(baseRate(obs, flat).rate).toBeCloseTo(20);
  });

  it('never claims a spread tighter than counting noise', () => {
    const obs = Array.from({ length: 8 }, (_, i) => ({ week: `w${i}`, units: 9 }));
    expect(baseRate(obs, flat).sigma).toBeCloseTo(3);
  });

  it('sees a style picking up, within bounds', () => {
    const obs = [...Array(12).fill(5), ...Array(6).fill(7)].map((u, i) => ({ week: `w${i}`, units: u }));
    expect(trendFactor(obs, flat)).toBeCloseTo(Math.sqrt(1.4), 3);
    const wild = [...Array(12).fill(1), ...Array(6).fill(40)].map((u, i) => ({ week: `w${i}`, units: u }));
    expect(trendFactor(wild, flat)).toBe(1.3);
  });

  it('projects when the shelf empties, with a delivery landing on the way', () => {
    const weeks = ['a', 'b', 'c', 'd'];
    const p = project(25, weeks, [10, 10, 10, 10]);
    expect(stockoutWeek(p)).toBe('c');
    expect(stockoutWeek(project(25, weeks, [10, 10, 10, 10], { c: 30 }))).toBeNull();
  });

  it('measures cover in weeks', () => {
    expect(weeksOfCover(30, [10, 10, 10, 10])).toBeCloseTo(3);
    expect(weeksOfCover(15, [10, 10])).toBeCloseTo(1.5);
    expect(weeksOfCover(10, [0, 0, 0, 0])).toBe(Infinity);
    expect(weeksOfCover(0, [5])).toBe(0);
  });

  it('orders in whole cases, never under the minimum, and nothing when covered', () => {
    expect(reorderQty({ position: 10, demandCover: 50, safety: 10, moq: 24, pack: 6 })).toBe(54);
    expect(reorderQty({ position: 50, demandCover: 52, safety: 4, moq: 24, pack: 6 })).toBe(24);
    expect(reorderQty({ position: 80, demandCover: 50, safety: 10, moq: 24, pack: 6 })).toBe(0);
    expect(safetyStock(4, 4, 1.65)).toBeCloseTo(13.2);
  });

  it('splits by size and always adds up', () => {
    const s = splitSizes(54, ['S', 'M', 'L', 'XL'], { S: 0.2, M: 0.35, L: 0.3, XL: 0.15 });
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(54);
    expect(s.M).toBeGreaterThan(s.XL);
    expect(Object.values(splitSizes(7, ['S', 'M'], {})).reduce((a, b) => a + b, 0)).toBe(7);
  });

  it('works out sell-through', () => {
    expect(sellThrough(30, 70)).toBeCloseTo(0.3);
    expect(sellThrough(0, 0)).toBe(0);
  });
});

describe('sorting the range', () => {
  it('ranks styles by their share of sales', () => {
    const r = abc([
      { id: 'a', revenue: 70 },
      { id: 'b', revenue: 20 },
      { id: 'c', revenue: 6 },
      { id: 'd', revenue: 4 },
    ]);
    expect(r).toEqual({ a: 'A', b: 'A', c: 'B', d: 'C' });
  });

  it('tells steady demand from lumpy', () => {
    expect(xyz([10, 11, 9, 10, 10, 12])).toBe('X');
    expect(xyz([0, 0, 30, 0, 1, 0])).toBe('Z');
  });

  it('names fast, slow, dead and new against the category', () => {
    const base = { categoryMedian: 3, weeksLive: 30, weeksSinceSale: 0, onHand: 40, cover: 6 };
    expect(velocity({ ...base, rate: 8 })).toBe('fast');
    expect(velocity({ ...base, rate: 3 })).toBe('steady');
    expect(velocity({ ...base, rate: 1 })).toBe('slow');
    expect(velocity({ ...base, rate: 3, cover: 30 })).toBe('slow');
    expect(velocity({ ...base, rate: 0, weeksSinceSale: 12 })).toBe('dead');
    expect(velocity({ ...base, rate: 0, weeksLive: 2 })).toBe('new');
  });
});

describe('rebalancing', () => {
  it('moves stock from a shop where it sits to one where it sells', () => {
    const moves = rebalance([
      { locationId: 'wh', kind: 'warehouse', onHand: 4, rate: 1, sells: true },
      { locationId: 'avenues', kind: 'store', onHand: 1, rate: 3, sells: true },
      { locationId: 'gate', kind: 'store', onHand: 14, rate: 0, sells: true },
    ]);
    expect(moves).toEqual([{ from: 'gate', to: 'avenues', qty: 14, why: 'Not selling where it is' }]);
  });

  it('keeps the websites’ weeks in the warehouse before feeding shops', () => {
    const moves = rebalance([
      { locationId: 'wh', kind: 'warehouse', onHand: 40, rate: 4, sells: true },
      { locationId: 'avenues', kind: 'store', onHand: 0, rate: 3, sells: true },
    ]);
    expect(moves[0]).toMatchObject({ from: 'wh', to: 'avenues', qty: 8 });
  });

  it('never sends a brand to a counter that does not sell it', () => {
    const moves = rebalance([
      { locationId: 'etam', kind: 'store', onHand: 20, rate: 0, sells: true },
      { locationId: 'ws', kind: 'store', onHand: 0, rate: 0, sells: false },
    ]);
    expect(moves).toEqual([]);
  });
});

describe('website merchandising', () => {
  const p = (id: string, category: Piece['category'], price: number, rate: number, cover = 6, extra: Partial<Piece> = {}): Piece => ({ id, category, price, margin: 0.6, rate, onHand: 40, cover, channels: ['fig-web'], ...extra });

  it('shows a slow piece on the pages of fast sellers it is worn with', () => {
    const slippers = p('slip', 'homewear', 400, 0.3, 40);
    const anchors = anchorsFor(slippers, [p('pj1', 'nightwear', 1400, 9), p('pj2', 'nightwear', 1200, 4), p('dress', 'dresses', 3000, 12), p('pj3', 'nightwear', 1300, 2, 6, { channels: ['ws-eg'] })]);
    expect(anchors.map((a) => a.id)).toEqual(['pj1', 'pj2']);
  });

  it('offers a dearer, overstocked step up in the same category', () => {
    const anchor = p('bra1', 'lingerie', 800, 10);
    expect(upsellFor(anchor, [p('bra2', 'lingerie', 1100, 0.5, 30), p('bra3', 'lingerie', 2400, 0.5, 30)])?.id).toBe('bra2');
  });

  it('only pushes what there is plenty of and is worth selling', () => {
    expect(worthPushing(p('x', 'tops', 500, 1, 30))).toBe(true);
    expect(worthPushing(p('x', 'tops', 500, 1, 30, { margin: 0.2 }))).toBe(false);
    expect(worthPushing(p('x', 'tops', 500, 1, 8))).toBe(false);
    expect(crossSellUplift([10])).toBeCloseTo(10 * 34 * 0.045 * 0.24 * 0.48);
  });
});

describe('the work', () => {
  it('estimates minutes from the job and the units', () => {
    expect(estimateMinutes('receive', 400)).toBe(60);
    expect(estimateMinutes('supplier_followup', 0)).toBe(15);
  });

  it('counts overlapping work once and finds the idle stretches', () => {
    const t0 = Date.UTC(2026, 9, 13, 7); // 10:00 Kuwait
    const m = 60_000;
    expect(merge([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 30, end: 40 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 40 }]);
    const u = utilisation({ from: t0, to: t0 + 540 * m }, [{ start: t0 + 10 * m, end: t0 + 70 * m }, { start: t0 + 100 * m, end: t0 + 160 * m }], t0 + 180 * m);
    expect(u.busy).toBe(120);
    expect(u.rate).toBeCloseTo(120 / 180);
    expect(u.longestIdle).toBe(30);
    expect(u.idleNow).toBe(20);
  });

  it('measures pace against standard', () => {
    expect(pace([{ estMinutes: 30, spentMinutes: 20 }, { estMinutes: 30, spentMinutes: 25 }, { estMinutes: 30, spentMinutes: 45 }])).toBeCloseTo(1);
    expect(pace([{ estMinutes: 30, spentMinutes: 20 }])).toBeNull();
  });

  it('gives a task to the least loaded person who may do it, on shift and in the right country', () => {
    const t = Date.UTC(2026, 9, 13, 8); // Tuesday 11:00 Kuwait
    const shift = { start: 9 * 60, end: 18 * 60, restDays: [5] };
    const people: Candidate[] = [
      { id: 'omar', level: 2, locationId: 'fig-cairo', country: 'EG', shift, queueMinutes: 10, pace: 1, skills: [] },
      { id: 'fatma', level: 2, locationId: 'dh-kuwait', country: 'KW', shift, queueMinutes: 90, pace: 1, skills: [] },
      { id: 'yousef', level: 2, locationId: 'dh-kuwait', country: 'KW', shift, queueMinutes: 30, pace: 1, skills: [] },
      { id: 'viewer', level: 1, locationId: 'dh-kuwait', country: 'KW', shift, queueMinutes: 0, pace: 1, skills: [] },
    ];
    expect(pickAssignee({ kind: 'receive', locationId: 'dh-kuwait', country: 'KW', estMinutes: 40 }, people, t)).toBe('yousef');
    const offShift = people.map((p) => (p.id === 'yousef' ? { ...p, shift: { ...shift, restDays: [2] } } : p));
    expect(pickAssignee({ kind: 'receive', locationId: 'dh-kuwait', country: 'KW', estMinutes: 40 }, offShift, t)).toBe('fatma');
    expect(pickAssignee({ kind: 'receive', locationId: 'x', country: 'JO', estMinutes: 40 }, people, t)).toBeNull();
  });
});

describe('purchase orders', () => {
  it('only lets the right level move an order', () => {
    expect(poStep('draft', 'approval')?.min).toBe(2);
    expect(poStep('approval', 'approved')?.min).toBe(3);
    expect(poStep('draft', 'received')).toBeNull();
  });

  it('asks for a second signature above the limit, unless the buyer can approve', () => {
    expect(needsSecondSignature(300_000_00, 250_000_00, 2)).toBe(true);
    expect(needsSecondSignature(300_000_00, 250_000_00, 3)).toBe(false);
    expect(needsSecondSignature(100_000_00, 250_000_00, 2)).toBe(false);
  });
});
