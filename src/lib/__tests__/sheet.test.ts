import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { major, toCsv, toXlsx, type Sheet } from '../sheet';
import { byHeader, numberIn, readCsv, readGrid } from '../sheet-read';

const sheet: Sheet = {
  name: 'Brands: top/slow',
  columns: [
    { key: 'brand', label: 'Brand' },
    { key: 'units', label: 'Pieces', kind: 'int' },
    { key: 'sales', label: 'Sales (KWD)', kind: 'num', decimals: 3 },
    { key: 'share', label: 'Share', kind: 'pct' },
    { key: 'day', label: 'First sale', kind: 'date' },
  ],
  rows: [
    { brand: 'Women Secret', units: 1250, sales: major(48_500, 'KWD'), share: 0.42, day: '2026-10-01' },
    { brand: 'لا في أون روز & "Co" <x>', units: 3, sales: 7.9, share: 0.05, day: new Date('2026-09-15T00:00:00Z') },
    { brand: 'Empty cells', units: null, sales: undefined, share: '', day: null },
  ],
};

describe('export', () => {
  it('writes an xlsx that reads back cell for cell', () => {
    const grid = readGrid(toXlsx([sheet, { ...sheet, name: 'Brands: top/slow' }]), 'x.xlsx');
    expect(grid[0]).toEqual(['Brand', 'Pieces', 'Sales (KWD)', 'Share', 'First sale']);
    expect(grid[1]).toEqual(['Women Secret', '1250', '48.5', '0.42', String(Date.UTC(2026, 9, 1) / 86_400_000 + 25569)]);
    expect(grid[2][0]).toBe('لا في أون روز & "Co" <x>');
    expect(grid[3][0]).toBe('Empty cells');
    expect(grid).toHaveLength(4);
  });

  it('writes a deflated xlsx as the server sends it, and reads it back the same', () => {
    const big = { ...sheet, rows: Array.from({ length: 400 }, (_, i) => ({ ...sheet.rows[0], units: i })) };
    const stored = toXlsx([big]);
    const packed = toXlsx([big], (b) => new Uint8Array(deflateRawSync(b)));
    expect(packed.length).toBeLessThan(stored.length / 4);
    expect(readGrid(packed, 'x.xlsx')).toEqual(readGrid(stored, 'x.xlsx'));
  });

  it('writes CSV with a byte-order mark and quotes what needs it', () => {
    const csv = toCsv(sheet);
    expect(csv.startsWith('﻿')).toBe(true);
    const back = readCsv(csv);
    expect(back[0]).toEqual(['Brand', 'Pieces', 'Sales (KWD)', 'Share', 'First sale']);
    expect(back[2][0]).toBe('لا في أون روز & "Co" <x>');
    expect(back[2][4]).toBe('2026-09-15');
  });

  it('keeps money in its own decimals', () => {
    expect(major(7900, 'KWD')).toBe(7.9);
    expect(major(125050, 'EGP')).toBe(1250.5);
    expect(major(null)).toBeNull();
  });
});

describe('import', () => {
  it('reads a compressed workbook as Excel saves it, with shared strings', () => {
    // the shape Excel writes: deflated parts, strings in sharedStrings.xml, a gap in the row
    const files: [string, string][] = [
      ['xl/workbook.xml', '<workbook><sheets><sheet name="Costs" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/sharedStrings.xml', '<sst><si><t>Barcode</t></si><si><t>Cost price</t></si><si><r><t>81</t></r><r><t>23</t></r></si></sst>'],
      ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>4.25</v></c></row></sheetData></worksheet>'],
    ];
    const grid = readGrid(deflatedZip(files), 'costs.xlsx');
    expect(grid).toEqual([
      ['Barcode', '', 'Cost price'],
      ['8123', '', '4.25'],
    ]);
  });

  it('finds columns by header name, whatever the case or punctuation', () => {
    const { rows, missing } = byHeader(
      [
        ['BARCODE', 'Cost Price (KWD)', 'note'],
        ['8123', '4.250', 'x'],
      ],
      { barcode: ['barcode', 'ean'], cost: ['cost', 'cost price kwd', 'cost price'], size: ['size'] },
    );
    expect(rows[0]).toEqual({ barcode: '8123', cost: '4.250', size: '' });
    expect(missing).toEqual(['size']);
  });

  it('takes a header that only adds a unit after the name, as the templates write them', () => {
    const { rows, missing } = byHeader(
      [
        ['Brand', 'Sales target (KWD)', 'Pieces target'],
        ['Etam', '1,200.500', '90'],
      ],
      { brand: ['brand'], value: ['sales target'], units: ['pieces target'] },
    );
    expect(missing).toEqual([]);
    expect(rows[0]).toEqual({ brand: 'Etam', value: '1,200.500', units: '90' });
  });

  it('reads numbers typed the usual ways', () => {
    expect(numberIn('1,250.5')).toBe(1250.5);
    expect(numberIn('1,250')).toBe(1250);
    expect(numberIn('12,5')).toBe(12.5);
    expect(numberIn('KWD 7.900')).toBe(7.9);
    expect(numberIn('12%')).toBe(0.12);
    expect(numberIn('')).toBeNull();
    expect(numberIn('n/a')).toBeNull();
  });

  it('reads semicolon CSV and quoted line breaks', () => {
    expect(readCsv('a;b\r\n"x\ny";2\r\n')).toEqual([
      ['a', 'b'],
      ['x\ny', '2'],
    ]);
  });
});

/** A minimal deflated zip, the way Excel writes its workbooks. */
function deflatedZip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [n, text] of files) {
    const name = enc.encode(n);
    const raw = enc.encode(text);
    const data = new Uint8Array(deflateRawSync(raw));
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(10, 8, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, raw.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
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
