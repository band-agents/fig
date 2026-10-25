/**
 * Tables out as Excel or CSV, in the browser or on the server, with no library: an .xlsx is a zip of a
 * few XML files, written here uncompressed. Every list in the console exports through this, so a sheet
 * always opens the same way: bold header row, frozen and filterable, numbers as numbers (money with its
 * currency's decimals, percentages as %), dates as dates, columns wide enough to read.
 *
 * Money goes in as major units (12.5 KWD, not 12500): callers convert with `major()`.
 */

export type ColKind = 'text' | 'int' | 'num' | 'pct' | 'date';
export type Col = { key: string; label: string; kind?: ColKind; decimals?: number };
export type Sheet = { name: string; columns: Col[]; rows: Record<string, unknown>[] };

/** Minor units (fils, piastres) to a plain number in the currency: KWD/JOD keep 3 decimals, others 2. */
export const major = (minor: number | null | undefined, currency = 'EGP') => (minor == null ? null : minor / (currency === 'KWD' || currency === 'JOD' ? 1000 : 100));
export const moneyDecimals = (currency = 'EGP') => (currency === 'KWD' || currency === 'JOD' ? 3 : 2);

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────────

const csvCell = (v: unknown) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** With a byte-order mark, so Excel opens Arabic names and accents correctly. */
export function toCsv(s: Sheet): string {
  const lines = [s.columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of s.rows) lines.push(s.columns.map((c) => csvCell(r[c.key])).join(','));
  return '﻿' + lines.join('\r\n');
}

// ── XLSX ─────────────────────────────────────────────────────────────────────────────────────────────

const xml = (s: string) =>
  s
    // characters XML 1.0 cannot carry at all
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// cell styles, by index in styles.xml: 0 plain, 1 header, 2 whole number, 3 two decimals, 4 three decimals, 5 percent, 6 date
const STYLE = { header: 1, int: 2, dec2: 3, dec3: 4, pct: 5, date: 6 } as const;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="#,##0.000"/><numFmt numFmtId="167" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEBE9E4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const styleFor = (c: Col) => {
  if (c.kind === 'int') return STYLE.int;
  if (c.kind === 'pct') return STYLE.pct;
  if (c.kind === 'date') return STYLE.date;
  if (c.kind === 'num') return c.decimals === 3 ? STYLE.dec3 : c.decimals === 0 ? STYLE.int : STYLE.dec2;
  return 0;
};

const toDate = (v: unknown) => (v instanceof Date ? v : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v) : null);

function cell(c: Col, v: unknown, ref: string): string {
  if (v == null || v === '') return '';
  if (c.kind && c.kind !== 'text') {
    if (c.kind === 'date') {
      const d = toDate(v);
      // Excel counts days from 30 Dec 1899
      if (d && !Number.isNaN(d.getTime())) return `<c r="${ref}" s="${STYLE.date}"><v>${d.getTime() / 86_400_000 + 25569}</v></c>`;
    } else {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
      if (Number.isFinite(n)) return `<c r="${ref}" s="${styleFor(c)}"><v>${n}</v></c>`;
    }
  }
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(s)}</t></is></c>`;
}

function sheetXml(s: Sheet): string {
  const widths = s.columns.map((c) => {
    let w = c.label.length;
    for (let i = 0; i < Math.min(s.rows.length, 400); i++) {
      const v = s.rows[i][c.key];
      if (v != null) w = Math.max(w, (v instanceof Date ? 10 : String(v).length) + (c.kind && c.kind !== 'text' ? 2 : 0));
    }
    return Math.min(60, Math.max(6, w + 2));
  });
  const last = colName(Math.max(0, s.columns.length - 1));
  const rows: string[] = [];
  rows.push(`<row r="1">${s.columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${xml(c.label)}</t></is></c>`).join('')}</row>`);
  s.rows.forEach((r, ri) => {
    const n = ri + 2;
    rows.push(`<row r="${n}">${s.columns.map((c, i) => cell(c, r[c.key], `${colName(i)}${n}`)).join('')}</row>`);
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (s.columns.length ? `<autoFilter ref="A1:${last}${s.rows.length + 1}"/>` : '') +
    `</worksheet>`
  );
}

/** A sheet name Excel accepts: 31 characters, none of []:*?/\ , unique in the book. */
function sheetNames(sheets: Sheet[]) {
  const seen = new Set<string>();
  return sheets.map((s, i) => {
    const base = (s.name || `Sheet ${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet ${i + 1}`;
    let name = base;
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${base.slice(0, 28)} ${k}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** `deflate` (the server passes Node's raw deflate) shrinks the file about tenfold; without it the parts are stored as they are. */
export function toXlsx(sheets: Sheet[], deflate?: (b: Uint8Array) => Uint8Array): Uint8Array {
  const names = sheetNames(sheets);
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    ],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)] as [string, string]),
  ];
  return zip(
    files.map(([name, text]) => ({ name, data: new TextEncoder().encode(text) })),
    deflate,
  );
}

// ── a zip: stored, or deflated when the caller can (the server) ──

let CRC: Uint32Array | null = null;
function crc32(b: Uint8Array) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[], deflate?: (b: Uint8Array) => Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const packed = deflate ? deflate(f.data) : f.data;
    const method = deflate ? 8 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names in UTF-8
    local.setUint16(8, method, true); // 0 stored, 8 deflated
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, packed.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const b of all) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A file name people can keep: words joined by dashes, and today's date. */
export const fileName = (base: string, ext: 'xlsx' | 'csv') =>
  `${base
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'export'}-${new Date().toISOString().slice(0, 10)}.${ext}`;
