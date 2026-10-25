import { createHmac } from 'node:crypto';
import { toMajor } from './format';

/**
 * Sends Labesny's returns to the Labesny app's Medusa backend, so the team sees every request in
 * the Medusa admin (Customer care → Returns) beside the customer's orders and saved items, and the
 * app can show a customer their own returns.
 *
 * Relay stays where returns are worked; Medusa holds a copy. Each send carries the whole return as
 * it stands, signed with HMAC-SHA256 over a secret both sides hold, so a lost send is put right by
 * the next and a repeat changes nothing. It runs after the return has been saved and never throws:
 * a Medusa that is down must not stop a customer opening a return or the floor moving one.
 *
 *   MEDUSA_RETURNS_URL      https://labesny-app.medusajs.app/hooks/returns   (off when unset)
 *   MEDUSA_RETURNS_SECRET   the same value as RETURNS_MIRROR_SECRET in Medusa
 *   RELAY_PUBLIC_URL        where Relay is reached, for the "Open in Relay" button
 *
 * Only Labesny's channels are sent; the other brands' returns have nowhere to go in that admin.
 * Money goes in the currency's main unit (15.250 KD), which is how Medusa holds it, not in fils.
 */

export type MirrorItem = {
  title: string;
  brand: string | null;
  size: string | null;
  variant: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  image: string | null;
  reason: string | null;
};

export type MirrorSnapshot = {
  id: string;
  number: string;
  stage: string;
  opened_via: string | null;
  store: string | null;
  order_number: string | null;
  customer: { name: string | null; email: string | null; phone: string | null };
  reason: string | null;
  reason_note: string | null;
  refund_method: string | null;
  amount: number | null;
  bonus: number | null;
  currency: string | null;
  branch: string | null;
  items: MirrorItem[];
  requested_at: string;
  stage_at: string | null;
  closed_at: string | null;
  relay_url: string | null;
};

type ReturnRow = {
  id: string;
  number: string;
  stage: string;
  openedVia: string | null;
  reason: string;
  reasonNote: string | null;
  refundMethod: string | null;
  amount: number | null;
  bonus: number | null;
  currency: string;
  branch: string | null;
  requestedAt: Date;
  stageAt: Date | null;
  closedAt: Date | null;
};
type OrderRow = { number: string; customerName: string; email: string | null; phone: string | null };
type Line = {
  title: string;
  brand: string | null;
  size: string | null;
  variant: string | null;
  sku: string | null;
  image: string | null;
  unitPrice: number | null;
  quantity: number;
  reason: string | null;
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** The return as Medusa stores it. Pure, so the shape is tested without a database. */
export function buildSnapshot(input: {
  ret: ReturnRow;
  order: OrderRow | null;
  lines: Line[];
  store: string | null;
  branchName: string | null;
  reasonLabel: (key: string) => string;
  relayUrl: string | null;
}): MirrorSnapshot {
  const { ret, order, lines } = input;
  const major = (minor: number | null) => (minor == null ? null : toMajor(minor, ret.currency));
  return {
    id: ret.id,
    number: ret.number,
    stage: ret.stage,
    opened_via: ret.openedVia,
    store: input.store,
    order_number: order?.number ?? null,
    customer: { name: order?.customerName ?? null, email: order?.email ?? null, phone: order?.phone ?? null },
    reason: ret.reason ? input.reasonLabel(ret.reason) : null,
    reason_note: ret.reasonNote,
    refund_method: ret.refundMethod,
    amount: major(ret.amount),
    bonus: major(ret.bonus),
    currency: ret.currency,
    branch: input.branchName,
    items: lines.map((l) => ({
      title: l.title,
      brand: l.brand,
      size: l.size,
      variant: l.variant,
      sku: l.sku,
      quantity: l.quantity,
      unit_price: major(l.unitPrice),
      image: l.image,
      reason: l.reason ? input.reasonLabel(l.reason) : null,
    })),
    requested_at: iso(ret.requestedAt)!,
    stage_at: iso(ret.stageAt),
    closed_at: iso(ret.closedAt),
    relay_url: input.relayUrl,
  };
}

export function signMirrorBody(body: string, secret: string) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export const mirrorConfigured = () => !!(process.env.MEDUSA_RETURNS_URL && process.env.MEDUSA_RETURNS_SECRET);

/**
 * Reads the return as it now stands and sends it. Resolves to what happened, for logs and tests;
 * never rejects.
 */
export async function mirrorReturn(returnId: string): Promise<'sent' | 'off' | 'skipped' | 'failed'> {
  if (!mirrorConfigured()) return 'off';
  try {
    const [{ getDb, schema }, { eq }, { CHANNEL }, { findBranch }, { RETURN_REASONS }] = await Promise.all([
      import('./db'),
      import('drizzle-orm'),
      import('./channels'),
      import('./domain/branches'),
      import('./domain/stages'),
    ]);
    const db = await getDb();
    const [ret] = await db.select().from(schema.returns).where(eq(schema.returns.id, returnId));
    if (!ret) return 'skipped';
    const channel = CHANNEL[ret.channelId];
    if (channel?.brand !== 'Labesny') return 'skipped';

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, ret.orderId));
    const picked = await db
      .select({
        title: schema.orderItems.title,
        brand: schema.orderItems.brand,
        size: schema.orderItems.size,
        variant: schema.orderItems.variant,
        sku: schema.orderItems.sku,
        image: schema.orderItems.image,
        unitPrice: schema.orderItems.unitPrice,
        quantity: schema.returnItems.quantity,
        reason: schema.returnItems.reason,
      })
      .from(schema.returnItems)
      .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.returnItems.orderItemId))
      .where(eq(schema.returnItems.returnId, returnId));

    const base = process.env.RELAY_PUBLIC_URL?.replace(/\/$/, '') || null;
    const snapshot = buildSnapshot({
      ret: ret as unknown as ReturnRow,
      order: order ?? null,
      lines: picked as Line[],
      store: channel ? `${channel.name} ${channel.surface}` : null,
      branchName: findBranch(channel.brand, channel.country, ret.branch)?.name ?? ret.branch ?? null,
      reasonLabel: (k) => (RETURN_REASONS as Record<string, string>)[k] ?? k.replace(/_/g, ' '),
      relayUrl: base ? `${base}/returns/${ret.id}` : null,
    });

    const body = JSON.stringify(snapshot);
    const res = await fetch(process.env.MEDUSA_RETURNS_URL!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-relay-signature': signMirrorBody(body, process.env.MEDUSA_RETURNS_SECRET!),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[medusa-mirror] ${ret.number}: Medusa answered ${res.status}`);
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.warn(`[medusa-mirror] ${returnId}: ${String(e).slice(0, 200)}`);
    return 'failed';
  }
}
