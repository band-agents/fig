import 'server-only';
import { deflateRawSync } from 'node:zlib';
import { fileName, toCsv, toXlsx, XLSX_TYPE, type Sheet } from './sheet';

/** An export route's answer: the sheets as .xlsx (the default) or the first as .csv, named for keeping. */
export function sheetResponse(sheets: Sheet[], base: string, format: string | null) {
  const csv = format === 'csv';
  const body = csv ? toCsv(sheets[0] ?? { name: base, columns: [], rows: [] }) : toXlsx(sheets, (b) => new Uint8Array(deflateRawSync(b)));
  const name = fileName(base, csv ? 'csv' : 'xlsx');
  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': csv ? 'text/csv; charset=utf-8' : XLSX_TYPE,
      // a header carries plain ASCII; the full name (Arabic brand names too) goes in filename*
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
