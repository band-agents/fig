import 'server-only';
// Shopify Admin GraphQL (2025-07): pulls orders by updated_at, maps order webhooks, and, only when
// RELAY_WRITE_BACK=true, tags stages, fulfils with tracking and marks COD orders paid.
import { channelEnv, type ChannelDef } from '../channels';
import type { Connector, IncomingOrder, WriteBackChange, WriteBackResult } from './types';
import { backoff, ConnectorError, errorText, fetchRetry, sleep } from './http';
import { str } from './map-util';
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

/** A mutation whose userErrors (HTTP 200) count as failure. */
async function mutate(c: ChannelDef, query: string, variables: Record<string, unknown>, field: string) {
  const body = await gql<Record<string, { userErrors?: { field?: string[] | null; message: string }[] } | null>>(c, query, variables);
  const errs = body.data?.[field]?.userErrors ?? [];
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

const TAGS_ADD = `mutation RelayTagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }`;
const TAGS_REMOVE = `mutation RelayTagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { node { id } userErrors { field message } } }`;
const FULFILMENT_ORDERS = `query RelayFulfilmentOrders($id: ID!) {
  order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status assignedLocation { location { id } } } } }
}`;
const FULFILMENT_CREATE = `mutation RelayFulfil($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } }
}`;
const MARK_PAID = `mutation RelayMarkPaid($input: OrderMarkAsPaidInput!) {
  orderMarkAsPaid(input: $input) { order { id displayFinancialStatus } userErrors { field message } }
}`;

async function tagStage(c: ChannelDef, id: string, stage: string): Promise<WriteBackResult> {
  const tag = `relay:${stage}`;
  const cur = await gql<{ order: { tags: string[] } | null }>(c, 'query RelayTags($id: ID!) { order(id: $id) { tags } }', { id });
  if (!cur.data?.order) return { ok: false, note: 'Shopify has no such order' };
  // tagsAdd/tagsRemove only touch the named tags; orderUpdate(tags) would replace the whole list.
  await mutate(c, TAGS_ADD, { id, tags: [tag] }, 'tagsAdd');
  const stale = cur.data.order.tags.filter((t) => t.startsWith('relay:') && t !== tag);
  if (stale.length) await mutate(c, TAGS_REMOVE, { id, tags: stale }, 'tagsRemove');
  return { ok: true, note: `tagged ${tag} on Shopify` };
}

async function fulfil(c: ChannelDef, id: string, change: Extract<WriteBackChange, { kind: 'fulfil' }>): Promise<WriteBackResult> {
  type Fo = { id: string; status: string; assignedLocation?: { location?: { id: string } | null } | null };
  const body = await gql<{ order: { fulfillmentOrders: { nodes: Fo[] } } | null }>(c, FULFILMENT_ORDERS, { id });
  const all = body.data?.order?.fulfillmentOrders.nodes ?? [];
  const open = all.filter((f) => f.status === 'OPEN' || f.status === 'IN_PROGRESS');
  if (!open.length) {
    return all.some((f) => f.status === 'CLOSED') ? { ok: true, note: 'already fulfilled on Shopify' } : { ok: false, note: 'Shopify has nothing open to fulfil on this order' };
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
    await mutate(
      c,
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
  return { ok: true, note: `fulfilled on Shopify with ${company} ${change.tracking}` };
}

async function markPaid(c: ChannelDef, id: string): Promise<WriteBackResult> {
  const cur = await gql<{ order: { displayFinancialStatus: string | null } | null }>(c, 'query RelayPaid($id: ID!) { order(id: $id) { displayFinancialStatus } }', { id });
  if (!cur.data?.order) return { ok: false, note: 'Shopify has no such order' };
  if (cur.data.order.displayFinancialStatus === 'PAID') return { ok: true, note: 'already paid on Shopify' };
  await mutate(c, MARK_PAID, { input: { id } }, 'orderMarkAsPaid');
  return { ok: true, note: 'marked paid on Shopify' };
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
    if (process.env.RELAY_WRITE_BACK !== 'true') return { ok: false, skipped: true, note: 'write-back is off' };
    const id = order.externalId;
    if (!id.startsWith('gid://shopify/Order/')) return { ok: false, skipped: true, note: `${order.number} is not a Shopify order` };
    try {
      if (change.kind === 'stage_tag') return await tagStage(c, id, change.stage);
      if (change.kind === 'fulfil') return await fulfil(c, id, change);
      return await markPaid(c, id);
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
export async function draftProduct(c: ChannelDef, id: string) {
  await mutate(c, SET_STATUS, { input: { id, status: 'DRAFT' } }, 'productUpdate');
  await mutate(c, TAGS_ADD, { id, tags: [OOS_TAG] }, 'tagsAdd');
}

/** Puts a product the rule drafted back on the shop, and takes its mark off. */
export async function publishProduct(c: ChannelDef, id: string) {
  await mutate(c, SET_STATUS, { input: { id, status: 'ACTIVE' } }, 'productUpdate');
  await mutate(c, TAGS_REMOVE, { id, tags: [OOS_TAG] }, 'tagsRemove');
}
