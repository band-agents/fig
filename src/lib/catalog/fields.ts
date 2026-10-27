// Catalogue import & export (Dan, 27 Oct: "clone Matrixify inside the console, for every website").
// The columns a products sheet can carry, and how a header row is read: Matrixify's own names first,
// then Shopify's CSV names, then the names the teams use in their own Excel sheets (Style, Barcode,
// RRP, Colour, Size, and the Arabic ones). Pure: the same rules run on the server and in the tests.

export type FieldKey =
  // product
  | 'id'
  | 'handle'
  | 'command'
  | 'title'
  | 'bodyHtml'
  | 'vendor'
  | 'type'
  | 'category'
  | 'subcategory'
  | 'gender'
  | 'season'
  | 'titleAr'
  | 'bodyHtmlAr'
  | 'tags'
  | 'tagsCommand'
  | 'status'
  | 'published'
  | 'templateSuffix'
  | 'seoTitle'
  | 'seoDescription'
  | 'option1Name'
  | 'option2Name'
  | 'option3Name'
  // images
  | 'imageSrc'
  | 'imageCommand'
  | 'imagePosition'
  | 'imageAlt'
  // variants
  | 'variantId'
  | 'variantCommand'
  | 'option1Value'
  | 'option2Value'
  | 'option3Value'
  | 'variantPosition'
  | 'sku'
  | 'barcode'
  | 'price'
  | 'compareAt'
  | 'taxable'
  | 'cost'
  | 'inventoryPolicy'
  | 'inventoryQty'
  | 'variantImage'
  // read on export, ignored on import
  | 'createdAt'
  | 'updatedAt'
  | 'topRow';

export type Level = 'product' | 'variant' | 'image' | 'info';

export type FieldDef = { key: FieldKey; header: string; level: Level; group: Group; hint: string; aliases?: string[] };
export type Group = 'basics' | 'menus' | 'arabic' | 'variants' | 'images' | 'seo' | 'commands' | 'stock' | 'info';

export const GROUP_LABEL: Record<Group, string> = {
  basics: 'Basics',
  menus: 'Menus & filters',
  arabic: 'Arabic',
  variants: 'Variants & prices',
  images: 'Images',
  seo: 'SEO',
  commands: 'Commands',
  stock: 'Stock & cost',
  info: 'Read only',
};

/** Every column, in the order an export writes them. Headers are Matrixify's, so its files import as they are. */
export const FIELDS: FieldDef[] = [
  { key: 'id', header: 'ID', level: 'product', group: 'basics', hint: "Shopify's product ID. Matches the product exactly; leave empty for new products.", aliases: ['product id'] },
  { key: 'handle', header: 'Handle', level: 'product', group: 'basics', hint: 'The product’s web address. Rows with the same handle are one product. Made from the title when empty.', aliases: ['url handle', 'slug'] },
  { key: 'command', header: 'Command', level: 'product', group: 'commands', hint: 'MERGE (create or update, the default) · NEW · UPDATE · REPLACE · DELETE · IGNORE' },
  { key: 'title', header: 'Title', level: 'product', group: 'basics', hint: 'The product name.', aliases: ['product title', 'product name', 'name', 'item name', 'style name', 'الاسم', 'اسم المنتج'] },
  { key: 'bodyHtml', header: 'Body HTML', level: 'product', group: 'basics', hint: 'The description, HTML allowed.', aliases: ['body (html)', 'body', 'description html', 'long description', 'product description', 'الوصف'] },
  { key: 'vendor', header: 'Vendor', level: 'product', group: 'basics', hint: 'The brand.', aliases: ['brand', 'brand name', 'الماركة', 'البراند'] },
  { key: 'type', header: 'Type', level: 'product', group: 'basics', hint: 'The product type (Logo Tshirt, Bralettes…). A new product with no Sub-category takes it as its sub-category too.', aliases: ['product type', 'النوع'] },
  { key: 'category', header: 'Category', level: 'product', group: 'menus', hint: 'The menu category (Tops, Bras, Sleep & Homewear…): becomes the cat: tag and the category name tag.', aliases: ['main category', 'menu category', 'الفئة', 'التصنيف'] },
  { key: 'subcategory', header: 'Sub-category', level: 'product', group: 'menus', hint: 'The menu sub-category (Boyshort, Logo Tshirt…): becomes the subcat: tag and its name tag. A new product with no Type takes it as its type.', aliases: ['sub category', 'subcategory', 'subcat', 'الفئة الفرعية'] },
  { key: 'gender', header: 'Gender', level: 'product', group: 'menus', hint: 'Women, Men, Kids, Girls, Boys: becomes the gender: tag the menus are built on.', aliases: ['department', 'dept', 'division', 'القسم', 'الجنس'] },
  { key: 'season', header: 'Season', level: 'product', group: 'menus', hint: 'AW26, SS26…: becomes the season: tag and the season name tag.', aliases: ['collection season', 'الموسم'] },
  { key: 'titleAr', header: 'Title [ar]', level: 'product', group: 'arabic', hint: 'The Arabic title (the Arabic site shows it). A Title column written in Arabic is read as this.', aliases: ['title ar', 'arabic title', 'title arabic', 'الاسم بالعربي', 'الاسم بالعربية', 'العنوان بالعربي'] },
  { key: 'bodyHtmlAr', header: 'Body HTML [ar]', level: 'product', group: 'arabic', hint: 'The Arabic description.', aliases: ['body html ar', 'description ar', 'arabic description', 'الوصف بالعربي', 'الوصف بالعربية'] },
  { key: 'tags', header: 'Tags', level: 'product', group: 'basics', hint: 'Comma separated. They drive the menus and filters, so the import adds to the existing tags unless Tags Command says REPLACE.', aliases: ['tag', 'keywords'] },
  { key: 'tagsCommand', header: 'Tags Command', level: 'product', group: 'commands', hint: 'MERGE (add, the default here) · REPLACE · DELETE (remove the listed tags)' },
  { key: 'status', header: 'Status', level: 'product', group: 'basics', hint: 'Active · Draft · Archived', aliases: ['product status', 'الحالة'] },
  { key: 'published', header: 'Published', level: 'product', group: 'basics', hint: 'TRUE puts it on the Online Store, FALSE takes it off.', aliases: ['published on online store', 'visible', 'online store'] },
  { key: 'templateSuffix', header: 'Template Suffix', level: 'product', group: 'seo', hint: 'The theme template, if not the default.', aliases: ['template'] },
  { key: 'seoTitle', header: 'SEO Title', level: 'product', group: 'seo', hint: 'The title search engines show.', aliases: ['meta title', 'page title'] },
  { key: 'seoDescription', header: 'SEO Description', level: 'product', group: 'seo', hint: 'The description search engines show.', aliases: ['meta description'] },
  { key: 'createdAt', header: 'Created At', level: 'info', group: 'info', hint: 'Read only.' },
  { key: 'updatedAt', header: 'Updated At', level: 'info', group: 'info', hint: 'Read only.' },
  { key: 'option1Name', header: 'Option1 Name', level: 'product', group: 'variants', hint: 'Size, Colour…', aliases: ['option 1 name'] },
  { key: 'option1Value', header: 'Option1 Value', level: 'variant', group: 'variants', hint: 'This variant’s value of option 1.', aliases: ['option 1 value'] },
  { key: 'option2Name', header: 'Option2 Name', level: 'product', group: 'variants', hint: '', aliases: ['option 2 name'] },
  { key: 'option2Value', header: 'Option2 Value', level: 'variant', group: 'variants', hint: '', aliases: ['option 2 value'] },
  { key: 'option3Name', header: 'Option3 Name', level: 'product', group: 'variants', hint: '', aliases: ['option 3 name'] },
  { key: 'option3Value', header: 'Option3 Value', level: 'variant', group: 'variants', hint: '', aliases: ['option 3 value'] },
  { key: 'variantId', header: 'Variant ID', level: 'variant', group: 'variants', hint: "Shopify's variant ID; otherwise variants match by barcode, then SKU, then options." },
  { key: 'variantCommand', header: 'Variant Command', level: 'variant', group: 'commands', hint: 'MERGE (the default) · REPLACE (only the listed variants stay) · DELETE' },
  { key: 'variantPosition', header: 'Variant Position', level: 'variant', group: 'variants', hint: 'Order of the variant.' },
  { key: 'sku', header: 'Variant SKU', level: 'variant', group: 'variants', hint: 'The SKU.', aliases: ['sku', 'item code', 'style code', 'style', 'style number', 'article', 'ref', 'reference', 'كود'] },
  { key: 'barcode', header: 'Variant Barcode', level: 'variant', group: 'variants', hint: 'The barcode (EAN/UPC). Lucida matches stock and price on it.', aliases: ['barcode', 'ean', 'upc', 'gtin', 'ean13', 'باركود', 'الباركود'] },
  { key: 'price', header: 'Variant Price', level: 'variant', group: 'variants', hint: 'The selling price.', aliases: ['price', 'rrp', 'retail price', 'selling price', 'sale price', 'السعر'] },
  { key: 'compareAt', header: 'Variant Compare At Price', level: 'variant', group: 'variants', hint: 'The price before a sale (shown crossed out).', aliases: ['compare at price', 'compare-at price', 'compare at', 'was price', 'original price', 'full price', 'السعر قبل الخصم'] },
  { key: 'taxable', header: 'Variant Taxable', level: 'variant', group: 'variants', hint: 'TRUE or FALSE. Labesny is always FALSE.', aliases: ['taxable', 'charge tax'] },
  { key: 'cost', header: 'Variant Cost', level: 'variant', group: 'stock', hint: 'Cost per item.', aliases: ['cost per item', 'cost', 'cost price', 'unit cost', 'التكلفة'] },
  { key: 'inventoryPolicy', header: 'Variant Inventory Policy', level: 'variant', group: 'stock', hint: 'deny (stop selling at zero) or continue.', aliases: ['inventory policy', 'continue selling when out of stock'] },
  { key: 'inventoryQty', header: 'Variant Inventory Qty', level: 'variant', group: 'stock', hint: 'Stock at the online location. Lucida owns stock, so this is written only when the import says so.', aliases: ['inventory qty', 'inventory quantity', 'qty', 'quantity', 'stock', 'on hand', 'الكمية', 'المخزون'] },
  { key: 'variantImage', header: 'Variant Image', level: 'variant', group: 'images', hint: 'The photo shown for this variant (a URL).', aliases: ['variant image url'] },
  { key: 'imageSrc', header: 'Image Src', level: 'image', group: 'images', hint: 'A photo URL. One per row; rows with the same handle add more photos.', aliases: ['image', 'image url', 'image src url', 'photo', 'photo url', 'picture', 'main image', 'الصورة'] },
  { key: 'imageCommand', header: 'Image Command', level: 'image', group: 'commands', hint: 'MERGE (add new photos, the default) · REPLACE (only these photos) · DELETE' },
  { key: 'imagePosition', header: 'Image Position', level: 'image', group: 'images', hint: 'Order of the photo, 1 first.', aliases: ['image order'] },
  { key: 'imageAlt', header: 'Image Alt Text', level: 'image', group: 'images', hint: 'The photo’s alt text.', aliases: ['alt', 'alt text', 'image alt'] },
  { key: 'topRow', header: 'Top Row', level: 'info', group: 'info', hint: 'Read only: TRUE on a product’s first row.' },
];

export const FIELD: Record<FieldKey, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<FieldKey, FieldDef>;

/** A column as read: which field, for which store (a `@Store` suffix), or a metafield, or a named option (Size, Colour). */
export type ColumnRef =
  | { kind: 'field'; key: FieldKey; store?: string }
  | { kind: 'metafield'; owner: 'product' | 'variant'; namespace: string; key: string; type: string; store?: string }
  | { kind: 'option'; name: string }
  | { kind: 'ignore' };

export type Mapped = { index: number; header: string; ref: ColumnRef; how: 'exact' | 'alias' | 'option' | 'metafield' | 'unknown'; problem?: string };

/** The stores a column can be aimed at with `@`: matched by id, name, brand or Shopify handle, ignoring case. */
export type StoreKey = { id: string; names: string[] };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‏‎]/g, '')
    .replace(/[_\-./()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const BY_NAME = new Map<string, { key: FieldKey; how: 'exact' | 'alias' }>();
for (const f of FIELDS) {
  BY_NAME.set(norm(f.header), { key: f.key, how: 'exact' });
  for (const a of f.aliases ?? []) if (!BY_NAME.has(norm(a))) BY_NAME.set(norm(a), { key: f.key, how: 'alias' });
}
// Shopify's own CSV names that differ from Matrixify's
for (const [name, key] of [
  ['body html', 'bodyHtml'],
  ['variant grams', 'ignore'],
  ['variant inventory tracker', 'ignore'],
  ['variant fulfillment service', 'ignore'],
  ['variant requires shipping', 'ignore'],
  ['gift card', 'ignore'],
  ['product category', 'ignore'],
  ['variant weight unit', 'ignore'],
  ['image position', 'imagePosition'],
] as const) {
  if (key !== 'ignore' && !BY_NAME.has(name)) BY_NAME.set(name, { key, how: 'alias' });
}
const IGNORED = new Set(['variant grams', 'variant inventory tracker', 'variant fulfillment service', 'variant requires shipping', 'gift card', 'product category', 'variant weight unit', 'variant weight', 'row #', 'import result', 'import comment', 'store', 'result', 'comment']);

/** Size and colour columns in the teams' own sheets become options by name. */
const OPTION_WORDS: Record<string, string> = { size: 'Size', sizes: 'Size', 'المقاس': 'Size', 'المقاسات': 'Size', colour: 'Colour', color: 'Colour', 'اللون': 'Colour', cup: 'Cup', 'band size': 'Band', material: 'Material' };

export function resolveStore(text: string, stores: StoreKey[]): string | null {
  const t = norm(text);
  for (const s of stores) if (s.id === text.trim() || s.names.some((n) => norm(n) === t)) return s.id;
  return null;
}

/**
 * Reads a header row. Each column becomes a field, a metafield (`Metafield: custom.fabric [single_line_text_field]`),
 * a named option (Size, Colour), or is ignored; `Variant Price @FIG` aims a column at one store.
 */
export function mapHeader(header: string[], stores: StoreKey[]): Mapped[] {
  return header.map((raw, index) => {
    const header = (raw ?? '').trim();
    if (!header) return { index, header, ref: { kind: 'ignore' }, how: 'unknown' };
    // a store suffix: "Variant Price @FIG" or "Variant Price [labesny-web]" is only for that store
    let name = header;
    let store: string | undefined;
    let problem: string | undefined;
    const at = header.match(/^(.*?)\s*(?:@\s*([^@]+)|\[([^\]]+)\])\s*$/);
    if (at && !/^(variant\s+)?metafield\s*:/i.test(header)) {
      const target = (at[2] ?? at[3] ?? '').trim();
      const found = resolveStore(target, stores);
      if (found) {
        name = at[1];
        store = found;
      } else if (at[2]) {
        name = at[1];
        problem = `No store called “${target}”: this column is ignored.`;
        return { index, header, ref: { kind: 'ignore' }, how: 'unknown', problem };
      }
    }
    const mf = name.match(/^(variant\s+)?metafield\s*:\s*([a-z0-9_\-]+)\.([a-z0-9_\-]+)\s*(?:\[\s*([a-z_.]+(?:\.[a-z_]+)*)\s*\])?(?:\s*@\s*(.+))?$/i);
    if (mf) {
      const mfStore = mf[5] ? (resolveStore(mf[5], stores) ?? undefined) : undefined;
      return {
        index,
        header,
        ref: { kind: 'metafield', owner: mf[1] ? 'variant' : 'product', namespace: mf[2], key: mf[3], type: (mf[4] ?? 'single_line_text_field').toLowerCase(), ...(mfStore ? { store: mfStore } : {}) },
        how: 'metafield',
        ...(mf[4] ? {} : { problem: 'No [type] after the metafield: read as single_line_text_field.' }),
      };
    }
    const n = norm(name);
    const hit = BY_NAME.get(n);
    if (hit) return { index, header, ref: { kind: 'field', key: hit.key, ...(store ? { store } : {}) }, how: hit.how, ...(problem ? { problem } : {}) };
    if (IGNORED.has(n)) return { index, header, ref: { kind: 'ignore' }, how: 'unknown' };
    const opt = OPTION_WORDS[n];
    if (opt) return { index, header, ref: { kind: 'option', name: opt }, how: 'option' };
    return { index, header, ref: { kind: 'ignore' }, how: 'unknown', problem: 'Not a column the import knows: ignored. Pick a field for it if it matters.' };
  });
}

/** Which kind of sheet this looks like, for the review screen. */
export function sheetFormat(mapped: Mapped[]): 'matrixify' | 'shopify' | 'own' {
  const headers = new Set(mapped.map((m) => norm(m.header)));
  if (headers.has('command') || headers.has('top row') || headers.has('variant command') || headers.has('image command')) return 'matrixify';
  if (headers.has('handle') && (headers.has('body (html)') || headers.has('body html') || headers.has('variant grams'))) return 'shopify';
  if (headers.has('handle') && headers.has('variant price')) return 'matrixify';
  return 'own';
}

/** Every field a column can be set to by hand on the review screen. */
export const PICKABLE: { value: string; label: string }[] = [
  { value: 'ignore', label: 'Ignore this column' },
  ...FIELDS.filter((f) => f.level !== 'info').map((f) => ({ value: `field:${f.key}`, label: f.header })),
  { value: 'option:Size', label: 'Option: Size' },
  { value: 'option:Colour', label: 'Option: Colour' },
];

export function refFromPick(v: string): ColumnRef {
  if (v.startsWith('field:')) return { kind: 'field', key: v.slice(6) as FieldKey };
  if (v.startsWith('option:')) return { kind: 'option', name: v.slice(7) };
  return { kind: 'ignore' };
}

export function pickOf(ref: ColumnRef): string {
  if (ref.kind === 'field') return `field:${ref.key}`;
  if (ref.kind === 'option') return `option:${ref.name}`;
  if (ref.kind === 'metafield') return 'metafield';
  return 'ignore';
}
