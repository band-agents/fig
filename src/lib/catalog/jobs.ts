import 'server-only';
// Catalogue import & export: the jobs. An import is read, checked against every chosen store (the dry
// run), and written only when someone presses Run; an export reads a whole store into a workbook; a
// revert undoes an import. Each runs in the background and records progress as it goes, so the page
// shows it live and a run whose server stopped is picked up again by the next poll (a lease on
// heartbeat_at) without writing anything twice: products already done are skipped.
import { deflateRawSync } from 'node:zlib';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { CHANNEL, CHANNELS, channelConfigured, COUNTRIES, type ChannelDef } from '../channels';
import { can, seesBrands, seesChannel, type Principal } from '../domain/perms';
import { RelayError } from '../errors';
import { keepAlive } from '../keep-alive';
import { fileName as sheetFileName, toCsv, toXlsx, XLSX_TYPE } from '../sheet';
import { readGrid } from '../sheet-read';
import { barcodesInStore, catalogAccess, catalogExport, catalogFetch, catalogSave, catalogWritable, storeConventions } from '../connectors/shopify';
import { mapHeader, pickOf, refFromPick, sheetFormat, type Mapped, type StoreKey } from './fields';
import { parseProducts, type FileProduct } from './parse';
import { DEFAULT_OPTIONS, planProduct, revertWrite, tally, type Action, type ImportOptions, type PlanItem, type Snapshot, type StoreCtx, type StoreRules } from './plan';
import { EXPORT_GROUPS, productsSheet } from './sheets';
import type { Group } from './fields';

export type JobKind = 'import' | 'export' | 'revert';
export type JobStatus = 'analysing' | 'ready' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobResult = { key: string; handle: string; title: string; store: string; action: Action; result: 'ok' | 'failed' | 'skipped'; message: string; productId?: string; before?: Snapshot | null; at: string; lines: number[] };
export type StorePlan = { items: PlanItem[]; tally: ReturnType<typeof tally>; blocked: string | null };
export type ImportPlan = {
  format: 'matrixify' | 'shopify' | 'own';
  header: string[];
  mapping: Mapped[];
  sample: string[][];
  rows: number;
  products: number;
  stores: Record<string, StorePlan>;
  checks: { images: { checked: number; broken: { src: string; why: string }[] }; barcodes: number };
  notes?: string[]; // how the file was read: Arabic columns found, styles split by colour, products found by barcode
};
export type JobProgress = { phase: string; done: number; total: number; message?: string; perStore?: Record<string, { done: number; ok: number; failed: number; skipped: number; total: number }>; counts?: Record<string, number> };
export type ImportJobOptions = ImportOptions & { emptyClears: boolean; mapping?: Record<number, string> };
export type ExportJobOptions = { groups: Group[]; status: string[]; vendor?: string; tag?: string; type?: string; updatedSince?: string; query?: string; format: 'xlsx' | 'csv'; metafields: boolean };

export type CatalogStore = { id: string; name: string; country: string; countryName: string; currency: string; store: string; brand: string; connected: boolean; writable: boolean; readOnly: boolean; rules: StoreRules };

const STALE_MS = 60_000;
const ACTIVE: JobStatus[] = ['analysing', 'running'];
const running = new Set<string>();

// ── Stores ──

/** A store's house rules, applied on top of every import (they show on the review screen). */
export function storeRules(c: ChannelDef): StoreRules {
  // FIG and Labesny share the theme, the menus and the tag system; Lucida owns both stores' prices
  const shared = c.brand === 'Labesny' || c.brand === 'FIG' ? { houseTags: true, lucidaPrices: true } : {};
  if (c.brand === 'Labesny') return { ...shared, taxable: false, notes: ['Labesny never charges tax: every variant goes in not taxable.', 'Menu tags (gender:, cat:, subcat:, season:, color:, the brand) are made from the Gender, Category, Sub-category, Season and Colour columns.'] };
  if (c.brand === 'FIG') return { ...shared, notes: ['Menu tags (gender:, cat:, subcat:, season:, color:, the brand) are made from the Gender, Category, Sub-category, Season and Colour columns.'] };
  return { notes: [] };
}

/** The store's rules with what only the store knows: its brands as it spells them, and whether it has an Arabic site. */
async function storeCtx(c: ChannelDef): Promise<StoreCtx> {
  const rules = storeRules(c);
  try {
    const conv = await storeConventions(c);
    return { id: c.id, name: c.name, currency: c.currency, rules: { ...rules, vendors: conv.vendors, arabic: conv.arabic } };
  } catch {
    return { id: c.id, name: c.name, currency: c.currency, rules };
  }
}

export function catalogStores(p: Pick<Principal, 'channels'>): CatalogStore[] {
  return CHANNELS.filter((c) => c.platform === 'shopify' && !c.parked && seesChannel(p as Principal, c.id)).map((c) => ({
    id: c.id,
    name: c.name,
    country: c.country,
    countryName: COUNTRIES.find((x) => x.code === c.country)?.name ?? c.country,
    currency: c.currency,
    store: c.store ?? '',
    brand: c.brand,
    connected: channelConfigured(c),
    writable: channelConfigured(c) && catalogWritable(c),
    readOnly: Boolean(c.readOnly) && !catalogWritable(c),
    rules: storeRules(c),
  }));
}

const storeKeys = (stores: CatalogStore[]): StoreKey[] => stores.map((s) => ({ id: s.id, names: [s.name, s.brand, s.store, `${s.brand} ${s.countryName}`, `${s.name} ${s.country}`] }));
export const adminUrl = (c: ChannelDef, productId?: string) => (productId && c.store ? `https://admin.shopify.com/store/${c.store}/products/${productId.split('/').pop()}` : undefined);

// ── Access ──

function mustSee(p: Principal) {
  if (!can(p, 'catalog', 1)) throw new RelayError('forbidden', 'Your access does not include the catalogue.');
}
function mustImport(p: Principal) {
  if (!can(p, 'catalog', 2)) throw new RelayError('forbidden', 'Importing products needs Catalogue import access.');
}

// ── Reading and writing jobs ──

type Row = typeof schema.catalogJobs.$inferSelect;

async function save(id: string, set: Partial<Row>) {
  const db = await getDb();
  await db
    .update(schema.catalogJobs)
    // every save is a sign of life, unless the caller hands the job back (heartbeatAt: null) for the runner to claim
    .set({ heartbeatAt: new Date(), ...set })
    .where(eq(schema.catalogJobs.id, id));
}

async function load(id: string) {
  const db = await getDb();
  const [job] = await db.select().from(schema.catalogJobs).where(eq(schema.catalogJobs.id, id));
  return job ?? null;
}

async function sourceGrid(jobId: string): Promise<string[][]> {
  const db = await getDb();
  const [f] = await db.select().from(schema.catalogFiles).where(and(eq(schema.catalogFiles.jobId, jobId), eq(schema.catalogFiles.role, 'source')));
  if (!f) throw new Error('The uploaded file is no longer kept.');
  return JSON.parse(f.data) as string[][];
}

export async function listJobs(p: Principal, limit = 30) {
  mustSee(p);
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.catalogJobs.id,
      kind: schema.catalogJobs.kind,
      status: schema.catalogJobs.status,
      stores: schema.catalogJobs.stores,
      fileName: schema.catalogJobs.fileName,
      progress: schema.catalogJobs.progress,
      note: schema.catalogJobs.note,
      parentId: schema.catalogJobs.parentId,
      createdByName: schema.catalogJobs.createdByName,
      createdAt: schema.catalogJobs.createdAt,
      startedAt: schema.catalogJobs.startedAt,
      finishedAt: schema.catalogJobs.finishedAt,
      heartbeatAt: schema.catalogJobs.heartbeatAt,
      // the dry run's counts, without the whole plan
      summary: sql<Record<string, ReturnType<typeof tally>> | null>`(select jsonb_object_agg(k, v->'tally') from jsonb_each(${schema.catalogJobs.plan}->'stores') as s(k, v))`,
    })
    .from(schema.catalogJobs)
    .orderBy(desc(schema.catalogJobs.createdAt))
    .limit(limit);
  return rows.filter((r) => r.stores.every((s) => seesChannel(p, s)));
}
export type JobRow = Awaited<ReturnType<typeof listJobs>>[number];

export async function getJob(p: Principal, id: string) {
  mustSee(p);
  const job = await load(id);
  if (!job || !job.stores.every((s) => seesChannel(p, s))) return null;
  return job;
}

export async function exportFile(p: Principal, id: string) {
  const job = await getJob(p, id);
  if (!job) return null;
  const db = await getDb();
  const [f] = await db.select().from(schema.catalogFiles).where(and(eq(schema.catalogFiles.jobId, id), eq(schema.catalogFiles.role, 'export')));
  return f ? { name: f.name, mime: f.mime, data: Buffer.from(f.data, 'base64') } : null;
}

// ── Starting jobs ──

const actor = (p: Principal) => ({ createdBy: p.id, createdByName: p.name });

/** A file uploaded for import: kept as its grid, then read and checked against the stores in the background. */
export async function startImport(p: Principal, file: { name: string; bytes: Uint8Array }, stores: string[], options: Partial<ImportJobOptions>) {
  mustImport(p);
  const grid = readGrid(file.bytes, file.name);
  if (grid.length < 2) throw new RelayError('invalid', 'The first sheet has no rows under its header.');
  if (grid.length > 60_001) throw new RelayError('invalid', 'Over 60,000 rows: split the file and import it in parts.');
  return createImportJob(p, file.name, grid, stores, options, null);
}

async function createImportJob(p: Principal, name: string, grid: string[][], stores: string[], options: Partial<ImportJobOptions>, parentId: string | null) {
  const allowed = catalogStores(p).filter((s) => s.connected);
  const chosen = stores.filter((s) => allowed.some((a) => a.id === s));
  if (!chosen.length) throw new RelayError('invalid', 'Choose at least one connected store.');
  const opts = clean(p, options);
  const db = await getDb();
  const [job] = await db
    .insert(schema.catalogJobs)
    .values({ kind: 'import', status: 'analysing', stores: chosen, fileName: name, options: opts as unknown as Record<string, unknown>, progress: { phase: 'reading', done: 0, total: 0 }, parentId, ...actor(p), startedAt: new Date() })
    .returning({ id: schema.catalogJobs.id });
  const data = JSON.stringify(grid);
  await db.insert(schema.catalogFiles).values({ jobId: job.id, role: 'source', name, mime: 'application/json', data, bytes: data.length });
  void prune().catch(() => {});
  kick(job.id);
  return job.id;
}

/** The import's options, with what this person may not choose taken out. */
function clean(p: Principal, o: Partial<ImportJobOptions>): ImportJobOptions {
  const manage = can(p, 'catalog', 3);
  return {
    ...DEFAULT_OPTIONS,
    emptyClears: false,
    ...o,
    mode: o.mode === 'new' || o.mode === 'update' ? o.mode : 'both',
    tags: o.tags === 'REPLACE' ? 'REPLACE' : 'MERGE',
    images: o.images === 'REPLACE' ? 'REPLACE' : 'MERGE',
    newStatus: o.newStatus === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
    writeStock: manage && Boolean(o.writeStock),
    safeDelete: manage ? o.safeDelete !== false : true,
  };
}

/** Read the file again with the review screen's choices (a column remapped, other stores, other options). */
export async function reanalyse(p: Principal, id: string, change: { mapping?: Record<number, string>; stores?: string[]; options?: Partial<ImportJobOptions> }) {
  mustImport(p);
  const job = await getJob(p, id);
  if (!job || job.kind !== 'import') throw new RelayError('not_found', 'Import not found.');
  if (!['ready', 'failed'].includes(job.status)) throw new RelayError('invalid', 'This import is not waiting for review.');
  const allowed = catalogStores(p).filter((s) => s.connected);
  const stores = (change.stores ?? job.stores).filter((s) => allowed.some((a) => a.id === s));
  if (!stores.length) throw new RelayError('invalid', 'Choose at least one connected store.');
  const prev = job.options as unknown as ImportJobOptions;
  const options = clean(p, { ...prev, ...(change.options ?? {}), mapping: { ...(prev.mapping ?? {}), ...(change.mapping ?? {}) } });
  await save(id, { status: 'analysing', stores, options: options as unknown as Record<string, unknown>, progress: { phase: 'reading', done: 0, total: 0 }, note: null, heartbeatAt: null });
  kick(id);
}

export async function startRun(p: Principal, id: string) {
  mustImport(p);
  const job = await getJob(p, id);
  if (!job || job.kind !== 'import') throw new RelayError('not_found', 'Import not found.');
  if (job.status !== 'ready') throw new RelayError('invalid', job.status === 'running' ? 'It is already running.' : 'Run the dry run first.');
  const plan = job.plan as unknown as ImportPlan | null;
  const stores = job.stores.filter((s) => !plan?.stores[s]?.blocked);
  if (!stores.length) throw new RelayError('invalid', 'None of the chosen stores can take this import.');
  const opts = job.options as unknown as ImportJobOptions;
  if ((opts.writeStock || opts.safeDelete === false) && !can(p, 'catalog', 3)) throw new RelayError('forbidden', 'Writing stock or deleting products needs Delete & revert access.');
  await save(id, { status: 'running', progress: { phase: 'writing', done: 0, total: 0 }, results: [], startedAt: new Date(), finishedAt: null, heartbeatAt: null });
  kick(id);
}

export async function startExport(p: Principal, store: string, options: Partial<ExportJobOptions>) {
  mustSee(p);
  const s = catalogStores(p).find((x) => x.id === store && x.connected);
  if (!s) throw new RelayError('invalid', 'Choose a connected store.');
  const opts: ExportJobOptions = {
    groups: (options.groups?.length ? options.groups : EXPORT_GROUPS).filter((g) => EXPORT_GROUPS.includes(g)),
    status: (options.status ?? []).filter((x) => ['active', 'draft', 'archived'].includes(x)),
    vendor: options.vendor?.trim() || undefined,
    tag: options.tag?.trim() || undefined,
    type: options.type?.trim() || undefined,
    updatedSince: /^\d{4}-\d{2}-\d{2}$/.test(options.updatedSince ?? '') ? options.updatedSince : undefined,
    query: options.query?.trim() || undefined,
    format: options.format === 'csv' ? 'csv' : 'xlsx',
    metafields: options.metafields !== false,
  };
  const db = await getDb();
  const [job] = await db
    .insert(schema.catalogJobs)
    .values({ kind: 'export', status: 'running', stores: [store], fileName: null, options: opts as unknown as Record<string, unknown>, progress: { phase: 'exporting', done: 0, total: 0 }, ...actor(p), startedAt: new Date() })
    .returning({ id: schema.catalogJobs.id });
  kick(job.id);
  return job.id;
}

/** An export's products imported into other stores: copies a range from one website to another. */
export async function importFromExport(p: Principal, exportId: string, stores: string[]) {
  mustImport(p);
  const job = await getJob(p, exportId);
  if (!job || job.kind !== 'export' || job.status !== 'done') throw new RelayError('invalid', 'That export is not finished.');
  const f = await exportFile(p, exportId);
  if (!f) throw new RelayError('not_found', 'The export file is no longer kept.');
  const grid = readGrid(new Uint8Array(f.data), f.name);
  // IDs belong to the store it came from: another store matches by handle
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const drop = new Set(['id', 'variant id'].map((h) => header.indexOf(h)).filter((i) => i >= 0));
  const cleaned = grid.map((r) => r.map((c, i) => (drop.has(i) ? '' : c)));
  return createImportJob(p, `${f.name} (copy)`, cleaned, stores, {}, exportId);
}

export async function startRevert(p: Principal, importId: string) {
  if (!can(p, 'catalog', 3)) throw new RelayError('forbidden', 'Reverting an import needs Delete & revert access.');
  const job = await getJob(p, importId);
  if (!job || job.kind !== 'import' || !['done', 'cancelled', 'failed'].includes(job.status)) throw new RelayError('invalid', 'Only a finished import can be reverted.');
  const results = job.results as JobResult[];
  if (!results.some((r) => r.result === 'ok' && (r.action === 'create' || r.before))) throw new RelayError('invalid', 'This import changed nothing that can be undone.');
  const db = await getDb();
  const [rev] = await db
    .insert(schema.catalogJobs)
    .values({ kind: 'revert', status: 'running', stores: job.stores, fileName: job.fileName, options: {}, progress: { phase: 'reverting', done: 0, total: 0 }, parentId: importId, ...actor(p), startedAt: new Date() })
    .returning({ id: schema.catalogJobs.id });
  kick(rev.id);
  return rev.id;
}

export async function cancelJob(p: Principal, id: string) {
  mustImport(p);
  const job = await getJob(p, id);
  if (!job) throw new RelayError('not_found', 'Job not found.');
  if (['done', 'failed', 'cancelled'].includes(job.status)) return;
  await save(id, { status: 'cancelled', finishedAt: new Date(), note: `Stopped by ${p.name}.` });
}

// ── Running ──

/** Files of jobs older than a month are dropped: an export is downloaded the day it is made, and the free database is small. */
async function prune() {
  const db = await getDb();
  await db.execute(sql`delete from catalog_files where created_at < now() - interval '30 days'`);
}

function kick(id: string) {
  keepAlive(runJob(id));
}

/** Called by every poll: a job whose server stopped (no heartbeat for a minute) is taken up again. */
export async function pump(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  const stale = await db
    .select({ id: schema.catalogJobs.id })
    .from(schema.catalogJobs)
    .where(and(inArray(schema.catalogJobs.id, ids), inArray(schema.catalogJobs.status, ACTIVE), or(isNull(schema.catalogJobs.heartbeatAt), lt(schema.catalogJobs.heartbeatAt, new Date(Date.now() - STALE_MS)))));
  for (const j of stale) kick(j.id);
}

async function claim(id: string) {
  if (running.has(id)) return false;
  const db = await getDb();
  const got = await db
    .update(schema.catalogJobs)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(schema.catalogJobs.id, id), inArray(schema.catalogJobs.status, ACTIVE), or(isNull(schema.catalogJobs.heartbeatAt), lt(schema.catalogJobs.heartbeatAt, new Date(Date.now() - STALE_MS)))))
    .returning({ id: schema.catalogJobs.id });
  if (!got.length) return false;
  running.add(id);
  return true;
}

export async function runJob(id: string) {
  if (!(await claim(id))) return;
  try {
    const job = await load(id);
    if (!job) return;
    const t0 = Date.now();
    if (job.kind === 'import' && job.status === 'analysing') await analyse(job);
    else if (job.kind === 'import' && job.status === 'running') await write(job);
    else if (job.kind === 'export') await runExport(job);
    else if (job.kind === 'revert') await runRevert(job);
    console.info(`[relay] catalogue ${job.kind} ${id.slice(0, 8)} (${job.status}) took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    console.error('[relay] catalogue job failed', id, e instanceof Error ? e.message : e);
    await save(id, { status: 'failed', finishedAt: new Date(), note: e instanceof Error ? e.message.slice(0, 500) : 'The job stopped.' });
  } finally {
    running.delete(id);
  }
}

const cancelled = async (id: string) => (await load(id))?.status === 'cancelled';

function readFile(grid: string[][], job: Row, stores: CatalogStore[]) {
  const opts = job.options as unknown as ImportJobOptions;
  const mapping = mapHeader(grid[0], storeKeys(stores)).map((m) => {
    const pick = opts.mapping?.[m.index];
    return pick && pick !== pickOf(m.ref) ? { ...m, ref: refFromPick(pick), how: 'alias' as const, problem: undefined } : m;
  });
  const notes: string[] = [];
  // a Title or Body column written in Arabic is the Arabic site's text, not the English one
  const arabic = (i: number) => {
    const vals = grid.slice(1, 61).map((r) => (r[i] ?? '').trim()).filter(Boolean);
    return vals.length > 0 && vals.filter((v) => /[\u0600-\u06ff]/.test(v)).length / vals.length > 0.6;
  };
  for (const m of mapping) {
    if (m.ref.kind !== 'field' || m.ref.store || (m.ref.key !== 'title' && m.ref.key !== 'bodyHtml') || opts.mapping?.[m.index]) continue;
    if (!arabic(m.index)) continue;
    const to = m.ref.key === 'title' ? 'titleAr' : 'bodyHtmlAr';
    if (mapping.some((x) => x.ref.kind === 'field' && x.ref.key === to)) continue;
    m.ref = { kind: 'field', key: to };
    m.how = 'alias';
    notes.push(`“${m.header}” is written in Arabic: read as the Arabic ${to === 'titleAr' ? 'title' : 'description'}.`);
  }
  // the teams' own sheets list a style once and its colours under it; the websites list each colour as its own product
  const hasKey = mapping.some((m) => m.ref.kind === 'field' && (m.ref.key === 'handle' || m.ref.key === 'id'));
  const colour = mapping.some((m) => m.ref.kind === 'option' && m.ref.name === 'Colour');
  const splitColours = !hasKey && colour;
  if (splitColours) notes.push('No handles and a Colour column: one product per colour, as the websites list them (“Title - Colour”, sizes as variants, a color: tag).');
  const products = parseProducts(grid, mapping, { emptyClears: opts.emptyClears, splitColours });
  return { opts, mapping, products, notes };
}

/**
 * A product the file names only by title (no handle, no ID) is looked for in the store by its barcodes, so a
 * sheet of existing styles updates them instead of listing them twice. Returns the notes for the review.
 */
async function matchByBarcode(c: ChannelDef, products: FileProduct[]) {
  const loose = products.filter((fp) => fp.handleMade && !fp.id && fp.variants.some((v) => v.barcode));
  if (!loose.length) return 0;
  const taken = await barcodesInStore(c, loose.flatMap((fp) => fp.variants.flatMap((v) => (v.barcode ? [v.barcode] : []))));
  let found = 0;
  for (const fp of loose) {
    const owners = new Set(fp.variants.flatMap((v) => (v.barcode && taken.get(v.barcode) ? [taken.get(v.barcode)!.productId] : [])));
    if (owners.size !== 1) continue;
    const [id] = [...owners];
    fp.id = id;
    const hit = [...taken.values()].find((x) => x.productId === id)!;
    fp.handle = hit.handle;
    fp.matched = `Found in ${c.name} by barcode as “${hit.handle}”: updated, not listed again.`;
    found++;
  }
  return found;
}

const metafieldKeys = (products: FileProduct[]) => ({
  product: [...new Set(products.flatMap((p) => p.metafields.map((m) => `${m.namespace}.${m.key}`)))],
  variant: [...new Set(products.flatMap((p) => p.variants.flatMap((v) => v.metafields.map((m) => `${m.namespace}.${m.key}`))))],
});

const refOf = (fp: FileProduct) => (fp.id ? { id: fp.id } : { handle: fp.handle });
const existingFor = (found: Map<string, unknown>, fp: FileProduct) => (found.get(fp.id ? `id:${fp.id}` : `h:${fp.handle.toLowerCase()}`) ?? null) as Parameters<typeof planProduct>[1];

/** A brand-limited person imports only their brands' products. */
function brandBlock(p: Principal, fp: FileProduct, existingVendor?: string) {
  if (!p.brands?.length) return null;
  const vendor = fp.vendor ?? existingVendor;
  return vendor && seesBrands(p, [vendor]) ? null : `${vendor || 'No vendor'} is not one of your brands.`;
}

async function principalOf(job: Row): Promise<Principal> {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, job.createdBy ?? ''));
  return { id: u?.id ?? '', name: u?.name ?? job.createdByName ?? '', role: (u?.role ?? 'viewer') as Principal['role'], scopes: (u?.scopes ?? {}) as Principal['scopes'], channels: u?.channels ?? [], brands: u?.brands ?? [] };
}

/** The dry run: every product against every chosen store, what would change, and the checks. */
async function analyse(job: Row) {
  const grid = await sourceGrid(job.id);
  const who = await principalOf(job);
  const all = catalogStores({ channels: [] });
  const { opts, mapping, products, notes } = readFile(grid, job, all);
  if (!products.length) throw new Error('No products found: the file needs a Handle, an ID or a Title column with values.');
  const arabicColumns = mapping.some((m) => m.ref.kind === 'field' && (m.ref.key === 'titleAr' || m.ref.key === 'bodyHtmlAr'));
  const plan: ImportPlan = {
    format: sheetFormat(mapping),
    header: grid[0],
    mapping,
    sample: grid.slice(1, 4),
    rows: grid.length - 1,
    products: products.length,
    stores: {},
    checks: { images: { checked: 0, broken: [] }, barcodes: 0 },
    notes,
  };
  const total = products.length * job.stores.length;
  let done = 0;
  const keys = metafieldKeys(products);
  for (const sid of job.stores) {
    const c = CHANNEL[sid];
    const items: PlanItem[] = [];
    let blocked: string | null = null;
    if (!c || !channelConfigured(c)) blocked = 'Not connected.';
    else if (!catalogWritable(c)) blocked = `${c.name} is connected read-only: a dry run only. Switch imports on for it to write.`;
    else {
      try {
        const access = await catalogAccess(c);
        if (!access.write) blocked = `The app on ${c.name} cannot write products (it needs ${access.missing.join(', ')}). A dry run only.`;
      } catch (e) {
        blocked = `Could not reach ${c.name}: ${e instanceof Error ? e.message : e}`;
      }
    }
    if (c && channelConfigured(c)) {
      const ctx = await storeCtx(c);
      // each store matches on its own: a fresh copy of the products per store
      const mine = structuredClone(products);
      const byBarcode = await matchByBarcode(c, mine).catch(() => 0);
      if (byBarcode) notes.push(`${byBarcode} product${byBarcode === 1 ? '' : 's'} with no handle found in ${c.name} by barcode.`);
      const storeKeys = { ...keys, arabic: arabicColumns && Boolean(ctx.rules.arabic) };
      for (let i = 0; i < mine.length; i += 25) {
        if (await cancelled(job.id)) return;
        const batch = mine.slice(i, i + 25);
        const found = await catalogFetch(c, batch.map(refOf), storeKeys);
        for (const fp of batch) {
          const existing = existingFor(found, fp);
          const r = planProduct(fp, existing, ctx, opts);
          if (fp.matched) r.item.issues.unshift({ level: 'info', code: 'matched', message: fp.matched });
          const block = brandBlock(who, fp, existing?.vendor);
          if (block) items.push({ ...r.item, action: 'error', issues: [...r.item.issues, { level: 'error', code: 'brand', message: block }] });
          else items.push(r.item);
        }
        done += batch.length;
        await save(job.id, { progress: { phase: 'checking', done, total, message: `Comparing with ${c.name}` } });
      }
      // a new variant whose barcode another product already has
      const fresh = mine.filter((fp) => items.find((x) => x.key === fp.key)?.action !== 'error');
      const barcodes = fresh.flatMap((fp) => fp.variants.flatMap((v) => (v.barcode ? [{ fp, barcode: v.barcode }] : [])));
      if (barcodes.length) {
        try {
          const taken = await barcodesInStore(c, barcodes.map((b) => b.barcode));
          plan.checks.barcodes += barcodes.length;
          for (const { fp, barcode } of barcodes) {
            const other = taken.get(barcode);
            const item = items.find((x) => x.key === fp.key);
            if (other && item && other.productId !== item.productId && other.handle.toLowerCase() !== fp.handle.toLowerCase()) {
              item.issues.push({ level: 'warning', code: 'barcode-taken', message: `Barcode ${barcode} is already on “${other.title}” (${other.handle}) in ${c.name}: the same piece would be listed twice.` });
            }
          }
        } catch {
          // the check is a help, not a gate
        }
      }
    }
    plan.stores[sid] = { items, tally: tally(items), blocked };
  }
  // photos that will not download
  const sources = [...new Set(products.flatMap((fp) => [...fp.images.map((i) => i.src), ...fp.variants.flatMap((v) => (v.image ? [v.image] : []))]).filter((s) => /^https?:\/\//i.test(s)))];
  await save(job.id, { progress: { phase: 'images', done: 0, total: Math.min(sources.length, 80), message: 'Checking photo links' } });
  const sample = sources.filter((s) => !/cdn\.shopify\.com/i.test(s)).slice(0, 80);
  const broken = await checkImages(sample);
  plan.checks.images = { checked: sample.length, broken };
  if (broken.length) {
    for (const sp of Object.values(plan.stores)) {
      for (const item of sp.items) {
        const fp = products.find((x) => x.key === item.key);
        const bad = broken.filter((b) => fp?.images.some((i) => i.src === b.src) || fp?.variants.some((v) => v.image === b.src));
        for (const b of bad) item.issues.push({ level: 'warning', code: 'image-broken', message: `Photo ${b.src.slice(0, 80)} does not open (${b.why}): Shopify will reject it.` });
      }
      sp.tally = tally(sp.items);
    }
  }
  await save(job.id, { status: 'ready', plan: plan as unknown as Record<string, unknown>, progress: { phase: 'ready', done: total, total }, finishedAt: null });
}

async function checkImages(urls: string[]) {
  const broken: { src: string; why: string }[] = [];
  let next = 0;
  const one = async () => {
    while (next < urls.length) {
      const src = urls[next++];
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        let res = await fetch(src, { method: 'HEAD', signal: ctl.signal, redirect: 'follow' });
        if (res.status === 405 || res.status === 403) res = await fetch(src, { method: 'GET', headers: { range: 'bytes=0-0' }, signal: ctl.signal, redirect: 'follow' });
        clearTimeout(t);
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok && res.status !== 206) broken.push({ src, why: `HTTP ${res.status}` });
        else if (type && !/^image\//i.test(type) && !/octet-stream/i.test(type)) broken.push({ src, why: `not a picture (${type.split(';')[0]})` });
      } catch (e) {
        broken.push({ src, why: e instanceof Error && e.name === 'AbortError' ? 'no answer in 6 s' : 'cannot be reached' });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, one));
  return broken;
}

/** The import itself: fresh from each store, product by product, skipping what an earlier pass already did. */
async function write(job: Row) {
  const grid = await sourceGrid(job.id);
  const who = await principalOf(job);
  const all = catalogStores({ channels: [] });
  const { opts, mapping, products: parsed } = readFile(grid, job, all);
  const plan = job.plan as unknown as ImportPlan | null;
  const arabicColumns = mapping.some((m) => m.ref.kind === 'field' && (m.ref.key === 'titleAr' || m.ref.key === 'bodyHtmlAr'));
  const stores = job.stores.filter((s) => !plan?.stores[s]?.blocked && CHANNEL[s] && catalogWritable(CHANNEL[s]));
  const results = [...((job.results as JobResult[]) ?? [])];
  const done = new Set(results.map((r) => `${r.store}|${r.key}`));
  const total = parsed.length * stores.length;
  const perStore: NonNullable<JobProgress['perStore']> = Object.fromEntries(stores.map((s) => [s, { done: 0, ok: 0, failed: 0, skipped: 0, total: parsed.length }]));
  for (const r of results) {
    const ps = perStore[r.store];
    if (!ps) continue;
    ps.done++;
    ps[r.result === 'ok' ? 'ok' : r.result === 'failed' ? 'failed' : 'skipped']++;
  }
  const keys = metafieldKeys(parsed);
  const progress = (message: string) => ({ phase: 'writing', done: results.length, total, message, perStore });
  for (const sid of stores) {
    const c = CHANNEL[sid];
    const ctx = await storeCtx(c);
    const products = structuredClone(parsed);
    await matchByBarcode(c, products).catch(() => 0);
    const storeKeys = { ...keys, arabic: arabicColumns && Boolean(ctx.rules.arabic) };
    for (let i = 0; i < products.length; i += 5) {
      const batch = products.slice(i, i + 5).filter((fp) => !done.has(`${sid}|${fp.key}`));
      if (!batch.length) continue;
      if (await cancelled(job.id)) return;
      const found = await catalogFetch(c, batch.map(refOf), storeKeys);
      for (const fp of batch) {
        const existing = existingFor(found, fp);
        const { item, write } = planProduct(fp, existing, ctx, opts);
        const block = brandBlock(who, fp, existing?.vendor);
        const base = { key: fp.key, handle: item.handle, title: item.title, store: sid, action: item.action, lines: fp.lines, at: new Date().toISOString() };
        let r: JobResult;
        if (block) r = { ...base, action: 'error', result: 'failed', message: block };
        else if (item.action === 'error') r = { ...base, result: 'failed', message: item.issues.filter((x) => x.level === 'error').map((x) => x.message).join(' ') };
        else if (!write) r = { ...base, result: 'skipped', message: item.action === 'unchanged' ? 'Already as the file says.' : item.issues.map((x) => x.message).join(' ') || 'Skipped.', productId: item.productId };
        else {
          try {
            const saved = await catalogSave(c, write);
            const what = item.changes.slice(0, 6).map((x) => x.label).join(', ');
            r = { ...base, result: 'ok', productId: saved.productId, handle: saved.handle || item.handle, message: [item.action === 'create' ? 'Created' : item.action === 'update' ? `Updated: ${what}${item.changes.length > 6 ? '…' : ''}` : item.action === 'archive' ? 'Archived' : 'Deleted', ...saved.notes].join(' · '), before: write.before };
          } catch (e) {
            r = { ...base, result: 'failed', message: e instanceof Error ? e.message.replace(/^Shopify refused productSet: /, '') : 'Shopify refused it.' };
          }
        }
        results.push(r);
        done.add(`${sid}|${fp.key}`);
        const ps = perStore[sid];
        ps.done++;
        ps[r.result === 'ok' ? 'ok' : r.result === 'failed' ? 'failed' : 'skipped']++;
        await save(job.id, { results, progress: progress(`${c.name}: ${item.title}`) });
      }
    }
  }
  const failed = results.filter((r) => r.result === 'failed').length;
  await save(job.id, { status: 'done', finishedAt: new Date(), results, progress: { ...progress('Finished'), phase: 'done' }, note: failed ? `${failed} product${failed === 1 ? '' : 's'} failed: see the results.` : null });
}

function exportQuery(o: ExportJobOptions) {
  const parts: string[] = [];
  if (o.status.length && o.status.length < 3) parts.push(`(${o.status.map((s) => `status:${s}`).join(' OR ')})`);
  if (o.vendor) parts.push(`vendor:${JSON.stringify(o.vendor)}`);
  if (o.tag) parts.push(`tag:${JSON.stringify(o.tag)}`);
  if (o.type) parts.push(`product_type:${JSON.stringify(o.type)}`);
  if (o.updatedSince) parts.push(`updated_at:>=${o.updatedSince}`);
  if (o.query) parts.push(o.query);
  return parts.join(' AND ');
}

async function runExport(job: Row) {
  const c = CHANNEL[job.stores[0]];
  if (!c || !channelConfigured(c)) throw new Error('The store is not connected.');
  const o = job.options as unknown as ExportJobOptions;
  let polls = 0;
  const conv = await storeConventions(c).catch(() => ({ arabic: false, vendors: [] as string[] }));
  const progress0 = (job.progress ?? {}) as JobProgress & { bulkId?: string };
  const products = await catalogExport(c, { query: exportQuery(o), metafields: o.metafields, arabic: conv.arabic && o.groups.includes('arabic'), bulkId: progress0.bulkId, started: (bulkId) => save(job.id, { progress: { phase: 'exporting', done: 0, total: 0, message: 'Shopify is preparing the export', bulkId } }) }, (m) => {
    polls++;
    void save(job.id, { progress: { phase: 'exporting', done: polls, total: 0, message: m.trim(), bulkId: progress0.bulkId } });
  });
  if (await cancelled(job.id)) return;
  await save(job.id, { progress: { phase: 'building', done: products.length, total: products.length, message: `Writing ${products.length.toLocaleString('en')} products` } });
  const sheet = productsSheet(products, { groups: o.groups, name: 'Products' });
  const name = sheetFileName(`${c.name}-products${o.vendor ? `-${o.vendor}` : ''}`, o.format);
  const bytes = o.format === 'csv' ? new TextEncoder().encode(`﻿${toCsv(sheet)}`) : toXlsx([sheet], (b) => deflateRawSync(b));
  const db = await getDb();
  await db.insert(schema.catalogFiles).values({ jobId: job.id, role: 'export', name, mime: o.format === 'csv' ? 'text/csv; charset=utf-8' : XLSX_TYPE, data: Buffer.from(bytes).toString('base64'), bytes: bytes.length });
  const counts = { products: products.length, variants: products.reduce((a, p) => a + p.variants.length, 0), images: products.reduce((a, p) => a + p.images.length, 0), rows: sheet.rows.length };
  await save(job.id, { status: 'done', fileName: name, finishedAt: new Date(), progress: { phase: 'done', done: products.length, total: products.length, counts } });
}

async function runRevert(job: Row) {
  const parent = await load(job.parentId ?? '');
  if (!parent) throw new Error('The import it undoes is gone.');
  const todo = (parent.results as JobResult[]).filter((r) => r.result === 'ok' && r.productId && (r.action === 'create' || r.before));
  const results = [...((job.results as JobResult[]) ?? [])];
  const done = new Set(results.map((r) => `${r.store}|${r.key}`));
  const total = todo.length;
  for (const r of todo) {
    if (done.has(`${r.store}|${r.key}`)) continue;
    if (await cancelled(job.id)) return;
    const c = CHANNEL[r.store];
    const base = { key: r.key, handle: r.handle, title: r.title, store: r.store, lines: r.lines, at: new Date().toISOString(), productId: r.productId };
    let out: JobResult;
    try {
      if (!c || !catalogWritable(c)) throw new Error('The store cannot be written now.');
      if (r.action === 'create') {
        await catalogSave(c, { kind: 'archive', productId: r.productId, metafields: [], stock: [], publish: null, before: null });
        out = { ...base, action: 'archive', result: 'ok', message: 'Created by the import: archived.' };
      } else if (r.action === 'delete') {
        out = { ...base, action: 'skip', result: 'skipped', message: 'Deleted products cannot come back.' };
      } else {
        const found = await catalogFetch(c, [{ id: r.productId }]);
        const now = found.get(`id:${r.productId}`);
        if (!now) throw new Error('No longer in the store.');
        await catalogSave(c, revertWrite(r.before!, now));
        out = { ...base, action: 'update', result: 'ok', message: 'Back to how it was before the import.' };
      }
    } catch (e) {
      out = { ...base, action: 'update', result: 'failed', message: e instanceof Error ? e.message : 'Could not be reverted.' };
    }
    results.push(out);
    await save(job.id, { results, progress: { phase: 'reverting', done: results.length, total, message: r.title } });
  }
  const failed = results.filter((x) => x.result === 'failed').length;
  await save(job.id, { status: 'done', finishedAt: new Date(), results, progress: { phase: 'done', done: results.length, total }, note: failed ? `${failed} could not be reverted: see the results.` : null });
  const db = await getDb();
  await db
    .update(schema.catalogJobs)
    .set({ note: sql`coalesce(${schema.catalogJobs.note} || ' · ', '') || ${'Reverted'}` })
    .where(eq(schema.catalogJobs.id, parent.id));
}

/** The plan for the review screen: one store's items, filtered and paged. */
export function planPage(plan: ImportPlan, store: string, f: { action?: string; issue?: string; q?: string; page?: number }) {
  const sp = plan.stores[store];
  if (!sp) return { items: [] as PlanItem[], total: 0, pages: 1 };
  let items = sp.items;
  if (f.action) items = items.filter((i) => (f.action === 'warning' ? i.issues.some((x) => x.level === 'warning') : i.action === f.action));
  if (f.issue) items = items.filter((i) => i.issues.some((x) => x.code === f.issue));
  if (f.q) {
    const q = f.q.toLowerCase();
    items = items.filter((i) => i.handle.includes(q) || i.title.toLowerCase().includes(q));
  }
  const per = 40;
  const pages = Math.max(1, Math.ceil(items.length / per));
  const page = Math.min(pages, Math.max(1, f.page ?? 1));
  return { items: items.slice((page - 1) * per, page * per), total: items.length, pages, page };
}

/** The issues of a plan, grouped by kind, with how many products each touches. */
export function issueGroups(plan: ImportPlan, store: string) {
  const groups = new Map<string, { code: string; level: 'error' | 'warning' | 'info'; example: string; count: number }>();
  for (const item of plan.stores[store]?.items ?? []) {
    const seen = new Set<string>();
    for (const x of item.issues) {
      if (seen.has(x.code)) continue;
      seen.add(x.code);
      const g = groups.get(x.code) ?? { code: x.code, level: x.level, example: x.message, count: 0 };
      g.count++;
      groups.set(x.code, g);
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return [...groups.values()].sort((a, b) => rank[a.level] - rank[b.level] || b.count - a.count);
}
