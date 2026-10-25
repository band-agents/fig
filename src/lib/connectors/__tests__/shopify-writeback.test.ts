import { describe, expect, it } from 'vitest';
import { cancelReason, holdReason, matchLines, refundTransactions, type StoreLine, type SuggestedTransaction } from '../shopify-writeback';
import { changesForStage } from '../../domain/store-changes';

const order = { paymentMethod: 'knet', tracking: null, courier: null, trackingUrl: null };

describe('what each stage sends to the store (Dan, 24 Oct)', () => {
  it('tags every stage, and only the stage that means something in the store adds more', () => {
    expect(changesForStage(order, 'ready', {}, 'Aramex')).toEqual([{ kind: 'stage_tag', stage: 'ready' }]);
    expect(changesForStage(order, 'picking', {}, 'Aramex')).toEqual([{ kind: 'stage_tag', stage: 'picking' }]);
  });

  it('fulfils with the waybill and emails the customer when it leaves with the courier', () => {
    expect(changesForStage(order, 'shipped', { tracking: '123', courier: 'Aramex' }, 'Aramex')).toContainEqual({ kind: 'fulfil', tracking: '123', company: 'Aramex', url: null, notifyCustomer: true });
    // no waybill, nothing to fulfil with
    expect(changesForStage(order, 'shipped', {}, 'Aramex').map((c) => c.kind)).toEqual(['stage_tag']);
  });

  it('follows the shipment: out for delivery, delivered, refused', () => {
    expect(changesForStage(order, 'delivering', {}, 'Aramex')).toContainEqual({ kind: 'delivery', status: 'OUT_FOR_DELIVERY' });
    expect(changesForStage(order, 'delivered', {}, 'Aramex')).toContainEqual({ kind: 'delivery', status: 'DELIVERED' });
    expect(changesForStage(order, 'rto', { reason: 'Customer refused at door' }, 'Aramex')).toContainEqual({ kind: 'delivery', status: 'FAILURE', message: 'Customer refused at door' });
  });

  it('marks cash paid only for cash on delivery', () => {
    expect(changesForStage({ ...order, paymentMethod: 'cod' }, 'settled', {}, 'Aramex')).toContainEqual({ kind: 'mark_paid' });
    expect(changesForStage(order, 'settled', {}, 'Aramex').map((c) => c.kind)).toEqual(['stage_tag']);
  });

  it('cancels with the reason and emails the customer; never a refund', () => {
    const c = changesForStage(order, 'cancelled', { reason: 'Customer cancelled' }, 'Aramex');
    expect(c).toContainEqual({ kind: 'cancel', reason: 'Customer cancelled', notifyCustomer: true });
    expect(c.some((x) => x.kind === 'refund' || x.kind === 'refund_order')).toBe(false);
  });
});

describe('Shopify words for our reasons', () => {
  it('holds', () => {
    expect(holdReason('Waiting for stock')).toBe('INVENTORY_OUT_OF_STOCK');
    expect(holdReason('Address check')).toBe('INCORRECT_ADDRESS');
    expect(holdReason('Payment check')).toBe('AWAITING_PAYMENT');
    expect(holdReason('Customer asked to delay')).toBe('UNKNOWN_DELIVERY_DATE');
    expect(holdReason('Gift wrap / special request')).toBe('OTHER');
  });
  it('cancels', () => {
    expect(cancelReason('Customer cancelled')).toBe('CUSTOMER');
    expect(cancelReason('Out of stock')).toBe('INVENTORY');
    expect(cancelReason('Suspected fraud')).toBe('FRAUD');
    expect(cancelReason('Failed confirmation')).toBe('DECLINED');
    expect(cancelReason('Duplicate order')).toBe('OTHER');
  });
});

describe('refunds', () => {
  const lines: StoreLine[] = [
    { id: 'L1', sku: 'BRA-34B', title: 'Lace bra', quantity: 2, refundableQuantity: 2, variant: { barcode: '111' } },
    { id: 'L2', sku: 'BRIEF-M', title: 'Brief', quantity: 1, refundableQuantity: 0, variant: { barcode: '222' } },
    { id: 'L3', sku: null, title: 'Gift box', quantity: 1, refundableQuantity: 1, variant: null },
  ];

  it('finds the store line by barcode, then SKU, then title, and never refunds more than is left', () => {
    const r = matchLines(lines, [
      { sku: 'X', barcode: '111', title: 'Lace bra', quantity: 3 },
      { sku: 'BRIEF-M', barcode: null, title: 'Brief', quantity: 1 },
      { sku: null, barcode: null, title: 'gift box ', quantity: 1 },
    ]);
    expect(r.lines).toEqual([
      { lineItemId: 'L1', quantity: 2, restockType: 'NO_RESTOCK' },
      { lineItemId: 'L3', quantity: 1, restockType: 'NO_RESTOCK' },
    ]);
    // the brief was already refunded in Shopify
    expect(r.missing).toEqual(['Brief']);
  });

  it('never restocks in Shopify: Lucida keeps the stock', () => {
    expect(matchLines(lines, [{ sku: 'BRA-34B', barcode: null, title: '', quantity: 1 }]).lines.every((l) => l.restockType === 'NO_RESTOCK')).toBe(true);
  });

  const t = (gateway: string, amount: string, parent = 'P1', max?: string): SuggestedTransaction => ({ gateway, kind: 'SUGGESTED_REFUND', parentTransaction: { id: parent }, amountSet: { presentmentMoney: { amount } }, maximumRefundableSet: max ? { presentmentMoney: { amount: max } } : null });

  it('sends back what was asked, through the gateways the order was paid with, in order', () => {
    expect(refundTransactions('O', [t('MyFatoorah', '8.000'), t('shopify_store_credit', '2.000', 'P2')], 9.5, 3)).toEqual([
      { orderId: 'O', parentId: 'P1', gateway: 'MyFatoorah', kind: 'REFUND', amount: '8.000' },
      { orderId: 'O', parentId: 'P2', gateway: 'shopify_store_credit', kind: 'REFUND', amount: '1.500' },
    ]);
  });

  it('never more than a payment can take back, and nothing without a payment to refund', () => {
    expect(refundTransactions('O', [t('MyFatoorah', '10.000', 'P1', '4.000')], 6, 3)).toEqual([{ orderId: 'O', parentId: 'P1', gateway: 'MyFatoorah', kind: 'REFUND', amount: '4.000' }]);
    expect(refundTransactions('O', [{ ...t('manual', '5.000'), parentTransaction: null }], 5, 3)).toEqual([]);
    expect(refundTransactions('O', [], 5, 3)).toEqual([]);
  });
});
