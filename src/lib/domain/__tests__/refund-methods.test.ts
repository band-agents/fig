import { describe, expect, it } from 'vitest';
import {
  earnsBonus,
  paymentKindFromGateway,
  paymentKindFromGateways,
  refundOptions,
  resolveRefund,
  resolutionFor,
  STORE_CREDIT_BONUS,
} from '../refund-methods';

const policy = { storeOnly: false };
const optionsFor = (payment: Parameters<typeof refundOptions>[0]['payment'], amount = 10_000) =>
  refundOptions({ amount, currency: 'EGP', payment, policy });

describe('reading the gateway', () => {
  it('knows the gateways the live stores actually use', () => {
    // Labesny
    expect(paymentKindFromGateway('Cash on Delivery (COD)')).toBe('cod');
    expect(paymentKindFromGateway('MyFatoorah')).toBe('card');
    expect(paymentKindFromGateway('Taly')).toBe('card');
    // FIG — note the different capitalisation of the same thing
    expect(paymentKindFromGateway('Cash on delivery')).toBe('cod');
    expect(paymentKindFromGateway('Paymob - Card')).toBe('card');
  });

  it('spots store credit however it is spelled', () => {
    for (const g of ['Store credit', 'store_credit', 'Gift card', 'gift_card', 'Loyalty points']) {
      expect(paymentKindFromGateway(g)).toBe('store_credit');
    }
  });

  it('treats an unknown or empty gateway as store credit, which is the answer that pays nothing', () => {
    // Guessing "card" here would pay a bonus on money that may never have been money.
    expect(paymentKindFromGateway('Some New Processor')).toBe('store_credit');
    expect(paymentKindFromGateway('')).toBe('store_credit');
    expect(paymentKindFromGateway(null)).toBe('store_credit');
  });

  it('forfeits the bonus when any part of the order was paid with credit', () => {
    expect(paymentKindFromGateways(['Paymob - Card', 'Store credit'])).toBe('store_credit');
    expect(paymentKindFromGateways(['Cash on delivery', 'Paymob - Card'])).toBe('mixed');
    expect(paymentKindFromGateways(['MyFatoorah'])).toBe('card');
    expect(paymentKindFromGateways([])).toBe('store_credit');
  });
});

describe('who earns the bonus', () => {
  it('pays it on cash and on cards', () => {
    for (const p of ['cod', 'card', 'wallet', 'knet', 'instapay', 'mixed'] as const) {
      expect(earnsBonus(p)).toBe(true);
    }
  });

  it('refuses it on an order already settled with store credit', () => {
    expect(earnsBonus('store_credit')).toBe(false);
  });
});

describe('the three choices', () => {
  it('adds 5% to store credit for a card order and to nothing else', () => {
    const o = optionsFor('card');
    expect(o.find((x) => x.method === 'original')).toMatchObject({ amount: 10_000, bonus: 0 });
    expect(o.find((x) => x.method === 'store_credit')).toMatchObject({ amount: 10_500, bonus: 500 });
    expect(o.find((x) => x.method === 'cash_at_store')).toMatchObject({ amount: 10_000, bonus: 0 });
  });

  it('adds it for cash on delivery too', () => {
    expect(optionsFor('cod').find((x) => x.method === 'store_credit')).toMatchObject({ amount: 10_500, bonus: 500 });
  });

  it('pays no bonus when the order was bought with store credit', () => {
    const credit = optionsFor('store_credit').find((x) => x.method === 'store_credit')!;
    expect(credit.amount).toBe(10_000);
    expect(credit.bonus).toBe(0);
    expect(credit.label).not.toMatch(/extra/);
    expect(credit.detail).toMatch(/does not apply again/);
  });

  it('offers all three however the order was paid: account credit, then a branch, then the original method', () => {
    for (const p of ['cod', 'card', 'knet', 'store_credit'] as const) {
      expect(optionsFor(p).map((x) => x.method)).toEqual(['store_credit', 'cash_at_store', 'original']);
    }
  });

  it('names KNET as either kind of card', () => {
    expect(optionsFor('knet').find((x) => x.method === 'original')!.label).toBe('Back to your KNET debit or credit card');
  });

  it('calls it account credit, which is what the customer sees everywhere else', () => {
    const [credit] = optionsFor('card');
    expect(credit.label).toBe('Account credit, and gain 5% extra');
    expect(optionsFor('store_credit')[0].label).toBe('Account credit');
  });

  it('rounds the bonus to whole minor units', () => {
    // 333 fils at 5% is 16.65; money cannot be a fraction of a fils.
    const o = refundOptions({ amount: 333, currency: 'KWD', payment: 'card', policy });
    expect(o.find((x) => x.method === 'store_credit')!.bonus).toBe(17);
  });

  it('withholds the original method on a cash order that was never collected', () => {
    const o = refundOptions({ amount: 10_000, currency: 'EGP', payment: 'cod', policy, settled: false });
    const original = o.find((x) => x.method === 'original')!;
    expect(original.available).toBe(false);
    expect(original.why).toMatch(/not been paid/);
    // The other two still stand: there is nothing to reverse, but credit and cash still work.
    expect(o.filter((x) => x.available).map((x) => x.method)).toEqual(['store_credit', 'cash_at_store']);
  });

  it('says where to collect when the store only takes returns in person', () => {
    const o = refundOptions({ amount: 10_000, currency: 'KWD', payment: 'card', policy: { storeOnly: true } });
    expect(o.find((x) => x.method === 'cash_at_store')!.detail).toMatch(/bring the item/i);
  });
});

describe('resolving what the customer asked for', () => {
  it('pays what the option says, not what the request said', () => {
    expect(resolveRefund('store_credit', optionsFor('card'))).toEqual({
      method: 'store_credit',
      amount: 10_500,
      bonus: 500,
    });
  });

  it('refuses a method the order is not entitled to', () => {
    const unpaid = refundOptions({ amount: 10_000, currency: 'EGP', payment: 'cod', policy, settled: false });
    expect(() => resolveRefund('original', unpaid)).toThrow(/not been paid/);
  });

  it('refuses a method that does not exist', () => {
    expect(() => resolveRefund('bank_transfer' as never, optionsFor('card'))).toThrow(/Unknown refund method/);
  });

  it('cannot be talked into a bonus by asking for one', () => {
    // A customer posting store_credit on a credit-paid order still gets no extra.
    expect(resolveRefund('store_credit', optionsFor('store_credit')).bonus).toBe(0);
  });
});

describe('how it maps onto a return', () => {
  it('files store credit as a credit and the rest as refunds', () => {
    expect(resolutionFor('store_credit')).toBe('credit');
    expect(resolutionFor('original')).toBe('refund');
    expect(resolutionFor('cash_at_store')).toBe('refund');
  });

  it('keeps the bonus at the agreed 5%', () => {
    expect(STORE_CREDIT_BONUS).toBe(0.05);
  });
});
