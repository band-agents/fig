import { currentUser } from '@/lib/auth/session';
import { can } from '@/lib/domain/perms';
import { templateSheets } from '@/lib/catalog/sheets';
import { sheetResponse } from '@/lib/sheet-response';

/** The products template: the usual columns, two example products and a sheet explaining every column. */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me || !can(me, 'catalog', 1)) return new Response('Not allowed', { status: 403 });
  return sheetResponse(templateSheets(), 'products-import-template', new URL(req.url).searchParams.get('format'));
}
