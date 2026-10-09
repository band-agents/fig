import 'server-only';
// WooCommerce REST v3 (figeg.com, still trading until the Shopify store launches), read with a
// consumer key and secret over HTTPS basic auth. Webhooks are signed with the webhook's own secret.
import { channelEnv, type ChannelDef } from '../channels';
import type { Connector, IncomingOrder } from './types';
import { basicAuth, ConnectorError, errorText, fetchRetry } from './http';
import { mapWooOrder, verifyWooSignature, WOO_TOPICS, type WooOrder } from './woo-map';

const DAY = 86_400_000;

async function get(c: ChannelDef, params: Record<string, string>) {
  const env = channelEnv(c);
  if (!env.url || !env.key || !env.secret) throw new ConnectorError(`${c.name} has no WooCommerce URL, consumer key or secret set.`);
  const url = `${env.url.replace(/\/+$/, '')}/wp-json/wc/v3/orders?${new URLSearchParams(params)}`;
  const res = await fetchRetry(url, { headers: { Authorization: basicAuth(env.key, env.secret), Accept: 'application/json' } }, { label: `${c.name} (WooCommerce)` });
  if (!res.ok) {
    const why = res.status === 401 ? 'the consumer key was refused (it needs Read access)' : await errorText(res);
    throw new ConnectorError(`${c.name} (WooCommerce) answered ${res.status}: ${why}`, res.status);
  }
  return { orders: (await res.json()) as WooOrder[], total: Number(res.headers.get('x-wp-total')), pages: Number(res.headers.get('x-wp-totalpages')) };
}

export const woo: Connector = {
  async check(c) {
    try {
      const { total } = await get(c, { per_page: '1' });
      return { ok: true, note: `Connected to ${c.name}${Number.isFinite(total) ? `; ${total} orders visible` : ''}.` };
    } catch (err) {
      return { ok: false, note: err instanceof Error ? err.message : String(err) };
    }
  },

  async *pull(c, since, opts = {}) {
    const from = since ?? new Date(Date.now() - (opts.days ?? 60) * DAY);
    const perPage = Math.min(100, Math.max(1, opts.pageSize ?? 100));
    const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
    for (let page = 1; page <= maxPages; page++) {
      const { orders, pages } = await get(c, {
        modified_after: from.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        dates_are_gmt: 'true',
        orderby: 'modified',
        order: 'asc',
        per_page: String(perPage),
        page: String(page),
      });
      if (orders.length) yield orders.map((o) => mapWooOrder(c, o));
      if (orders.length < perPage || (Number.isFinite(pages) && page >= pages)) break;
    }
  },

  verifyWebhook(c, rawBody, headers) {
    return verifyWooSignature(rawBody, headers.get('x-wc-webhook-signature'), channelEnv(c).webhookSecret);
  },

  /** order.created / order.updated carry the full order. Woo's ping on webhook creation is form-encoded and maps to null. */
  async parseWebhook(c, topic, payload): Promise<IncomingOrder | null> {
    if (!WOO_TOPICS.has(topic) || !payload || typeof payload !== 'object' || !('id' in payload)) return null;
    return mapWooOrder(c, payload as WooOrder);
  },
};
