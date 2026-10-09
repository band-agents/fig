import { describe, expect, it } from 'vitest';
import { normalisePhone, phoneLooksValid, scoreRisk, sizeBracketing } from '../risk';
import { autopilotRun, DEFAULT_AUTOPILOT, nextAutoStep } from '../autopilot';
import { can, maskName, maskPhone, ROLES, scopesFor, seesChannel, within } from '../perms';
import { isAllowed, ORDER_FLOW, ORDER_STAGE, ORDER_STAGES, RETURN_FLOW, RETURN_STAGES } from '../stages';
import { dueFor, slaState, span } from '../sla';
import { eligibility, itemReturnable, policyFor } from '../returns-policy';
import { decimalsFor, money, toMajor, toMinor } from '../../format';

describe('phones', () => {
  it('normalises the ways Egyptians and Kuwaitis type numbers', () => {
    expect(normalisePhone('01012345678', 'EG')).toBe('+201012345678');
    expect(normalisePhone('0100 123 4567', 'EG')).toBe('+201001234567');
    expect(normalisePhone('٠١٠١٢٣٤٥٦٧٨', 'EG')).toBe('+201012345678');
    expect(normalisePhone('00201112345678', 'EG')).toBe('+201112345678');
    expect(normalisePhone('99887766', 'KW')).toBe('+96599887766');
    expect(normalisePhone('', 'EG')).toBeNull();
  });
  it('knows a valid mobile from a typo', () => {
    expect(phoneLooksValid('+201012345678', 'EG')).toBe(true);
    expect(phoneLooksValid('+2010123456', 'EG')).toBe(false);
    expect(phoneLooksValid('+96599887766', 'KW')).toBe(true);
    expect(phoneLooksValid('+96519887766', 'KW')).toBe(false);
  });
});

describe('risk', () => {
  const base = {
    paymentMethod: 'cod',
    total: 150_000,
    currency: 'EGP',
    phone: '+201012345678',
    email: 'a@gmail.com',
    country: 'EG',
    address: { line1: '12 Abbas El Akkad St, Building 4', city: 'Nasr City', region: 'Cairo' },
    placedAt: new Date('2026-10-01T12:00:00Z'),
    items: [{ sku: 'X-M', title: 'Dress', size: 'M', quantity: 1 }],
    history: { orders: 4, delivered: 4, refused: 0, returned: 0 },
    channelMedian: 150_000,
  };
  it('scores a loyal cash customer low', () => {
    const r = scoreRisk(base);
    expect(r.level).toBe('low');
    expect(r.reasons.find((x) => x.code === 'loyal')).toBeTruthy();
  });
  it('flags a past refuser with a broken phone as high, with reasons', () => {
    const r = scoreRisk({ ...base, phone: '+2010123', history: { orders: 2, delivered: 0, refused: 2, returned: 0 } });
    expect(r.level).toBe('high');
    expect(r.reasons[0].weight).toBeGreaterThanOrEqual(r.reasons.at(-1)!.weight);
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['refused_before', 'phone', 'cod']));
  });
  it('sees size bracketing', () => {
    expect(sizeBracketing([{ sku: 'DR1-S', title: 'Dress', size: 'S', quantity: 1 }, { sku: 'DR1-M', title: 'Dress', size: 'M', quantity: 1 }, { sku: 'DR1-L', title: 'Dress', size: 'L', quantity: 1 }])).toBe(3);
    expect(sizeBracketing([{ sku: 'A-S', title: 'A', size: 'S', quantity: 1 }, { sku: 'B-M', title: 'B', size: 'M', quantity: 1 }])).toBe(1);
  });
  it('never leaves 0..100', () => {
    const r = scoreRisk({ ...base, phone: null, email: null, address: null, total: 10_000_000, history: { orders: 9, delivered: 0, refused: 9, returned: 9 }, recentSamePhone: 3 });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe('autopilot', () => {
  const o = { stage: 'new', paymentMethod: 'card', paymentStatus: 'paid', risk: 5, riskLevel: 'low', total: 100_000, currency: 'EGP' };
  it('sends a paid online order straight past confirmation and finance', () => {
    const steps = autopilotRun(o, null);
    expect(steps.map((s) => s.to)).toEqual(['finance', 'ready']);
  });
  it('always stops at confirmation for cash from a stranger', () => {
    const steps = autopilotRun({ ...o, paymentMethod: 'cod', paymentStatus: 'cod_due' }, null);
    expect(steps.map((s) => s.to)).toEqual(['confirming']);
  });
  it('lets a trusted cash customer skip the call, but not a high-risk one', () => {
    const h = { orders: 5, delivered: 5, refused: 0, returned: 0 };
    expect(nextAutoStep({ ...o, paymentMethod: 'cod', paymentStatus: 'cod_due' }, h)?.to).toBe('finance');
    expect(nextAutoStep({ ...o, paymentMethod: 'cod', paymentStatus: 'cod_due', riskLevel: 'high', risk: 70 }, h)?.to).toBe('confirming');
  });
  it('keeps big cash orders for a person in finance', () => {
    expect(nextAutoStep({ ...o, stage: 'finance', paymentMethod: 'cod', paymentStatus: 'cod_due', total: toMinor(9000, 'EGP') }, null)).toBeNull();
    expect(nextAutoStep({ ...o, stage: 'finance', paymentMethod: 'cod', paymentStatus: 'cod_due', total: toMinor(900, 'EGP') }, null)?.to).toBe('ready');
  });
  it('does nothing when switched off or on hold', () => {
    expect(nextAutoStep(o, null, { ...DEFAULT_AUTOPILOT, enabled: false })).toBeNull();
    expect(nextAutoStep({ ...o, onHold: true }, null)).toBeNull();
  });
});

describe('access', () => {
  it('presets match the jobs', () => {
    expect(can({ scopes: scopesFor('fulfilment') }, 'money', 1)).toBe(false);
    expect(can({ scopes: scopesFor('marketing') }, 'customers', 1)).toBe(false);
    expect(can({ scopes: scopesFor('finance') }, 'finance', 3)).toBe(true);
    expect(can({ scopes: scopesFor('care') }, 'finance', 1)).toBe(false);
    expect(Object.values(ROLES.admin.scopes).every((l) => l === 3)).toBe(true);
  });
  it('never lets an editor grant more than they hold', () => {
    expect(within(scopesFor('ops'), { orders: 3, team: 1 })).toBe(true);
    expect(within(scopesFor('ops'), { team: 3 })).toBe(false);
  });
  it('scopes channels', () => {
    expect(seesChannel({ channels: [] }, 'ws-kw')).toBe(true);
    expect(seesChannel({ channels: ['labesny-web'] }, 'fig-web')).toBe(false);
  });
  it('masks names and phones', () => {
    expect(maskName('Salma Mostafa Adel')).toBe('S. M.');
    expect(maskPhone('+201012345678')).toBe('+••••••••••78');
  });
});

describe('stages', () => {
  it('every transition lands on a real stage owned by a real area', () => {
    for (const s of ORDER_STAGES) for (const t of ORDER_FLOW[s]) expect(ORDER_STAGES).toContain(t.to);
    for (const s of RETURN_STAGES) for (const t of RETURN_FLOW[s]) expect(RETURN_STAGES).toContain(t.to);
  });
  it('closed stages are dead ends and open ones have a way out', () => {
    for (const s of ORDER_STAGES) {
      if (ORDER_STAGE[s].open) expect(ORDER_FLOW[s].length).toBeGreaterThan(0);
      else expect(ORDER_FLOW[s]).toHaveLength(0);
    }
  });
  it('does not let an order jump the warehouse', () => {
    expect(isAllowed(ORDER_FLOW, 'finance', 'shipped')).toBeNull();
    expect(isAllowed(ORDER_FLOW, 'packed', 'shipped')?.needs).toContain('tracking');
    expect(isAllowed(RETURN_FLOW, 'refund_pending', 'refunded')?.level).toBe(3);
  });
});

describe('sla', () => {
  const t0 = new Date('2026-10-01T10:00:00Z');
  it('computes due times and states', () => {
    const due = dueFor('orders', 'confirming', t0)!;
    expect(due.getTime() - t0.getTime()).toBe(2 * 3600_000);
    expect(slaState(due, t0, new Date(t0.getTime() + 30 * 60_000))).toBe('ok');
    expect(slaState(due, t0, new Date(t0.getTime() + 100 * 60_000))).toBe('soon');
    expect(slaState(due, t0, new Date(t0.getTime() + 3 * 3600_000))).toBe('late');
    expect(slaState(due, t0, new Date(), true)).toBe('held');
    expect(dueFor('orders', 'settled', t0)).toBeNull();
  });
  it('speaks human durations', () => {
    expect(span(14 * 60_000)).toBe('14m');
    expect(span(134 * 60_000)).toBe('2h 14m');
    expect(span(76 * 3600_000)).toBe('3d 4h');
  });
});

describe('returns policy', () => {
  it('knows Labesny takes no bras or panties back and returns in store', () => {
    const p = policyFor('Labesny', 'KW');
    expect(itemReturnable(p, { title: 'Lace balconette bra', category: 'Bras' })).toBe(false);
    expect(itemReturnable(p, { title: 'Linen trousers', category: 'Trousers' })).toBe(true);
    expect(p.storeOnly).toBe(true);
  });
  it('closes the window after 14 days', () => {
    const p = policyFor('FIG', 'EG');
    const now = new Date('2026-10-20T10:00:00Z');
    expect(eligibility(p, new Date('2026-10-10T10:00:00Z'), now).ok).toBe(true);
    expect(eligibility(p, new Date('2026-09-30T10:00:00Z'), now).ok).toBe(false);
    expect(eligibility(p, null, now).ok).toBe(false);
  });
});

describe('money', () => {
  it('keeps fils for KWD and drops piastres for whole pounds', () => {
    expect(decimalsFor('KWD')).toBe(3);
    expect(toMinor('15.25', 'KWD')).toBe(15250);
    expect(toMajor(15250, 'KWD')).toBe(15.25);
    expect(money(15250, 'KWD')).toBe('KWD 15.250');
    expect(money(199500, 'EGP')).toBe('EGP 1,995');
    expect(money(199550, 'EGP')).toBe('EGP 1,995.50');
    expect(money(-500, 'EGP')).toBe('−EGP 5');
  });
});
