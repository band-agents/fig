import { describe, expect, it } from 'vitest';
import { mapHeader, sheetFormat, type StoreKey } from '../catalog/fields';
import { parseProducts, slugify } from '../catalog/parse';
import { planProduct, tally, type StoreCtx, type StoreProduct } from '../catalog/plan';

/* Dan, 27 Oct: Matrixify inside the console, for every website. A sheet becomes products, each product a
   plan per store: what changes, before → after, and what Shopify is sent. */
const STORES: StoreKey[] = [
  { id: 'labesny-web', names: ['Labesny', 'szk0ey-ns'] },
  { id: 'fig-web', names: ['FIG', 'ujvi0q-ga'] },
];
const LAB: StoreCtx = { id: 'labesny-web', name: 'Labesny', currency: 'KWD', rules: { taxable: false, notes: ['Labesny never charges tax: every variant goes in not taxable.'] } };
const FIG: StoreCtx = { id: 'fig-web', name: 'FIG', currency: 'EGP', rules: { notes: [] } };

const read = (grid: string[][]) => parseProducts(grid, mapHeader(grid[0], STORES));

const existing = (over: Partial<StoreProduct> = {}): StoreProduct => ({
  id: 'gid://shopify/Product/1',
  handle: 'lace-bra',
  title: 'Lace bra',
  bodyHtml: '<p>Soft</p>',
  vendor: 'Etam',
  type: 'Bras',
  tags: ['women', 'cat:bras'],
  status: 'ACTIVE',
  published: true,
  templateSuffix: null,
  seoTitle: null,
  seoDescription: null,
  optionNames: ['Size'],
  variants: [
    { id: 'gid://shopify/ProductVariant/11', options: ['S'], sku: 'LB-S', barcode: '111', price: '10', compareAt: null, taxable: false, cost: null, inventoryPolicy: 'DENY', inventoryQty: 3, position: 1, image: null },
    { id: 'gid://shopify/ProductVariant/12', options: ['M'], sku: 'LB-M', barcode: '112', price: '10', compareAt: null, taxable: false, cost: null, inventoryPolicy: 'DENY', inventoryQty: 2, position: 2, image: null },
  ],
  images: [{ id: 'gid://shopify/MediaImage/9', src: 'https://cdn.shopify.com/s/files/1/lace-bra_1a2b3c4d-1111-2222-3333-444455556666.jpg?v=1', alt: 'Lace bra' }],
  metafields: [],
  ...over,
});

describe('reading the header', () => {
  it("knows Matrixify's, Shopify's and the teams' own names, metafields and @store columns", () => {
    const m = mapHeader(['Handle', 'Command', 'Body (HTML)', 'Brand', 'RRP', 'Barcode', 'Size', 'Colour', 'Metafield: custom.fabric [single_line_text_field]', 'Variant Price @FIG', 'Status @Nowhere', 'Whatever'], STORES);
    expect(m[0].ref).toEqual({ kind: 'field', key: 'handle' });
    expect(m[2].ref).toEqual({ kind: 'field', key: 'bodyHtml' });
    expect(m[3].ref).toEqual({ kind: 'field', key: 'vendor' });
    expect(m[4].ref).toEqual({ kind: 'field', key: 'price' });
    expect(m[5].ref).toEqual({ kind: 'field', key: 'barcode' });
    expect(m[6].ref).toEqual({ kind: 'option', name: 'Size' });
    expect(m[7].ref).toEqual({ kind: 'option', name: 'Colour' });
    expect(m[8].ref).toMatchObject({ kind: 'metafield', owner: 'product', namespace: 'custom', key: 'fabric', type: 'single_line_text_field' });
    expect(m[9].ref).toEqual({ kind: 'field', key: 'price', store: 'fig-web' });
    expect(m[10].ref.kind).toBe('ignore');
    expect(m[10].problem).toMatch(/No store/);
    expect(m[11].problem).toMatch(/Not a column/);
    expect(sheetFormat(m)).toBe('matrixify');
  });
});

describe('rows into products', () => {
  it('groups rows by handle, continues a product on rows with no handle, and reads sizes as variants', () => {
    const ps = read([
      ['Title', 'Brand', 'Size', 'Barcode', 'RRP', 'Image', 'Tags'],
      ['Lace Bra', 'Etam', 'S', '111', '10.5', 'https://x/a.jpg', 'women, cat:bras'],
      ['', '', 'M', '112', '10.5', 'https://x/b.jpg', ''],
      ['Silk Robe', 'Etam', 'One size', '201', '25', '', ''],
    ]);
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({ handle: 'lace-bra', handleMade: true, title: 'Lace Bra', vendor: 'Etam', optionNames: ['Size'], tags: ['women', 'cat:bras'] });
    expect(ps[0].variants.map((v) => [v.options[0], v.barcode, v.price])).toEqual([
      ['S', '111', '10.5'],
      ['M', '112', '10.5'],
    ]);
    expect(ps[0].images.map((i) => i.src)).toEqual(['https://x/a.jpg', 'https://x/b.jpg']);
    expect(ps[1].handle).toBe('silk-robe');
  });

  it('reads commands, per-store values and a compare-at of 0 as "no sale"', () => {
    const [p] = read([
      ['Handle', 'Command', 'Tags Command', 'Option1 Name', 'Option1 Value', 'Variant Price', 'Variant Price @FIG', 'Variant Compare At Price', 'Status @FIG'],
      ['lace-bra', 'update', 'REPLACE', 'Size', 'S', '10', '450', '0', 'Draft'],
    ]);
    expect(p.command).toBe('UPDATE');
    expect(p.tagsCommand).toBe('REPLACE');
    expect(p.variants[0]).toMatchObject({ price: '10', compareAt: '', overrides: { 'fig-web': { price: '450' } } });
    expect(p.overrides['fig-web']).toEqual({ status: 'DRAFT' });
  });

  it('makes handles Shopify accepts', () => {
    expect(slugify("Women'secret — Lace Bra & Brief")).toBe('womensecret-lace-bra-and-brief');
  });
});

describe('the plan for one store', () => {
  it('updates only what changed, adds tags instead of replacing them, and keeps the other variants', () => {
    const [p] = read([
      ['Handle', 'Title', 'Tags', 'Option1 Name', 'Option1 Value', 'Variant Barcode', 'Variant Price'],
      ['lace-bra', 'Lace bra', 'new-in', 'Size', 'S', '111', '12'],
    ]);
    const { item, write } = planProduct(p, existing(), LAB);
    expect(item.action).toBe('update');
    expect(item.changes.map((c) => c.field)).toEqual(['tags', 'variant:gid://shopify/ProductVariant/11']);
    expect(write!.input!.tags).toEqual(['women', 'cat:bras', 'new-in']);
    const variants = write!.input!.variants as { id: string; price: string }[];
    expect(variants.map((v) => [v.id, v.price])).toEqual([
      ['gid://shopify/ProductVariant/11', '12'],
      ['gid://shopify/ProductVariant/12', '10'],
    ]);
    expect(write!.before!.tags).toEqual(['women', 'cat:bras']);
    expect(write!.before!.variants).toHaveLength(2);
  });

  it('says unchanged when the store already matches, and never resends', () => {
    const [p] = read([
      ['Handle', 'Title', 'Vendor', 'Option1 Name', 'Option1 Value', 'Variant Barcode', 'Variant Price'],
      ['lace-bra', 'Lace bra', 'Etam', 'Size', 'M', '112', '10.000'],
    ]);
    const { item, write } = planProduct(p, existing(), LAB);
    expect(item.action).toBe('unchanged');
    expect(write).toBeNull();
  });

  it('creates a new product as a draft, with its options, not taxable on Labesny, published', () => {
    const [p] = read([
      ['Title', 'Vendor', 'Size', 'Barcode', 'Price', 'Image'],
      ['Silk Robe', 'Etam', 'S', '201', '25', 'https://x/robe.jpg'],
      ['', '', 'M', '202', '25', ''],
    ]);
    const { item, write } = planProduct(p, null, LAB);
    expect(item.action).toBe('create');
    expect(write!.identifier).toEqual({ handle: 'silk-robe' });
    expect(write!.input).toMatchObject({ handle: 'silk-robe', title: 'Silk Robe', status: 'DRAFT', productOptions: [{ name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }] });
    expect((write!.input!.variants as { taxable: boolean }[]).every((v) => v.taxable === false)).toBe(true);
    expect(write!.input!.files).toEqual([{ originalSource: 'https://x/robe.jpg', contentType: 'IMAGE' }]);
    expect(write!.publish).toBe(true);
    // FIG has no tax rule: the variants keep Shopify's default
    const fig = planProduct(p, null, FIG).write!;
    expect((fig.input!.variants as { taxable?: boolean }[]).every((v) => v.taxable === undefined)).toBe(true);
  });

  it('takes the store’s own price from an @store column', () => {
    const [p] = read([
      ['Handle', 'Option1 Name', 'Option1 Value', 'Variant Barcode', 'Variant Price', 'Variant Price @FIG'],
      ['lace-bra', 'Size', 'S', '111', '12', '450'],
    ]);
    const lab = planProduct(p, existing(), LAB).write!;
    const fig = planProduct(p, existing({ variants: existing().variants.map((v) => ({ ...v, price: '400' })) }), FIG).write!;
    expect((lab.input!.variants as { price: string }[])[0].price).toBe('12');
    expect((fig.input!.variants as { price: string }[])[0].price).toBe('450');
  });

  it('stops on what Shopify would refuse, and warns on what looks wrong', () => {
    const [noTitle] = read([['Handle', 'Variant Price'], ['ghost', '5']]);
    expect(planProduct(noTitle, null, FIG).item.issues[0].code).toBe('no-title');
    const [dup] = read([
      ['Title', 'Size', 'Barcode', 'Price'],
      ['Robe', 'S', '1', '5'],
      ['', 'S', '2', '5'],
    ]);
    const d = planProduct(dup, null, FIG).item;
    expect(d.action).toBe('error');
    expect(d.issues.map((i) => i.code)).toContain('duplicate-variant');
    const [cheap] = read([
      ['Title', 'Price', 'Compare At Price', 'Status'],
      ['Robe', '20', '15', 'Active'],
    ]);
    const codes = planProduct(cheap, null, FIG).item.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['compare', 'no-photo', 'no-barcode']));
  });

  it('deletes safely: DELETE archives unless asked otherwise', () => {
    const [p] = read([['Handle', 'Command'], ['lace-bra', 'DELETE']]);
    expect(planProduct(p, existing(), LAB).item.action).toBe('archive');
    expect(planProduct(p, existing(), LAB, { safeDelete: false }).write!.kind).toBe('delete');
    expect(planProduct(p, null, LAB).item.action).toBe('skip');
  });

  it('keeps photos it already has and adds the new ones (Shopify renames files, so names match loosely)', () => {
    const [p] = read([
      ['Handle', 'Image Src', 'Image Alt Text'],
      ['lace-bra', 'https://other.host/lace-bra.jpg', 'Lace bra'],
      ['lace-bra', 'https://x/back.jpg', ''],
    ]);
    const { write, item } = planProduct(p, existing(), LAB);
    expect(item.counts).toMatchObject({ imagesAdded: 1, imagesRemoved: 0 });
    expect(write!.input!.files).toEqual([{ id: 'gid://shopify/MediaImage/9', alt: 'Lace bra' }, { originalSource: 'https://x/back.jpg', contentType: 'IMAGE' }]);
  });

  it('counts the plan', () => {
    const [p] = read([['Handle', 'Title'], ['lace-bra', 'Lace bra 2']]);
    const items = [planProduct(p, existing(), LAB).item, planProduct(p, null, FIG).item];
    expect(tally(items)).toMatchObject({ update: 1, create: 1 });
  });
});
