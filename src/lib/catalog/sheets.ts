// Catalogue import & export: the sheets. An export is laid out the way Matrixify lays out products (one
// row per variant, more rows for more photos, the product's own fields on its first row), so an export
// can be edited and imported again, here or into another store. Pure.
import type { Col, Sheet } from '../sheet';
import { FIELD, FIELDS, GROUP_LABEL, type FieldKey, type Group } from './fields';
import type { PlanItem, StoreProduct } from './plan';

export const EXPORT_GROUPS: Group[] = ['basics', 'menus', 'arabic', 'variants', 'images', 'stock', 'seo', 'commands', 'info'];

const col = (k: FieldKey): Col => {
  const f = FIELD[k];
  const kind = k === 'price' || k === 'compareAt' || k === 'cost' ? 'num' : k === 'inventoryQty' || k === 'variantPosition' || k === 'imagePosition' ? 'int' : 'text';
  return { key: k, label: f.header, kind, ...(kind === 'num' ? { decimals: 3 } : {}) };
};

const ALWAYS: FieldKey[] = ['id', 'handle', 'command', 'title'];

/** The products of one store as a Matrixify-style sheet. `groups` picks the column groups; metafield columns follow. */
export function productsSheet(products: (StoreProduct & { createdAt?: string; updatedAt?: string })[], opts: { groups: Group[]; name?: string } = { groups: EXPORT_GROUPS }): Sheet {
  const groups = new Set(opts.groups);
  const keys = FIELDS.filter((f) => ALWAYS.includes(f.key) || (groups.has(f.group) && f.key !== 'command')).map((f) => f.key);
  const metaKeys = [...new Set(products.flatMap((p) => p.metafields.map((m) => `${m.owner}|${m.namespace}.${m.key}|${m.type}`)))].sort();
  const metaCols: Col[] = metaKeys.map((k) => {
    const [owner, nk, type] = k.split('|');
    return { key: `mf:${k}`, label: `${owner === 'variant' ? 'Variant Metafield' : 'Metafield'}: ${nk} [${type}]` };
  });
  const columns = [...keys.map(col), ...metaCols];
  const rows: Record<string, unknown>[] = [];
  for (const p of products) {
    const n = Math.max(1, p.variants.length, groups.has('images') ? p.images.length : 0);
    for (let i = 0; i < n; i++) {
      const v = p.variants[i];
      const img = groups.has('images') ? p.images[i] : undefined;
      const r: Record<string, unknown> = { id: p.id.split('/').pop(), handle: p.handle };
      if (i === 0) {
        Object.assign(r, {
          command: 'MERGE',
          title: p.title,
          bodyHtml: p.bodyHtml,
          vendor: p.vendor,
          type: p.type,
          tags: p.tags.join(', '),
          status: p.status === 'ACTIVE' ? 'Active' : p.status === 'DRAFT' ? 'Draft' : 'Archived',
          published: p.published == null ? '' : p.published ? 'TRUE' : 'FALSE',
          templateSuffix: p.templateSuffix ?? '',
          seoTitle: p.seoTitle ?? '',
          seoDescription: p.seoDescription ?? '',
          createdAt: p.createdAt ?? '',
          updatedAt: p.updatedAt ?? '',
          topRow: 'TRUE',
          ...menuColumns(p.tags),
          titleAr: p.translations?.title ?? '',
          bodyHtmlAr: p.translations?.body_html ?? '',
        });
        for (const m of p.metafields.filter((x) => x.owner === 'product')) r[`mf:product|${m.namespace}.${m.key}|${m.type}`] = m.value;
      }
      p.optionNames.slice(0, 3).forEach((name, j) => {
        if (i === 0) r[`option${j + 1}Name`] = name;
        if (v) r[`option${j + 1}Value`] = v.options[j] ?? '';
      });
      if (v) {
        Object.assign(r, {
          variantId: v.id.split('/').pop(),
          variantCommand: 'MERGE',
          variantPosition: v.position,
          sku: v.sku ?? '',
          barcode: v.barcode ?? '',
          price: v.price === '' ? null : Number(v.price),
          compareAt: v.compareAt == null ? null : Number(v.compareAt),
          taxable: v.taxable ? 'TRUE' : 'FALSE',
          cost: v.cost == null ? null : Number(v.cost),
          inventoryPolicy: v.inventoryPolicy.toLowerCase(),
          inventoryQty: v.inventoryQty,
          variantImage: v.image ?? '',
        });
        for (const m of p.metafields.filter((x) => x.owner === 'variant' && x.variantId === v.id)) r[`mf:variant|${m.namespace}.${m.key}|${m.type}`] = m.value;
      }
      if (img) Object.assign(r, { imageSrc: img.src, imageCommand: 'MERGE', imagePosition: i + 1, imageAlt: img.alt ?? '' });
      rows.push(r);
    }
  }
  return { name: opts.name ?? 'Products', columns, rows };
}

/** Gender, Category and Season read back from the menu tags, so an export imports again unchanged. */
function menuColumns(tags: string[]) {
  const after = (prefix: string) => tags.find((t) => t.toLowerCase().startsWith(`${prefix}:`))?.slice(prefix.length + 1) ?? '';
  const cat = after('cat');
  const named = cat ? tags.find((t) => !t.includes(':') && t.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') === cat.toLowerCase()) : undefined;
  const sub = after('subcat');
  const subNamed = sub ? tags.find((t) => !t.includes(':') && t.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') === sub.toLowerCase()) : undefined;
  return { gender: after('gender'), category: named ?? cat, subcategory: subNamed ?? sub, season: after('season').toUpperCase() };
}

/** The template: the columns most imports need, two example products, and a sheet that explains every column. */
export function templateSheets(): Sheet[] {
  const keys: FieldKey[] = ['handle', 'command', 'title', 'titleAr', 'bodyHtml', 'vendor', 'gender', 'category', 'subcategory', 'type', 'season', 'tags', 'status', 'published', 'option1Name', 'option1Value', 'option2Name', 'option2Value', 'sku', 'barcode', 'price', 'compareAt', 'imageSrc', 'imageAlt'];
  const rows: Record<string, unknown>[] = [
    { handle: 'etam-lace-push-up-bra-black', command: 'MERGE', title: 'Lace Push-Up Bra - Black', titleAr: 'صدرية دانتيل - أسود', bodyHtml: '<p>Soft lace, padded cups.</p>', vendor: 'Etam', gender: 'Women', category: 'Bras', subcategory: 'Push Up Bra', type: 'Push Up Bra', season: 'AW26', tags: 'new-in', status: 'Draft', published: 'TRUE', option1Name: 'Size', option1Value: '75B', option2Name: 'Colour', option2Value: 'Black', sku: 'ETM-LPB-75B', barcode: '3612345678901', price: 12.5, compareAt: null, imageSrc: 'https://example.com/photos/lace-bra-front.jpg', imageAlt: 'Lace push-up bra, front' },
    { handle: 'etam-lace-push-up-bra-black', option1Value: '80B', option2Value: 'Black', sku: 'ETM-LPB-80B', barcode: '3612345678902', price: 12.5, imageSrc: 'https://example.com/photos/lace-bra-back.jpg', imageAlt: 'Lace push-up bra, back' },
    { handle: 'women-secret-satin-robe-pink', command: 'MERGE', title: 'Satin Robe - Pink', vendor: 'Women Secret', gender: 'Women', category: 'Sleep & Homewear', subcategory: 'Robe', type: 'Robe', season: 'AW26', status: 'Active', price: 25, compareAt: 32, barcode: '8434567890123', imageSrc: 'https://example.com/photos/silk-robe.jpg' },
  ];
  const help: Sheet = {
    name: 'Read me',
    columns: [
      { key: 'col', label: 'Column' },
      { key: 'group', label: 'Group' },
      { key: 'hint', label: 'What it does' },
    ],
    rows: [
      ...FIELDS.filter((f) => f.level !== 'info').map((f) => ({ col: f.header, group: GROUP_LABEL[f.group], hint: f.hint })),
      { col: 'Metafield: custom.fabric [single_line_text_field]', group: 'Metafields', hint: 'A product metafield: namespace.key, then its type in brackets. "Variant Metafield: …" sets one on the variant.' },
      { col: 'Variant Price @FIG', group: 'Per store', hint: 'Any column followed by @ and a store name applies to that store only (here: FIG’s price). The plain column applies to every store.' },
      { col: 'Size, Colour', group: 'Your own sheets', hint: 'Columns named Size or Colour become the product’s options. Brand, RRP, Barcode, Style and the Arabic names are understood too. A sheet with no handles and a Colour column becomes one product per colour, as the websites list them.' },
      { col: 'Gender, Category, Sub-category, Season, Colour', group: 'Menus', hint: 'FIG and Labesny build their menus and filters on tags: gender:women, cat:bras + “Bras”, subcat:push-up-bra + “Push Up Bra”, season:aw26 + “AW26”, color:Black, and the brand. They are made from these columns for you.' },
      { col: 'No handle', group: 'Matching', hint: 'A product without a handle or ID is looked for in the store by its barcodes, so existing styles are updated, not listed twice.' },
      { col: '(empty cell)', group: 'Rules', hint: 'An empty cell leaves that field as it is. A compare-at price of 0 takes the sale off.' },
    ],
  };
  return [{ name: 'Products', columns: keys.map(col), rows }, help];
}

export type ResultRow = { handle: string; title: string; store: string; storeName: string; action: string; result: 'ok' | 'failed' | 'skipped' | 'dry run'; message: string; productId?: string; adminUrl?: string; lines?: number[] };

/** An import's results (or a dry run's plan), one row per product per store, like Matrixify's results file. */
export function resultsSheet(rows: ResultRow[]): Sheet {
  return {
    name: 'Import results',
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'handle', label: 'Handle' },
      { key: 'title', label: 'Title' },
      { key: 'action', label: 'Action' },
      { key: 'result', label: 'Import Result' },
      { key: 'message', label: 'Import Comment' },
      { key: 'lines', label: 'Rows in the file' },
      { key: 'productId', label: 'ID' },
      { key: 'adminUrl', label: 'Open in Shopify' },
    ],
    rows: rows.map((r) => ({ ...r, store: r.storeName, productId: r.productId?.split('/').pop() ?? '', lines: (r.lines ?? []).join(', ') })),
  };
}

/** A dry run's plan as result rows. */
export function planRows(items: PlanItem[], storeName: (id: string) => string): ResultRow[] {
  return items.map((i) => ({
    handle: i.handle,
    title: i.title,
    store: i.store,
    storeName: storeName(i.store),
    action: i.action,
    result: 'dry run',
    message: [...i.changes.map((c) => `${c.label}: ${c.before && c.before !== '—' ? `${c.before} → ` : ''}${c.after}`), ...i.issues.map((x) => `${x.level === 'error' ? 'Error' : x.level === 'warning' ? 'Check' : 'Note'}: ${x.message}`)].join(' | '),
    productId: i.productId,
    lines: i.lines,
  }));
}
