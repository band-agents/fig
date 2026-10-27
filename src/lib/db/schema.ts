import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { ReturnReview } from '../domain/return-review';
import type { Costs, Inspection, Payment, Step } from '../domain/production';
import type { Scopes } from '../domain/perms';
import type { ChannelDef } from '../channels';

const id = () => text('id').primaryKey().default(sql`gen_random_uuid()::text`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' }); // minor units (piastres, fils)

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  title: text('title'),
  passwordHash: text('password_hash'),
  // set with a temporary password: they choose their own before anything else opens
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  role: text('role').notNull(),
  scopes: jsonb('scopes').$type<Scopes>().notNull(),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  brands: jsonb('brands').$type<string[]>().notNull().default([]), // empty = every brand
  active: boolean('active').notNull().default(true),
  hue: integer('hue').notNull().default(200),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastSeenAt: ts('last_seen_at'),
  invitedBy: text('invited_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  // Where and when this person works, for the warehouse and buying boards: the shift is minutes
  // after local midnight, rest days are 0 = Sunday … 6 = Saturday.
  locationId: text('location_id'),
  shiftStart: integer('shift_start'),
  shiftEnd: integer('shift_end'),
  restDays: jsonb('rest_days').$type<number[]>().notNull().default([5]),
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 of the cookie token
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  userAgent: text('user_agent'),
});

export const invitations = pgTable('invitations', {
  id: id(),
  email: text('email').notNull(),
  name: text('name'),
  role: text('role').notNull(),
  scopes: jsonb('scopes').$type<Scopes>().notNull(),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  brands: jsonb('brands').$type<string[]>().notNull().default([]),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: text('invited_by').notNull(),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const channels = pgTable('channels', {
  id: text('id').primaryKey(),
  mode: text('mode').notNull().default('demo'), // live | demo | off
  lastSyncAt: ts('last_sync_at'),
  lastSyncOk: boolean('last_sync_ok'),
  lastSyncNote: text('last_sync_note'),
  cursor: text('cursor'), // updated_at high-water mark
  lastWebhookAt: ts('last_webhook_at'),
  // A storefront added from the console rather than shipped in channels.ts: its whole definition.
  // Credentials still live in the server environment under RELAY_<PREFIX>_*.
  custom: boolean('custom').notNull().default(false),
  config: jsonb('config').$type<ChannelDef>(),
  createdAt: ts('created_at').defaultNow(),
});

export const customers = pgTable(
  'customers',
  {
    id: id(),
    phone: text('phone'), // E.164; the cross-store identity
    email: text('email'),
    name: text('name').notNull(),
    city: text('city'),
    region: text('region'), // governorate / Kuwaiti area
    country: text('country').notNull(),
    orders: integer('orders').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    refused: integer('refused').notNull().default(0),
    returned: integer('returned').notNull().default(0),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    vip: boolean('vip').notNull().default(false),
  },
  (t) => [index('customers_phone').on(t.phone), index('customers_email').on(t.email)],
);

export type Address = { name?: string; line1: string; line2?: string; area?: string; city: string; region?: string; country: string; notes?: string; phone?: string };
export type RiskReason = { code: string; label: string; weight: number };

export const orders = pgTable(
  'orders',
  {
    id: id(),
    channelId: text('channel_id').notNull(),
    externalId: text('external_id').notNull(),
    number: text('number').notNull(),
    source: text('source').notNull().default('demo'), // shopify | medusa | woo | demo
    placedAt: ts('placed_at').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    phone: text('phone'),
    email: text('email'),
    address: jsonb('address').$type<Address>(),
    currency: text('currency').notNull(),
    subtotal: money('subtotal').notNull(),
    shipping: money('shipping').notNull().default(0),
    discount: money('discount').notNull().default(0),
    total: money('total').notNull(),
    paymentMethod: text('payment_method').notNull(), // cod | card | wallet | knet | instapay | store_credit
    paymentStatus: text('payment_status').notNull(), // pending | paid | cod_due | cod_collected | refunded | partially_refunded | voided
    stage: text('stage').notNull(),
    stageAt: ts('stage_at').notNull(),
    dueAt: ts('due_at'), // SLA deadline for leaving the current stage
    onHold: boolean('on_hold').notNull().default(false),
    holdReason: text('hold_reason'),
    exception: text('exception'), // live courier problem: "Customer unreachable (2nd attempt)"
    risk: integer('risk').notNull().default(0),
    riskLevel: text('risk_level').notNull().default('low'),
    riskReasons: jsonb('risk_reasons').$type<RiskReason[]>().notNull().default([]),
    autopilot: jsonb('autopilot').$type<string[]>().notNull().default([]), // stages autopilot cleared
    assigneeId: text('assignee_id'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    items: integer('items').notNull().default(0),
    courier: text('courier'),
    tracking: text('tracking'),
    trackingUrl: text('tracking_url'),
    attempts: integer('attempts').notNull().default(0),
    settlementId: text('settlement_id'),
    note: text('note'), // the customer's own order note
    confirmedAt: ts('confirmed_at'),
    approvedAt: ts('approved_at'),
    packedAt: ts('packed_at'),
    shippedAt: ts('shipped_at'),
    deliveredAt: ts('delivered_at'),
    closedAt: ts('closed_at'),
    cancelReason: text('cancel_reason'),
    // The branch the parcel leaves from: a Lucida store code (or one of our locations), who set it and when.
    shipFrom: text('ship_from'),
    shipFromName: text('ship_from_name'),
    shipFromBy: text('ship_from_by'),
    shipFromAt: ts('ship_from_at'),
    syncedAt: ts('synced_at'),
    writeBack: jsonb('write_back').$type<Record<string, string>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_channel_ext').on(t.channelId, t.externalId),
    index('orders_stage').on(t.stage),
    index('orders_placed').on(t.placedAt),
    index('orders_customer').on(t.customerId),
    index('orders_number').on(t.number),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    sku: text('sku'),
    barcode: text('barcode'),
    title: text('title').notNull(),
    variant: text('variant'),
    size: text('size'),
    brand: text('brand'),
    category: text('category'),
    image: text('image'),
    quantity: integer('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
    picked: integer('picked').notNull().default(0),
    returnable: boolean('returnable').notNull().default(true),
    stockHint: integer('stock_hint'), // last known units on hand (Lucida / Shopify)
  },
  (t) => [index('items_order').on(t.orderId), index('items_sku').on(t.sku)],
);

export const returns = pgTable(
  'returns',
  {
    id: id(),
    number: text('number').notNull().unique(),
    orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    customerId: text('customer_id'),
    requestedAt: ts('requested_at').notNull(),
    stage: text('stage').notNull(),
    stageAt: ts('stage_at').notNull(),
    dueAt: ts('due_at'),
    reason: text('reason').notNull(),
    reasonNote: text('reason_note'),
    resolution: text('resolution').notNull().default('refund'), // refund | exchange | credit
    method: text('method').notNull().default('pickup'), // pickup | store
    // Where the money goes: original | store_credit | cash_at_store. Decided by refund-methods.ts
    // from how the order was paid, never taken from the request.
    refundMethod: text('refund_method').notNull().default('original'),
    currency: text('currency').notNull(),
    amount: money('amount').notNull(),
    // The extra paid for taking store credit, included in `amount`. Held separately so finance can
    // see what the bonus cost and so an order settled with credit can be shown to have earned none.
    bonus: money('bonus').notNull().default(0),
    // How the customer asked: portal | app | agent. A self-service return is unreviewed until
    // customer care looks at it, and the queue should show which is which.
    openedVia: text('opened_via').notNull().default('agent'),
    // The shop the customer is bringing it to, or collecting cash from, as an id from
    // domain/branches.ts. Null when the return is collected by courier, or while a market's branch
    // list has not been handed over.
    branch: text('branch'),
    // What the desk recorded when it approved or declined, for the refund team (domain/return-review.ts).
    review: jsonb('review').$type<ReturnReview>(),
    inspection: text('inspection'), // pass | damaged | wrong_item | partial
    restocked: boolean('restocked').notNull().default(false),
    tracking: text('tracking'),
    assigneeId: text('assignee_id'),
    closedAt: ts('closed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('returns_stage').on(t.stage), index('returns_order').on(t.orderId)],
);

export const returnItems = pgTable('return_items', {
  id: id(),
  returnId: text('return_id').notNull().references(() => returns.id, { onDelete: 'cascade' }),
  orderItemId: text('order_item_id').notNull(),
  quantity: integer('quantity').notNull(),
  reason: text('reason'),
  condition: text('condition'),
});

/**
 * The photographs a customer attaches when they ask to send something back.
 *
 * Required, and the reason is the desk's: a picture of what actually arrived settles "too small"
 * from "arrived damaged" before anyone drives out to collect it, and it is the only evidence that
 * survives the parcel. They are held as bytes rather than as links to somewhere else so that a
 * return is complete in one database and nothing expires behind it. The portal shrinks each one in
 * the browser first, so what lands here is a few hundred kilobytes, not a phone's full frame.
 */
export const returnPhotos = pgTable(
  'return_photos',
  {
    id: id(),
    returnId: text('return_id').notNull().references(() => returns.id, { onDelete: 'cascade' }),
    mime: text('mime').notNull(),
    bytes: text('bytes').notNull(), // base64; PGlite and Postgres both carry it without fuss
    size: integer('size').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('return_photos_return').on(t.returnId)],
);

export const events = pgTable(
  'events',
  {
    id: id(),
    at: ts('at').notNull().defaultNow(),
    orderId: text('order_id'),
    returnId: text('return_id'),
    actorId: text('actor_id'),
    actorName: text('actor_name').notNull(), // "Relay Autopilot", "Aramex", "Salma (Customer care)"
    dept: text('dept'),
    kind: text('kind').notNull(), // stage | note | call | payment | courier | hold | assign | risk | sync | system
    fromStage: text('from_stage'),
    toStage: text('to_stage'),
    message: text('message').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
  },
  (t) => [index('events_order').on(t.orderId, t.at), index('events_return').on(t.returnId), index('events_at').on(t.at)],
);

export const settlements = pgTable('settlements', {
  id: id(),
  reference: text('reference').notNull().unique(),
  courier: text('courier').notNull(),
  currency: text('currency').notNull(),
  periodFrom: ts('period_from').notNull(),
  periodTo: ts('period_to').notNull(),
  expected: money('expected').notNull(),
  remitted: money('remitted'),
  orderCount: integer('order_count').notNull(),
  status: text('status').notNull().default('pending'), // pending | matched | discrepancy
  createdAt: ts('created_at').notNull().defaultNow(),
  matchedAt: ts('matched_at'),
});

export const syncRuns = pgTable('sync_runs', {
  id: id(),
  channelId: text('channel_id').notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  ok: boolean('ok'),
  fetched: integer('fetched').notNull().default(0),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  note: text('note'),
});

// ── Catalogue import & export (Dan, 27 Oct: Matrixify inside the console) ──────────────────────

/**
 * One import or export against the websites' Shopify stores. An import is read and checked first (a dry
 * run: `plan` holds what each store would get), runs only when someone presses Run, and keeps each
 * product's result and what it was before (`results`), so it can be reverted. Work continues in the
 * background; `heartbeatAt` lets the next poll pick up a run whose server stopped.
 */
export const catalogJobs = pgTable(
  'catalog_jobs',
  {
    id: id(),
    kind: text('kind').notNull(), // import | export | revert
    status: text('status').notNull(), // queued | analysing | ready | running | done | failed | cancelled
    stores: jsonb('stores').$type<string[]>().notNull().default([]), // channel ids
    fileName: text('file_name'),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    plan: jsonb('plan').$type<Record<string, unknown> | null>(),
    progress: jsonb('progress').$type<Record<string, unknown>>().notNull().default({}),
    results: jsonb('results').$type<unknown[]>().notNull().default([]),
    note: text('note'),
    parentId: text('parent_id'), // a revert points at the import it undoes; an import made from an export at that export
    createdBy: text('created_by'),
    createdByName: text('created_by_name'),
    createdAt: ts('created_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    heartbeatAt: ts('heartbeat_at'),
  },
  (t) => [index('catalog_jobs_created').on(t.createdAt)],
);

/** A job's files: the products read from an upload, or an export's workbook (base64), kept apart so the job list stays light. */
export const catalogFiles = pgTable(
  'catalog_files',
  {
    id: id(),
    jobId: text('job_id').notNull(),
    role: text('role').notNull(), // source (the parsed upload, JSON) | export (xlsx/csv, base64)
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    data: text('data').notNull(),
    bytes: integer('bytes').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('catalog_files_job').on(t.jobId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

export const dismissals = pgTable('dismissals', {
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  at: ts('at').notNull().defaultNow(),
}, (t) => [uniqueIndex('dismissals_pk').on(t.userId, t.key)]);

export const stockConflicts = pgTable('stock_signals', {
  id: id(),
  sku: text('sku').notNull(),
  title: text('title'),
  onHand: integer('on_hand'),
  demand: integer('demand').notNull(),
  channels: jsonb('channels').$type<string[]>().notNull(),
  seenAt: ts('seen_at').notNull().defaultNow(),
});

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Return = typeof returns.$inferSelect;
export type ReturnItem = typeof returnItems.$inferSelect;
export type Event = typeof events.$inferSelect;
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;

// ── Stock, buying, warehouse work and website merchandising ──────────────────────────────────────
// Every change to these goes through src/lib/stock/ops.ts, which checks access, writes the
// activity log and keeps stock_levels and stock_moves in step. Quantities are units; money is minor
// units in the row's own currency (EGP for Egypt, KWD for Kuwait).

/** Warehouses and shops. Kuwait counters are D&H's and D&Co's own; a store sells the brands listed. */
export const locations = pgTable('locations', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // warehouse | store
  name: text('name').notNull(),
  company: text('company').notNull(), // DH | DCO | FIG
  country: text('country').notNull(),
  currency: text('currency').notNull(),
  city: text('city'),
  area: text('area'), // the mall
  brands: jsonb('brands').$type<string[]>().notNull().default([]), // empty = sells everything
  phone: text('phone'),
  externalCode: text('external_code'), // the store's code in Lucida
  active: boolean('active').notNull().default(true),
  source: text('source').notNull().default('demo'), // demo | setup | lucida
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const suppliers = pgTable('suppliers', {
  id: id(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  currency: text('currency').notNull(), // what they invoice in
  brands: jsonb('brands').$type<string[]>().notNull().default([]),
  leadDays: integer('lead_days').notNull(), // promised, order to dock
  moq: integer('moq').notNull().default(0), // minimum units per style
  casePack: integer('case_pack').notNull().default(1),
  paymentTerms: text('payment_terms'),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  phone: text('phone'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  source: text('source').notNull().default('demo'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** A style in one market. Egypt and Kuwait price and stock separately, so each is its own row. */
export const products = pgTable(
  'products',
  {
    id: id(),
    market: text('market').notNull(), // EG | KW
    company: text('company').notNull(), // DH | DCO | FIG
    styleCode: text('style_code').notNull(),
    title: text('title').notNull(),
    brand: text('brand').notNull(),
    category: text('category').notNull(),
    season: text('season').notNull().default('core'), // core | AW26 | SS26 …
    image: text('image'),
    currency: text('currency').notNull(),
    price: money('price').notNull(),
    cost: money('cost').notNull(), // landed
    compareAt: money('compare_at'),
    sizes: jsonb('sizes').$type<string[]>().notNull().default([]),
    sizeMix: jsonb('size_mix').$type<Record<string, number>>().notNull().default({}),
    supplierId: text('supplier_id'),
    channels: jsonb('channels').$type<string[]>().notNull().default([]), // the websites that sell it
    handle: text('handle'),
    status: text('status').notNull().default('active'), // active | discontinued
    launchedAt: ts('launched_at').notNull(),
    source: text('source').notNull().default('demo'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('products_market_style').on(t.market, t.styleCode), index('products_brand').on(t.brand), index('products_category').on(t.category)],
);

export const variants = pgTable(
  'variants',
  {
    id: id(),
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    barcode: text('barcode'),
    size: text('size'),
    sizeIdx: integer('size_idx').notNull().default(0),
  },
  (t) => [uniqueIndex('variants_product_sku').on(t.productId, t.sku), index('variants_sku').on(t.sku), index('variants_barcode').on(t.barcode)],
);

export const stockLevels = pgTable(
  'stock_levels',
  {
    variantId: text('variant_id').notNull().references(() => variants.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    locationId: text('location_id').notNull(),
    onHand: integer('on_hand').notNull().default(0),
    bin: text('bin'),
    countedAt: ts('counted_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.locationId] }), index('stock_levels_location').on(t.locationId), index('stock_levels_product').on(t.productId)],
);

/** The ledger. stock_levels is always the sum of these, and nothing changes one without the other. */
export const stockMoves = pgTable(
  'stock_moves',
  {
    id: id(),
    at: ts('at').notNull().defaultNow(),
    variantId: text('variant_id').notNull(),
    productId: text('product_id').notNull(),
    locationId: text('location_id').notNull(),
    qty: integer('qty').notNull(), // + in, − out
    kind: text('kind').notNull(), // receive | sale | return | transfer_out | transfer_in | adjust | count | damage
    refType: text('ref_type'), // po | transfer | order | return | task
    refId: text('ref_id'),
    channelId: text('channel_id'),
    actorId: text('actor_id'),
    actorName: text('actor_name').notNull(),
    note: text('note'),
  },
  (t) => [index('stock_moves_product').on(t.productId, t.at), index('stock_moves_location').on(t.locationId, t.at), index('stock_moves_at').on(t.at)],
);

/** Units sold per style, per place, per week (weeks start on Sunday). The planner reads only this. */
export const salesWeekly = pgTable(
  'sales_weekly',
  {
    week: date('week', { mode: 'string' }).notNull(),
    productId: text('product_id').notNull(),
    locationId: text('location_id').notNull(), // a store, or the warehouse for website sales
    units: integer('units').notNull(),
    revenue: money('revenue').notNull(),
    cost: money('cost').notNull(),
    stockoutDays: integer('stockout_days').notNull().default(0), // days it could not be bought there
    markdownUnits: integer('markdown_units').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.week, t.productId, t.locationId] }), index('sales_weekly_product').on(t.productId), index('sales_weekly_week').on(t.week)],
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    number: text('number').notNull().unique(),
    supplierId: text('supplier_id').notNull(),
    locationId: text('location_id').notNull(), // where it is delivered
    company: text('company').notNull(),
    market: text('market').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(), // draft | approval | approved | sent | confirmed | partial | received | closed | cancelled
    total: money('total').notNull().default(0),
    units: integer('units').notNull().default(0),
    season: text('season'),
    source: text('source').notNull().default('manual'), // ai | manual | import
    reason: text('reason'),
    note: text('note'),
    expectedAt: ts('expected_at'),
    sentAt: ts('sent_at'),
    confirmedAt: ts('confirmed_at'),
    receivedAt: ts('received_at'),
    closedAt: ts('closed_at'),
    createdBy: text('created_by'),
    createdByName: text('created_by_name').notNull(),
    approvedBy: text('approved_by'),
    approvedByName: text('approved_by_name'),
    approvedAt: ts('approved_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('po_status').on(t.status), index('po_supplier').on(t.supplierId)],
);

export const poLines = pgTable(
  'po_lines',
  {
    id: id(),
    poId: text('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    variantId: text('variant_id').notNull(),
    qty: integer('qty').notNull(),
    received: integer('received').notNull().default(0),
    damaged: integer('damaged').notNull().default(0),
    unitCost: money('unit_cost').notNull(),
  },
  (t) => [index('po_lines_po').on(t.poId), index('po_lines_product').on(t.productId)],
);

export const transfers = pgTable('transfers', {
  id: id(),
  number: text('number').notNull().unique(),
  fromId: text('from_id').notNull(),
  toId: text('to_id').notNull(),
  status: text('status').notNull(), // proposed | picking | in_transit | received | cancelled
  units: integer('units').notNull().default(0),
  reason: text('reason'),
  source: text('source').notNull().default('manual'),
  createdBy: text('created_by'),
  createdByName: text('created_by_name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  shippedAt: ts('shipped_at'),
  receivedAt: ts('received_at'),
});

export const transferLines = pgTable(
  'transfer_lines',
  {
    id: id(),
    transferId: text('transfer_id').notNull().references(() => transfers.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    variantId: text('variant_id').notNull(),
    qty: integer('qty').notNull(),
    received: integer('received').notNull().default(0),
  },
  (t) => [index('transfer_lines_transfer').on(t.transferId)],
);

/** One piece of work for one person: receive a delivery, count a bay, chase a supplier. */
export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    number: text('number').notNull().unique(),
    kind: text('kind').notNull(),
    area: text('area').notNull(), // warehouse | procurement | merch | stock
    title: text('title').notNull(),
    detail: text('detail'),
    locationId: text('location_id'),
    assigneeId: text('assignee_id'),
    status: text('status').notNull().default('open'), // open | doing | blocked | done | cancelled
    priority: integer('priority').notNull().default(3), // 1 urgent · 2 high · 3 normal · 4 low
    dueAt: ts('due_at'),
    startedAt: ts('started_at'),
    doneAt: ts('done_at'),
    estMinutes: integer('est_minutes').notNull().default(15),
    spentMinutes: integer('spent_minutes'),
    units: integer('units').notNull().default(0),
    refType: text('ref_type'),
    refId: text('ref_id'),
    source: text('source').notNull().default('manual'), // ai | manual | system
    blockedReason: text('blocked_reason'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdBy: text('created_by'),
    createdByName: text('created_by_name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('tasks_assignee').on(t.assigneeId, t.status), index('tasks_status').on(t.status), index('tasks_done').on(t.doneAt), index('tasks_ref').on(t.refType, t.refId)],
);

export type Reason = { label: string; value?: string; tone?: 'good' | 'bad' | 'neutral' };

/** What the AI planner proposes. A person accepts or dismisses it; accepting does the work. */
export const recommendations = pgTable(
  'recommendations',
  {
    id: id(),
    key: text('key').notNull().unique(), // what it is about, so a re-run updates instead of repeating
    kind: text('kind').notNull(), // reorder | transfer | markdown | cross_sell | upsell | popup | count | stop_buying | expedite
    area: text('area').notNull(), // procurement | stock | warehouse | merch
    status: text('status').notNull().default('open'), // open | accepted | dismissed | done | expired
    market: text('market').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    reasons: jsonb('reasons').$type<Reason[]>().notNull().default([]),
    impact: money('impact').notNull().default(0), // EGP-equivalent minor units at stake
    impactLabel: text('impact_label'),
    confidence: integer('confidence').notNull().default(70), // 0–100
    priority: integer('priority').notNull().default(3),
    productId: text('product_id'),
    locationId: text('location_id'),
    supplierId: text('supplier_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    runId: text('run_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    decidedBy: text('decided_by'),
    decidedByName: text('decided_by_name'),
    decidedAt: ts('decided_at'),
    resultRef: text('result_ref'),
  },
  (t) => [index('recs_status').on(t.status, t.area), index('recs_product').on(t.productId)],
);

/** A cross-sell, upsell, pop-up or bundle shown on the websites. Served by /api/merch. */
export const placements = pgTable(
  'placements',
  {
    id: id(),
    number: text('number').notNull().unique(),
    kind: text('kind').notNull(), // cross_sell | upsell | popup | bundle
    status: text('status').notNull().default('draft'), // draft | live | paused | ended
    market: text('market').notNull(),
    channels: jsonb('channels').$type<string[]>().notNull().default([]),
    anchors: jsonb('anchors').$type<string[]>().notNull().default([]), // product pages it shows on; empty = sitewide
    items: jsonb('items').$type<string[]>().notNull().default([]), // the products it shows
    headline: text('headline').notNull(),
    headlineAr: text('headline_ar'),
    body: text('body'),
    offer: text('offer'),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    recommendationId: text('recommendation_id'),
    createdBy: text('created_by'),
    createdByName: text('created_by_name').notNull(),
    approvedBy: text('approved_by'),
    approvedByName: text('approved_by_name'),
    approvedAt: ts('approved_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('placements_status').on(t.status)],
);

export const placementDaily = pgTable(
  'placement_daily',
  {
    placementId: text('placement_id').notNull().references(() => placements.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    adds: integer('adds').notNull().default(0),
    orders: integer('orders').notNull().default(0),
    revenue: money('revenue').notNull().default(0), // EGP-equivalent minor units
  },
  (t) => [primaryKey({ columns: [t.placementId, t.day] })],
);

/** Who did what, across stock, buying, the warehouse and the websites. The manager's record. */
export const activity = pgTable(
  'activity',
  {
    id: id(),
    at: ts('at').notNull().defaultNow(),
    actorId: text('actor_id'),
    actorName: text('actor_name').notNull(),
    area: text('area').notNull(),
    kind: text('kind').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    message: text('message').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
  },
  (t) => [index('activity_at').on(t.at), index('activity_actor').on(t.actorId, t.at), index('activity_ref').on(t.refType, t.refId)],
);

/** Stock per branch for a barcode, as Lucida last reported it (BalanceByStore). Read on demand, kept so pages need no call. */
export const branchStock = pgTable(
  'branch_stock',
  {
    barcode: text('barcode').notNull(),
    account: text('account').notNull(), // the Lucida database: DH, DCO, FIG
    storeCode: text('store_code').notNull(),
    storeName: text('store_name'),
    qty: integer('qty').notNull(),
    checkedAt: ts('checked_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.barcode, t.account, t.storeCode] }), index('branch_stock_barcode').on(t.barcode)],
);

/**
 * Every size a website sells or Lucida holds for it, side by side: the website's own facts (live or
 * not, photo, description, category, price, stock) and Lucida's (defined as a web item with stock,
 * its quantity and price). One row per store and barcode, rebuilt by each comparison run.
 */
export const webItems = pgTable(
  'web_items',
  {
    channelId: text('channel_id').notNull(),
    barcode: text('barcode').notNull(),
    sku: text('sku'),
    productId: text('product_id'), // the store's product id; null for a Lucida item the store does not have
    variantId: text('variant_id'),
    handle: text('handle'),
    title: text('title'),
    brand: text('brand'),
    size: text('size'),
    productType: text('product_type'),
    status: text('status').notNull(), // active | draft | archived | absent (not on the store)
    hasPhoto: boolean('has_photo'),
    hasDescription: boolean('has_description'),
    hasCategory: boolean('has_category'),
    price: money('price'),
    compareAt: money('compare_at'),
    webQty: integer('web_qty'),
    lucidaQty: integer('lucida_qty'), // null until Lucida has been asked; 0 = asked and not reported
    lucidaPrice: money('lucida_price'),
    lucidaWas: money('lucida_was'),
    lucidaDb: text('lucida_db'),
    lucidaDesc: text('lucida_desc'),
    currency: text('currency').notNull(),
    checkedAt: ts('checked_at').notNull().defaultNow(),
    lucidaAt: ts('lucida_at'),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.barcode] }), index('web_items_status').on(t.channelId, t.status), index('web_items_brand').on(t.brand)],
);

/** The factories that make our styles for us. */
export const makers = pgTable('makers', {
  id: id(),
  name: text('name').notNull(),
  country: text('country').notNull().default('EG'),
  city: text('city'),
  contactName: text('contact_name'),
  phone: text('phone'),
  email: text('email'),
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  capacity: integer('capacity'), // pieces a month
  leadDays: integer('lead_days'), // brief to ex-factory, as they quote it
  paymentTerms: text('payment_terms'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** One style (or colourway) placed with one factory, from the brief to our warehouse (domain/production.ts). */
export const productionOrders = pgTable(
  'production_orders',
  {
    id: id(),
    number: text('number').notNull().unique(),
    makerId: text('maker_id').notNull(),
    brand: text('brand').notNull(),
    market: text('market').notNull(), // EG | KW: where it will be sold
    season: text('season'),
    styleCode: text('style_code').notNull(),
    title: text('title').notNull(),
    category: text('category'),
    colour: text('colour'),
    image: text('image'),
    sizes: jsonb('sizes').$type<Record<string, number>>().notNull().default({}),
    qty: integer('qty').notNull().default(0),
    currency: text('currency').notNull(),
    costs: jsonb('costs').$type<Costs>().notNull().default({}), // per piece, minor units
    retailPrice: money('retail_price'),
    steps: jsonb('steps').$type<Step[]>().notNull().default([]),
    stage: text('stage').notNull().default('brief'),
    status: text('status').notNull().default('open'), // open | done | cancelled
    dueAt: date('due_at', { mode: 'string' }), // the factory's promised ex-factory day
    inspections: jsonb('inspections').$type<Inspection[]>().notNull().default([]),
    payments: jsonb('payments').$type<Payment[]>().notNull().default([]),
    received: integer('received').notNull().default(0),
    rejected: integer('rejected').notNull().default(0),
    productId: text('product_id'), // the catalogue style it becomes, when there is one
    note: text('note'),
    createdBy: text('created_by'),
    createdByName: text('created_by_name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('production_status').on(t.status, t.stage), index('production_maker').on(t.makerId), index('production_brand').on(t.brand)],
);

export type Location = typeof locations.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Variant = typeof variants.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PoLine = typeof poLines.$inferSelect;
export type Transfer = typeof transfers.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
export type Placement = typeof placements.$inferSelect;
export type Maker = typeof makers.$inferSelect;
export type ProductionOrder = typeof productionOrders.$inferSelect;
export type WebItem = typeof webItems.$inferSelect;
