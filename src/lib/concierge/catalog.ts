import 'server-only';
import { CHANNEL, type ChannelDef } from '../channels';
import { shopifyRead } from '../connectors/shopify';

/**
 * What the shopping concierge knows about a storefront, read live from its Shopify store.
 *
 * Two kinds of knowledge, kept apart on purpose:
 *
 *   The store's own words — policies, pages, the menu — change rarely, so they are read once,
 *   kept for a quarter of an hour, and handed to the model as a fixed block it can cache.
 *
 *   The catalogue changes by the minute (Lucida moves stock all day), so products are never
 *   cached here: every search and every product the concierge describes is read at that moment,
 *   and only products that are live and in stock are offered.
 *
 * Read only. Nothing here can change the store.
 */

export type ProductCard = {
  id: string;
  handle: string;
  title: string;
  brand: string;
  type: string;
  url: string;
  image: string | null;
  /** Display price, e.g. "KWD 12.500". */
  price: string;
  /** The pre-sale price when the piece is reduced. */
  was: string | null;
  sizesInStock: string[];
  colour: string | null;
  inStock: boolean;
};

export type ProductDetail = ProductCard & {
  description: string;
  images: string[];
  sizes: { size: string; inStock: boolean }[];
  /** The same style in other colours, live and in stock. */
  otherColours: { handle: string; colour: string | null; title: string }[];
  tags: string[];
};

/* ---------------- helpers ---------------- */

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };

/** Shopify's rich text as plain text: block tags become line breaks, everything else goes. */
export function plain(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITY[e] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function amount(value: string | number | null | undefined, currency: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const decimals = currency === 'KWD' || currency === 'JOD' ? 3 : 2;
  return `${currency} ${n.toFixed(decimals)}`;
}

/** Shopify's CDN resizes on request; a chat card needs a fraction of the original. */
const thumb = (url: string | null | undefined, width = 480) =>
  url ? `${url}${url.includes('?') ? '&' : '?'}width=${width}` : null;

const colourOf = (tags: string[]) => tags.find((t) => t.startsWith('color:'))?.slice(6) ?? null;
const colourGroupOf = (tags: string[]) => tags.find((t) => t.startsWith('_color_group_')) ?? null;

/** Shopify search syntax needs quoting for values with spaces or punctuation. */
const quote = (s: string) => `"${s.replace(/["\\]/g, ' ').trim()}"`;

export function conciergeChannel(store: string | null | undefined): ChannelDef {
  const c = CHANNEL[store ?? ''] ?? CHANNEL['labesny-web'];
  if (c.platform !== 'shopify') throw new Error(`${c.name} is not a Shopify store.`);
  return c;
}

/* ---------------- products ---------------- */

const CARD_FIELDS = `
  id handle title vendor productType tags onlineStoreUrl totalInventory status
  featuredMedia { preview { image { url } } }
  priceRangeV2 { minVariantPrice { amount currencyCode } }
  compareAtPriceRange { maxVariantCompareAtPrice { amount } }
  variants(first: 40) { nodes { title availableForSale inventoryQuantity selectedOptions { name value } } }
`;

type RawProduct = {
  id: string;
  /** Collections hold drafts and archived pieces too; only ACTIVE is for sale. */
  status?: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  onlineStoreUrl: string | null;
  totalInventory: number | null;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  compareAtPriceRange: { maxVariantCompareAtPrice: { amount: string } | null } | null;
  variants: { nodes: { title: string; availableForSale: boolean; inventoryQuantity: number | null; selectedOptions: { name: string; value: string }[] }[] };
};

function sizeOf(v: RawProduct['variants']['nodes'][number]) {
  return v.selectedOptions.find((o) => /size|taille|مقاس/i.test(o.name))?.value ?? (v.title === 'Default Title' ? 'One size' : v.title);
}

const variantInStock = (v: RawProduct['variants']['nodes'][number]) => v.availableForSale && (v.inventoryQuantity ?? 1) > 0;

function toCard(p: RawProduct, domain: string): ProductCard {
  const currency = p.priceRangeV2.minVariantPrice.currencyCode;
  const price = amount(p.priceRangeV2.minVariantPrice.amount, currency) ?? '';
  const wasRaw = Number(p.compareAtPriceRange?.maxVariantCompareAtPrice?.amount ?? 0);
  const was = wasRaw > Number(p.priceRangeV2.minVariantPrice.amount) ? amount(wasRaw, currency) : null;
  const live = !p.status || p.status === 'ACTIVE';
  const sizesInStock = live ? p.variants.nodes.filter(variantInStock).map(sizeOf) : [];
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    brand: p.vendor,
    type: p.productType,
    url: p.onlineStoreUrl ?? `${domain}/products/${p.handle}`,
    image: thumb(p.featuredMedia?.preview?.image?.url),
    price,
    was,
    sizesInStock,
    colour: colourOf(p.tags),
    inStock: sizesInStock.length > 0,
  };
}

/**
 * What the advisor may put in front of a shopper: in stock, with a photograph, and once. A card
 * with an empty frame sells nothing, and some older pieces exist as one page per size with the same
 * name — shown together they read as the same thing three times.
 */
function showable(cards: ProductCard[]): ProductCard[] {
  const seen = new Set<string>();
  return cards.filter((p) => {
    if (!p.inStock || !p.image) return false;
    const key = `${p.brand}|${p.title}|${p.price}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type SearchInput = {
  text?: string;
  brand?: string;
  category?: string;
  department?: 'women' | 'men' | 'kids';
  onSale?: boolean;
  minPrice?: number;
  maxPrice?: number;
  size?: string;
  colour?: string;
  /** Newest first, for "what's new". */
  newest?: boolean;
  limit?: number;
};

/**
 * Live, published, in-stock products matching what the shopper described. Free text goes to
 * Shopify's own search (title, description, type, tags); the structured filters narrow it. Price
 * and size are checked here, against the variants, because Shopify's search does not filter on
 * them reliably.
 */
export async function searchProducts(c: ChannelDef, input: SearchInput): Promise<ProductCard[]> {
  const terms = ['status:active', 'published_status:published', 'inventory_total:>0'];
  if (input.brand) terms.push(`vendor:${quote(input.brand)}`);
  if (input.department) terms.push(`tag:${quote(`gender:${input.department}`)}`);
  if (input.onSale) terms.push(`tag:${quote('on-sale')}`);
  if (input.colour) terms.push(`tag:${quote(`color:${input.colour}`)}`);
  if (input.category) terms.push(`(product_type:${quote(input.category)} OR tag:${quote(input.category)} OR title:${quote(input.category)})`);
  const text = (input.text ?? '').replace(/[():]/g, ' ').trim();
  if (text) terms.push(text);

  const domain = await storeDomain(c);
  /* Browsing with nothing to search for — "what's new", "something for her" — reads the shop's own
     collections: New Arrivals in the order the shop added them, the departments by best-seller.
     Sorting the whole catalogue by date instead finds old single-size pages first. */
  const browse = !text && !input.category && !input.colour && (input.newest || input.department);
  let nodes: RawProduct[] = [];
  if (browse) {
    const handle = input.newest ? 'new-in' : input.department!;
    const data = await shopifyRead<{ collectionByHandle: { products: { nodes: RawProduct[] } } | null }>(
      c,
      `query($h: String!, $sort: ProductCollectionSortKeys!, $reverse: Boolean!) { collectionByHandle(handle: $h) { products(first: 100, sortKey: $sort, reverse: $reverse) { nodes { ${CARD_FIELDS} } } } }`,
      { h: handle, sort: input.newest ? 'CREATED' : 'BEST_SELLING', reverse: Boolean(input.newest) },
    );
    nodes = (data.collectionByHandle?.products.nodes ?? []).filter(
      (p) =>
        (!input.brand || p.vendor.toLowerCase() === input.brand.toLowerCase()) &&
        (!input.department || !input.newest || p.tags.includes(`gender:${input.department}`)) &&
        (!input.onSale || p.tags.includes('on-sale')),
    );
  }
  /* A collection whose top sellers are not on sale right now (Menswear is mostly next season's
     drafts) falls back to a plain search of live pieces in that department. */
  if (!browse || !showable(nodes.map((p) => toCard(p, domain))).length) {
    const data = await shopifyRead<{ products: { nodes: RawProduct[] } }>(
      c,
      `query($q: String!, $sort: ProductSortKeys!, $reverse: Boolean!) { products(first: 100, query: $q, sortKey: $sort, reverse: $reverse) { nodes { ${CARD_FIELDS} } } }`,
      /* Relevance only means something with words to rank by. Otherwise the pieces whose stock moved
         most recently: the live range, photographed — newest-created would be next season's blank pages. */
      { q: terms.join(' '), sort: text ? 'RELEVANCE' : 'UPDATED_AT', reverse: !text },
    );
    nodes = data.products.nodes;
  }

  const wantSize = input.size?.trim().toLowerCase();
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 10);
  return showable(nodes.map((p) => toCard(p, domain)))
    .filter((p) => (wantSize ? p.sizesInStock.some((s) => s.toLowerCase() === wantSize) : true))
    .filter((p) => {
      const n = Number(p.price.replace(/[^\d.]/g, ''));
      return (input.minPrice == null || n >= input.minPrice) && (input.maxPrice == null || n <= input.maxPrice);
    })
    .slice(0, limit);
}

const DETAIL_FIELDS = `${CARD_FIELDS} description media(first: 4) { nodes { preview { image { url } } } }`;

/** One product in full: description, every size and whether it is in stock, the other colours. */
export async function productDetail(c: ChannelDef, handle: string): Promise<ProductDetail | null> {
  const domain = await storeDomain(c);
  const data = await shopifyRead<{ productByIdentifier: (RawProduct & { description: string; status?: string; media: { nodes: { preview: { image: { url: string } | null } | null }[] } }) | null }>(
    c,
    `query($h: String!) { productByIdentifier(identifier: { handle: $h }) { status ${DETAIL_FIELDS} } }`,
    { h: handle },
  );
  const p = data.productByIdentifier;
  if (!p || (p.status && p.status !== 'ACTIVE')) return null;

  const group = colourGroupOf(p.tags);
  let otherColours: ProductDetail['otherColours'] = [];
  if (group) {
    const siblings = await shopifyRead<{ products: { nodes: { handle: string; title: string; tags: string[] }[] } }>(
      c,
      `query($q: String!) { products(first: 12, query: $q) { nodes { handle title tags } } }`,
      { q: `status:active published_status:published inventory_total:>0 tag:${quote(group)}` },
    );
    otherColours = siblings.products.nodes
      .filter((s) => s.handle !== p.handle)
      .map((s) => ({ handle: s.handle, title: s.title, colour: colourOf(s.tags) }));
  }

  const card = toCard(p, domain);
  return {
    ...card,
    description: plain(p.description).slice(0, 1500),
    images: p.media.nodes.map((m) => thumb(m.preview?.image?.url, 800)).filter((u): u is string => Boolean(u)),
    sizes: p.variants.nodes.map((v) => ({ size: sizeOf(v), inStock: variantInStock(v) })),
    otherColours,
    tags: p.tags.filter((t) => !t.startsWith('_') && !t.startsWith('SAPG')),
  };
}

/** Cards for products the concierge has chosen to show, by handle, in the order given. */
export async function cardsByHandle(c: ChannelDef, handles: string[]): Promise<ProductCard[]> {
  const wanted = [...new Set(handles.map((h) => h.trim()).filter(Boolean))].slice(0, 8);
  if (!wanted.length) return [];
  const domain = await storeDomain(c);
  const data = await shopifyRead<{ products: { nodes: RawProduct[] } }>(
    c,
    `query($q: String!) { products(first: 8, query: $q) { nodes { ${CARD_FIELDS} } } }`,
    { q: `status:active published_status:published (${wanted.map((h) => `handle:${quote(h)}`).join(' OR ')})` },
  );
  const byHandle = new Map(data.products.nodes.map((p) => [p.handle, toCard(p, domain)]));
  return showable(wanted.map((h) => byHandle.get(h)).filter((p): p is ProductCard => Boolean(p)));
}

/**
 * What goes with a piece: the pieces a stylist would put beside it. A bra is completed by the brief
 * in the same lace; a pyjama top by its bottoms; a shirt by trousers. Same brand first, because a
 * set only matches within a brand, and the same colour first within that.
 */
const PAIRS: [RegExp, string[]][] = [
  /* Swimwear first: a "plunge bikini top" is not a bra, and its pair is the bikini bottom. */
  [/swim|bikini/i, ['Bikini', 'Bikini Bottoms', 'Swimwear', 'Kaftans', 'Beachwear']],
  [/bra|bralette|balcon|push.?up|plunge|bandeau/i, ['Briefs', 'Brazilian', 'Thongs', 'G-Strings', 'Boyshorts', 'Panties', 'Knickers']],
  [/brief|thong|string|boyshort|pant(y|ies)|knicker|brazilian/i, ['Bras', 'Bralettes']],
  [/pyjama|pajama|sleep|nightdress|nightgown|chemise|babydoll/i, ['Robes', 'Slippers', 'Kimono', 'Socks']],
  [/top|t-shirt|tee|blouse|shirt|sweat|knit|cardigan|jumper/i, ['Trousers', 'Jeans', 'Skirts', 'Shorts', 'Leggings']],
  [/trouser|jean|skirt|short|legging|pant/i, ['Tops', 'Shirts', 'T-shirts', 'Blouses', 'Knitwear']],
  [/dress|jumpsuit|romper/i, ['Jackets', 'Blazers', 'Bags', 'Accessories']],
  [/jacket|blazer|coat/i, ['Tops', 'Trousers', 'Dresses']],
];

export async function pairings(c: ChannelDef, handle: string, limit = 4): Promise<ProductCard[]> {
  const base = await productDetail(c, handle);
  if (!base) return [];
  const rule = PAIRS.find(([re]) => re.test(`${base.type} ${base.title}`));
  if (!rule) return [];
  const types = rule[1];
  const domain = await storeDomain(c);
  const data = await shopifyRead<{ products: { nodes: RawProduct[] } }>(
    c,
    `query($q: String!) { products(first: 30, query: $q) { nodes { ${CARD_FIELDS} } } }`,
    {
      q: `status:active published_status:published inventory_total:>0 vendor:${quote(base.brand)} (${types
        .map((t) => `product_type:${quote(t)} OR tag:${quote(t)}`)
        .join(' OR ')})`,
    },
  );
  const cards = showable(data.products.nodes.map((p) => toCard(p, domain))).filter((p) => p.handle !== base.handle);
  /* The same colour first — that is what makes it a set rather than two things from one shop. */
  cards.sort((a, b) => Number(b.colour === base.colour) - Number(a.colour === base.colour));
  return cards.slice(0, limit);
}

/* ---------------- the store's own words ---------------- */

export type StorePage = { handle: string; title: string; url: string; text: string };
type Knowledge = { at: number; text: string; domain: string; pages: StorePage[] };
const knowledge = new Map<string, Knowledge>();
const KNOWLEDGE_TTL = 15 * 60_000;

async function storeDomain(c: ChannelDef): Promise<string> {
  const hit = knowledge.get(c.id);
  if (hit) return hit.domain;
  return (await storeKnowledge(c)).domain;
}

type Menu = { title: string; url: string; items?: Menu[] };

/**
 * Policies, published pages and the main menu, as one block of plain text. Fixed for fifteen
 * minutes at a time so that every conversation in that window sends the model the same bytes and
 * the prompt cache holds.
 */
export async function storeKnowledge(c: ChannelDef): Promise<Knowledge> {
  const hit = knowledge.get(c.id);
  if (hit && Date.now() - hit.at < KNOWLEDGE_TTL) return hit;

  const data = await shopifyRead<{
    shop: { name: string; primaryDomain: { url: string }; shopPolicies: { title: string; body: string; url: string }[] };
    pages: { nodes: { title: string; handle: string; body: string; isPublished: boolean }[] };
    menus: { nodes: { handle: string; items: Menu[] }[] };
  }>(
    c,
    `{
      shop { name primaryDomain { url } shopPolicies { title body url } }
      pages(first: 50) { nodes { title handle body isPublished } }
      menus(first: 10) { nodes { handle items { title url items { title url items { title url } } } } }
    }`,
  );

  const domain = data.shop.primaryDomain.url.replace(/\/$/, '');
  const link = (url: string) => (url.startsWith('/') ? `${domain}${url}` : url);
  const menuText = (items: Menu[], depth = 0): string =>
    items.map((i) => `${'  '.repeat(depth)}- ${plain(i.title)} (${link(i.url)})\n${i.items?.length ? menuText(i.items, depth + 1) : ''}`).join('');

  const main = data.menus.nodes.find((m) => m.handle === 'main-menu');
  const sections = [
    `# ${data.shop.name} — ${domain}`,
    main ? `## Main menu (departments, brands and collections)\n${menuText(main.items)}` : '',
    ...data.pages.nodes
      .filter((p) => p.isPublished && plain(p.body).length > 20)
      .map((p) => `## Page: ${plain(p.title)} (${domain}/pages/${p.handle})\n${plain(p.body).slice(0, 4000)}`),
    ...data.shop.shopPolicies
      .filter((p) => plain(p.body).length > 20)
      .map((p) => `## Policy: ${p.title} (${p.url})\n${plain(p.body).slice(0, 6000)}`),
  ].filter(Boolean);

  /* The same pages kept apart too, so the basic mode can quote the one a question is about. */
  const pages: StorePage[] = data.pages.nodes
    .filter((p) => p.isPublished && plain(p.body).length > 20)
    .map((p) => ({ handle: p.handle, title: plain(p.title), url: `${domain}/pages/${p.handle}`, text: plain(p.body) }));
  const out = { at: Date.now(), text: sections.join('\n\n'), domain, pages };
  knowledge.set(c.id, out);
  return out;
}
