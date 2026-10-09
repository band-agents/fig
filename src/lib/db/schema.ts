import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { Scopes } from '../domain/perms';

const id = () => text('id').primaryKey().default(sql`gen_random_uuid()::text`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' }); // minor units (piastres, fils)

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  title: text('title'),
  passwordHash: text('password_hash'),
  role: text('role').notNull(),
  scopes: jsonb('scopes').$type<Scopes>().notNull(),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  hue: integer('hue').notNull().default(200),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastSeenAt: ts('last_seen_at'),
  invitedBy: text('invited_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
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
