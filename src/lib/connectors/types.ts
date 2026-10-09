import type { ChannelDef } from '../channels';
import type { Address, Order, OrderItem } from '../db/schema';

/** What every connector hands the engine: one order, normalised, money in minor units. */
export type IncomingOrder = {
  channelId: string;
  externalId: string; // platform id (Shopify GID, Medusa id, Woo id) — unique per channel
  number: string; // what staff and customers say: "#1042", "FIG-1042"
  source: 'shopify' | 'medusa' | 'woo' | 'demo';
  placedAt: Date;
  customerName: string;
  phone?: string | null; // raw; the engine normalises
  email?: string | null;
  address?: Address | null;
  currency: string;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  paymentMethod: 'cod' | 'card' | 'wallet' | 'knet' | 'instapay';
  paymentStatus: 'pending' | 'paid' | 'cod_due' | 'refunded' | 'partially_refunded' | 'voided';
  items: IncomingItem[];
  note?: string | null;
  tags?: string[];
  /** Facts the platform already knows that can move Relay forward (never backwards). */
  platform?: {
    cancelled?: { at: Date; reason?: string | null };
    fulfilled?: { at: Date; tracking?: string | null; company?: string | null; url?: string | null };
    delivered?: { at: Date };
    refunded?: boolean;
  };
};

export type IncomingItem = {
  sku?: string | null;
  barcode?: string | null;
  title: string;
  variant?: string | null;
  size?: string | null;
  brand?: string | null;
  category?: string | null;
  image?: string | null;
  quantity: number;
  unitPrice: number; // minor units
};

export type ConnectionCheck = {
  ok: boolean;
  note: string; // one plain sentence for the Channels screen
  shop?: { name?: string; currency?: string; timezone?: string };
  scopes?: string[];
  missing?: string[]; // scopes Relay needs and the token lacks
};

export type WriteBackChange =
  | { kind: 'stage_tag'; stage: string }
  | { kind: 'fulfil'; tracking: string; company: string; url?: string | null; notifyCustomer: boolean }
  | { kind: 'mark_paid' };

export type WriteBackResult = { ok: boolean; note: string; skipped?: boolean };

export interface Connector {
  /** Cheap, read-only: can we talk to the store, and does the token carry what Relay needs? */
  check(c: ChannelDef): Promise<ConnectionCheck>;
  /** Pages of orders updated since `since` (null = the last `days` days), oldest first. */
  pull(c: ChannelDef, since: Date | null, opts?: { days?: number; pageSize?: number; maxPages?: number }): AsyncGenerator<IncomingOrder[]>;
  /** Webhooks: verify the signature over the exact raw body, then map the payload. */
  verifyWebhook?(c: ChannelDef, rawBody: string, headers: Headers): boolean;
  parseWebhook?(c: ChannelDef, topic: string, payload: unknown): Promise<IncomingOrder | null>;
  /** Optional: tell the store what happened in Relay. Always gated by RELAY_WRITE_BACK=true. */
  writeBack?(c: ChannelDef, order: Order & { lines: OrderItem[] }, change: WriteBackChange): Promise<WriteBackResult>;
}
