// Catalogue import: a products sheet (rows) into products (a product, its variants, its photos).
// Pure. Rows that share a handle (or an ID) are one product, as in Matrixify; a row with no handle,
// ID or title continues the product above it, so the teams' own sheets (a style on its first row, its
// sizes under it) read the same way. An empty cell means "leave as it is", unless asked otherwise.
import { numberIn } from '../sheet-read';
import { FIELD, type FieldKey, type Mapped } from './fields';

export type Cmd = 'MERGE' | 'NEW' | 'UPDATE' | 'REPLACE' | 'DELETE' | 'IGNORE';
export type ListCmd = 'MERGE' | 'REPLACE' | 'DELETE';
export type Status = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

export type FileMetafield = { owner: 'product' | 'variant'; namespace: string; key: string; type: string; value: string; store?: string };

export type VariantValues = { sku?: string; barcode?: string; price?: string; compareAt?: string; taxable?: boolean; cost?: string; inventoryPolicy?: 'DENY' | 'CONTINUE'; inventoryQty?: number; image?: string };
export type ProductValues = { title?: string; bodyHtml?: string; vendor?: string; type?: string; category?: string; subcategory?: string; gender?: string; season?: string; colour?: string; titleAr?: string; bodyHtmlAr?: string; tags?: string[]; status?: Status; published?: boolean; templateSuffix?: string; seoTitle?: string; seoDescription?: string };

export type FileVariant = VariantValues & {
  line: number;
  id?: string;
  command?: ListCmd;
  options: string[]; // aligned with the product's option names; '' where the row gives none
  position?: number;
  metafields: FileMetafield[];
  overrides: Record<string, VariantValues>; // per store, from "@Store" columns
};

export type FileImage = { line: number; src: string; position?: number; alt?: string; command?: ListCmd };

export type FileProduct = ProductValues & {
  key: string; // what groups its rows: the ID, else the handle
  lines: number[]; // the sheet's own row numbers (1 = header)
  id?: string;
  handle: string;
  handleMade: boolean; // made from the title (the file had none): the store's product is then found by barcode
  command: Cmd;
  tagsCommand?: ListCmd;
  variantCommand?: ListCmd;
  imageCommand?: ListCmd;
  optionNames: string[];
  variants: FileVariant[];
  images: FileImage[];
  metafields: FileMetafield[];
  overrides: Record<string, ProductValues>;
  problems: string[]; // read problems: a status or a price that could not be read
  matched?: string; // found in the store by barcode (no handle in the file)
};

/** splitColours: a sheet of styles with a Colour column and no handles becomes one product per colour, as the websites list them ("Logo Tee - Blue", sizes as variants). */
export type ParseOptions = { emptyClears?: boolean; splitColours?: boolean };

const CMDS: Cmd[] = ['MERGE', 'NEW', 'UPDATE', 'REPLACE', 'DELETE', 'IGNORE'];
const LIST: ListCmd[] = ['MERGE', 'REPLACE', 'DELETE'];

/** A handle Shopify accepts, made from any text (Arabic titles fall back to the SKU or a number). */
export function slugify(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

export const readBool = (s: string): boolean | null => {
  const t = s.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on', 'نعم'].includes(t)) return true;
  if (['false', 'no', 'n', '0', 'off', 'لا'].includes(t)) return false;
  return null;
};

/** A money amount as Shopify takes it: plain digits, up to 3 decimals (KWD has 3). */
export function readMoney(s: string): string | null {
  const n = numberIn(s.replace(/[^\d.,\-]/g, ''));
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return String(Math.round(n * 1000) / 1000);
}

const readStatus = (s: string): Status | null => {
  const t = s.trim().toLowerCase();
  if (t === 'active' || t === 'live' || t === 'published') return 'ACTIVE';
  if (t === 'draft' || t === 'hidden') return 'DRAFT';
  if (t === 'archived' || t === 'archive') return 'ARCHIVED';
  return null;
};

export const readTags = (s: string) => [...new Set(s.split(/[,،;]/).map((t) => t.trim()).filter(Boolean))];

const TEXT_KEYS = ['title', 'bodyHtml', 'vendor', 'type', 'category', 'subcategory', 'gender', 'season', 'titleAr', 'bodyHtmlAr', 'templateSuffix', 'seoTitle', 'seoDescription'] as const;
type TextKey = (typeof TEXT_KEYS)[number];

const VARIANT_KEYS = new Set<FieldKey>(['variantId', 'variantCommand', 'option1Value', 'option2Value', 'option3Value', 'variantPosition', 'sku', 'barcode', 'price', 'compareAt', 'taxable', 'cost', 'inventoryPolicy', 'inventoryQty', 'variantImage']);

/**
 * Rows to products. `mapped` comes from mapHeader (or the review screen's corrections); `grid[0]` is the
 * header. Returns the products in the order they first appear.
 */
export function parseProducts(grid: string[][], mapped: Mapped[], opts: ParseOptions = {}): FileProduct[] {
  const products: FileProduct[] = [];
  const byKey = new Map<string, FileProduct>();
  const split = Boolean(opts.splitColours);
  const colourCol = split ? mapped.find((m) => m.ref.kind === 'option' && m.ref.name === 'Colour') : undefined;
  // split by colour: the colour names the product, so it is not a variant option
  const namedOptions = [...new Set(mapped.flatMap((m) => (m.ref.kind === 'option' && !(colourCol && m.ref.name === 'Colour') ? [m.ref.name] : [])))];
  let current: FileProduct | null = null;
  let lastTitle = '';

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const line = r + 1;
    const cell = (m: Mapped) => (row[m.index] ?? '').trim();
    const get = (key: FieldKey) => {
      const m = mapped.find((x) => x.ref.kind === 'field' && x.ref.key === key && !x.ref.store);
      return m ? cell(m) : '';
    };
    const has = (key: FieldKey) => mapped.some((x) => x.ref.kind === 'field' && x.ref.key === key && !x.ref.store);

    const id = idOf(get('id'), 'Product');
    const handle = get('handle').toLowerCase();
    const title = get('title');
    const colour = colourCol ? cell(colourCol) : '';
    let key: string | null;
    let display = title;
    const prevColour: string = (current as FileProduct | null)?.colour ?? '';
    if (colourCol && !id && !handle) {
      // one product per style and colour: a row with no title continues the style above, in its own colour
      const base = title || lastTitle;
      const tone: string = colour || prevColour;
      key = base ? `h:${slugify(base)}|${tone.toLowerCase()}` : null;
      display = base && tone && !base.toLowerCase().endsWith(tone.toLowerCase()) ? `${base} - ${tone}` : base;
    } else key = id ? `id:${id}` : handle ? `h:${handle}` : title ? `h:${slugify(title) || title}` : null;
    if (title) lastTitle = title;
    let p: FileProduct | undefined = key ? byKey.get(key) : (current ?? undefined);
    if (!p) {
      if (!key) continue; // nothing to hang this row on
      const made = !handle;
      p = {
        key,
        lines: [],
        id: id ?? undefined,
        handle: handle || slugify(display) || slugify(get('sku')) || `product-${line}`,
        handleMade: made && !id,
        command: 'MERGE',
        ...(colourCol && display !== title ? { title: display } : {}),
        ...(colourCol && (colour || prevColour) ? { colour: colour || prevColour } : {}),
        optionNames: [],
        variants: [],
        images: [],
        metafields: [],
        overrides: {},
        problems: [],
      };
      // a new colour started on a size row takes the style's own fields from the colour above
      const prev = current as FileProduct | null;
      if (colourCol && !title && prev) {
        for (const k of ['vendor', 'type', 'category', 'subcategory', 'gender', 'season', 'bodyHtml', 'bodyHtmlAr', 'status', 'published', 'templateSuffix'] as const) if (prev[k] !== undefined) (p as Record<string, unknown>)[k] = prev[k];
        if (prev.tags) p.tags = [...prev.tags];
        p.optionNames = [...prev.optionNames];
      }
      byKey.set(key, p);
      products.push(p);
    }
    current = p;
    p.lines.push(line);
    const prob = (m: string) => p!.problems.push(`Row ${line}: ${m}`);

    // ── product fields: the first row that gives one wins
    const text = (k: TextKey) => {
      if (!has(k) || p![k] !== undefined) return;
      const v = get(k);
      if (v) p![k] = v;
      else if (opts.emptyClears && p!.lines.length === 1 && k !== 'title' && k !== 'vendor') p![k] = '';
    };
    for (const k of TEXT_KEYS) text(k);
    if (has('command') && get('command')) {
      const c = get('command').toUpperCase() as Cmd;
      if (CMDS.includes(c)) p.command = c;
      else prob(`Command “${get('command')}” is not one of ${CMDS.join(', ')}; MERGE used.`);
    }
    // the variant and image commands are read with their rows below
    const tc = get('tagsCommand').toUpperCase() as ListCmd;
    if (tc && !p.tagsCommand) {
      if (LIST.includes(tc)) p.tagsCommand = tc;
      else prob(`Tags Command “${get('tagsCommand')}” is not MERGE, REPLACE or DELETE.`);
    }
    if (has('tags') && p.tags === undefined && get('tags')) p.tags = readTags(get('tags'));
    else if (has('tags') && p.tags === undefined && opts.emptyClears && p.lines.length === 1) p.tags = [];
    if (has('status') && p.status === undefined && get('status')) {
      const s = readStatus(get('status'));
      if (s) p.status = s;
      else prob(`Status “${get('status')}” is not Active, Draft or Archived.`);
    }
    if (has('published') && p.published === undefined && get('published')) {
      const b = readBool(get('published'));
      if (b == null) prob(`Published “${get('published')}” is not TRUE or FALSE.`);
      else p.published = b;
    }
    for (const n of [1, 2, 3] as const) {
      const v = get(`option${n}Name`);
      if (v && !p.optionNames[n - 1]) p.optionNames[n - 1] = v;
    }

    // ── per-store product values ("Status @FIG")
    for (const m of mapped) {
      if (m.ref.kind !== 'field' || !m.ref.store || VARIANT_KEYS.has(m.ref.key)) continue;
      const v = cell(m);
      if (!v) continue;
      const o = (p.overrides[m.ref.store] ??= {});
      const k = m.ref.key;
      if (k === 'status') {
        const s = readStatus(v);
        if (s) o.status = s;
        else prob(`${m.header} “${v}” is not Active, Draft or Archived.`);
      } else if (k === 'published') {
        const b = readBool(v);
        if (b != null) o.published = b;
      } else if (k === 'tags') o.tags = readTags(v);
      else if ((TEXT_KEYS as readonly string[]).includes(k)) {
        if (o[k as TextKey] === undefined) o[k as TextKey] = v;
      }
    }

    // ── metafields (product ones on any row, first value wins; variant ones go with the row's variant)
    const variantMeta: FileMetafield[] = [];
    for (const m of mapped) {
      if (m.ref.kind !== 'metafield') continue;
      const v = cell(m);
      if (!v) continue;
      const f: FileMetafield = { owner: m.ref.owner, namespace: m.ref.namespace, key: m.ref.key, type: m.ref.type, value: v, ...(m.ref.store ? { store: m.ref.store } : {}) };
      if (m.ref.owner === 'variant') variantMeta.push(f);
      else if (!p.metafields.some((x) => x.namespace === f.namespace && x.key === f.key && x.store === f.store)) p.metafields.push(f);
    }

    // ── the row's variant, when it gives anything a variant has
    const named = namedOptions.map((name) => {
      const m = mapped.find((x) => x.ref.kind === 'option' && x.ref.name === name);
      return m ? cell(m) : '';
    });
    const storeVariant = mapped.filter((m) => m.ref.kind === 'field' && m.ref.store && VARIANT_KEYS.has(m.ref.key) && cell(m));
    const isVariantRow = [...VARIANT_KEYS].some((k) => has(k) && get(k)) || named.some(Boolean) || variantMeta.length > 0 || storeVariant.length > 0;
    if (isVariantRow) {
      // named options (Size, Colour) take the option slots after any OptionN Name the file gives
      for (const name of namedOptions) if (!p.optionNames.includes(name) && named[namedOptions.indexOf(name)]) p.optionNames.push(name);
      const values = p.optionNames.map((name, i) => {
        const byNumber = i < 3 ? get(`option${(i + 1) as 1 | 2 | 3}Value`) : '';
        const ni = namedOptions.indexOf(name);
        return byNumber || (ni >= 0 ? named[ni] : '');
      });
      const v: FileVariant = { line, options: values, metafields: variantMeta, overrides: {} };
      const vid = idOf(get('variantId'), 'ProductVariant');
      if (vid) v.id = vid;
      const vc = get('variantCommand').toUpperCase() as ListCmd;
      if (vc) {
        if (LIST.includes(vc)) v.command = vc;
        else prob(`Variant Command “${get('variantCommand')}” is not MERGE, REPLACE or DELETE.`);
      }
      readVariantValues(v, (k) => (has(k) ? get(k) : ''), prob);
      const pos = numberIn(get('variantPosition'));
      if (pos != null && pos > 0) v.position = Math.round(pos);
      for (const m of storeVariant) {
        const o = (v.overrides[(m.ref as { store: string }).store] ??= {});
        readVariantValues(o, (k) => ((m.ref as { key: FieldKey }).key === k ? cell(m) : ''), prob);
      }
      p.variants.push(v);
    }

    // ── the row's photo
    const src = get('imageSrc');
    if (src) {
      const img: FileImage = { line, src };
      const pos = numberIn(get('imagePosition'));
      if (pos != null && pos > 0) img.position = Math.round(pos);
      if (get('imageAlt')) img.alt = get('imageAlt');
      const ic = get('imageCommand').toUpperCase() as ListCmd;
      if (ic && LIST.includes(ic)) img.command = ic;
      if (!p.images.some((x) => x.src === src)) p.images.push(img);
    }
  }

  // a product whose option slots filled up after its first variants: pad the earlier ones
  for (const p of products) {
    for (const v of p.variants) while (v.options.length < p.optionNames.length) v.options.push('');
    if (!p.variantCommand) p.variantCommand = p.variants.find((v) => v.command)?.command;
    if (!p.imageCommand) p.imageCommand = p.images.find((i) => i.command)?.command;
    if (p.optionNames.length > 3) p.problems.push(`More than 3 options (${p.optionNames.join(', ')}): Shopify allows 3.`);
  }
  return products;
}

function readVariantValues(v: VariantValues, get: (k: FieldKey) => string, prob: (m: string) => void) {
  const sku = get('sku');
  if (sku) v.sku = sku;
  const barcode = get('barcode');
  if (barcode) v.barcode = barcode.replace(/^'/, '').replace(/\.0+$/, '');
  for (const k of ['price', 'compareAt', 'cost'] as const) {
    const raw = get(k);
    if (!raw) continue;
    // a compare-at price of 0 (or "-") takes the sale off
    if (k === 'compareAt' && /^(0+([.,]0+)?|-)$/.test(raw)) {
      v.compareAt = '';
      continue;
    }
    const m = readMoney(raw);
    if (m == null) prob(`${FIELD[k].header} “${raw}” is not an amount.`);
    else v[k] = m;
  }
  const tax = get('taxable');
  if (tax) {
    const b = readBool(tax);
    if (b == null) prob(`Variant Taxable “${tax}” is not TRUE or FALSE.`);
    else v.taxable = b;
  }
  const pol = get('inventoryPolicy').toLowerCase();
  if (pol) {
    if (pol === 'deny' || pol === 'continue') v.inventoryPolicy = pol.toUpperCase() as 'DENY' | 'CONTINUE';
    else prob(`Inventory policy “${pol}” is not deny or continue.`);
  }
  const qty = get('inventoryQty');
  if (qty) {
    const n = numberIn(qty);
    if (n == null) prob(`Inventory Qty “${qty}” is not a number.`);
    else v.inventoryQty = Math.round(n);
  }
  const img = get('variantImage');
  if (img) v.image = img;
}

/** A Shopify ID as written in a sheet: the number alone, or the full gid. */
export function idOf(s: string, type: 'Product' | 'ProductVariant'): string | null {
  const t = s.trim();
  if (!t) return null;
  if (t.startsWith('gid://shopify/')) return t;
  const n = t.replace(/\.0+$/, '');
  return /^\d{5,}$/.test(n) ? `gid://shopify/${type}/${n}` : null;
}
