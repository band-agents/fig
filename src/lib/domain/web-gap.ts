/**
 * Why the website and Lucida disagree, size by size and style by style.
 *
 * Dan, 21 Oct 2026: "compare between the live product on the website and the actual product on the
 * web items… why there is a gap, and why there is items that is not published on the website, and
 * the reason… missing photo, missing info, don't have stock". Each size gets one verdict and a list
 * of the reasons behind it, from facts both sides hold, never guessed:
 *
 * - Lucida's StockInquiry answers only for items defined as web items, and leaves out quantity 0, so
 *   "Lucida does not report it" means either not a web item or sold out there. It is said that way.
 * - A style is live when the store's product is ACTIVE; draft and archived products are not on sale.
 * Pure: amounts are minor units in the store's currency.
 */

export type GapRow = {
  barcode: string;
  status: string; // active | draft | archived | absent
  hasPhoto: boolean | null;
  hasDescription: boolean | null;
  hasCategory: boolean | null;
  price: number | null;
  webQty: number | null;
  lucidaQty: number | null; // null = Lucida not asked
  lucidaPrice: number | null;
};

export const VERDICTS = {
  ok: { label: 'Live and matching', tone: 'neutral', group: 'matched' },
  live_qty: { label: 'Live, stock differs from Lucida', tone: 'warning', group: 'gap' },
  live_price: { label: 'Live, price differs from Lucida', tone: 'warning', group: 'gap' },
  live_not_lucida: { label: 'Live, Lucida reports no stock', tone: 'critical', group: 'gap' },
  live_sold_out: { label: 'Live but sold out', tone: 'warning', group: 'gap' },
  unpublished_stock: { label: 'Not published, Lucida has stock', tone: 'critical', group: 'unpublished' },
  unpublished_none: { label: 'Not published, no stock anywhere', tone: 'neutral', group: 'quiet' },
  not_uploaded: { label: 'In Lucida, not on the website', tone: 'critical', group: 'unpublished' },
  live_web_only: { label: 'Live (Lucida not asked yet)', tone: 'neutral', group: 'matched' },
  unpublished: { label: 'Not published', tone: 'attention', group: 'unpublished' },
} as const;
export type Verdict = keyof typeof VERDICTS;

export const REASONS = {
  no_photo: 'Missing photo',
  no_description: 'Missing description',
  no_category: 'Missing category or product type',
  no_price: 'Missing price',
  no_barcode: 'No barcode: cannot be matched to Lucida',
  web_no_stock: 'No stock on the website',
  lucida_no_stock: 'Lucida reports no stock (not a web item, or sold out there)',
  archived: 'Archived (old season)',
  draft: 'Kept as a draft',
  not_uploaded: 'Never created on the website',
  qty_differs: 'Website stock differs from Lucida',
  price_differs: 'Website price differs from Lucida',
} as const;
export type Reason = keyof typeof REASONS;

/** The verdict for one size and the reasons behind it. */
export function judge(r: GapRow): { verdict: Verdict; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const asked = r.lucidaQty !== null;
  const lucida = r.lucidaQty ?? 0;
  const web = Math.max(0, r.webQty ?? 0);
  if (r.status === 'absent') return { verdict: 'not_uploaded', reasons: ['not_uploaded'] };
  if (!r.barcode || r.barcode.startsWith('no-barcode:')) reasons.push('no_barcode');
  if (r.hasPhoto === false) reasons.push('no_photo');
  if (r.hasDescription === false) reasons.push('no_description');
  if (r.hasCategory === false) reasons.push('no_category');
  if (!r.price) reasons.push('no_price');

  if (r.status === 'active') {
    if (!asked) return { verdict: web > 0 ? 'live_web_only' : 'live_sold_out', reasons: web > 0 ? reasons : [...reasons, 'web_no_stock'] };
    if (lucida === 0 && web > 0) return { verdict: 'live_not_lucida', reasons: [...reasons, 'lucida_no_stock'] };
    if (lucida === 0 && web === 0) return { verdict: 'live_sold_out', reasons: [...reasons, 'web_no_stock', 'lucida_no_stock'] };
    if (web !== lucida) return { verdict: 'live_qty', reasons: [...reasons, 'qty_differs', ...(web === 0 ? (['web_no_stock'] as Reason[]) : [])] };
    if (r.lucidaPrice && r.price && r.lucidaPrice !== r.price) return { verdict: 'live_price', reasons: [...reasons, 'price_differs'] };
    return { verdict: 'ok', reasons };
  }

  // draft or archived: not on sale
  const why: Reason[] = [...reasons, r.status === 'archived' ? 'archived' : 'draft'];
  if (web === 0) why.push('web_no_stock');
  if (asked && lucida > 0) return { verdict: 'unpublished_stock', reasons: why };
  if (asked && lucida === 0) return { verdict: web > 0 ? 'unpublished' : 'unpublished_none', reasons: [...why, 'lucida_no_stock'] };
  return { verdict: 'unpublished', reasons: why };
}

/** A style's verdict: the most pressing of its sizes'. */
const ORDER: Verdict[] = ['live_not_lucida', 'unpublished_stock', 'not_uploaded', 'live_qty', 'live_price', 'live_sold_out', 'unpublished', 'unpublished_none', 'live_web_only', 'ok'];
export const worst = (vs: Verdict[]): Verdict => ORDER.find((v) => vs.includes(v)) ?? 'ok';

/** Reasons for a style: those its sizes share, then the rest, without repeats. */
export function styleReasons(rows: Reason[][]): Reason[] {
  const count = new Map<Reason, number>();
  for (const rs of rows) for (const r of new Set(rs)) count.set(r, (count.get(r) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}
