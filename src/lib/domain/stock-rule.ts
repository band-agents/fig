/**
 * When a product comes off the shop, and when it goes back on.
 *
 * The judgement, with none of the plumbing: given what a storefront says about a product, may the
 * rule take it down, and may it put it back? It is separated from the sweep that calls it because
 * these three or four lines are the whole of the risk — everything else is paging and mutations.
 */

export type RuleMode = 'off' | 'dry' | 'on';

/** The mark the rule leaves on what it drafts, so it can tell its own work from everyone else's. */
export const OOS_TAG = 'relay:oos';

export type RuleProduct = {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  /** False when the storefront does not count this product's stock at all. */
  tracksInventory: boolean;
  tags: string[];
  /** True when every variant stops selling at zero. A product that oversells is never drafted. */
  stopsAtZero: boolean;
};

/**
 * Whether a sold-out product may be taken down, or the reason it may not.
 *
 * Two of these matter more than they look. A product whose stock is not tracked reads as zero
 * whether there are none or a thousand; a product set to keep selling at zero is meant to be bought
 * at zero. Drafting either would take a perfectly good product off the shop.
 */
export function cannotDraft(p: RuleProduct): string | null {
  if (!p.tracksInventory) return 'inventory is not tracked, so zero does not mean sold out';
  if (!p.stopsAtZero) return 'set to keep selling at zero';
  if (p.totalInventory > 0) return 'back in stock between the search and the look';
  return null;
}

/**
 * Whether a product may go back on the shop, or the reason it may not.
 *
 * It only ever publishes what it drafted, which it knows from the tag. Without that, the first
 * delivery of a season would put every unreleased product, every half-finished draft and every line
 * that was pulled on purpose straight onto the shop.
 */
export function cannotPublish(p: RuleProduct): string | null {
  if (!p.tags.includes(OOS_TAG)) return 'this one was not drafted by the rule';
  if (p.totalInventory <= 0) return 'still has nothing in stock';
  return null;
}
