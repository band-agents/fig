// Catalogue import & export: the sheets. An export is laid out the way Matrixify lays out products (one
// row per variant, more rows for more photos, the product's own fields on its first row), so an export
// can be edited and imported again, here or into another store. Pure.
import type { Col, Sheet } from '../sheet';
import { FIELD, FIELDS, GROUP_LABEL, type FieldKey, type Group } from './fields';
import type { PlanItem, StoreProduct } from './plan';

export const EXPORT_GROUPS: Group[] = ['basics', 'variants', 'images', 'stock', 'seo', 'commands', 'info'];

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

/** The template: the columns most imports need, two example products, and a sheet that explains every column. */
export function templateSheets(): Sheet[] {
  const keys: FieldKey[] = ['handle', 'command', 'title', 'bodyHtml', 'vendor', 'type', 'tags', 'status', 'published', 'option1Name', 'option1Value', 'option2Name', 'option2Value', 'sku', 'barcode', 'price', 'compareAt', 'imageSrc', 'imageAlt'];
  const rows: Record<string, unknown>[] = [
    { handle: 'lace-push-up-bra-black', command: 'MERGE', title: 'Lace push-up bra', bodyHtml: '<p>Soft lace, padded cups.</p>', vendor: 'Etam', type: 'Bras', tags: 'women, new-in', status: 'Draft', published: 'TRUE', option1Name: 'Size', option1Value: '75B', option2Name: 'Colour', option2Value: 'Black', sku: 'ETM-LPB-75B', barcode: '3612345678901', price: 12.5, compareAt: null, imageSrc: 'https://example.com/photos/lace-bra-front.jpg', imageAlt: 'Lace push-up bra, front' },
    { handle: 'lace-push-up-bra-black', option1Value: '80B', option2Value: 'Black', sku: 'ETM-LPB-80B', barcode: '3612345678902', price: 12.5, imageSrc: 'https://example.com/photos/lace-bra-back.jpg', imageAlt: 'Lace push-up bra, back' },
    { handle: 'silk-robe', command: 'MERGE', title: 'Silk robe', vendor: 'Women Secret', type: 'Robes', tags: 'women', status: 'Active', price: 25, compareAt: 32, barcode: '8434567890123', imageSrc: 'https://example.com/photos/silk-robe.jpg' },
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
      { col: 'Size, Colour', group: 'Your own sheets', hint: 'Columns named Size or Colour become the product’s options. Brand, RRP, Barcode, Style and the Arabic names are understood too.' },
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
