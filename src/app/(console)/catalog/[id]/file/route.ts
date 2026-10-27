import { currentUser } from '@/lib/auth/session';
import { exportFile } from '@/lib/catalog/jobs';

/** An export's workbook, as it was written when the export finished. */
export async function GET(_req: Request, ctx: RouteContext<'/catalog/[id]/file'>) {
  const me = await currentUser();
  if (!me) return new Response('Signed out', { status: 401 });
  const f = await exportFile(me, (await ctx.params).id).catch(() => null);
  if (!f) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: {
      'Content-Type': f.mime,
      // a header carries plain ASCII; the full name goes in filename*
      'Content-Disposition': `attachment; filename="${f.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
