import { currentUser } from '@/lib/auth/session';
import { importTemplate, isKind, mayImport } from '@/lib/imports';
import { sheetResponse } from '@/lib/sheet-response';

/** The sheet to fill in for an import, already holding today's figures where there are any. */
export async function GET(req: Request, ctx: RouteContext<'/imports/[kind]/template'>) {
  const me = await currentUser();
  const { kind } = await ctx.params;
  if (!me || !isKind(kind) || !mayImport(me, kind)) return new Response('Not allowed', { status: 403 });
  const sheet = await importTemplate(me, kind);
  return sheetResponse([sheet], `${kind}-template`, new URL(req.url).searchParams.get('format'));
}
