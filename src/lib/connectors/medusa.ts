import 'server-only';
// Medusa v2 admin API (the FIG and Labesny apps), read with a secret API key. Read-only: no webhooks,
// no write-back. App orders also reach Shopify; shopify-map files that copy under the same id.
import { channelEnv, type ChannelDef } from '../channels';
import type { Connector } from './types';
import { basicAuth, ConnectorError, errorText, fetchRetry } from './http';
import { mapMedusaOrder, MEDUSA_ORDER_FIELDS, type MedusaOrder } from './medusa-map';

const DAY = 86_400_000;

async function get<T>(c: ChannelDef, path: string, params: Record<string, string>): Promise<T> {
  const env = channelEnv(c);
  if (!env.url || !env.key) throw new ConnectorError(`${c.name} app has no Medusa URL or secret API key set.`);
  const url = `${env.url.replace(/\/+$/, '')}${path}?${new URLSearchParams(params)}`;
  const res = await fetchRetry(url, { headers: { Authorization: basicAuth(env.key, ''), Accept: 'application/json' } }, { label: `${c.name} app (Medusa)` });
  if (!res.ok) {
    const why = res.status === 401 ? 'the secret API key was refused' : await errorText(res);
    throw new ConnectorError(`${c.name} app (Medusa) answered ${res.status}: ${why}`, res.status);
  }
  return (await res.json()) as T;
}

export const medusa: Connector = {
  async check(c) {
    try {
      const body = await get<{ count?: number }>(c, '/admin/orders', { limit: '1', fields: 'id' });
      return { ok: true, note: `Connected to the ${c.name} app backend; ${body.count ?? 0} orders visible.` };
    } catch (err) {
      return { ok: false, note: err instanceof Error ? err.message : String(err) };
    }
  },

  async *pull(c, since, opts = {}) {
    const from = since ?? new Date(Date.now() - (opts.days ?? 60) * DAY);
    const limit = Math.min(100, Math.max(1, opts.pageSize ?? 50));
    const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const body = await get<{ orders?: MedusaOrder[]; count?: number }>(c, '/admin/orders', {
        limit: String(limit),
        offset: String(offset),
        order: 'updated_at',
        'updated_at[$gte]': from.toISOString(),
        fields: MEDUSA_ORDER_FIELDS,
      });
      const orders = body.orders ?? [];
      if (orders.length) yield orders.map((o) => mapMedusaOrder(c, o));
      offset += orders.length;
      if (orders.length < limit || (body.count !== undefined && offset >= body.count)) break;
    }
  },
};
