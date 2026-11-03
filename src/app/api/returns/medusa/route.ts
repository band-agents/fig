import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { openReturn } from '@/lib/engine';
import { isReturnReason, portalOrder } from '@/lib/returns-portal';
import { signMirrorBody } from '@/lib/medusa-mirror';
import type { RefundMethod } from '@/lib/domain/refund-methods';
import { httpError, invalid, notFound } from '@/lib/errors';
import { readPhotos, savePhotos } from '@/lib/return-photos';
import { CHANNEL } from '@/lib/channels';
import { findBranch } from '@/lib/domain/branches';
import { toMinor } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Line = { sku?: string | null; barcode?: string | null; title?: string; quantity?: number };

/**
 * Where FIG's and Labesny's app backends (Medusa) send a return a customer opened on figeg.com,
 * labesny.com or in the app, so the console holds every return and works it (Dan, 2 Nov: "everyone
 * sees each other"; 3 Nov: every website return, with everything the customer chose). Medusa
 * has already checked the customer against the Shopify order; this opens the return on the console's
 * copy of that order, books the UPS pickup when they asked to be collected at home, and answers the RMA
 * number. The console then sends its copy back to Medusa (medusa-mirror.ts), as it does for every return.
 *
 *   POST /api/returns/medusa    x-relay-signature: <hex HMAC-SHA256 of the body, MEDUSA_RETURNS_SECRET>
 *   { shopify_order_id, items: [{ sku, barcode, title, quantity }], reason, note, refund_method,
 *     branch, pickup: "home" | "shop", photos[], via: "portal" | "app", amount, bonus }
 *
 * amount and bonus are what the site showed the customer, in the currency's main unit (EGP 1,082.00,
 * 15.250 KD); the return keeps them rather than working its own out, since the customer was promised them.
 *
 * Shopify's line ids are not kept here, so each line is found by its barcode or SKU, then its title.
 */
export async function POST(req: Request) {
  const secret = process.env.MEDUSA_RETURNS_SECRET?.trim();
  if (!secret) return Response.json({ error: 'not_connected' }, { status: 503 });
  const raw = await req.text();
  const want = Buffer.from(signMirrorBody(raw, secret), 'hex');
  const got = Buffer.from((req.headers.get('x-relay-signature') ?? '').trim(), 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return Response.json({ error: 'bad_signature' }, { status: 401 });

  try {
    let body: {
      shopify_order_id?: string;
      items?: Line[];
      reason?: string;
      note?: string;
      refund_method?: RefundMethod;
      branch?: string | null;
      /** The shop's name as the site knows it, for a shop id the console doesn't have (FIG's). */
      branch_name?: string | null;
      pickup?: 'home' | 'shop';
      photos?: unknown;
      via?: 'portal' | 'app';
      amount?: number;
      bonus?: number;
    };
    try {
      body = JSON.parse(raw);
    } catch {
      throw invalid('Send a JSON body.');
    }

    const db = await getDb();
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.externalId, String(body.shopify_order_id ?? '')));
    if (!o) throw notFound('That order is not in the console yet.');
    const order = await portalOrder(o);

    const key = (s?: string | null) => (s ?? '').trim().toLowerCase();
    const left = new Map(order.items.map((i) => [i.id, i.available]));
    const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id));
    const picked: { orderItemId: string; quantity: number }[] = [];
    for (const want of body.items ?? []) {
      let qty = Math.floor(Number(want.quantity) || 0);
      const codes = [key(want.barcode), key(want.sku)].filter(Boolean);
      const match = (l: (typeof lines)[number]) => (codes.length && codes.some((c) => c === key(l.barcode) || c === key(l.sku))) || key(l.title) === key(want.title);
      // the same piece can sit on two lines (one split -DH, one -DCO): fill each in turn
      for (const l of lines.filter(match)) {
        if (qty <= 0) break;
        const take = Math.min(qty, left.get(l.id) ?? 0);
        if (!take) continue;
        picked.push({ orderItemId: l.id, quantity: take });
        left.set(l.id, (left.get(l.id) ?? 0) - take);
        qty -= take;
      }
      if (qty > 0) throw invalid(`${want.title ?? 'One of those pieces'} is not on the console's copy of ${o.number}, or has already gone back.`);
    }
    if (!picked.length) throw invalid('Choose at least one item to return.');

    const reason = body.reason ?? '';
    if (!isReturnReason(reason)) throw invalid('Choose a reason for the return.');
    const photos = readPhotos(body.photos, { required: false });
    const refundMethod: RefundMethod = body.refund_method ?? 'original';
    // collected only when they asked for it (the fee is theirs, Dan 3 Nov); otherwise they bring it to the shop
    const toShop = body.pickup !== 'home' || refundMethod === 'cash_at_store' || order.storeOnly;
    const brand = CHANNEL[o.channelId]?.brand ?? '';
    const site = brand === 'FIG' ? 'figeg.com' : brand === 'Labesny' ? 'labesny.com' : 'the website';
    const known = findBranch(brand || 'FIG', CHANNEL[o.channelId]?.country ?? 'EG', body.branch ?? null);
    const shopNote = !known && body.branch_name?.trim() ? `Shop chosen: ${body.branch_name.trim()}` : '';
    const note = [shopNote, body.note?.trim()].filter(Boolean).join(' · ') || undefined;
    const amount = Number(body.amount);
    const bonus = Number(body.bonus ?? 0);

    const ret = await openReturn({ id: null, name: `Customer (${body.via === 'app' ? `${brand || 'the'} app` : site} · ${o.number})`, dept: null }, o.id, {
      items: picked,
      reason,
      note,
      refundMethod,
      method: toShop ? 'store' : 'pickup',
      branch: body.branch ?? null,
      openedVia: body.via === 'app' ? 'app' : 'portal',
      site: Number.isFinite(amount) && amount >= 0 ? { amount: toMinor(amount, o.currency), bonus: Number.isFinite(bonus) && bonus > 0 ? toMinor(bonus, o.currency) : 0 } : undefined,
    });
    if (photos.length) await savePhotos(ret.id, photos);

    return Response.json({ ok: true, id: ret.id, number: ret.number, method: ret.method, amount: ret.amount, bonus: ret.bonus, currency: ret.currency });
  } catch (e) {
    const { status, body: payload } = httpError(e);
    return Response.json(payload, { status });
  }
}
