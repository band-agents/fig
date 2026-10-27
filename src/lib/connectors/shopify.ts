import 'server-only';
// Shopify Admin GraphQL (2025-07): pulls orders by updated_at, maps order webhooks, and, only when
// RELAY_WRITE_BACK=true (or =dry, to see without sending), writes what the console does back to the
// store: stage tags, holds, fulfilment with tracking, delivery steps, payment, cancels and refunds.
import { channelEnv, storeWriteBack, type ChannelDef } from '../channels';
import type { Connector, IncomingOrder, WriteBackChange, WriteBackResult } from './types';
import type { StoreProduct, Write } from '../catalog/plan';
import { backoff, ConnectorError, errorText, fetchRetry, sleep } from './http';
import { str } from './map-util';
import { cancelReason, holdReason, matchLines, refundTransactions, type SuggestedTransaction } from './shopify-writeback';
import {
  checkNote,
  customerDataHidden,
  LINE_FIELDS,
  mapShopifyOrder,
  mapShopifyRestOrder,
  ORDER_TOPICS,
  orderSelection,
  pagePlan,
  scopeReport,
  verifyShopifyHmac,
  type ShopifyLineNode,
  type ShopifyOrderNode,
  type ShopifyRestOrder,
} from './shopify-map';

const API_VERSION = '2025-07';
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Client-credential tokens, per store, in memory only. */
const minted = new Map<string, { token: string; until: number }>();
const scopeCache = new Map<string, { at: number; scopes: string[] }>();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function storeOf(c: ChannelDef) {
  if (!c.store) throw new ConnectorError(`${c.name} has no Shopify store handle.`);
  return c.store;
}

async function accessToken(c: ChannelDef): Promise<{ token: string; minted: boolean }> {
  const env = channelEnv(c);
  if (env.token) return { token: env.token, minted: false };
  if (!env.clientId || !env.clientSecret) throw new ConnectorError(`${c.name} has no Shopify credentials set.`);
  const store = storeOf(c);
  const hit = minted.get(store);
  if (hit && hit.until > Date.now()) return { token: hit.token, minted: true };

  const res = await fetchRetry(
    `https://${store}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: env.clientId, client_secret: env.clientSecret, grant_type: 'client_credentials' }),
    },
    { label: `Shopify (${store})`, timeoutMs: 20_000 },
  );
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    throw new ConnectorError(`Shopify (${store}) refused the app's client credentials (${res.status}${body.error ? ` ${body.error}` : ''}).`, res.status);
  }
  const ttl = body.expires_in ? Math.min(20 * HOUR, body.expires_in * 1000 - HOUR) : 20 * HOUR;
  minted.set(store, { token: body.access_token, until: Date.now() + Math.max(ttl, 5 * 60_000) });
  return { token: body.access_token, minted: true };
}

/** One authenticated Admin API call; a minted token Shopify refuses is replaced once. */
async function admin(c: ChannelDef, path: string, body?: unknown, opts: { tries?: number; timeoutMs?: number } = {}): Promise<unknown> {
  const store = storeOf(c);
  for (let refreshed = false; ; refreshed = true) {
    const auth = await accessToken(c);
    const res = await fetchRetry(
      `https://${store}.myshopify.com${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Shopify-Access-Token': auth.token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { label: `Shopify (${store})`, tries: opts.tries, timeoutMs: opts.timeoutMs },
    );
    if (res.status === 401 && auth.minted && !refreshed) {
      minted.delete(store);
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    if (!res.ok) {
      const why =
        res.status === 401 ? 'the access token was refused' : res.status === 403 ? 'the token lacks a scope this call needs' : await errorText(res);
      throw new ConnectorError(`Shopify (${store}) answered ${res.status}: ${why}`, res.status);
    }
    return res.json();
  }
}

type GqlError = { message: string; extensions?: { code?: string } };
type GqlBody<T> = {
  data?: T | null;
  errors?: GqlError[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
};

/** GraphQL with Shopify's cost-based throttling waited out. Errors throw unless `soft`, which hands them back. */
async function gql<T>(c: ChannelDef, query: string, variables: Record<string, unknown> = {}, opts: { soft?: boolean; tries?: number; timeoutMs?: number } = {}) {
  const tries = opts.tries ?? 5;
  for (let attempt = 1; ; attempt++) {
    const body = (await admin(c, `/admin/api/${API_VERSION}/graphql.json`, { query, variables }, { tries, timeoutMs: opts.timeoutMs })) as GqlBody<T>;
    const errors = Array.isArray(body.errors) ? body.errors : [];
    if (errors.some((e) => e.extensions?.code === 'THROTTLED') && attempt < tries) {
      const cost = body.extensions?.cost;
      const refill =
        cost?.requestedQueryCost && cost.throttleStatus
          ? ((cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable) / Math.max(1, cost.throttleStatus.restoreRate)) * 1000
          : 0;
      await sleep(Math.min(Math.max(refill, backoff(attempt)), 30_000));
      continue;
    }
    if (!opts.soft && errors.length) {
      const text = errors.map((e) => e.message).join('; ');
      const hint = /protected customer data|not approved to access/i.test(text) ? " The app needs Shopify's protected customer data access." : '';
      throw new ConnectorError(
        `Shopify: ${text.slice(0, 400)}${hint}`,
        200,
        errors.map((e) => e.extensions?.code ?? '').filter(Boolean),
      );
    }
    if (!opts.soft && !body.data) throw new ConnectorError('Shopify returned no data.');
    return body;
  }
}

/**
 * A read-only Admin GraphQL query, for callers outside the connector (the shopping concierge reads
 * products, pages and policies through this). Mutations go through `mutate` and stay in this file.
 */
export async function shopifyRead<T>(c: ChannelDef, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (/^\s*mutation\b/i.test(query)) throw new ConnectorError('shopifyRead only reads.');
  const body = await gql<T>(c, query, variables, { tries: 3, timeoutMs: 15_000 });
  return body.data as T;
}

/** A mutation whose userErrors (HTTP 200) count as failure. */
async function mutate(c: ChannelDef, query: string, variables: Record<string, unknown>, field: string) {
  type Errs = { field?: string[] | null; message: string }[];
  const body = await gql<Record<string, { userErrors?: Errs; orderCancelUserErrors?: Errs } | null>>(c, query, variables);
  const errs = [...(body.data?.[field]?.userErrors ?? []), ...(body.data?.[field]?.orderCancelUserErrors ?? [])];
  if (errs.length) throw new ConnectorError(`Shopify refused ${field}: ${errs.map((e) => `${(e.field ?? []).join('.')} ${e.message}`.trim()).join('; ')}`);
  return body.data?.[field];
}

async function grantedScopes(c: ChannelDef, fresh = false) {
  const store = storeOf(c);
  const hit = scopeCache.get(store);
  if (!fresh && hit && Date.now() - hit.at < HOUR) return hit.scopes;
  const body = (await admin(c, '/admin/oauth/access_scopes.json')) as { access_scopes?: { handle: string }[] };
  const scopes = (body.access_scopes ?? []).map((s) => s.handle);
  scopeCache.set(store, { at: Date.now(), scopes });
  return scopes;
}

// ── Queries ────────────────────────────────────────────────────────────────────────────────────

const ordersQuery = (lines: number, withCustomer: boolean) => `query RelayOrders($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, sortKey: UPDATED_AT, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes { ${orderSelection(lines, withCustomer)} }
  }
}`;

const orderQuery = (withCustomer: boolean) => `query RelayOrder($id: ID!) { order(id: $id) { ${orderSelection(50, withCustomer)} } }`;

const LINES_QUERY = `query RelayOrderLines($id: ID!, $after: String) {
  order(id: $id) { lineItems(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${LINE_FIELDS} } } }
}`;

const SHOP_QUERY = '{ shop { name currencyCode ianaTimezone } }';

const probeQuery = (withCustomer: boolean) =>
  `{ orders(first: 1, reverse: true, sortKey: CREATED_AT) { nodes { id email ${withCustomer ? 'customer { id firstName lastName email }' : ''} shippingAddress { name phone address1 } } } }`;

type LinesPage = { nodes: ShopifyLineNode[]; pageInfo?: { hasNextPage: boolean; endCursor?: string | null } };

/** Lines beyond what fitted in the page query, fetched for that order alone. */
async function completeLines(c: ChannelDef, node: ShopifyOrderNode, opts: { tries?: number; timeoutMs?: number } = {}) {
  let page = node.lineItems?.pageInfo;
  while (node.lineItems && page?.hasNextPage && page.endCursor) {
    const body = await gql<{ order: { lineItems: LinesPage } | null }>(c, LINES_QUERY, { id: node.id, after: page.endCursor }, opts);
    const more = body.data?.order?.lineItems;
    if (!more) break;
    node.lineItems.nodes.push(...more.nodes);
    page = more.pageInfo;
  }
}

async function fetchOrder(c: ChannelDef, id: string, opts: { tries?: number; timeoutMs?: number }) {
  const cached = c.store ? scopeCache.get(c.store) : undefined;
  const withCustomer = cached ? scopeReport(cached.scopes).customers : true;
  const body = await gql<{ order: ShopifyOrderNode | null }>(c, orderQuery(withCustomer), { id }, opts);
  const node = body.data?.order;
  if (node) await completeLines(c, node, opts);
  return node ?? null;
}

// ── Write-back ─────────────────────────────────────────────────────────────────────────────────
// Every change reads the order first and does nothing when the store already shows it (fulfilled,
// held, cancelled, refunded), so a retry or a replayed event never doubles anything. With
// RELAY_WRITE_BACK=dry the reads still happen and nothing is sent: the timeline says what would be.

const TAGS_ADD = `mutation RelayTagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }`;
const TAGS_REMOVE = `mutation RelayTagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { node { id } userErrors { field message } } }`;
const FULFILMENT_ORDERS = `query RelayFulfilmentOrders($id: ID!) {
  order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status assignedLocation { location { id } } fulfillmentHolds { id handle reason } } } }
}`;
const FULFILMENT_CREATE = `mutation RelayFulfil($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } }
}`;
const MARK_PAID = `mutation RelayMarkPaid($input: OrderMarkAsPaidInput!) {
  orderMarkAsPaid(input: $input) { order { id displayFinancialStatus } userErrors { field message } }
}`;
const HOLD = `mutation RelayHold($id: ID!, $hold: FulfillmentOrderHoldInput!) {
  fulfillmentOrderHold(id: $id, fulfillmentHold: $hold) { fulfillmentOrder { id status } userErrors { field message } }
}`;
const RELEASE = `mutation RelayRelease($id: ID!, $holdIds: [ID!]) {
  fulfillmentOrderReleaseHold(id: $id, holdIds: $holdIds) { fulfillmentOrder { id status } userErrors { field message } }
}`;
const FULFILMENTS = `query RelayFulfilments($id: ID!) { order(id: $id) { fulfillments(first: 10) { id status createdAt } } }`;
const EVENT = `mutation RelayEvent($event: FulfillmentEventInput!) {
  fulfillmentEventCreate(fulfillmentEvent: $event) { fulfillmentEvent { id status } userErrors { field message } }
}`;
const CANCEL = `mutation RelayCancel($orderId: ID!, $reason: OrderCancelReason!, $notify: Boolean, $note: String) {
  orderCancel(orderId: $orderId, reason: $reason, restock: true, notifyCustomer: $notify, staffNote: $note, refundMethod: { originalPaymentMethodsRefund: false }) {
    job { id done } orderCancelUserErrors { field message code }
  }
}`;
const ORDER_FOR_REFUND = `query RelayRefundable($id: ID!) {
  order(id: $id) {
    currencyCode cancelledAt displayFinancialStatus customer { id }
    lineItems(first: 100) { nodes { id sku title quantity refundableQuantity variant { barcode } } }
  }
}`;
const SUGGEST = `query RelaySuggest($id: ID!, $lines: [RefundLineItemInput!], $full: Boolean) {
  order(id: $id) {
    suggestedRefund(refundLineItems: $lines, suggestFullRefund: $full) {
      amountSet { presentmentMoney { amount currencyCode } }
      refundLineItems { lineItem { id } quantity }
      suggestedTransactions { gateway kind parentTransaction { id } amountSet { presentmentMoney { amount } } maximumRefundableSet { presentmentMoney { amount } } }
    }
  }
}`;
const REFUND = `mutation RelayRefund($input: RefundInput!) {
  refundCreate(input: $input) { refund { id totalRefundedSet { presentmentMoney { amount currencyCode } } } userErrors { field message } }
}`;
const CREDIT = `mutation RelayCredit($id: ID!, $credit: StoreCreditAccountCreditInput!) {
  storeCreditAccountCredit(id: $id, creditInput: $credit) { storeCreditAccountTransaction { amount { amount currencyCode } } userErrors { field message } }
}`;

/** Holds this console placed carry this handle, so releasing never lifts a hold someone set in Shopify. */
const HOLD_HANDLE = 'relay';

type Send = (query: string, variables: Record<string, unknown>, field: string) => Promise<unknown>;
const would = (dry: boolean, done: string) => (dry ? `dry run, would have ${done}` : done);
const decimalsOf = (currency: string) => (currency === 'KWD' || currency === 'JOD' || currency === 'BHD' || currency === 'OMR' ? 3 : 2);
const money = (minor: number, currency: string) => (minor / 10 ** decimalsOf(currency)).toFixed(decimalsOf(currency));

async function tagStage(c: ChannelDef, id: string, stage: string, send: Send, dry: boolean): Promise<WriteBackResult> {
  const tag = `relay:${stage}`;
  const cur = await gql<{ order: { tags: string[] } | null }>(c, 'query RelayTags($id: ID!) { order(id: $id) { tags } }', { id });
  if (!cur.data?.order) return { ok: false, note: 'Shopify has no such order' };
  // tagsAdd/tagsRemove only touch the named tags; orderUpdate(tags) would replace the whole list.
  await send(TAGS_ADD, { id, tags: [tag] }, 'tagsAdd');
  const stale = cur.data.order.tags.filter((t) => t.startsWith('relay:') && t !== tag);
  if (stale.length) await send(TAGS_REMOVE, { id, tags: stale }, 'tagsRemove');
  return { ok: true, note: would(dry, `tagged ${tag}`) };
}

type Fo = { id: string; status: string; assignedLocation?: { location?: { id: string } | null } | null; fulfillmentHolds?: { id: string; handle: string | null; reason: string }[] };
const fulfilmentOrders = async (c: ChannelDef, id: string) => (await gql<{ order: { fulfillmentOrders: { nodes: Fo[] } } | null }>(c, FULFILMENT_ORDERS, { id })).data?.order?.fulfillmentOrders.nodes ?? [];

async function fulfil(c: ChannelDef, id: string, change: Extract<WriteBackChange, { kind: 'fulfil' }>, send: Send, dry: boolean): Promise<WriteBackResult> {
  const all = await fulfilmentOrders(c, id);
  const open = all.filter((f) => f.status === 'OPEN' || f.status === 'IN_PROGRESS');
  if (!open.length) {
    if (all.some((f) => f.status === 'ON_HOLD')) return { ok: false, note: 'the order is on hold in Shopify: release it there or here first' };
    return all.some((f) => f.status === 'CLOSED') ? { ok: true, note: 'already fulfilled in Shopify' } : { ok: false, note: 'Shopify has nothing open to fulfil on this order' };
  }
  const company = /aramex/i.test(change.company) ? 'Aramex' : change.company;
  // One fulfilment per location; the customer is notified once.
  const byLocation = new Map<string, Fo[]>();
  for (const f of open) {
    const key = f.assignedLocation?.location?.id ?? '';
    byLocation.set(key, [...(byLocation.get(key) ?? []), f]);
  }
  let first = true;
  for (const group of byLocation.values()) {
    await send(
      FULFILMENT_CREATE,
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: group.map((f) => ({ fulfillmentOrderId: f.id })),
          trackingInfo: { number: change.tracking, company, ...(change.url ? { url: change.url } : {}) },
          notifyCustomer: change.notifyCustomer && first,
        },
      },
      'fulfillmentCreate',
    );
    first = false;
  }
  return { ok: true, note: would(dry, `fulfilled with ${company} ${change.tracking}${change.notifyCustomer ? ', customer emailed' : ''}`) };
}

async function markPaid(c: ChannelDef, id: string, send: Send, dry: boolean): Promise<WriteBackResult> {
  const cur = await gql<{ order: { displayFinancialStatus: string | null } | null }>(c, 'query RelayPaid($id: ID!) { order(id: $id) { displayFinancialStatus } }', { id });
  if (!cur.data?.order) return { ok: false, note: 'Shopify has no such order' };
  if (cur.data.order.displayFinancialStatus === 'PAID') return { ok: true, note: 'already paid in Shopify' };
  await send(MARK_PAID, { input: { id } }, 'orderMarkAsPaid');
  return { ok: true, note: would(dry, 'marked paid') };
}

async function hold(c: ChannelDef, id: string, reason: string, send: Send, dry: boolean): Promise<WriteBackResult> {
  const all = await fulfilmentOrders(c, id);
  const open = all.filter((f) => f.status === 'OPEN' || f.status === 'IN_PROGRESS' || f.status === 'SCHEDULED');
  if (!open.length) return all.some((f) => f.status === 'ON_HOLD') ? { ok: true, note: 'already on hold in Shopify' } : { ok: true, skipped: true, note: 'nothing left to fulfil in Shopify' };
  for (const f of open) await send(HOLD, { id: f.id, hold: { reason: holdReason(reason), reasonNotes: reason.slice(0, 250), handle: HOLD_HANDLE, notifyMerchant: false } }, 'fulfillmentOrderHold');
  return { ok: true, note: would(dry, `put the fulfilment on hold (${reason})`) };
}

async function release(c: ChannelDef, id: string, send: Send, dry: boolean): Promise<WriteBackResult> {
  const all = await fulfilmentOrders(c, id);
  const held = all.filter((f) => f.status === 'ON_HOLD' && (f.fulfillmentHolds ?? []).some((h) => h.handle === HOLD_HANDLE));
  if (!held.length) return { ok: true, note: 'no hold from the console in Shopify' };
  for (const f of held) await send(RELEASE, { id: f.id, holdIds: (f.fulfillmentHolds ?? []).filter((h) => h.handle === HOLD_HANDLE).map((h) => h.id) }, 'fulfillmentOrderReleaseHold');
  return { ok: true, note: would(dry, 'released the hold') };
}

const EVENT_TEXT = { OUT_FOR_DELIVERY: 'out for delivery', DELIVERED: 'delivered', FAILURE: 'delivery failed' } as const;

async function delivery(c: ChannelDef, id: string, change: Extract<WriteBackChange, { kind: 'delivery' }>, send: Send, dry: boolean): Promise<WriteBackResult> {
  const body = await gql<{ order: { fulfillments: { id: string; status: string; createdAt: string }[] } | null }>(c, FULFILMENTS, { id });
  const shipment = (body.data?.order?.fulfillments ?? []).filter((f) => f.status !== 'CANCELLED').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!shipment) return { ok: false, note: 'no shipment in Shopify yet to mark' };
  await send(EVENT, { event: { fulfillmentId: shipment.id, status: change.status, happenedAt: new Date().toISOString(), ...(change.message ? { message: change.message.slice(0, 250) } : {}) } }, 'fulfillmentEventCreate');
  return { ok: true, note: would(dry, `marked the shipment ${EVENT_TEXT[change.status]}`) };
}

async function cancel(c: ChannelDef, id: string, change: Extract<WriteBackChange, { kind: 'cancel' }>, send: Send, dry: boolean): Promise<WriteBackResult> {
  const cur = await gql<{ order: { cancelledAt: string | null } | null }>(c, 'query RelayCancelled($id: ID!) { order(id: $id) { cancelledAt } }', { id });
  if (!cur.data?.order) return { ok: false, note: 'Shopify has no such order' };
  if (cur.data.order.cancelledAt) return { ok: true, note: 'already cancelled in Shopify' };
  await send(CANCEL, { orderId: id, reason: cancelReason(change.reason), notify: change.notifyCustomer, note: `From the console: ${change.reason}`.slice(0, 250) }, 'orderCancel');
  return { ok: true, note: would(dry, `cancelled and restocked, no refund (${change.reason})${change.notifyCustomer ? ', customer emailed' : ''}`) };
}

type RefundOrder = { currencyCode: string; cancelledAt: string | null; displayFinancialStatus: string | null; customer: { id: string } | null; lineItems: { nodes: { id: string; sku: string | null; title: string; quantity: number; refundableQuantity: number; variant: { barcode: string | null } | null }[] } };
type Suggested = {
  amountSet: { presentmentMoney: { amount: string; currencyCode: string } };
  refundLineItems: { lineItem: { id: string }; quantity: number }[];
  suggestedTransactions: SuggestedTransaction[];
};

async function refund(c: ChannelDef, id: string, change: Extract<WriteBackChange, { kind: 'refund' }>, send: Send, dry: boolean): Promise<WriteBackResult> {
  const order = (await gql<{ order: RefundOrder | null }>(c, ORDER_FOR_REFUND, { id })).data?.order;
  if (!order) return { ok: false, note: 'Shopify has no such order' };
  const { lines, missing } = matchLines(order.lineItems.nodes, change.lines);
  if (!lines.length) return { ok: missing.length === 0, note: missing.length ? `no refundable line in Shopify for ${missing.join(', ')}` : 'already refunded in Shopify' };
  const cur = order.currencyCode || change.currency;
  const dec = decimalsOf(cur);
  const note = `${change.returnNumber} from the console`;
  if (change.method === 'cash_at_store') {
    await send(REFUND, { input: { orderId: id, note: `${note}: paid in cash at the store`, notify: false, refundLineItems: lines } }, 'refundCreate');
    return { ok: true, note: would(dry, `recorded ${change.returnNumber} as refunded in cash at the store`) };
  }
  if (change.method === 'store_credit') {
    const value = Math.max(0, change.amount - change.bonus);
    await send(REFUND, { input: { orderId: id, note, notify: change.notifyCustomer, refundLineItems: lines, refundMethods: [{ storeCreditRefund: { amount: { amount: money(value, cur), currencyCode: cur } } }] } }, 'refundCreate');
    // the bonus is more than the goods were worth, so it goes on the account as credit of its own
    if (change.bonus > 0 && order.customer?.id) await send(CREDIT, { id: order.customer.id, credit: { creditAmount: { amount: money(change.bonus, cur), currencyCode: cur }, notify: change.notifyCustomer } }, 'storeCreditAccountCredit');
    return { ok: true, note: would(dry, `refunded ${change.returnNumber} as store credit, ${cur} ${money(change.amount, cur)}${change.bonus ? ` with the ${cur} ${money(change.bonus, cur)} bonus` : ''}`) };
  }
  const suggestion = (await gql<{ order: { suggestedRefund: Suggested | null } | null }>(c, SUGGEST, { id, lines })).data?.order?.suggestedRefund;
  const want = Number(money(change.amount, cur));
  const transactions = refundTransactions(id, suggestion?.suggestedTransactions ?? [], want, dec);
  if (!transactions.length) {
    if (['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'].includes(order.displayFinancialStatus ?? '')) {
      // paid online, yet Shopify suggests no money for these pieces (a free or zero-priced line?)
      return { ok: false, note: `Shopify sees nothing to pay back for ${change.returnNumber}'s pieces: refund it by hand in Shopify` };
    }
    // nothing was paid through a gateway (cash on delivery not collected): the pieces are marked refunded only
    await send(REFUND, { input: { orderId: id, note: `${note}: nothing paid online to send back`, notify: false, refundLineItems: lines } }, 'refundCreate');
    return { ok: true, note: would(dry, `marked ${change.returnNumber} refunded; nothing was paid online to send back`) };
  }
  await send(REFUND, { input: { orderId: id, note, notify: change.notifyCustomer, refundLineItems: lines, transactions } }, 'refundCreate');
  const sent = transactions.reduce((a, t) => a + Number(t.amount), 0).toFixed(dec);
  return { ok: true, note: would(dry, `refunded ${change.returnNumber}: ${cur} ${sent} back through ${[...new Set(transactions.map((t) => t.gateway))].join(' and ')}`) };
}

async function refundOrder(c: ChannelDef, id: string, change: Extract<WriteBackChange, { kind: 'refund_order' }>, send: Send, dry: boolean): Promise<WriteBackResult> {
  const order = (await gql<{ order: RefundOrder | null }>(c, ORDER_FOR_REFUND, { id })).data?.order;
  if (!order) return { ok: false, note: 'Shopify has no such order' };
  if (order.displayFinancialStatus === 'REFUNDED') return { ok: true, note: 'already refunded in Shopify' };
  const cur = order.currencyCode;
  const suggestion = (await gql<{ order: { suggestedRefund: Suggested | null } | null }>(c, SUGGEST, { id, full: true })).data?.order?.suggestedRefund;
  const total = Number(suggestion?.amountSet.presentmentMoney.amount ?? 0);
  const transactions = refundTransactions(id, suggestion?.suggestedTransactions ?? [], total, decimalsOf(cur));
  if (!transactions.length) return { ok: true, note: 'nothing paid online to refund in Shopify' };
  const lines = (suggestion?.refundLineItems ?? []).filter((l) => l.quantity > 0).map((l) => ({ lineItemId: l.lineItem.id, quantity: l.quantity, restockType: 'NO_RESTOCK' as const }));
  await send(REFUND, { input: { orderId: id, note: 'Cancelled order, refunded from the console', notify: change.notifyCustomer, refundLineItems: lines, transactions } }, 'refundCreate');
  const sent = transactions.reduce((a, t) => a + Number(t.amount), 0).toFixed(decimalsOf(cur));
  return { ok: true, note: would(dry, `refunded the cancelled order: ${cur} ${sent} back through ${[...new Set(transactions.map((t) => t.gateway))].join(' and ')}`) };
}

// ── Connector ──────────────────────────────────────────────────────────────────────────────────

export const shopify: Connector = {
  async check(c) {
    try {
      const [scopes, shopBody] = await Promise.all([
        grantedScopes(c, true),
        gql<{ shop: { name: string; currencyCode: string; ianaTimezone: string } }>(c, SHOP_QUERY),
      ]);
      const report = scopeReport(scopes);
      const probe = await gql<{ orders: { nodes: Partial<ShopifyOrderNode>[] } }>(c, probeQuery(report.customers), {}, { soft: true, tries: 2 }).catch(() => null);
      const s = shopBody.data!.shop;
      const shop = { name: s.name, currency: s.currencyCode, timezone: s.ianaTimezone };
      return { ok: report.missing.length === 0, note: checkNote(shop, report, customerDataHidden(probe)), shop, scopes, missing: report.missing };
    } catch (err) {
      return { ok: false, note: message(err) };
    }
  },

  async *pull(c, since, opts = {}) {
    const from = since ?? new Date(Date.now() - (opts.days ?? 60) * DAY);
    const search = `updated_at:>='${from.toISOString().replace(/\.\d{3}Z$/, 'Z')}'`;
    const withCustomer = scopeReport(await grantedScopes(c)).customers;
    const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
    let plan = pagePlan(opts.pageSize ?? 10);
    let after: string | null = null;
    let pages = 0;
    while (pages < maxPages) {
      type Page = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] } };
      let body: GqlBody<Page>;
      try {
        body = await gql<Page>(c, ordersQuery(plan.lines, withCustomer), { first: plan.first, after, query: search });
      } catch (err) {
        // The cost estimate is ours, not Shopify's: if a page is still too dear, ask for less and retry the same cursor.
        if (err instanceof ConnectorError && err.codes.includes('MAX_COST_EXCEEDED') && (plan.first > 1 || plan.lines > 1)) {
          plan = plan.first > 1 ? { first: Math.ceil(plan.first / 2), lines: plan.lines } : { first: 1, lines: Math.max(1, Math.floor(plan.lines / 2)) };
          continue;
        }
        throw err;
      }
      pages++;
      const conn = body.data!.orders;
      for (const node of conn.nodes) await completeLines(c, node);
      if (conn.nodes.length) yield conn.nodes.map((n) => mapShopifyOrder(c, n));
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
  },

  verifyWebhook(c, rawBody, headers) {
    const env = channelEnv(c);
    return verifyShopifyHmac(rawBody, headers.get('x-shopify-hmac-sha256'), env.webhookSecret ?? env.clientSecret);
  },

  /**
   * Order topics only. fulfillments/* return null: Shopify follows them with orders/updated (or
   * orders/fulfilled), which carries the same tracking on the whole order. The order is re-read
   * over GraphQL for images, barcodes and categories; if that is slow or fails, the payload is used.
   */
  async parseWebhook(c, topic, payload): Promise<IncomingOrder | null> {
    if (!ORDER_TOPICS.has(topic) || !payload || typeof payload !== 'object') return null;
    const p = payload as ShopifyRestOrder;
    const fromPayload = mapShopifyRestOrder(c, p);
    if (!fromPayload) return null;
    const gid = str(p.admin_graphql_api_id) ?? `gid://shopify/Order/${str(p.id)}`;
    try {
      const node = await fetchOrder(c, gid, { tries: 1, timeoutMs: 3000 });
      if (node) return mapShopifyOrder(c, node);
    } catch {
      // The payload alone is a complete order; the next pull fills in the rest.
    }
    return fromPayload;
  },

  async writeBack(c, order, change) {
    const mode = storeWriteBack(c);
    if (mode === 'off') return { ok: false, skipped: true, note: c.readOnly ? `${c.name} is read-only` : 'write-back is off' };
    const id = order.externalId;
    if (!id.startsWith('gid://shopify/Order/')) return { ok: false, skipped: true, note: `${order.number} is not a Shopify order` };
    const dry = mode === 'dry';
    // a dry run reads the store as usual and sends nothing
    const send: Send = dry ? async () => null : (query, variables, field) => mutate(c, query, variables, field);
    try {
      switch (change.kind) {
        case 'stage_tag':
          return await tagStage(c, id, change.stage, send, dry);
        case 'fulfil':
          return await fulfil(c, id, change, send, dry);
        case 'mark_paid':
          return await markPaid(c, id, send, dry);
        case 'hold':
          return await hold(c, id, change.reason, send, dry);
        case 'release':
          return await release(c, id, send, dry);
        case 'delivery':
          return await delivery(c, id, change, send, dry);
        case 'cancel':
          return await cancel(c, id, change, send, dry);
        case 'refund':
          return await refund(c, id, change, send, dry);
        case 'refund_order':
          return await refundOrder(c, id, change, send, dry);
      }
    } catch (err) {
      return { ok: false, note: message(err) };
    }
  },
};

// ── The out-of-stock rule ──────────────────────────────────────────────────────────────────────
// A product that has sold out comes off the shop, and goes back on when it is in stock again.
// Everything here is deliberately narrow: it reads only the products Shopify's own search says are
// candidates, it never touches a product whose inventory is not tracked or that is set to keep
// selling at zero, and it only ever publishes a product it drafted itself — which it knows because
// it tagged it on the way down.

export { OOS_TAG } from '../domain/stock-rule';
import { OOS_TAG, type RuleProduct } from '../domain/stock-rule';

const OOS_FIELDS = `
  id
  title
  status
  totalInventory
  tracksInventory
  tags
  variants(first: 100) { nodes { inventoryPolicy inventoryQuantity } }
`;

const PRODUCTS = `query RelayRuleProducts($query: String!, $after: String) {
  products(first: 50, query: $query, after: $after) {
    nodes { ${OOS_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SET_STATUS = `mutation RelayProductStatus($input: ProductInput!) {
  productUpdate(input: $input) { product { id status } userErrors { field message } }
}`;

type ProductNode = {
  id: string;
  title: string;
  status: string;
  totalInventory: number | null;
  tracksInventory: boolean;
  tags: string[];
  variants: { nodes: { inventoryPolicy: string; inventoryQuantity: number | null }[] };
};

const toProduct = (n: ProductNode): RuleProduct => ({
  id: n.id,
  title: n.title,
  status: n.status,
  totalInventory: n.totalInventory ?? 0,
  tracksInventory: n.tracksInventory,
  tags: n.tags ?? [],
  stopsAtZero: n.variants.nodes.length > 0 && n.variants.nodes.every((v) => v.inventoryPolicy === 'DENY'),
});

/** Every product Shopify's own search matches, a page at a time. */
export async function* searchProducts(c: ChannelDef, query: string): AsyncGenerator<RuleProduct[]> {
  type Page = { products: { nodes: ProductNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };
  let after: string | null = null;
  for (;;) {
    const body: { data?: Page | null } = await gql<Page>(
      c,
      PRODUCTS,
      { query, after },
      { timeoutMs: 60_000 },
    );
    const page = body.data?.products;
    if (!page) return;
    yield page.nodes.map(toProduct);
    if (!page.pageInfo.hasNextPage) return;
    after = page.pageInfo.endCursor;
  }
}

/**
 * Takes a sold-out product off the shop, leaving the rule's own tag behind.
 *
 * The tag is added with `tagsAdd` rather than through `productUpdate(tags:)`, which replaces the
 * whole list — on a catalogue where the tags carry the gender, the category and the sub-category,
 * that would quietly strip the menu off the product.
 */
/** A read-only store takes no product changes, whoever asks (the stock rule filters it out first). */
const assertWritable = (c: ChannelDef) => {
  if (c.readOnly && storeWriteBack(c) === 'off') throw new ConnectorError(`${c.name} is connected read-only: nothing is changed in its store.`);
};

export async function draftProduct(c: ChannelDef, id: string) {
  assertWritable(c);
  await mutate(c, SET_STATUS, { input: { id, status: 'DRAFT' } }, 'productUpdate');
  await mutate(c, TAGS_ADD, { id, tags: [OOS_TAG] }, 'tagsAdd');
}

/** Puts a product the rule drafted back on the shop, and takes its mark off. */
export async function publishProduct(c: ChannelDef, id: string) {
  assertWritable(c);
  await mutate(c, SET_STATUS, { input: { id, status: 'ACTIVE' } }, 'productUpdate');
  await mutate(c, TAGS_REMOVE, { id, tags: [OOS_TAG] }, 'tagsRemove');
}

// ── Order webhooks ─────────────────────────────────────────────────────────────────────────────

/** The topics the webhook route reads (see Setup → Channels). Without them orders wait for the next sync. */
export const ORDER_WEBHOOK_TOPICS = ['ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_PAID', 'ORDERS_CANCELLED', 'ORDERS_FULFILLED'] as const;

const WEBHOOKS = `{ webhookSubscriptions(first: 100) { nodes { id topic uri format } } }`;
const WEBHOOK_CREATE = `mutation RelayWebhook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id topic uri } userErrors { field message } }
}`;

/** This app's webhook subscriptions on the store. Another app's webhooks are not visible here. */
export async function orderWebhooks(c: ChannelDef) {
  const body = await gql<{ webhookSubscriptions: { nodes: { id: string; topic: string; uri: string; format: string }[] } }>(c, WEBHOOKS);
  return body.data?.webhookSubscriptions.nodes ?? [];
}

/**
 * Points the store's order webhooks at `address` (…/api/webhooks/shopify/<channel>), so an order shows
 * within seconds instead of at the next sync. Shopify signs them with the app's client secret, which the
 * route already checks. Topics already sent to `address` are left alone; with `apply` false nothing is written.
 */
export async function registerOrderWebhooks(c: ChannelDef, address: string, apply: boolean) {
  const have = await orderWebhooks(c);
  const missing = ORDER_WEBHOOK_TOPICS.filter((t) => !have.some((w) => w.topic === t && w.uri === address));
  const created: string[] = [];
  if (apply) for (const topic of missing) {
    await mutate(c, WEBHOOK_CREATE, { topic, sub: { uri: address, format: 'JSON' } }, 'webhookSubscriptionCreate');
    created.push(topic);
  }
  return { have, missing, created };
}

// ── Catalogue and stock, for the stockroom ─────────────────────────────────────────────────────

const BULK_CATALOGUE = `{
  productVariants(query: "product_status:active") {
    edges {
      node {
        id sku barcode price compareAtPrice inventoryQuantity
        selectedOptions { name value }
        product { id title handle vendor productType tags createdAt featuredImage { url } }
      }
    }
  }
}`;

export type CatalogueVariant = {
  id: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  selectedOptions: { name: string; value: string }[];
  product: { id: string; title: string; handle: string; vendor: string; productType: string; tags: string[]; createdAt: string; featuredImage: { url: string } | null };
};

const START_BULK = `mutation RelayCatalogueExport($query: String!) {
  bulkOperationRunQuery(query: $query) { bulkOperation { id status } userErrors { field message } }
}`;
const BULK_STATUS = `query RelayBulkStatus($id: ID!) { node(id: $id) { ... on BulkOperation { id status errorCode objectCount url } } }`;

/**
 * Every active variant with its product and the stock Shopify holds for it, in one read.
 *
 * A catalogue of tens of thousands of sizes is too big to page through quickly, so this asks Shopify
 * for a bulk export: a background job that reads the catalogue and hands back a file. It changes
 * nothing in the store; it is the read Shopify recommends for a whole catalogue.
 */
export async function exportCatalogue(c: ChannelDef, log: (m: string) => void = () => {}): Promise<CatalogueVariant[]> {
  return (await runBulk(c, BULK_CATALOGUE, log)).map((l) => JSON.parse(l) as CatalogueVariant).filter((v) => v.product);
}

/** Starts a bulk export, waits for it, and hands back its lines (JSONL). Read-only towards the store. */
async function runBulk(c: ChannelDef, query: string, log: (m: string) => void): Promise<string[]> {
  const started = await mutate(c, START_BULK, { query }, 'bulkOperationRunQuery');
  const id = (started as { bulkOperation?: { id: string } } | null)?.bulkOperation?.id;
  if (!id) throw new ConnectorError('Shopify did not start the catalogue export.');
  let url: string | null = null;
  for (let i = 0; i < 360; i++) {
    await sleep(i < 5 ? 2000 : 5000);
    const body = await gql<{ node: { status: string; errorCode: string | null; objectCount: string; url: string | null } | null }>(c, BULK_STATUS, { id });
    const op = body.data?.node;
    if (!op) continue;
    if (i % 4 === 0) log(`  Shopify export ${op.status.toLowerCase()} · ${op.objectCount} rows`);
    if (op.status === 'COMPLETED') {
      url = op.url;
      break;
    }
    if (['FAILED', 'CANCELED', 'EXPIRED'].includes(op.status)) throw new ConnectorError(`Shopify's catalogue export ${op.status.toLowerCase()}${op.errorCode ? ` (${op.errorCode})` : ''}.`);
  }
  if (!url) return [];
  const res = await fetchRetry(url, {}, { label: 'Shopify export file', timeoutMs: 180_000 });
  if (!res.ok) throw new ConnectorError(`Could not download Shopify's export (${res.status}).`);
  return (await res.text()).split('\n').filter((l) => l.trim());
}

// ── Every product, live or not, for the website-against-Lucida comparison ─────────────────────

const BULK_WEBSITE = `{
  products {
    edges {
      node {
        id handle title vendor status productType tags
        description(truncateAt: 40)
        featuredImage { url }
        variants {
          edges { node { id sku barcode price compareAtPrice inventoryQuantity selectedOptions { name value } } }
        }
      }
    }
  }
}`;

export type WebsiteProduct = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | string;
  productType: string;
  tags: string[];
  description: string;
  featuredImage: { url: string } | null;
  variants: { id: string; sku: string | null; barcode: string | null; price: string; compareAtPrice: string | null; inventoryQuantity: number | null; selectedOptions: { name: string; value: string }[] }[];
};

/** Every product the store holds, whatever its status, with its sizes. One bulk export. */
export async function exportWebsiteItems(c: ChannelDef, log: (m: string) => void = () => {}): Promise<WebsiteProduct[]> {
  const lines = await runBulk(c, BULK_WEBSITE, log);
  const products = new Map<string, WebsiteProduct>();
  const orphans: { parent: string; v: WebsiteProduct['variants'][number] }[] = [];
  for (const l of lines) {
    const o = JSON.parse(l) as Record<string, unknown> & { id: string; __parentId?: string };
    if (o.__parentId) orphans.push({ parent: o.__parentId, v: o as unknown as WebsiteProduct['variants'][number] });
    else products.set(o.id, { ...(o as unknown as WebsiteProduct), variants: [] });
  }
  for (const { parent, v } of orphans) products.get(parent)?.variants.push(v);
  return [...products.values()];
}

/** The store's stock locations, the one that ships website orders first. */
export async function stockLocations(c: ChannelDef) {
  const body = await gql<{ locations: { nodes: { id: string; name: string; isActive: boolean; fulfillsOnlineOrders: boolean; address: { city: string | null } }[] } }>(
    c,
    `{ locations(first: 50) { nodes { id name isActive fulfillsOnlineOrders address { city } } } }`,
  );
  return (body.data?.locations.nodes ?? []).filter((l) => l.isActive).sort((a, b) => Number(b.fulfillsOnlineOrders) - Number(a.fulfillsOnlineOrders));
}

// ── Catalogue import & export (Dan, 27 Oct: Matrixify inside the console) ───────────────────────
// Products read by handle for the dry run, a whole catalogue read for an export, and one product
// written at a time for an import: productSet creates or updates the product with its options,
// variants and photos together; metafields, the Online Store and stock follow. Every write is a
// product someone asked for in an import they ran; nothing here runs on its own.

type CatalogNode = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  templateSuffix: string | null;
  createdAt?: string;
  updatedAt?: string;
  seo: { title: string | null; description: string | null } | null;
  options: { name: string; position: number }[];
  onlineStore?: boolean;
  media?: { pageInfo?: { hasNextPage: boolean }; nodes: CatalogMedia[] };
  variants?: { pageInfo?: { hasNextPage: boolean }; nodes: CatalogVariantNode[] };
  metafields?: { nodes: CatalogMetafield[] };
};
type CatalogMedia = { id?: string; alt?: string | null; image?: { url: string } | null };
type CatalogMetafield = { namespace: string; key: string; type: string; value: string };
type CatalogVariantNode = {
  id: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  taxable: boolean;
  position: number;
  inventoryQuantity: number | null;
  inventoryPolicy: 'DENY' | 'CONTINUE';
  selectedOptions: { name: string; value: string }[];
  inventoryItem: { id?: string; unitCost: { amount: string } | null } | null;
  image: { url: string } | null;
  metafields?: { nodes: CatalogMetafield[] };
};
export type ExportedProduct = StoreProduct & { createdAt?: string; updatedAt?: string };

const publicationCache = new Map<string, { at: number; id: string | null }>();

/** The store's Online Store sales channel (where "Published" puts a product), or null without access to channels. */
export async function onlineStorePublication(c: ChannelDef): Promise<string | null> {
  const store = storeOf(c);
  const hit = publicationCache.get(store);
  if (hit && Date.now() - hit.at < HOUR) return hit.id;
  const body = await gql<{ publications: { nodes: { id: string; name: string }[] } }>(c, `{ publications(first: 25) { nodes { id name } } }`, {}, { soft: true });
  const id = body.data?.publications?.nodes.find((p) => /online store/i.test(p.name))?.id ?? null;
  publicationCache.set(store, { at: Date.now(), id });
  return id;
}

/** Whether a store can be read and written for catalogue work, from the app's granted scopes. */
export async function catalogAccess(c: ChannelDef) {
  const scopes = await grantedScopes(c);
  const has = (s: string) => scopes.includes(s);
  const missing = ['write_products', 'write_publications', 'write_files'].filter((s) => !has(s));
  return { read: has('read_products') || has('write_products'), write: has('write_products'), publish: has('write_publications'), stock: has('write_inventory'), missing };
}

function toStoreProduct(n: CatalogNode, opts: { variants: CatalogVariantNode[]; media: CatalogMedia[]; metafields: CatalogMetafield[]; truncated?: boolean }): ExportedProduct {
  const optionNames = [...(n.options ?? [])].sort((a, b) => a.position - b.position).map((o) => o.name);
  return {
    id: n.id,
    handle: n.handle,
    title: n.title,
    bodyHtml: n.descriptionHtml ?? '',
    vendor: n.vendor ?? '',
    type: n.productType ?? '',
    tags: n.tags ?? [],
    status: n.status,
    published: typeof n.onlineStore === 'boolean' ? n.onlineStore : null,
    templateSuffix: n.templateSuffix || null,
    seoTitle: n.seo?.title || null,
    seoDescription: n.seo?.description || null,
    optionNames,
    variants: [...opts.variants]
      .sort((a, b) => a.position - b.position)
      .map((v) => ({
        id: v.id,
        options: optionNames.map((name) => v.selectedOptions.find((o) => o.name === name)?.value ?? ''),
        sku: v.sku || null,
        barcode: v.barcode || null,
        price: v.price,
        compareAt: v.compareAtPrice || null,
        taxable: v.taxable,
        cost: v.inventoryItem?.unitCost?.amount ?? null,
        inventoryPolicy: v.inventoryPolicy,
        inventoryQty: v.inventoryQuantity,
        inventoryItemId: v.inventoryItem?.id ?? null,
        position: v.position,
        image: v.image?.url ?? null,
      })),
    images: opts.media.filter((m) => m.id && m.image?.url).map((m) => ({ id: m.id!, src: m.image!.url, alt: m.alt ?? null })),
    metafields: [
      ...opts.metafields.map((m) => ({ owner: 'product' as const, namespace: m.namespace, key: m.key, type: m.type, value: m.value })),
      ...opts.variants.flatMap((v) => (v.metafields?.nodes ?? []).map((m) => ({ owner: 'variant' as const, variantId: v.id, namespace: m.namespace, key: m.key, type: m.type, value: m.value }))),
    ],
    ...(opts.truncated ? { truncated: true } : {}),
    ...(n.createdAt ? { createdAt: n.createdAt, updatedAt: n.updatedAt } : {}),
  };
}

const catalogFields = (opts: { pub: boolean; meta: boolean; variantMeta: boolean }) => `
  id handle title descriptionHtml vendor productType tags status templateSuffix
  seo { title description }
  options { name position }
  ${opts.pub ? 'onlineStore: publishedOnPublication(publicationId: $pub)' : ''}
  media(first: 50) { pageInfo { hasNextPage } nodes { ... on MediaImage { id alt image { url } } } }
  variants(first: 100) { pageInfo { hasNextPage } nodes {
    id sku barcode price compareAtPrice taxable position inventoryQuantity inventoryPolicy
    selectedOptions { name value } inventoryItem { id unitCost { amount } } image { url }
    ${opts.variantMeta ? 'metafields(first: 20, keys: $vkeys) { nodes { namespace key type value } }' : ''}
  } }
  ${opts.meta ? 'metafields(first: 30, keys: $keys) { nodes { namespace key type value } }' : ''}`;

/**
 * The store's products for a list of handles and IDs, as the dry run compares them: five a call (each
 * brings up to 100 variants and 50 photos). Products not in the store are absent from the map, which is
 * keyed `id:<gid>` and `h:<handle>`.
 */
export async function catalogFetch(c: ChannelDef, refs: { handle?: string; id?: string }[], keys: { product: string[]; variant: string[] } = { product: [], variant: [] }) {
  const pub = await onlineStorePublication(c);
  const opts = { pub: Boolean(pub), meta: keys.product.length > 0, variantMeta: keys.variant.length > 0 };
  const vars = `${pub ? ', $pub: ID!' : ''}${opts.meta ? ', $keys: [String!]' : ''}${opts.variantMeta ? ', $vkeys: [String!]' : ''}`;
  const extra = { ...(pub ? { pub } : {}), ...(opts.meta ? { keys: keys.product } : {}), ...(opts.variantMeta ? { vkeys: keys.variant } : {}) };
  const out = new Map<string, ExportedProduct>();
  const toProduct = (n: CatalogNode) =>
    toStoreProduct(n, {
      variants: n.variants?.nodes ?? [],
      media: n.media?.nodes ?? [],
      metafields: n.metafields?.nodes ?? [],
      truncated: Boolean(n.variants?.pageInfo?.hasNextPage || n.media?.pageInfo?.hasNextPage),
    });
  const ids = [...new Set(refs.flatMap((r) => (r.id ? [r.id] : [])))];
  for (let i = 0; i < ids.length; i += 5) {
    const body = await gql<{ nodes: (CatalogNode | null)[] }>(c, `query RelayCatalogIds($ids: [ID!]!${vars}) { nodes(ids: $ids) { ... on Product { ${catalogFields(opts)} } } }`, { ids: ids.slice(i, i + 5), ...extra });
    for (const n of body.data?.nodes ?? []) {
      if (!n?.id) continue;
      const p = toProduct(n);
      out.set(`id:${n.id}`, p);
      out.set(`h:${n.handle.toLowerCase()}`, p);
    }
  }
  const handles = [...new Set(refs.flatMap((r) => (r.handle && !r.id ? [r.handle.toLowerCase()] : [])))];
  for (let i = 0; i < handles.length; i += 5) {
    const batch = handles.slice(i, i + 5);
    const query = batch.map((h) => `(handle:${JSON.stringify(h)})`).join(' OR ');
    const body = await gql<{ products: { nodes: CatalogNode[] } }>(c, `query RelayCatalogHandles($q: String!${vars}) { products(first: 5, query: $q) { nodes { ${catalogFields(opts)} } } }`, { q: query, ...extra });
    for (const n of body.data?.products.nodes ?? []) if (batch.includes(n.handle.toLowerCase())) out.set(`h:${n.handle.toLowerCase()}`, toProduct(n));
  }
  return out;
}

/** Which barcodes the store already has, and on which product: a new variant should not repeat one. */
export async function barcodesInStore(c: ChannelDef, barcodes: string[]) {
  const out = new Map<string, { productId: string; handle: string; title: string }>();
  const list = [...new Set(barcodes.filter((b) => /^[\w.-]+$/.test(b)))];
  for (let i = 0; i < list.length; i += 40) {
    const q = list
      .slice(i, i + 40)
      .map((b) => `barcode:${b}`)
      .join(' OR ');
    const body = await gql<{ productVariants: { nodes: { barcode: string | null; product: { id: string; handle: string; title: string } }[] } }>(
      c,
      `query RelayBarcodes($q: String!) { productVariants(first: 100, query: $q) { nodes { barcode product { id handle title } } } }`,
      { q },
    );
    for (const v of body.data?.productVariants.nodes ?? []) if (v.barcode) out.set(v.barcode, { productId: v.product.id, handle: v.product.handle, title: v.product.title });
  }
  return out;
}

/** Every product of the store (or those the filter picks) with variants, photos and metafields: one bulk export. */
export async function catalogExport(c: ChannelDef, opts: { query?: string; metafields: boolean }, log: (m: string) => void = () => {}): Promise<ExportedProduct[]> {
  const pub = await onlineStorePublication(c);
  const filter = opts.query?.trim() ? `(query: ${JSON.stringify(opts.query.trim())})` : '';
  const query = `{ products${filter} { edges { node {
    id handle title descriptionHtml vendor productType tags status templateSuffix createdAt updatedAt
    seo { title description }
    options { name position }
    ${pub ? `onlineStore: publishedOnPublication(publicationId: ${JSON.stringify(pub)})` : ''}
    media { edges { node { ... on MediaImage { id alt image { url } } } } }
    variants { edges { node { id sku barcode price compareAtPrice taxable position inventoryQuantity inventoryPolicy selectedOptions { name value } inventoryItem { unitCost { amount } } image { url } } } }
    ${opts.metafields ? 'metafields { edges { node { id namespace key type value } } }' : ''}
  } } } }`;
  const lines = await runBulk(c, query, log);
  const products = new Map<string, { node: CatalogNode; variants: CatalogVariantNode[]; media: CatalogMedia[]; metafields: CatalogMetafield[] }>();
  for (const l of lines) {
    const o = JSON.parse(l) as Record<string, unknown> & { id?: string; __parentId?: string };
    if (!o.__parentId) {
      if (o.id) products.set(o.id, { node: o as unknown as CatalogNode, variants: [], media: [], metafields: [] });
      continue;
    }
    const p = products.get(o.__parentId);
    if (!p || !o.id) continue;
    if (o.id.includes('/ProductVariant/')) p.variants.push(o as unknown as CatalogVariantNode);
    else if (o.id.includes('/MediaImage/')) p.media.push(o as CatalogMedia);
    else if (o.id.includes('/Metafield/')) p.metafields.push(o as unknown as CatalogMetafield);
  }
  return [...products.values()].map((p) => toStoreProduct(p.node, p));
}

const PRODUCT_SET = `mutation RelayProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product { id handle variants(first: 250) { nodes { id selectedOptions { name value } inventoryItem { id } } } }
    userErrors { field message code }
  }
}`;
const METAFIELDS_SET = `mutation RelayMetafieldsSet($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message code } } }`;
const PUBLISH = `mutation RelayPublish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`;
const UNPUBLISH = `mutation RelayUnpublish($id: ID!, $input: [PublicationInput!]!) { publishableUnpublish(id: $id, input: $input) { userErrors { field message } } }`;
const STOCK_SET = `mutation RelayStockSet($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { field message } } }`;
const PRODUCT_DELETE = `mutation RelayProductDelete($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { field message } } }`;

/** Whether catalogue imports may write to this store: its own RELAY_<PREFIX>_CATALOG=on|off, else any store not connected read-only. */
export function catalogWritable(c: ChannelDef) {
  const own = process.env[`RELAY_${c.envPrefix}_CATALOG`]?.trim().toLowerCase();
  if (own) return own === 'on' || own === 'true';
  return !(c.readOnly && storeWriteBack(c) === 'off');
}

type SavedProduct = { id: string; handle: string; variants: { nodes: { id: string; selectedOptions: { name: string; value: string }[]; inventoryItem: { id: string } | null }[] } };

/**
 * One product from an import, written: productSet (create or update, with its options, variants and
 * photos), then its metafields, its stock when the import writes stock, and the Online Store. Returns
 * the product and what was done; a refusal throws with Shopify's own words.
 */
export async function catalogSave(c: ChannelDef, w: Write): Promise<{ productId: string; handle: string; notes: string[] }> {
  if (!catalogWritable(c)) throw new ConnectorError(`${c.name} is connected read-only: imports are off for it.`);
  const notes: string[] = [];
  if (w.kind === 'delete') {
    await mutate(c, PRODUCT_DELETE, { input: { id: w.productId } }, 'productDelete');
    return { productId: w.productId!, handle: '', notes: ['deleted'] };
  }
  if (w.kind === 'archive') {
    const r = (await mutate(c, PRODUCT_SET, { input: { status: 'ARCHIVED' }, identifier: { id: w.productId } }, 'productSet')) as { product: SavedProduct };
    return { productId: r.product.id, handle: r.product.handle, notes: ['archived'] };
  }
  // an existing product is named by its ID beside the input (ProductSetInput has no id); a new one by its handle
  const input = w.input ?? {};
  const identifier = w.productId ? { id: w.productId } : { handle: String(input.handle ?? '') };
  let product: SavedProduct;
  if (Object.keys(input).length || !w.productId) {
    const r = (await mutate(c, PRODUCT_SET, { input, identifier }, 'productSet')) as { product: SavedProduct | null } | null;
    if (!r?.product) throw new ConnectorError('Shopify did not return the product.');
    product = r.product;
  } else {
    const body = await gql<{ product: SavedProduct | null }>(c, `query RelayProductVariants($id: ID!) { product(id: $id) { id handle variants(first: 250) { nodes { id selectedOptions { name value } inventoryItem { id } } } } }`, { id: w.productId });
    if (!body.data?.product) throw new ConnectorError('The product is no longer in the store.');
    product = body.data.product;
  }
  const keyOf = (v: { selectedOptions: { name: string; value: string }[] }) => v.selectedOptions.map((o) => o.value.trim().toLowerCase()).join(' / ');
  const variantBy = new Map(product.variants.nodes.map((v) => [keyOf(v), v]));
  const single = product.variants.nodes.length === 1 ? product.variants.nodes[0] : null;
  const variantFor = (key: string | undefined) => (key != null ? (variantBy.get(key) ?? (single && /^(default title)?$/.test(key) ? single : null)) : null);

  if (w.metafields.length) {
    const list = w.metafields.flatMap((m) => {
      const owner = m.owner === 'product' ? product.id : variantFor(m.variantKey)?.id;
      return owner ? [{ ownerId: owner, namespace: m.namespace, key: m.key, type: m.type, value: m.value }] : [];
    });
    for (let i = 0; i < list.length; i += 25) await mutate(c, METAFIELDS_SET, { m: list.slice(i, i + 25) }, 'metafieldsSet');
    if (list.length) notes.push(`${list.length} metafield${list.length === 1 ? '' : 's'}`);
  }
  if (w.stock.length) {
    const location = (await stockLocations(c))[0]?.id;
    if (!location) notes.push('stock not written: the store has no active location');
    else {
      const quantities = w.stock.flatMap((s) => {
        const item = variantFor(s.variantKey)?.inventoryItem?.id;
        return item ? [{ inventoryItemId: item, locationId: location, quantity: s.quantity }] : [];
      });
      if (quantities.length) {
        await mutate(c, STOCK_SET, { input: { name: 'available', reason: 'correction', quantities } }, 'inventorySetQuantities');
        notes.push(`stock set on ${quantities.length}`);
      }
    }
  }
  if (w.publish != null) {
    const pub = await onlineStorePublication(c);
    if (!pub) notes.push('Online Store not changed: the app cannot see sales channels');
    else {
      await mutate(c, w.publish ? PUBLISH : UNPUBLISH, { id: product.id, input: [{ publicationId: pub }] }, w.publish ? 'publishablePublish' : 'publishableUnpublish');
      notes.push(w.publish ? 'on the Online Store' : 'off the Online Store');
    }
  }
  return { productId: product.id, handle: product.handle, notes };
}
