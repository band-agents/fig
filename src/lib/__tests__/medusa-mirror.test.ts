import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot, mirrorConfigured, mirrorReturn, signMirrorBody } from '../medusa-mirror';

const ret = {
  id: 'ret_1',
  number: 'RMA-4101',
  stage: 'requested',
  openedVia: 'portal',
  reason: 'too_small',
  reasonNote: 'Runs small',
  refundMethod: 'store_credit',
  amount: 16800, // fils: 16.800 KD, bonus included
  bonus: 800,
  currency: 'KWD',
  branch: 'etam-avenues',
  requestedAt: new Date('2026-10-10T09:00:00Z'),
  stageAt: new Date('2026-10-10T09:00:00Z'),
  closedAt: null,
};
const labels: Record<string, string> = { too_small: 'Too small' };

describe('buildSnapshot', () => {
  const s = buildSnapshot({
    ret,
    order: { number: 'LB1042', customerName: 'Dana', email: 'dana@example.com', phone: '+96550000000' },
    lines: [{ title: 'Lace Balconette Bra', brand: 'Etam', size: '75B', variant: null, sku: 'E1', image: null, unitPrice: 16000, quantity: 1, reason: 'too_small' }],
    store: 'Labesny Website',
    branchName: 'Etam · The Avenues',
    reasonLabel: (k) => labels[k] ?? k,
    relayUrl: 'https://relay.example/returns/ret_1',
  });

  it('sends money in dinars, not fils', () => {
    expect(s.amount).toBe(16.8);
    expect(s.bonus).toBe(0.8);
    expect(s.items[0].unit_price).toBe(16);
  });
  it('carries the customer, the brand of each line and readable reasons', () => {
    expect(s.customer).toEqual({ name: 'Dana', email: 'dana@example.com', phone: '+96550000000' });
    expect(s.items[0]).toMatchObject({ brand: 'Etam', size: '75B', reason: 'Too small' });
    expect(s.reason).toBe('Too small');
    expect(s.branch).toBe('Etam · The Avenues');
  });
  it('dates are ISO strings', () => {
    expect(s.requested_at).toBe('2026-10-10T09:00:00.000Z');
    expect(s.closed_at).toBeNull();
  });
});

describe('signMirrorBody', () => {
  it('is HMAC-SHA256 of the exact body, as Medusa checks it', () => {
    expect(signMirrorBody('{"a":1}', 'k')).toBe(createHmac('sha256', 'k').update('{"a":1}').digest('hex'));
  });
});

describe('mirrorReturn', () => {
  afterEach(() => {
    delete process.env.MEDUSA_RETURNS_URL;
    delete process.env.MEDUSA_RETURNS_SECRET;
  });
  it('does nothing until both the address and the secret are set', async () => {
    expect(mirrorConfigured()).toBe(false);
    expect(await mirrorReturn('ret_1')).toBe('off');
    process.env.MEDUSA_RETURNS_URL = 'https://example.test/hooks/returns';
    expect(mirrorConfigured()).toBe(false);
  });
});
