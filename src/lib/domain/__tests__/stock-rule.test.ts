import { describe, expect, it } from 'vitest';
import { cannotDraft, cannotPublish, OOS_TAG } from '../stock-rule';

const product = (over: Partial<Parameters<typeof cannotDraft>[0]> = {}) => ({
  id: 'gid://shopify/Product/1',
  title: 'Satin Robe',
  status: 'ACTIVE',
  totalInventory: 0,
  tracksInventory: true,
  tags: [] as string[],
  stopsAtZero: true,
  ...over,
});

describe('taking a sold-out product off the shop', () => {
  it('drafts one that is tracked, stops at zero, and has none left', () => {
    expect(cannotDraft(product())).toBe(null);
  });

  it('leaves alone a product whose stock is not tracked', () => {
    // Shopify reports zero for an untracked product whether there are none or a thousand.
    expect(cannotDraft(product({ tracksInventory: false }))).toMatch(/not tracked/);
  });

  it('leaves alone a product meant to be sold at zero', () => {
    expect(cannotDraft(product({ stopsAtZero: false }))).toMatch(/keep selling/);
  });

  it('changes its mind if stock arrived while it was looking', () => {
    expect(cannotDraft(product({ totalInventory: 3 }))).toMatch(/back in stock/);
  });
});

describe('putting one back on the shop', () => {
  it('publishes a product the rule drafted, once stock is back', () => {
    expect(cannotPublish(product({ status: 'DRAFT', tags: [OOS_TAG], totalInventory: 4 }))).toBe(null);
  });

  it('never publishes a draft the rule did not make', () => {
    /* The whole reason for the tag: an unreleased product, or one pulled on purpose, must not go
       live the day a delivery lands. */
    expect(cannotPublish(product({ status: 'DRAFT', tags: ['aw26', 'gender:women'], totalInventory: 9 }))).toMatch(
      /not drafted by the rule/
    );
  });

  it('keeps it down while there is still nothing to sell', () => {
    expect(cannotPublish(product({ status: 'DRAFT', tags: [OOS_TAG], totalInventory: 0 }))).toMatch(/nothing in stock/);
  });
});
