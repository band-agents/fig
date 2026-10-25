// server side only: it reads with Node's zlib
import { inflateRawSync } from 'node:zlib';

/**
 * A file someone uploads (an Excel .xlsx or a .csv) as a grid of text: the first sheet, every row, every
 * cell as Excel shows it. No library: an .xlsx is a zip, read here with Node's own inflate. Imports then
 * match the header row to their columns by name (`byHeader`), so a sheet exported from the console, edited
 * and uploaded again lands back in the same place.
 */
export function readGrid(buf: Uint8Array, filename = ''): string[][] {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) return readXlsx(buf);
  if (/\.xls$/i.test(filename)) throw new Error('Old .xls files cannot be read: save it as .xlsx (Excel Workbook) or .csv and upload again.');
  return readCsv(new TextDecoder('utf-8').decode(buf));
}

// ── CSV ──

export function readCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  // a semicolon file (Excel in some regions) when the first line has more of them than commas
  const first = s.slice(0, s.search(/\r?\n/) === -1 ? s.length : s.search(/\r?\n/));
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ── XLSX ──

function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // the end record sits in the last 64 KB
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This file is not a readable Excel workbook.');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^xl\/(worksheets\/sheet\d+|sharedStrings|workbook)\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(name)) continue;
    const lName = dv.getUint16(local + 26, true);
    const lExtra = dv.getUint16(local + 28, true);
    const start = local + 30 + lName + lExtra;
    const raw = buf.subarray(start, start + size);
    out.set(name, method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw);
  }
  return out;
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** The text of a string item: plain, or several formatted runs. */
const textOf = (si: string) => unxml([...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+$/, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function readXlsx(buf: Uint8Array): string[][] {
  const files = unzip(buf);
  const dec = new TextDecoder();
  const read = (n: string) => (files.has(n) ? dec.decode(files.get(n)) : null);
  // the first sheet in the workbook's own order
  let path = 'xl/worksheets/sheet1.xml';
  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  const firstId = wb?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (firstId && rels) {
    const target = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstId}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstId}"`))?.[1];
    if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = read(path) ?? read('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('This workbook has no sheet to read.');
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const t = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = '';
      if (t === 's') text = v != null ? (shared[Number(v)] ?? '') : '';
      else if (t === 'inlineStr') text = textOf(body);
      else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else text = v != null ? unxml(v) : '';
      const at = ref ? colIndex(ref) : row.length;
      while (row.length < at) row.push('');
      row[at] = text;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
}

// ── matching a header row to what an import needs ──

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();

/**
 * Rows as objects keyed by the import's own field names, finding each field's column by any of its
 * accepted header names (case, spaces and punctuation ignored). Fields not found are listed, so the
 * import can say which column is missing instead of failing quietly.
 */
export function byHeader<K extends string>(grid: string[][], fields: Record<K, string[]>): { rows: Record<K, string>[]; missing: K[]; header: string[] } {
  const header = (grid[0] ?? []).map((h) => (h ?? '').trim());
  const at = {} as Record<K, number>;
  const missing: K[] = [];
  for (const k of Object.keys(fields) as K[]) {
    const names = fields[k].map(norm);
    // the exact name first; then a header that only adds a unit after it ("Sales target (KWD)")
    let i = header.findIndex((h) => names.includes(norm(h)));
    if (i < 0) i = header.findIndex((h) => names.some((n) => norm(h).startsWith(`${n} `)));
    if (i < 0) missing.push(k);
    at[k] = i;
  }
  const rows = grid.slice(1).map((r) => {
    const o = {} as Record<K, string>;
    for (const k of Object.keys(fields) as K[]) o[k] = at[k] >= 0 ? (r[at[k]] ?? '').trim() : '';
    return o;
  });
  return { rows, missing, header };
}

/** A number typed any usual way: "1,250.5", "1,250" (thousands), "12,5" (comma decimal), "12%", "KWD 7.900". */
export function numberIn(s: string): number | null {
  const t = s.replace(/[^\d.,\-%]/g, '');
  if (!t || t === '-' || t === '.') return null;
  let x = t.replace('%', '');
  // a comma with one or two digits after it, and no point, is a decimal comma; three digits is thousands
  if (/,\d{1,2}$/.test(x) && !x.includes('.')) x = x.replace(',', '.');
  else x = x.replace(/,/g, '');
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return t.includes('%') ? n / 100 : n;
}
