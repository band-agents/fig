import { describe, expect, it } from 'vitest';
import { buildStockRequest, mergeStock, parseLucidaAccounts, readStockResponse } from '../lucida-map';

describe('Lucida request', () => {
  it('matches fig-app’s StockInquiry body, credentials in the body, barcodes comma-joined', () => {
    expect(buildStockRequest({ username: 'DH', password: 'pw' }, ['6223001234567', '6223007654321'])).toEqual({
      Username: 'DH',
      Password: 'pw',
      AccountID: '',
      Platform: 1,
      Lang: 1,
      ItemCode: '',
      ItemBarcode: '6223001234567,6223007654321',
      StoreCode: '',
      BalanceByStore: 0,
      HideZeroBalance: 0,
      UpdateType: 1,
      LastUpdateID: 0,
    });
  });
});

describe('Lucida accounts', () => {
  it('reads one login per company database from LUCIDA_ACCOUNTS', () => {
    const env = { LUCIDA_ACCOUNTS: '[{"username":"DH","password":"a"},{"username":" DCO ","password":"b","accountId":"7"}]' };
    expect(parseLucidaAccounts(env)).toEqual([
      { username: 'DH', password: 'a' },
      { username: 'DCO', password: 'b', accountId: '7' },
    ]);
  });

  it('falls back to the single login, or nothing', () => {
    expect(parseLucidaAccounts({ LUCIDA_USERNAME: 'DH', LUCIDA_PASSWORD: 'a' })).toEqual([{ username: 'DH', password: 'a' }]);
    expect(parseLucidaAccounts({})).toEqual([]);
  });

  it('refuses a malformed list without echoing it', () => {
    expect(() => parseLucidaAccounts({ LUCIDA_ACCOUNTS: '{secret' })).toThrow(/not valid JSON/);
    expect(() => parseLucidaAccounts({ LUCIDA_ACCOUNTS: '[{"username":"DH"}]' })).toThrow(/entry 1/);
    const bad = () => parseLucidaAccounts({ LUCIDA_ACCOUNTS: '[{"username":"DH","password":"hunter2"},{}]' });
    expect(bad).toThrow(/entry 2/);
    expect(bad).not.toThrow(/hunter2/);
  });
});

describe('Lucida response', () => {
  const ok = {
    noOfRecords: 3,
    lastUpdateID: 0,
    status: 1,
    remarks: '',
    itemsList: [
      { itemBarcode: '6223001234567', qty: 4, priceA: 1195, priceE: 1495, storeCode: '', status: 1 },
      { itemBarcode: '6223007654321', qty: 0, priceA: 1000, priceE: 0, storeCode: '', status: 1 },
      { itemBarcode: '6223001234567', qty: 3, priceA: 1195, priceE: 1495, storeCode: '', status: 1 },
    ],
  };

  it('reads camelCase rows', () => {
    expect(readStockResponse(ok)).toEqual([
      { barcode: '6223001234567', qty: 4, priceA: 1195, priceE: 1495 },
      { barcode: '6223007654321', qty: 0, priceA: 1000 },
      { barcode: '6223001234567', qty: 3, priceA: 1195, priceE: 1495 },
    ]);
  });

  it('throws on status above 1 rather than reading it as no stock', () => {
    expect(() => readStockResponse({ status: 2, remarks: 'Invalid user', itemsList: [] }, 'Lucida (DH)')).toThrow('Lucida (DH) reported a failure (status 2): "Invalid user"');
    expect(() => readStockResponse({ Status: 3, Remarks: 'Bad barcode list' })).toThrow(/entry error/);
  });

  it('throws when there is no items list or a row is unreadable', () => {
    expect(() => readStockResponse({ status: 1 })).toThrow(/without an items list/);
    expect(() => readStockResponse({ status: 1, itemsList: [{ qty: 2 }] })).toThrow(/no item barcode/);
    expect(() => readStockResponse({ status: 1, itemsList: [{ itemBarcode: 'X', qty: 'n/a' }] })).toThrow(/no readable quantity/);
  });

  it('takes the last figure per barcode within an account, never the sum', () => {
    const merged = mergeStock([{ account: 'DH', rows: readStockResponse(ok) }]);
    expect(merged.get('6223001234567')).toEqual({ qty: 3, price: 1195, was: 1495, store: 'DH' });
    expect(merged.get('6223007654321')).toEqual({ qty: 0, price: 1000, store: 'DH' });
  });

  it('merges databases: a barcode belongs to whichever one stocks it', () => {
    const merged = mergeStock([
      { account: 'DH', rows: [{ barcode: 'A', qty: 2 }, { barcode: 'B', qty: 0 }] },
      { account: 'DCO', rows: [{ barcode: 'B', qty: 5 }, { barcode: 'C', qty: -1 }, { barcode: 'A', qty: 0 }] },
    ]);
    expect(merged.get('A')).toEqual({ qty: 2, store: 'DH' });
    expect(merged.get('B')).toEqual({ qty: 5, store: 'DCO' });
    expect(merged.get('C')).toEqual({ qty: 0, store: 'DCO' });
  });
});
