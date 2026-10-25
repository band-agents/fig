import { currentUser } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { moversList, periodOf } from '@/lib/brands';
import { styleSheet } from '@/lib/brands-sheets';
import { sheetResponse } from '@/lib/sheet-response';

/** Every style the movers list holds for these filters, not just the first screen. */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me || !canSee(me, 'brands')) return new Response('Not allowed', { status: 403 });
  const u = new URL(req.url).searchParams;
  const weeks = periodOf(u.get('weeks'));
  const f = { brand: u.get('brand') ?? undefined, pace: u.get('pace') ?? undefined, category: u.get('category') ?? undefined, q: u.get('q') ?? undefined };
  const d = await moversList(me, weeks, f);
  return sheetResponse([styleSheet(d.rows, { money: d.money, currency: d.currency, weeks, name: 'Movers' })], `movers-${f.pace || 'all'}-${weeks}-weeks`, u.get('format'));
}
