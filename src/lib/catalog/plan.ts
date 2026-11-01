// Catalogue import: what one product from the sheet does to one store. Pure: given the product as the
// file has it and as the store has it now, it says create, update, unchanged, skip, delete or error,
// lists every field that changes (before → after), and builds what Shopify is sent (one productSet,
// which creates or updates the product, its options, variants and photos together). It also keeps what
// the product was before, so an import can be reverted.
//
// Safety, by design: nothing outside the sheet's columns changes; tags are added to the existing ones
// unless the sheet says REPLACE (they drive the menus and filters); variants and photos the sheet does
// not mention stay; stock is written only when the import says so (Lucida owns stock); a store's house
// rules apply on top (Labesny: never taxable).
import type { FileMetafield, FileProduct, FileVariant, ListCmd, ProductValues, Status, VariantValues } from './parse';

export type StoreVariant = { id: string; options: string[]; sku: string | null; barcode: string | null; price: string; compareAt: string | null; taxable: boolean; cost: string | null; inventoryPolicy: 'DENY' | 'CONTINUE'; inventoryQty: number | null; inventoryItemId?: string | null; position: number; image: string | null };
export type StoreImage = { id: string; src: string; alt: string | null };
export type StoreProduct = {
  id: string;
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  type: string;
  tags: string[];
  status: Status;
  published: boolean | null;
  templateSuffix: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  optionNames: string[];
  variants: StoreVariant[];
  images: StoreImage[];
  metafields: { owner: 'product' | 'variant'; variantId?: string; namespace: string; key: string; type: string; value: string }[];
  truncated?: boolean; // more variants or photos than were read: not safe to rewrite those lists
  translations?: Record<string, string>; // Arabic, by key (title, body_html), when asked for
};

/**
 * A store's house rules (FIG and Labesny run the same theme and the same tag system):
 * taxable: forced on every variant (Labesny: false) · houseTags: gender:/cat:/subcat:/season:/color: tags and
 * the brand tag made from the sheet's columns, the way the menus and filters read them · lucidaPrices:
 * Lucida's price sync owns prices · vendors: the store's brands, so a misspelt one is caught · arabic: the
 * store has an Arabic site (titles and descriptions are translated).
 */
export type StoreRules = { taxable?: boolean; houseTags?: boolean; lucidaPrices?: boolean; vendors?: string[]; arabic?: boolean; notes: string[] };
export type StoreCtx = { id: string; name: string; currency: string; rules: StoreRules };

/**
 * What the file does to the products it names (Dan, 1 Nov: "make it clear"), for every row without its
 * own Command: both adds new products and updates the ones the store has (Matrixify's MERGE); new adds
 * only, leaving products the store has as they are; update changes only products the store has, creating
 * nothing. A Command in the file (NEW, UPDATE, REPLACE, DELETE, IGNORE) always wins.
 */
export type ImportMode = 'both' | 'new' | 'update';
export const IMPORT_MODES: ImportMode[] = ['both', 'new', 'update'];

export type ImportOptions = {
  mode: ImportMode; // rows with no Command (MERGE): add and update, add only, or update only
  tags: ListCmd; // when the sheet gives no Tags Command: MERGE adds (the default), REPLACE sets exactly
  images: ListCmd; // when the sheet gives no Image Command
  newStatus: Status; // a new product with no Status
  publishNew: boolean; // a new product goes on the Online Store
  writeStock: boolean; // Variant Inventory Qty is written (Lucida owns stock otherwise)
  safeDelete: boolean; // DELETE archives instead of deleting
};
export const DEFAULT_OPTIONS: ImportOptions = { mode: 'both', tags: 'MERGE', images: 'MERGE', newStatus: 'DRAFT', publishNew: true, writeStock: false, safeDelete: true };

export type Change = { field: string; label: string; before: string; after: string; rule?: boolean };
export type Issue = { level: 'error' | 'warning' | 'info'; code: string; message: string };
export type Action = 'create' | 'update' | 'unchanged' | 'skip' | 'delete' | 'archive' | 'error';

export type Snapshot = {
  title?: string;
  bodyHtml?: string;
  vendor?: string;
  type?: string;
  tags?: string[];
  status?: Status;
  templateSuffix?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  published?: boolean | null;
  optionNames?: string[];
  variants?: { id: string; options: string[]; price: string; compareAt: string | null; sku: string | null; barcode: string | null; taxable: boolean }[];
  images?: { id: string; src: string; alt: string | null }[];
  translations?: Record<string, string>;
};

export type Write = {
  kind: 'set' | 'delete' | 'archive';
  productId?: string;
  identifier?: { id: string } | { handle: string };
  input?: Record<string, unknown>;
  metafields: { owner: 'product' | 'variant'; variantKey?: string; namespace: string; key: string; type: string; value: string }[];
  stock: { variantKey: string; quantity: number }[];
  publish: boolean | null;
  translations?: { key: string; locale: string; value: string }[];
  before: Snapshot | null;
};

export type PlanItem = {
  key: string;
  handle: string;
  title: string;
  store: string;
  action: Action;
  productId?: string;
  image?: string;
  lines: number[];
  changes: Change[];
  issues: Issue[];
  counts: { variantsAdded: number; variantsChanged: number; variantsRemoved: number; imagesAdded: number; imagesRemoved: number };
};

const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
export const variantKey = (options: string[]) => options.map(lc).join(' / ');
const STATUS_WORD: Record<string, string> = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' };
const show = (v: unknown) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : (STATUS_WORD[String(v)] ?? String(v)));
const sameMoney = (a: string | null | undefined, b: string | null | undefined) => (a == null || a === '' ? null : Number(a)) === (b == null || b === '' ? null : Number(b));
const fileName = (src: string) => {
  const path = src.split('?')[0].split('/').pop() ?? src;
  // Shopify adds _<uuid> or _<n>x<n> to names it stores
  return decodeURIComponent(path)
    .toLowerCase()
    .replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.)/, '')
    .replace(/_\d+x\d*(?=\.)/, '');
};
const sameImage = (a: string, b: string) => a.split('?')[0] === b.split('?')[0] || fileName(a) === fileName(b);

/** What the file says for one store: its values with that store's "@Store" columns on top. */
function forStore(fp: FileProduct, store: string): { p: ProductValues; variants: (FileVariant & VariantValues)[]; metafields: FileMetafield[] } {
  const p: ProductValues = { title: fp.title, bodyHtml: fp.bodyHtml, vendor: fp.vendor, type: fp.type, category: fp.category, subcategory: fp.subcategory, gender: fp.gender, season: fp.season, colour: fp.colour, titleAr: fp.titleAr, bodyHtmlAr: fp.bodyHtmlAr, tags: fp.tags, status: fp.status, published: fp.published, templateSuffix: fp.templateSuffix, seoTitle: fp.seoTitle, seoDescription: fp.seoDescription, ...(fp.overrides[store] ?? {}) };
  const variants = fp.variants.map((v) => ({ ...v, ...(v.overrides[store] ?? {}) }));
  const mine = (m: FileMetafield) => !m.store || m.store === store;
  const pick = (list: FileMetafield[]) => {
    const out = new Map<string, FileMetafield>();
    for (const m of list.filter(mine)) {
      const k = `${m.namespace}.${m.key}`;
      if (!out.has(k) || m.store === store) out.set(k, m);
    }
    return [...out.values()];
  };
  return { p, variants: variants.map((v) => ({ ...v, metafields: pick(v.metafields) })), metafields: pick(fp.metafields) };
}

/** One product from the sheet against one store. `existing` is the store's product with that handle or ID, or null. */
export function planProduct(fp: FileProduct, existing: StoreProduct | null, store: StoreCtx, options: Partial<ImportOptions> = {}): { item: PlanItem; write: Write | null } {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const { p, variants: fileVariants, metafields: fileMeta } = forStore(fp, store.id);
  const issues: Issue[] = fp.problems.map((m) => ({ level: 'warning' as const, code: 'read', message: m }));
  const changes: Change[] = [];
  const counts = { variantsAdded: 0, variantsChanged: 0, variantsRemoved: 0, imagesAdded: 0, imagesRemoved: 0 };
  const item = (action: Action, extra: Partial<PlanItem> = {}): PlanItem => ({
    key: fp.key,
    handle: existing?.handle ?? fp.handle,
    title: p.title ?? existing?.title ?? fp.handle,
    store: store.id,
    action,
    productId: existing?.id,
    image: fp.images[0]?.src ?? existing?.images[0]?.src,
    lines: fp.lines,
    changes,
    issues,
    counts,
    ...extra,
  });
  const err = (code: string, message: string) => {
    issues.push({ level: 'error', code, message });
    return { item: item('error'), write: null };
  };

  // ── the command
  if (fp.command === 'IGNORE') return { item: item('skip', { issues: [...issues, { level: 'info', code: 'ignore', message: 'Command IGNORE.' }] }), write: null };
  if (fp.command === 'DELETE') {
    if (!existing) return { item: item('skip', { issues: [...issues, { level: 'info', code: 'absent', message: `Not in ${store.name}: nothing to delete.` }] }), write: null };
    const archive = o.safeDelete;
    changes.push({ field: 'status', label: archive ? 'Archived (safe delete)' : 'Deleted', before: show(existing.status), after: archive ? 'ARCHIVED' : 'deleted' });
    return { item: item(archive ? 'archive' : 'delete'), write: { kind: archive ? 'archive' : 'delete', productId: existing.id, metafields: [], stock: [], publish: null, before: { status: existing.status } } };
  }
  if (fp.command === 'NEW' && existing) return err('exists', `Command NEW, but ${store.name} already has “${existing.handle}”.`);
  // the file's mode, for rows that carry no Command of their own
  if (fp.command === 'MERGE' && o.mode === 'new' && existing) return { item: item('skip', { issues: [...issues, { level: 'info', code: 'mode-new', message: `Already in ${store.name}: left as it is (this import only adds new products).` }] }), write: null };
  if (fp.command === 'MERGE' && o.mode === 'update' && !existing) return { item: item('skip', { issues: [...issues, { level: 'info', code: 'mode-update', message: `Not in ${store.name}: not created (this import only updates existing products).` }] }), write: null };
  if (fp.command === 'UPDATE' && !existing) return { item: item('skip', { issues: [...issues, { level: 'info', code: 'absent', message: `Command UPDATE, and ${store.name} does not have it: skipped.` }] }), write: null };
  if (existing?.truncated) return err('too-big', 'More than 100 variants or 50 photos: too big to change safely from a sheet.');
  const creating = !existing;
  const replace = fp.command === 'REPLACE';
  if (creating && !p.title) return err('no-title', 'A new product needs a Title.');
  if (fp.optionNames.length > 3) return err('options', 'Shopify allows 3 options per product.');
  if (creating && fp.handleMade) issues.push({ level: 'info', code: 'handle', message: `No handle in the file: “${fp.handle}” made from the title.` });

  const input: Record<string, unknown> = {};
  const before: Snapshot = {};
  const set = <K extends keyof Snapshot>(field: K, label: string, apiField: string, now: Snapshot[K], next: unknown, apiValue: unknown = next) => {
    changes.push({ field, label, before: show(now), after: show(next) });
    input[apiField] = apiValue;
    if (!creating) before[field] = now;
  };

  // ── the brand as the store writes it (brand pages, tiles and filters are keyed on it)
  if (p.vendor && store.rules.vendors?.length && !store.rules.vendors.includes(p.vendor)) {
    const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    const near = store.rules.vendors.find((v) => squash(v) === squash(p.vendor!));
    if (near) {
      issues.push({ level: 'info', code: 'vendor-spelling', message: `Brand “${p.vendor}” written as ${store.name} writes it: “${near}”.` });
      p.vendor = near;
    } else issues.push({ level: 'warning', code: 'vendor-new', message: `“${p.vendor}” is not one of ${store.name}’s ${store.rules.vendors.length} brands: it would start a new brand in the filters and brand pages. Check the spelling.` });
  }

  // a new product named only by its sub-category takes it as its type too (the websites' types are their sub-categories)
  if (creating && p.type === undefined && p.subcategory) p.type = p.subcategory;

  // ── the product's own fields
  const scalar = [
    ['title', 'Title', 'title'],
    ['bodyHtml', 'Description', 'descriptionHtml'],
    ['vendor', 'Vendor', 'vendor'],
    ['type', 'Type', 'productType'],
    ['templateSuffix', 'Template', 'templateSuffix'],
  ] as const;
  for (const [k, label, api] of scalar) {
    const next = p[k];
    if (next === undefined) continue;
    const now = existing ? (existing[k] ?? '') : '';
    if (creating ? next !== '' : next !== now) set(k, label, api, now, next);
  }
  const status: Status | undefined = p.status ?? (creating ? o.newStatus : undefined);
  if (status && status !== existing?.status) set('status', 'Status', 'status', existing?.status, status);
  if (creating && !p.status) issues.push({ level: 'info', code: 'status', message: `No Status in the file: goes in as ${o.newStatus === 'DRAFT' ? 'Draft' : o.newStatus.toLowerCase()}.` });
  if ((p.seoTitle !== undefined && p.seoTitle !== (existing?.seoTitle ?? '')) || (p.seoDescription !== undefined && p.seoDescription !== (existing?.seoDescription ?? ''))) {
    const t = p.seoTitle ?? existing?.seoTitle ?? '';
    const d = p.seoDescription ?? existing?.seoDescription ?? '';
    if (p.seoTitle !== undefined && p.seoTitle !== (existing?.seoTitle ?? '')) changes.push({ field: 'seoTitle', label: 'SEO title', before: show(existing?.seoTitle), after: show(t) });
    if (p.seoDescription !== undefined && p.seoDescription !== (existing?.seoDescription ?? '')) changes.push({ field: 'seoDescription', label: 'SEO description', before: show(existing?.seoDescription), after: show(d) });
    input.seo = { title: t || null, description: d || null };
    if (!creating) {
      before.seoTitle = existing?.seoTitle ?? null;
      before.seoDescription = existing?.seoDescription ?? null;
    }
  }

  // ── tags: added to the existing ones unless the sheet says otherwise, then the store's menu tags
  const haveTags = existing?.tags ?? [];
  let nextTags = [...haveTags];
  let tagCmd: ListCmd | null = null;
  if (p.tags !== undefined) {
    tagCmd = fp.tagsCommand ?? (replace ? 'REPLACE' : o.tags);
    const lower = new Set(haveTags.map(lc));
    const fileLower = new Set(p.tags.map(lc));
    nextTags = tagCmd === 'REPLACE' ? [...p.tags] : tagCmd === 'DELETE' ? haveTags.filter((t) => !fileLower.has(lc(t))) : [...haveTags, ...p.tags.filter((t) => !lower.has(lc(t)))];
    if (tagCmd === 'REPLACE' && existing && haveTags.some(isMenuTag) && !p.tags.some(isMenuTag) && !store.rules.houseTags) {
      issues.push({ level: 'warning', code: 'menu-tags', message: 'Tags are replaced and the menu tags (gender, category) are not in the file: the product may drop out of its menus.' });
    }
  }
  const house = store.rules.houseTags ? houseTags({ ...p, colour: p.colour ?? fp.colour }, existing, creating) : { add: [] as string[], remove: [] as string[] };
  if (house.add.length || house.remove.length) {
    const drop = new Set(house.remove.map(lc));
    nextTags = nextTags.filter((t) => !drop.has(lc(t)));
    const now = new Set(nextTags.map(lc));
    for (const t of house.add) {
      if (now.has(lc(t))) continue;
      now.add(lc(t));
      nextTags.push(t);
    }
  }
  {
    const haveLower = new Set(haveTags.map(lc));
    const nextLower = new Set(nextTags.map(lc));
    const added = nextTags.filter((t) => !haveLower.has(lc(t)));
    const removed = haveTags.filter((t) => !nextLower.has(lc(t)));
    if (added.length || removed.length) {
      const houseOnly = added.every((t) => house.add.some((h) => lc(h) === lc(t))) && removed.every((t) => house.remove.some((h) => lc(h) === lc(t)));
      changes.push({ field: 'tags', label: houseOnly ? 'Menu tags' : `Tags (${tagCmd === 'REPLACE' ? 'replaced' : tagCmd === 'DELETE' ? 'removed' : 'added'})`, before: removed.length ? `− ${removed.join(', ')}` : creating ? '—' : 'kept', after: added.length ? `+ ${added.join(', ')}` : '—', rule: houseOnly });
      input.tags = nextTags;
      if (!creating) before.tags = haveTags;
    }
  }
  if (store.rules.houseTags && (creating || p.tags !== undefined)) {
    const missing = [!nextTags.some((t) => /^gender:/i.test(t)) && 'gender', !nextTags.some((t) => /^cat:/i.test(t)) && 'category'].filter(Boolean) as string[];
    if (missing.length) issues.push({ level: 'warning', code: 'menu-tags-missing', message: `No ${missing.join(' or ')} tag: it will not show in the menus or the filters. Add ${missing.map((m) => (m === 'gender' ? 'a Gender' : 'a Category')).join(' and ')} column.` });
  }

  // ── options and variants
  let pricesSet = false;
  const variantCmd: ListCmd = fp.variantCommand ?? (replace ? 'REPLACE' : 'MERGE');
  const have = existing?.variants ?? [];
  // a product with no options holds Shopify's one "Default Title" variant: it has no option names of its own
  const isDefault = have.length === 1 && (existing?.optionNames ?? []).length <= 1 && lc(have[0].options[0]) === 'default title';
  const haveNames = isDefault ? [] : (existing?.optionNames ?? []);
  const fileHasOptions = fp.optionNames.length > 0 && fileVariants.some((v) => v.options.some(Boolean));
  const names = fileHasOptions ? mergeNames(haveNames, fp.optionNames) : haveNames;
  const namesChanged = names.join('|') !== haveNames.join('|');
  const valueOf = (sv: StoreVariant, name: string) => {
    const j = haveNames.findIndex((x) => lc(x) === lc(name));
    return j >= 0 ? (sv.options[j] ?? '') : '';
  };
  // a file variant against the store's: by ID, barcode, SKU, then the option values
  const matchOf = (fv: FileVariant & VariantValues) => {
    if (fv.id) return have.find((v) => v.id === fv.id) ?? null;
    if (fv.barcode) {
      const b = have.find((v) => lc(v.barcode) === lc(fv.barcode));
      if (b) return b;
    }
    if (fv.sku) {
      const s = have.filter((v) => lc(v.sku) === lc(fv.sku));
      if (s.length === 1) return s[0];
    }
    const want = byName(fp.optionNames, fv.options);
    const keys = Object.keys(want).filter((k) => want[k]);
    if (keys.length && haveNames.length) return have.find((sv) => keys.every((k) => lc(valueOf(sv, k)) === lc(want[k]))) ?? null;
    return have.length === 1 && fileVariants.length === 1 ? have[0] : null;
  };
  type Desired = { id?: string; options: string[]; v: Partial<StoreVariant>; from?: StoreVariant; file?: FileVariant & VariantValues };
  let desired: Desired[] = [];
  let variantsTouched = false;
  const optionsOf = (sv: StoreVariant) => names.map((n) => valueOf(sv, n));
  // the file's values by name; where the file gives none for a known variant, the store's stay
  const fileOptionsOf = (fv: FileVariant, m?: StoreVariant | null) => {
    const byFile = byName(fp.optionNames, fv.options);
    return names.map((n) => byFile[lc(n)] || (m ? valueOf(m, n) : ''));
  };
  if (fileVariants.length || creating) {
    const used = new Set<string>();
    const matched = fileVariants.map((fv) => {
      const m = matchOf(fv);
      if (m) used.add(m.id);
      return { fv, m };
    });
    if (variantCmd === 'REPLACE' || isDefault || creating) {
      desired = matched.filter((x) => x.fv.command !== 'DELETE').map(({ fv, m }) => ({ id: m?.id, options: fileOptionsOf(fv, m), v: {}, from: m ?? undefined, file: fv }));
      counts.variantsRemoved = have.filter((v) => !desired.some((d) => d.id === v.id)).length;
    } else {
      const removedIds = new Set(matched.filter((x) => x.fv.command === 'DELETE' || variantCmd === 'DELETE').flatMap((x) => (x.m ? [x.m.id] : [])));
      desired = have.filter((v) => !removedIds.has(v.id)).map((sv) => {
        const hit = matched.find((x) => x.m?.id === sv.id && x.fv.command !== 'DELETE');
        return { id: sv.id, options: optionsOf(sv), v: {}, from: sv, file: hit?.fv };
      });
      if (variantCmd !== 'DELETE') for (const { fv, m } of matched) if (!m && fv.command !== 'DELETE') desired.push({ options: fileOptionsOf(fv), v: {}, file: fv });
      counts.variantsRemoved = removedIds.size;
    }
    if (creating && !desired.length) desired = [{ options: [], v: {} }];
    // a product with no options has Shopify's one "Default Title" variant
    const finalNames = names.length ? names : ['Title'];
    for (const d of desired) if (!names.length) d.options = ['Default Title'];
    // the values each variant ends with, and what changed
    for (const d of desired) {
      const f = d.file;
      const from = d.from;
      const next: Partial<StoreVariant> = {};
      const diff: string[] = [];
      const take = <K extends 'price' | 'compareAt' | 'sku' | 'barcode' | 'cost'>(k: K, val: string | undefined) => {
        if (val === undefined) return;
        const now = from?.[k] ?? null;
        const same = k === 'price' || k === 'compareAt' || k === 'cost' ? sameMoney(now, val) : (now ?? '') === val;
        if (!same || !from) next[k] = (val === '' ? null : val) as StoreVariant[K];
        if (!same && from) diff.push(`${k === 'compareAt' ? 'compare-at' : k} ${show(now)} → ${show(val || null)}`);
        if ((k === 'price' || k === 'compareAt') && (!same || !from)) pricesSet = true;
      };
      if (f) {
        take('price', f.price);
        take('compareAt', f.compareAt);
        take('sku', f.sku);
        take('barcode', f.barcode);
        take('cost', f.cost);
        if (f.taxable !== undefined && f.taxable !== from?.taxable) {
          next.taxable = f.taxable;
          if (from) diff.push(`taxable ${show(from.taxable)} → ${show(f.taxable)}`);
        }
        if (f.inventoryPolicy && f.inventoryPolicy !== from?.inventoryPolicy) {
          next.inventoryPolicy = f.inventoryPolicy;
          if (from) diff.push(`policy ${lc(from.inventoryPolicy)} → ${lc(f.inventoryPolicy)}`);
        }
        if (f.image && (!from?.image || !sameImage(from.image, f.image))) {
          next.image = f.image;
          if (from) diff.push('photo');
        }
      }
      // house rule: Labesny never charges tax
      if (store.rules.taxable !== undefined && (from ? from.taxable : (next.taxable ?? true)) !== store.rules.taxable) {
        next.taxable = store.rules.taxable;
        if (from) diff.push(`taxable → ${show(store.rules.taxable)} (house rule)`);
      }
      if (from && namesChanged && haveNames.length) diff.push('options');
      d.v = next;
      if (!from) counts.variantsAdded++;
      else if (diff.length) {
        counts.variantsChanged++;
        if (counts.variantsChanged <= 12) changes.push({ field: `variant:${d.id}`, label: `Variant ${d.options.filter(Boolean).join(' / ') || from.sku || from.barcode || ''}`.trim(), before: '', after: diff.join(' · '), rule: diff.every((x) => x.includes('house rule')) });
      }
    }
    if (counts.variantsChanged > 12) changes.push({ field: 'variants:more', label: 'More variants', before: '', after: `${counts.variantsChanged - 12} more changed` });
    if (counts.variantsAdded) changes.push({ field: 'variants:add', label: creating ? `Variants (${counts.variantsAdded})` : 'Variants added', before: '', after: desired.filter((d) => !d.from).map((d) => [d.options.filter((x) => x && x !== 'Default Title').join(' / '), d.v.price ? `${d.v.price}` : ''].filter(Boolean).join(' · ') || d.file?.sku || 'one variant').join(', ') });
    if (counts.variantsRemoved) changes.push({ field: 'variants:remove', label: 'Variants removed', before: have.filter((v) => !desired.some((d) => d.id === v.id)).map((v) => v.options.join(' / ')).join(', '), after: '' });
    if (namesChanged && !creating) changes.push({ field: 'options', label: 'Options', before: show(haveNames), after: show(names) });

    variantsTouched = creating || counts.variantsAdded > 0 || counts.variantsChanged > 0 || counts.variantsRemoved > 0 || namesChanged;
    // every variant needs a value for every option, and no two the same
    if (variantsTouched) {
      const seen = new Map<string, number>();
      for (const d of desired) {
        if (names.length && d.options.some((x) => !x)) return err('option-missing', `A variant${d.file ? ` (row ${d.file.line})` : ''} has no ${names[d.options.findIndex((x) => !x)]}.`);
        const k = variantKey(d.options);
        if (seen.has(k)) return err('duplicate-variant', `Two variants are both “${d.options.join(' / ')}”${d.file ? ` (row ${d.file.line})` : ''}.`);
        seen.set(k, 1);
      }
      if (desired.length > 2048) return err('too-many', 'More than 2,048 variants.');
      const values = finalNames.map((_, i) => [...new Set(desired.map((d) => d.options[i] ?? ''))]);
      input.productOptions = finalNames.map((n, i) => ({ name: n, position: i + 1, values: values[i].map((v) => ({ name: v })) }));
      input.variants = desired.map((d, i) => variantInput(d, finalNames, i, o.writeStock));
      if (!creating) {
        before.optionNames = existing?.optionNames;
        before.variants = have.map((v) => ({ id: v.id, options: v.options, price: v.price, compareAt: v.compareAt, sku: v.sku, barcode: v.barcode, taxable: v.taxable }));
      }
    }
    // checks on what each variant ends with
    for (const d of desired) {
      const price = d.v.price ?? d.from?.price;
      const compare = d.v.compareAt !== undefined ? d.v.compareAt : d.from?.compareAt;
      if (creating && (price == null || Number(price) === 0)) issues.push({ level: 'warning', code: 'price-zero', message: `${d.options.join(' / ') || 'The variant'} has no price: it would sell at 0.` });
      if (compare != null && price != null && Number(compare) > 0 && Number(compare) <= Number(price)) issues.push({ level: 'warning', code: 'compare', message: `${d.options.join(' / ') || 'A variant'}: compare-at ${compare} is not above the price ${price}, so no sale shows.` });
      if (!(d.v.barcode ?? d.from?.barcode) && d.file) issues.push({ level: 'warning', code: 'no-barcode', message: `${d.options.join(' / ') || 'A variant'} has no barcode: Lucida cannot match its stock or price.` });
    }
  }

  // ── photos
  const imgCmd: ListCmd = fp.imageCommand ?? (replace ? 'REPLACE' : o.images);
  const haveImgs = existing?.images ?? [];
  const fileImgs = [...fp.images].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
  for (const img of fileImgs) if (!/^https?:\/\//i.test(img.src)) issues.push({ level: 'warning', code: 'image-url', message: `Row ${img.line}: “${img.src.slice(0, 60)}” is not a web address, so it is skipped.` });
  const goodImgs = fileImgs.filter((i) => /^https?:\/\//i.test(i.src));
  const variantImgs = desired.flatMap((d) => (d.v.image ? [d.v.image] : []));
  if (goodImgs.length || variantImgs.length) {
    type F = { id?: string; src: string; alt: string | null; isNew: boolean };
    let files: F[];
    if (imgCmd === 'REPLACE') files = goodImgs.map((i) => ({ ...existingImage(haveImgs, i.src), src: i.src, alt: i.alt ?? existingImage(haveImgs, i.src).alt ?? null, isNew: !existingImage(haveImgs, i.src).id }));
    else if (imgCmd === 'DELETE') files = haveImgs.filter((h) => !goodImgs.some((g) => sameImage(h.src, g.src))).map((h) => ({ id: h.id, src: h.src, alt: h.alt, isNew: false }));
    else {
      files = haveImgs.map((h) => {
        const g = goodImgs.find((x) => sameImage(h.src, x.src));
        return { id: h.id, src: h.src, alt: g?.alt ?? h.alt, isNew: false };
      });
      for (const g of goodImgs) if (!haveImgs.some((h) => sameImage(h.src, g.src))) files.push({ src: g.src, alt: g.alt ?? null, isNew: true });
    }
    for (const src of variantImgs) if (!files.some((f) => sameImage(f.src, src))) files.push({ src, alt: null, isNew: true });
    counts.imagesAdded = files.filter((f) => f.isNew).length;
    counts.imagesRemoved = haveImgs.filter((h) => !files.some((f) => f.id === h.id)).length;
    const altChanged = files.some((f) => !f.isNew && f.alt !== (haveImgs.find((h) => h.id === f.id)?.alt ?? null));
    if (counts.imagesAdded || counts.imagesRemoved || altChanged) {
      input.files = files.map((f) => (f.id ? { id: f.id, ...(f.alt != null ? { alt: f.alt } : {}) } : { originalSource: f.src, contentType: 'IMAGE', ...(f.alt ? { alt: f.alt } : {}) }));
      if (counts.imagesAdded) changes.push({ field: 'images:add', label: 'Photos added', before: '', after: `${counts.imagesAdded}` });
      if (counts.imagesRemoved) changes.push({ field: 'images:remove', label: 'Photos removed', before: `${counts.imagesRemoved}`, after: '' });
      if (altChanged) changes.push({ field: 'images:alt', label: 'Photo alt text', before: '', after: 'updated' });
      if (!creating) before.images = haveImgs;
      // a variant's photo points at the file it uses
      if (Array.isArray(input.variants)) {
        for (const [i, d] of desired.entries()) {
          if (!d.v.image) continue;
          const f = files.find((x) => sameImage(x.src, d.v.image!));
          (input.variants as Record<string, unknown>[])[i].file = f?.id ? { id: f.id } : { originalSource: d.v.image, contentType: 'IMAGE' };
        }
      }
    } else if (variantImgs.length && Array.isArray(input.variants)) {
      for (const [i, d] of desired.entries()) {
        const f = d.v.image ? haveImgs.find((x) => sameImage(x.src, d.v.image!)) : null;
        if (f) (input.variants as Record<string, unknown>[])[i].file = { id: f.id };
      }
    }
  }
  const finalImages = counts.imagesAdded + haveImgs.length - counts.imagesRemoved;
  if ((status ?? existing?.status) === 'ACTIVE' && finalImages === 0) issues.push({ level: 'warning', code: 'no-photo', message: 'Active with no photo: shoppers see an empty card.' });

  // ── metafields: only the ones in the sheet, upserted after the product is saved
  const metafields: Write['metafields'] = [];
  for (const m of fileMeta) {
    const now = existing?.metafields.find((x) => x.owner === 'product' && x.namespace === m.namespace && x.key === m.key);
    if (now?.value === m.value) continue;
    metafields.push({ owner: 'product', namespace: m.namespace, key: m.key, type: now?.type ?? m.type, value: m.value });
    changes.push({ field: `mf:${m.namespace}.${m.key}`, label: `${m.namespace}.${m.key}`, before: show(now?.value), after: show(m.value) });
  }
  for (const d of desired) {
    for (const m of d.file?.metafields ?? []) {
      const now = existing?.metafields.find((x) => x.owner === 'variant' && x.variantId === d.id && x.namespace === m.namespace && x.key === m.key);
      if (now?.value === m.value) continue;
      metafields.push({ owner: 'variant', variantKey: variantKey(d.options), namespace: m.namespace, key: m.key, type: now?.type ?? m.type, value: m.value });
    }
  }
  const variantMeta = metafields.filter((m) => m.owner === 'variant').length;
  if (variantMeta) changes.push({ field: 'mf:variants', label: 'Variant metafields', before: '', after: `${variantMeta} set` });

  // ── stock, only when asked
  const stock: Write['stock'] = [];
  if (o.writeStock) {
    for (const d of desired) {
      const q = d.file?.inventoryQty;
      if (q == null || q === d.from?.inventoryQty) continue;
      stock.push({ variantKey: variantKey(d.options), quantity: q });
    }
    if (stock.length) changes.push({ field: 'stock', label: 'Stock', before: '', after: `${stock.length} variant${stock.length === 1 ? '' : 's'} set` });
  } else if (fileVariants.some((v) => v.inventoryQty != null)) {
    issues.push({ level: 'info', code: 'stock-off', message: 'Stock quantities are in the file but not written: Lucida keeps the stock.' });
  }

  // ── the Online Store
  const publish = p.published !== undefined ? (p.published === existing?.published ? null : p.published) : creating ? o.publishNew : null;
  if (publish != null) {
    changes.push({ field: 'published', label: 'Online Store', before: show(existing?.published ?? null), after: publish ? 'published' : 'hidden' });
    if (!creating) before.published = existing?.published ?? null;
  }

  // ── Arabic: the Arabic site's title and description (Shopify's translations)
  const translations: NonNullable<Write['translations']> = [];
  for (const [k, key, label] of [
    ['titleAr', 'title', 'Arabic title'],
    ['bodyHtmlAr', 'body_html', 'Arabic description'],
  ] as const) {
    const v = p[k];
    if (v === undefined || v === '') continue;
    if (!store.rules.arabic) {
      if (!issues.some((x) => x.code === 'no-arabic-site')) issues.push({ level: 'info', code: 'no-arabic-site', message: `${store.name} has no Arabic site: the Arabic columns are left out.` });
      continue;
    }
    const now = existing?.translations?.[key];
    if (now === v) continue;
    translations.push({ key, locale: 'ar', value: v });
    changes.push({ field: `ar:${key}`, label, before: show(now), after: show(v) });
    if (!creating) (before.translations ??= {})[key] = now ?? '';
  }
  if (creating && store.rules.arabic && !p.titleAr) issues.push({ level: 'info', code: 'no-arabic', message: 'No Arabic title: the Arabic site shows the English one until it is translated.' });

  if (pricesSet && store.rules.lucidaPrices) issues.push({ level: 'info', code: 'lucida-price', message: `Lucida's price sync sets ${store.name}'s prices for every barcode it holds: a price here stays only on barcodes Lucida does not have.` });
  // the house rule on tax, said once where it changed a variant
  if (store.rules.taxable !== undefined && changes.some((c) => c.rule && c.field.startsWith('variant:'))) issues.push({ level: 'info', code: 'rule-tax', message: `${store.name}'s house rule: every variant goes in ${store.rules.taxable ? 'taxable' : 'not taxable'}.` });

  const anything = Object.keys(input).length > 0 || metafields.length > 0 || stock.length > 0 || publish != null || translations.length > 0;
  if (!creating && !anything) return { item: item('unchanged'), write: null };
  if (creating) input.handle = fp.handle;
  const write: Write = {
    kind: 'set',
    productId: existing?.id,
    identifier: existing ? { id: existing.id } : { handle: fp.handle },
    input,
    metafields,
    stock,
    publish,
    translations,
    before: creating ? null : before,
  };
  return { item: item(creating ? 'create' : 'update'), write };
}

const isMenuTag = (t: string) => /^(gender|cat|subcat|season|women|men|kids|girls|boys|dept)[:_-]/i.test(t);
const words = (x: string) => x.trim().replace(/\s+/g, ' ').replace(/(^|[\s-])(\p{L})/gu, (_m: string, a: string, b: string) => a + b.toUpperCase());
const slug = (x: string) =>
  x
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const GENDER: Record<string, string> = { women: 'women', woman: 'women', ladies: 'women', female: 'women', 'نساء': 'women', 'نسائي': 'women', 'حريمي': 'women', men: 'men', man: 'men', male: 'men', 'رجال': 'men', 'رجالي': 'men', kids: 'kids', kid: 'kids', children: 'kids', 'أطفال': 'kids', 'اطفال': 'kids', girls: 'girls', girl: 'girls', 'بنات': 'girls', boys: 'boys', boy: 'boys', 'أولاد': 'boys', baby: 'baby', unisex: 'unisex' };

/**
 * The menu and filter tags FIG and Labesny build on, from the sheet's columns: gender:women, cat:tops +
 * "Tops", subcat:logo-tshirt + "Logo Tshirt" (the Sub-category), season:aw26 + "AW26", color:Blue, and the brand.
 * A new value replaces the old one with the same prefix (and the old name tag that went with it).
 */
export function houseTags(p: ProductValues, existing: Pick<StoreProduct, 'tags' | 'vendor'> | null, creating: boolean) {
  const have = existing?.tags ?? [];
  const add: string[] = [];
  const remove: string[] = [];
  const swap = (prefix: string, value: string, plain?: string, plainOf?: (tag: string, old: string) => boolean) => {
    if (!value) return;
    const tag = `${prefix}:${value}`;
    for (const t of have) {
      const i = t.indexOf(':');
      if (i < 0 || lc(t.slice(0, i)) !== prefix || lc(t) === lc(tag)) continue;
      remove.push(t);
      if (plainOf) for (const x of have) if (!x.includes(':') && plainOf(x, t.slice(i + 1))) remove.push(x);
    }
    add.push(tag);
    if (plain) add.push(plain);
  };
  if (p.gender) swap('gender', GENDER[lc(p.gender)] ?? slug(p.gender));
  if (p.category) swap('cat', slug(p.category), words(p.category), (x, old) => slug(x) === lc(old));
  // the sub-category is its own column: a type is not always the sub-category (20100805: type Panties, subcat Boyshort);
  // a new product with only a type takes it as its sub-category
  const sub = p.subcategory ?? (creating ? p.type : undefined);
  if (sub) swap('subcat', slug(sub), sub.trim(), (x, old) => slug(x) === lc(old));
  if (p.season) swap('season', lc(p.season), p.season.trim().toUpperCase(), (x) => /^(aw|ss|fw|sp)\d{2}$/i.test(x) && lc(x) !== lc(p.season));
  if (p.colour) swap('color', words(p.colour));
  if (p.vendor && (creating || (existing && lc(existing.vendor) !== lc(p.vendor)))) {
    add.push(p.vendor);
    if (existing?.vendor && lc(existing.vendor) !== lc(p.vendor)) remove.push(...have.filter((t) => lc(t) === lc(existing.vendor)));
  }
  return { add, remove: remove.filter((r) => !add.some((x) => lc(x) === lc(r))) };
}

function existingImage(have: StoreImage[], src: string): { id?: string; alt?: string | null } {
  const h = have.find((x) => sameImage(x.src, src));
  return h ? { id: h.id, alt: h.alt } : {};
}

function byName(names: string[], values: string[]) {
  return Object.fromEntries(names.map((n, i) => [lc(n), values[i] ?? ''])) as Record<string, string>;
}

/** The store's option names, then any new ones the file brings (by name, ignoring case). */
function mergeNames(have: string[], file: string[]) {
  const out = [...have];
  for (const n of file) if (n && !out.some((x) => lc(x) === lc(n))) out.push(n);
  return out.slice(0, 3);
}

function variantInput(d: { id?: string; options: string[]; v: Partial<StoreVariant>; from?: StoreVariant }, names: string[], i: number, writeStock: boolean) {
  const from = d.from;
  const val = <K extends keyof StoreVariant>(k: K) => (d.v[k] !== undefined ? d.v[k] : from?.[k]);
  const out: Record<string, unknown> = {
    ...(d.id ? { id: d.id } : {}),
    optionValues: names.map((n, j) => ({ optionName: n, name: d.options[j] ?? '' })),
    position: i + 1,
    price: val('price') ?? '0',
    compareAtPrice: val('compareAt') ?? null,
  };
  const sku = val('sku');
  if (sku != null) out.sku = sku;
  const barcode = val('barcode');
  if (barcode != null) out.barcode = barcode;
  const taxable = val('taxable');
  if (taxable != null) out.taxable = taxable;
  const policy = val('inventoryPolicy');
  if (policy) out.inventoryPolicy = policy;
  const cost = d.v.cost;
  if (cost !== undefined || !from) out.inventoryItem = { ...(cost != null ? { cost } : {}), ...(!from ? { tracked: true } : {}) };
  void writeStock; // stock goes separately, after the product is saved (inventorySetQuantities)
  return out;
}

/** The summary tiles: how many products each action, per store. */
export function tally(items: PlanItem[]) {
  const t = { create: 0, update: 0, unchanged: 0, skip: 0, delete: 0, archive: 0, error: 0, warnings: 0 };
  for (const i of items) {
    t[i.action]++;
    if (i.issues.some((x) => x.level === 'warning')) t.warnings++;
  }
  return t;
}

/**
 * Undo for one product an import updated: back to what it was (`before`), against how it is now. Fields
 * go back; variants the import added go, ones it removed come back (as new variants); photos come back by
 * address. A product the import created is archived instead (see the job runner).
 */
export function revertWrite(before: Snapshot, now: StoreProduct): Write {
  const input: Record<string, unknown> = {};
  if (before.title !== undefined) input.title = before.title;
  if (before.bodyHtml !== undefined) input.descriptionHtml = before.bodyHtml;
  if (before.vendor !== undefined) input.vendor = before.vendor;
  if (before.type !== undefined) input.productType = before.type;
  if (before.templateSuffix !== undefined) input.templateSuffix = before.templateSuffix ?? '';
  if (before.tags !== undefined) input.tags = before.tags;
  if (before.status !== undefined) input.status = before.status;
  if (before.seoTitle !== undefined || before.seoDescription !== undefined) input.seo = { title: before.seoTitle ?? null, description: before.seoDescription ?? null };
  if (before.variants) {
    const names = before.optionNames?.length ? before.optionNames : ['Title'];
    const values = names.map((_, i) => [...new Set(before.variants!.map((v) => v.options[i] ?? 'Default Title'))]);
    input.productOptions = names.map((n, i) => ({ name: n, position: i + 1, values: values[i].map((v) => ({ name: v })) }));
    input.variants = before.variants.map((v, i) => ({
      ...(now.variants.some((x) => x.id === v.id) ? { id: v.id } : {}),
      optionValues: names.map((n, j) => ({ optionName: n, name: v.options[j] ?? 'Default Title' })),
      position: i + 1,
      price: v.price,
      compareAtPrice: v.compareAt,
      ...(v.sku != null ? { sku: v.sku } : {}),
      ...(v.barcode != null ? { barcode: v.barcode } : {}),
      taxable: v.taxable,
    }));
  }
  if (before.images) input.files = before.images.map((img) => (now.images.some((x) => x.id === img.id) ? { id: img.id, ...(img.alt != null ? { alt: img.alt } : {}) } : { originalSource: img.src, contentType: 'IMAGE', ...(img.alt ? { alt: img.alt } : {}) }));
  // an Arabic text the import added where there was none goes again (an empty value removes it)
  const translations = Object.entries(before.translations ?? {}).map(([key, value]) => ({ key, locale: 'ar', value }));
  return { kind: 'set', productId: now.id, identifier: { id: now.id }, input, metafields: [], stock: [], publish: before.published === undefined || before.published === now.published ? null : before.published, translations, before: null };
}
