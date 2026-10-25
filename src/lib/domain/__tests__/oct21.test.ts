import { describe, expect, it } from 'vitest';
import { cleanReview, reviewProblem, reviewSummary, type ReturnReview } from '../return-review';
import { DEFAULT_RATES, normaliseRates, parcelCost, pickupCost, zoneFor } from '../shipping-cost';
import { aqlPlan, aqlVerdict, costPerPiece, currentStep, daysLate, isFinished, marginOn, nextProductionNumber, planSteps, PRODUCTION_STEPS } from '../production';
import { judge, styleReasons, worst } from '../web-gap';
import { canSee, READ_ONLY_ROLES, scopesFor, seesBrand, seesBrands } from '../perms';
import { mayTake, ORDER_FLOW, ORDER_TRACK, RETIRED_STAGES } from '../stages';


describe('return review for the refund team', () => {
  const full: ReturnReview = {
    decision: 'approved',
    checks: { photos: 'yes', window: 'yes', eligible: 'yes', delivered: 'yes', contacted: 'na' },
    condition: 'damaged',
    fault: 'ours',
    shippingPaidBy: 'us',
    refundKind: 'full',
    note: 'Seam open on the left strap, photo 2.',
  };
  it('asks for every check, the photos, the fault, who pays the trip and how money goes back', () => {
    expect(reviewProblem(full, { amount: 1000 })).toBeNull();
    expect(reviewProblem({ ...full, checks: { ...full.checks, contacted: undefined } }, { amount: 1000 })).toMatch(/Spoke to the customer/);
    expect(reviewProblem({ ...full, checks: { ...full.checks, photos: 'no' } }, { amount: 1000 })).toMatch(/photos/);
    expect(reviewProblem({ ...full, fault: undefined }, { amount: 1000 })).toMatch(/fault/);
    expect(reviewProblem({ ...full, note: 'ok' }, { amount: 1000 })).toMatch(/note/);
    expect(reviewProblem(null, { amount: 1000 })).toMatch(/review/);
  });
  it('never lets a part refund exceed what the return is worth', () => {
    expect(reviewProblem({ ...full, refundKind: 'partial', refundAmount: 0 }, { amount: 1000 })).toMatch(/part/);
    expect(reviewProblem({ ...full, refundKind: 'partial', refundAmount: 1200 }, { amount: 1000 })).toMatch(/more than/);
    expect(cleanReview({ ...full, refundKind: 'partial', refundAmount: 400 }, { amount: 1000 }, { id: 'u', name: 'Mona' }, new Date('2026-10-21')).refundAmount).toBe(400);
    expect(cleanReview(full, { amount: 1000 }, { id: 'u', name: 'Mona' }, new Date('2026-10-21')).refundAmount).toBe(1000);
  });
  it('declines need a reason and a note, nothing else', () => {
    const no: ReturnReview = { decision: 'rejected', checks: {}, reason: 'Worn or washed', note: 'Photos show it was worn.' };
    expect(reviewProblem(no, { amount: 1000 })).toBeNull();
    expect(reviewProblem({ ...no, reason: '' }, { amount: 1000 })).toMatch(/why/);
    expect(reviewSummary(no)).toBe('Declined: Worn or washed');
    expect(reviewSummary(full)).toMatch(/^Full refund, our fault/);
  });
});

describe('shipping we pay', () => {
  const rates = DEFAULT_RATES;
  const eg = rates.cards.find((c) => c.market === 'EG')!;
  it('finds the zone from the city, loosely, and falls back for a city nobody listed', () => {
    expect(zoneFor(eg, 'New Cairo').key).toBe('greater-cairo');
    expect(zoneFor(eg, 'Hurghada').key).toBe('remote');
    expect(zoneFor(eg, 'Somewhere').key).toBe(eg.fallbackZone);
  });
  it('prices the first kilo, extra kilos, the cash fee and a refusal', () => {
    const one = parcelCost(rates, { market: 'EG', city: 'Giza', pieces: 1, cod: 0 })!;
    expect(one.total).toBe(eg.zones[0].base);
    const heavy = parcelCost(rates, { market: 'EG', city: 'Giza', pieces: 1, kg: 3.2, cod: 0 })!;
    expect(heavy.extraKg).toBe(3 * eg.perKg);
    const cash = parcelCost(rates, { market: 'EG', city: 'Giza', pieces: 1, cod: 200_000 })!;
    expect(cash.cod).toBe(Math.max(eg.codMin, Math.round(200_000 * eg.codPct)));
    const back = parcelCost(rates, { market: 'EG', city: 'Giza', pieces: 1, cod: 200_000, refused: true })!;
    expect(back.cod).toBe(0);
    expect(back.rto).toBe(eg.zones[0].base);
    expect(pickupCost(rates, 'KW')?.currency).toBe('KWD');
  });
  it('mends a broken stored card instead of computing with it', () => {
    expect(normaliseRates({ cards: 'nope' }).cards.length).toBe(DEFAULT_RATES.cards.length);
    expect(normaliseRates({ ...DEFAULT_RATES, kgPerPiece: -1 }).kgPerPiece).toBe(DEFAULT_RATES.kgPerPiece);
  });
});

describe('production', () => {
  it('plans every step from the brief, stretched to meet a promised ex-factory day', () => {
    const steps = planSteps('2026-11-01', '2026-12-31');
    expect(steps).toHaveLength(PRODUCTION_STEPS.length);
    expect(steps[0].planned).toBe('2026-11-01');
    expect(steps.find((s) => s.key === 'shipped')?.planned).toBe('2026-12-31');
  });
  it('stands at the first step not done, and is late by its most overdue open step', () => {
    const steps = planSteps('2026-10-01').map((s, i) => (i < 3 ? { ...s, done: s.planned } : s));
    expect(currentStep(steps)).toBe(PRODUCTION_STEPS[3].key);
    expect(daysLate(steps, '2026-10-30')).toBeGreaterThan(0);
    expect(isFinished(steps)).toBe(false);
    expect(isFinished(steps.map((s) => ({ ...s, done: '2026-12-01' })))).toBe(true);
  });
  it('adds up a piece and its margin', () => {
    expect(costPerPiece({ fabric: 12000, cmt: 8000, trims: 1500 })).toBe(21500);
    expect(marginOn(21500, 99900)).toBeCloseTo(0.785, 3);
    expect(marginOn(21500, null)).toBeNull();
  });
  it('samples by AQL 2.5 general level II', () => {
    expect(aqlPlan(1000)).toEqual({ sample: 80, majorAccept: 5, minorAccept: 7 });
    expect(aqlPlan(400).sample).toBe(50);
    expect(aqlVerdict(1000, 5, 7)).toBe('pass');
    expect(aqlVerdict(1000, 6, 0)).toBe('fail');
  });
  it('numbers orders in a series', () => {
    expect(nextProductionNumber(null)).toBe('PRD-0001');
    expect(nextProductionNumber('PRD-0041')).toBe('PRD-0042');
  });
});

describe('website against Lucida', () => {
  const live = { barcode: '1', status: 'active', hasPhoto: true, hasDescription: true, hasCategory: true, price: 1000, webQty: 3, lucidaQty: 3, lucidaPrice: 1000 };
  it('calls a live size right only when stock and price match Lucida', () => {
    expect(judge(live).verdict).toBe('ok');
    expect(judge({ ...live, lucidaQty: 5 }).verdict).toBe('live_qty');
    expect(judge({ ...live, lucidaPrice: 1250 }).verdict).toBe('live_price');
    expect(judge({ ...live, lucidaQty: 0 }).verdict).toBe('live_not_lucida');
    expect(judge({ ...live, lucidaQty: null }).verdict).toBe('live_web_only');
  });
  it('says why a size is not on sale', () => {
    const j = judge({ ...live, status: 'draft', hasPhoto: false, hasDescription: false, webQty: 0, lucidaQty: 4 });
    expect(j.verdict).toBe('unpublished_stock');
    expect(j.reasons).toEqual(expect.arrayContaining(['no_photo', 'no_description', 'draft', 'web_no_stock']));
    expect(judge({ ...live, status: 'archived', webQty: 0, lucidaQty: 0 }).verdict).toBe('unpublished_none');
    expect(judge({ ...live, status: 'absent' }).verdict).toBe('not_uploaded');
  });
  it('gives a style its most pressing verdict and its shared reasons first', () => {
    expect(worst(['ok', 'live_qty', 'unpublished_stock'])).toBe('unpublished_stock');
    expect(styleReasons([['no_photo', 'draft'], ['draft'], ['draft', 'web_no_stock']])[0]).toBe('draft');
  });
});

describe('brand managers and the retired steps', () => {
  it('matches brands however they are spelled', () => {
    expect(seesBrand({ brands: ['Women Secret'] }, "WOMEN'SECRET")).toBe(true);
    expect(seesBrand({ brands: ['Benetton'] }, 'UNITED COLORS OF BENETTON')).toBe(true);
    expect(seesBrand({ brands: ['Etam'] }, 'Forever 21')).toBe(false);
    expect(seesBrands({ brands: ['Etam'] }, ['Forever 21', 'ETAM'])).toBe(true);
    expect(seesBrands({ brands: [] }, ['anything'])).toBe(true);
  });
  it('keeps the brand manager read-only and off the staff pages', () => {
    expect(READ_ONLY_ROLES).toContain('brand');
    expect(canSee({ role: 'brand', scopes: scopesFor('brand') }, 'team')).toBe(false);
    expect(canSee({ role: 'brand', scopes: scopesFor('brand') }, 'production')).toBe(true);
  });
  it('sends new orders straight to Pick & pack, and lets care or the warehouse cancel a waiting one', () => {
    expect(ORDER_TRACK.some((s) => RETIRED_STAGES.includes(s))).toBe(false);
    expect(ORDER_FLOW.new.map((t) => t.to)).toEqual(['ready', 'cancelled']);
    const cancel = ORDER_FLOW.ready.find((t) => t.to === 'cancelled')!;
    expect(mayTake(scopesFor('care'), cancel)).toBe(true);
    expect(mayTake(scopesFor('fulfilment'), cancel)).toBe(true);
    expect(mayTake(scopesFor('marketing'), cancel)).toBe(false);
  });
});
