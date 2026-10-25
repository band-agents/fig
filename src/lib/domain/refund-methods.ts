// How a refund can come back to the customer, and which choice earns the store-credit bonus.
//
// Three ways: back to the card or cash they paid with, as store credit, or as cash collected from a
// brand store. Store credit carries a bonus — the customer gets more back than they spent — because
// the money stays with us. That bonus is NOT paid on an order that was itself settled with store
// credit, or the same money earns the bonus again every time it goes round.
//
// The choice is decided here and never read from the request. A customer can send any refund method
// they like; what they get is what this file says they are entitled to.
import type { ReturnPolicy } from './returns-policy';

export const STORE_CREDIT_BONUS = 0.05;

export type RefundMethod = 'original' | 'store_credit' | 'cash_at_store';

/** How the order was paid. `store_credit` is the one that forfeits the bonus. */
export type PaymentMethod = 'cod' | 'card' | 'wallet' | 'knet' | 'instapay' | 'store_credit' | 'mixed';

/**
 * What the storefronts actually write into the payment gateway field, mapped to the kinds above.
 *
 * These are the real strings seen on the live stores — Labesny settles through "Cash on Delivery
 * (COD)", "MyFatoorah" and "Taly"; FIG through "Cash on delivery" and "Paymob - Card" — and they
 * differ between stores down to the capitalisation, so this matches loosely and on purpose.
 */
const GATEWAY_PATTERNS: [RegExp, PaymentMethod][] = [
  [/store.?credit|gift.?card|loyalty|points/i, 'store_credit'],
  [/cash.?on.?delivery|\bcod\b|cash/i, 'cod'],
  [/knet/i, 'knet'],
  [/instapay/i, 'instapay'],
  [/wallet|vodafone|etisalat|orange|fawry/i, 'wallet'],
  [/card|visa|master|myfatoorah|paymob|taly|tabby|tamara|stripe|shopify.?payments/i, 'card'],
];

/**
 * Reads a gateway name into a payment kind.
 *
 * An unrecognised gateway comes back as `store_credit`, which is the answer that costs us nothing:
 * a wrong guess there pays no bonus and someone asks why, whereas defaulting to `card` would pay a
 * bonus on money that may never have been money.
 */
export function paymentKindFromGateway(gateway: string | null | undefined): PaymentMethod {
  const g = (gateway ?? '').trim();
  if (!g) return 'store_credit';
  for (const [re, kind] of GATEWAY_PATTERNS) if (re.test(g)) return kind;
  return 'store_credit';
}

/**
 * Several gateways on one order: any store credit in the mix forfeits the bonus.
 *
 * Paying half with credit and half with a card would otherwise earn a bonus on the credit half,
 * which is the loop this rule exists to close.
 */
export function paymentKindFromGateways(gateways: (string | null | undefined)[]): PaymentMethod {
  const kinds = gateways.map(paymentKindFromGateway);
  if (!kinds.length) return 'store_credit';
  if (kinds.includes('store_credit')) return 'store_credit';
  return kinds.length === 1 ? kinds[0] : 'mixed';
}

/** Whether an order paid this way earns the extra on store credit. */
export const earnsBonus = (payment: PaymentMethod) => payment !== 'store_credit';

export type RefundOption = {
  method: RefundMethod;
  label: string;
  /** What the customer receives, in minor units. */
  amount: number;
  /** The part of `amount` that is the bonus, so the portal can show it and finance can see it. */
  bonus: number;
  detail: string;
  available: boolean;
  /** Set when `available` is false. */
  why?: string;
};

/**
 * The refund choices for one return, with the amount each one pays.
 *
 * `amount` is what the returned goods are worth; everything else follows from how the order was
 * paid and what the store's policy allows.
 */
export function refundOptions(input: {
  amount: number;
  currency: string;
  payment: PaymentMethod;
  policy: Pick<ReturnPolicy, 'storeOnly'>;
  /** False for a cash-on-delivery order that has not been collected yet: there is nothing to send back. */
  settled?: boolean;
}): RefundOption[] {
  const { amount, payment } = input;
  const bonus = earnsBonus(payment) ? Math.round(amount * STORE_CREDIT_BONUS) : 0;
  const settled = input.settled ?? true;

  const originalLabel: Record<PaymentMethod, string> = {
    cod: 'Cash back to you',
    card: 'Back to your card',
    wallet: 'Back to your wallet',
    knet: 'Back to your KNET debit or credit card',
    instapay: 'Back to your InstaPay account',
    store_credit: 'Back to your account credit',
    mixed: 'Back the way you paid',
  };

  /* Account credit leads. It is the one the customer is better off taking — it is worth 5% more and
     it is the quickest — and it is the one the business would rather pay, so it is not buried under
     the two that move cash out. Cash at a branch comes next and the refund to the card or cash they
     paid with comes last: it is the slowest of the three and the one that sends money back out of
     the business, so it is offered, not suggested. */
  return [
    {
      method: 'store_credit',
      label: bonus > 0 ? `Account credit, and gain ${Math.round(STORE_CREDIT_BONUS * 100)}% extra` : 'Account credit',
      amount: amount + bonus,
      bonus,
      detail:
        bonus > 0
          ? 'Yours straight after inspection, and the fastest of the three.'
          : 'This order was paid with account credit, so the extra does not apply again.',
      available: true,
    },
    {
      method: 'cash_at_store',
      label: 'Cash from one of our branches',
      amount,
      bonus: 0,
      detail: input.policy.storeOnly
        ? 'Bring the item to the branch you choose and collect the cash there.'
        : 'Collect the cash in person once the return is approved.',
      available: true,
    },
    {
      method: 'original',
      label: originalLabel[payment],
      amount,
      bonus: 0,
      detail:
        payment === 'cod'
          ? 'We transfer it to you once the return is inspected.'
          : 'Back to the account you paid from, usually within 5 to 10 working days.',
      available: settled,
      why: settled ? undefined : 'This order has not been paid for yet.',
    },
  ];
}

/** The one the customer chose, refusing anything they are not entitled to. */
export function resolveRefund(
  chosen: RefundMethod,
  options: RefundOption[]
): { method: RefundMethod; amount: number; bonus: number } {
  const hit = options.find((o) => o.method === chosen);
  if (!hit) throw new Error(`Unknown refund method "${chosen}".`);
  if (!hit.available) throw new Error(hit.why ?? 'That refund method is not available for this order.');
  return { method: hit.method, amount: hit.amount, bonus: hit.bonus };
}

/** Returns carry a resolution of refund | exchange | credit; store credit is the `credit` one. */
export const resolutionFor = (method: RefundMethod) => (method === 'store_credit' ? 'credit' : 'refund');
