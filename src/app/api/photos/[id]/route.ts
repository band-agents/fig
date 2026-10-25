import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { seesBrands, seesChannel } from '@/lib/domain/perms';
import { photoById } from '@/lib/return-photos';

export const dynamic = 'force-dynamic';

/**
 * Serves one photograph from a return, to the desk.
 *
 * It lives here rather than under `/api/returns` on purpose: that path is the customer's and the
 * proxy lets anyone through it. A customer's photograph of their own bedroom floor is theirs, and
 * only someone signed in, with the store it belongs to in their scope, may look at it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await ctx.params;

  const photo = await photoById(id);
  if (!photo) return new Response('Not found', { status: 404 });

  const db = await getDb();
  const [ret] = await db.select().from(schema.returns).where(eq(schema.returns.id, photo.returnId));
  if (!ret || !seesChannel(me, ret.channelId)) return new Response('Not found', { status: 404 });
  if (me.brands?.length && !seesBrands(me, (await db.select({ b: schema.orderItems.brand }).from(schema.orderItems).where(eq(schema.orderItems.orderId, ret.orderId))).map((x) => x.b))) return new Response('Not found', { status: 404 });

  const body = Buffer.from(photo.bytes, 'base64');
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': photo.mime,
      'Content-Length': String(body.length),
      /* A customer's photograph: cached by the one browser looking at it, never by anything between. */
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
