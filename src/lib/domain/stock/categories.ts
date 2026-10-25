// What a product is, as the planner needs to know it: its category, how that category moves
// through the year, and what it is worn with. Pure.

export const CATEGORIES = ['nightwear', 'lingerie', 'swimwear', 'dresses', 'tops', 'bottoms', 'outerwear', 'knitwear', 'bags', 'accessories', 'kids', 'homewear', 'menswear'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  nightwear: 'Nightwear & pyjamas',
  lingerie: 'Lingerie',
  swimwear: 'Swimwear',
  dresses: 'Dresses',
  tops: 'Tops & shirts',
  bottoms: 'Trousers & skirts',
  outerwear: 'Coats & jackets',
  knitwear: 'Knitwear & sweats',
  bags: 'Bags & luggage',
  accessories: 'Accessories',
  kids: 'Kids',
  homewear: 'Homewear',
  menswear: 'Menswear',
};

const RULES: [Category, RegExp][] = [
  ['kids', /\bkids?\b|junior|baby|children|boys?\b|girls?\b|toddler/i],
  ['swimwear', /bikini|swim|beach|bathing/i],
  ['nightwear', /pyjama|pajama|nightgown|nightdress|sleep|babydoll|chemise|robe|dressing gown/i],
  ['lingerie', /\bbra\b|bras\b|bralette|brief|panty|panties|thong|knicker|lingerie|corset|bodysuit|stocking|tights|hipster|balconette|plunge|push.?up|underwear|slip\b/i],
  ['homewear', /homewear|lounge|slipper|home\b/i],
  ['bags', /\bbag|backpack|tote|clutch|luggage|trolley|suitcase|wallet|purse|pouch|organi[sz]er/i],
  ['accessories', /sock|scarf|belt|hat\b|cap\b|beanie|glove|jewel|earring|necklace|accessor|sunglass|hair/i],
  ['outerwear', /coat|jacket|blazer|parka|puffer|trench|vest|gilet|outerwear/i],
  ['knitwear', /sweat|hoodie|pullover|cardigan|jumper|knit|fleece/i],
  ['dresses', /dress|jumpsuit|playsuit|onepiece|kaftan|abaya/i],
  ['bottoms', /trouser|pant|jean|skirt|short|legging|jogger|bottom/i],
  ['tops', /top\b|tops|t-?shirt|tee\b|shirt|blouse|polo|tank|cami/i],
];

/** Reads a product's category from its title, tags and type, most specific rule first. */
export function categorize(title: string, tags: string[] = [], type = ''): Category {
  const hay = `${title} ${tags.join(' ')} ${type}`.replace(/&amp;/g, '&');
  if (/\bmen\b|gender:men\b|springfield men|celio|tom tailor/i.test(hay) && !/women/i.test(hay)) return 'menswear';
  for (const [c, re] of RULES) if (re.test(hay)) return c;
  if (/nightwear|underwear/i.test(hay)) return 'nightwear';
  return 'tops';
}

/**
 * How each category sells across the year, January first, before the floor's own history is
 * read: 1 is an average month. The planner learns its own curve from two years of sales and only
 * leans on these where a category has too little history to say.
 */
const PRIOR_EG: Record<Category, number[]> = {
  nightwear: [1.25, 1.0, 1.1, 0.85, 0.7, 0.55, 0.55, 0.6, 0.8, 1.15, 1.6, 1.7],
  lingerie: [0.95, 1.3, 1.05, 0.95, 0.95, 0.9, 0.95, 0.95, 0.9, 0.95, 1.2, 1.0],
  swimwear: [0.12, 0.15, 0.35, 0.8, 1.7, 2.35, 2.4, 2.0, 0.85, 0.3, 0.12, 0.12],
  dresses: [0.7, 0.8, 1.2, 1.2, 1.15, 1.25, 1.1, 1.0, 0.95, 0.85, 0.9, 1.2],
  tops: [0.8, 0.85, 1.0, 1.1, 1.2, 1.25, 1.2, 1.15, 1.0, 0.85, 0.8, 0.8],
  bottoms: [0.95, 0.95, 1.0, 1.0, 1.0, 1.0, 0.95, 0.95, 1.05, 1.05, 1.05, 1.05],
  outerwear: [1.6, 1.15, 0.6, 0.3, 0.15, 0.1, 0.1, 0.2, 0.6, 1.5, 2.1, 2.2],
  knitwear: [1.55, 1.2, 0.8, 0.45, 0.3, 0.25, 0.25, 0.3, 0.7, 1.3, 1.85, 1.95],
  bags: [0.85, 0.9, 1.15, 1.0, 0.95, 0.95, 0.9, 0.95, 1.05, 0.95, 1.25, 1.4],
  accessories: [1.1, 1.0, 1.05, 0.9, 0.85, 0.8, 0.8, 0.85, 0.95, 1.05, 1.25, 1.4],
  kids: [0.9, 0.85, 1.05, 1.05, 1.05, 1.0, 0.9, 0.95, 1.55, 1.05, 0.95, 1.0],
  homewear: [1.15, 1.0, 1.15, 0.9, 0.8, 0.7, 0.7, 0.75, 0.85, 1.1, 1.35, 1.45],
  menswear: [0.95, 0.9, 1.05, 1.05, 1.0, 1.0, 0.9, 0.9, 1.0, 1.0, 1.15, 1.1],
};

const normalise = (a: number[]) => {
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return a.map((x) => x / m);
};

/** Kuwait: swimwear peaks earlier (people travel in June), and July–August is quiet overall. */
const PRIOR_KW: Record<Category, number[]> = Object.fromEntries(
  Object.entries(PRIOR_EG).map(([c, v]) => {
    if (c === 'swimwear') return [c, [0.15, 0.25, 0.6, 1.4, 2.2, 2.6, 1.5, 0.9, 0.5, 0.25, 0.15, 0.15]];
    return [c, v.map((x, i) => (i === 6 || i === 7 ? x * 0.85 : x))];
  }),
) as Record<Category, number[]>;

export function priorIndex(market: 'EG' | 'KW', c: Category): number[] {
  return normalise((market === 'KW' ? PRIOR_KW : PRIOR_EG)[c]);
}

/**
 * A category's monthly curve from its own sales, pulled toward the prior where the evidence is
 * thin. `units[m]` is total units sold in month m across every year seen, `periods[m]` how much
 * of that month was observed (weeks, or whole months): the rate per period is what is compared, so
 * a month seen only in part does not read as a slow one.
 */
export function learnIndex(units: number[], periods: number[], prior: number[], strength = 60): number[] {
  const rate = units.map((u, m) => (periods[m] ? u / periods[m] : 0));
  const seen = rate.filter((_, m) => periods[m] > 0);
  const mean = seen.reduce((s, x) => s + x, 0) / Math.max(1, seen.length) || 1;
  const raw = rate.map((x) => x / mean);
  // how many units back each month's figure, against a fixed pseudo-count for the prior
  const blended = raw.map((r, m) => {
    const w = periods[m] ? units[m] / (units[m] + strength) : 0;
    return w * r + (1 - w) * prior[m];
  });
  return normalise(blended);
}

/** The index on a given day of the year, eased between month midpoints so weeks don't jump. */
export function indexOn(idx: number[], month: number, dayOfMonth: number): number {
  const pos = month + (dayOfMonth - 15) / 30;
  const lo = Math.floor(pos);
  const t = pos - lo;
  const a = idx[((lo % 12) + 12) % 12];
  const b = idx[(((lo + 1) % 12) + 12) % 12];
  return a + (b - a) * t;
}

/** What a category is worn or bought with: where a cross-sell makes sense to a customer. */
export const COMPLEMENTS: Record<Category, Category[]> = {
  nightwear: ['homewear', 'accessories', 'lingerie'],
  lingerie: ['lingerie', 'nightwear'],
  swimwear: ['swimwear', 'bags', 'accessories'],
  dresses: ['bags', 'accessories', 'outerwear'],
  tops: ['bottoms', 'accessories', 'outerwear'],
  bottoms: ['tops', 'knitwear'],
  outerwear: ['knitwear', 'accessories', 'tops'],
  knitwear: ['bottoms', 'outerwear', 'accessories'],
  bags: ['accessories', 'dresses'],
  accessories: ['nightwear', 'lingerie', 'bags'],
  kids: ['kids'],
  homewear: ['nightwear', 'accessories'],
  menswear: ['menswear'],
};

/** Seasonal categories: buying them late, or holding them past their months, costs money. */
export const SEASONAL: Category[] = ['swimwear', 'outerwear', 'knitwear', 'nightwear'];
