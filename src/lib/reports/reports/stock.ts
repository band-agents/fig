import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { lucidaConfigured } from '../../connectors/lucida';
import { lastBranchRun } from '../../branch-stock';
import { CATEGORY_LABEL, type Category } from '../../domain/stock/categories';
import { n, ratio, shareOf, type Col, type Report, type Row } from '../engine';
import { stylesFor } from './brands';

const catLabel = (c: string) => CATEGORY_LABEL[c as Category] ?? c;

const byBranch: Report = {
  id: 'stock-by-branch',
  group: 'stock',
  title: 'Stock by branch',
  blurb: 'Every style and size, and how many pieces each branch and the warehouse hold, from Lucida.',
  for: ['brand', 'ops', 'management'],
  filters: ['brand', 'category', 'branch'],
  snapshot: true,
  async run(c) {
    const db = await getDb();
    const last = await lastBranchRun();
    if (!lucidaConfigured())
      return {
        figures: [],
        charts: [],
        tables: [],
        empty: 'Lucida is not connected to the console yet, so it cannot say what each branch holds.',
        notes: ['To switch it on, the Lucida logins (one per company database: D&H, DCO, FIG) go in LUCIDA_ACCOUNTS in relay/.env.local. Best is a separate read-only login from Kaitco for this console.'],
      };
    const r = await db.execute<{ barcode: string; store: string; store_name: string | null; qty: number; title: string | null; brand: string | null; category: string | null; size: string | null; checked: string }>(sql`
      select bs.barcode, bs.account || ':' || bs.store_code as store, bs.store_name, bs.qty, p.title, p.brand, p.category, v.size, bs.checked_at::text as checked
      from branch_stock bs
      join variants v on v.barcode = bs.barcode join products p on p.id = v.product_id
      where bs.qty > 0 and ${c.products('p')} ${c.q.branch ? sql`and bs.store_code = ${c.q.branch}` : sql``}`);
    if (!r.rows.length)
      return {
        figures: [],
        charts: [],
        tables: [],
        empty: last?.ok === false ? `The last reading failed: ${last.note}` : 'Lucida has not been read for every branch yet. It runs every night, or now with “Read every branch”.',
      };
    const stores = new Map<string, { name: string; qty: number; styles: Set<string> }>();
    const styles = new Map<string, { title: string; brand: string; category: string; qty: number; by: Map<string, number> }>();
    for (const x of r.rows) {
      const s = stores.get(x.store) ?? (stores.set(x.store, { name: x.store_name ?? x.store.split(':')[1], qty: 0, styles: new Set() }), stores.get(x.store)!);
      s.qty += n(x.qty);
      s.styles.add(`${x.brand}|${x.title}`);
      const k = `${x.brand}|${x.title}`;
      const st = styles.get(k) ?? (styles.set(k, { title: x.title ?? x.barcode, brand: x.brand ?? '', category: x.category ?? '', qty: 0, by: new Map() }), styles.get(k)!);
      st.qty += n(x.qty);
      st.by.set(x.store, (st.by.get(x.store) ?? 0) + n(x.qty));
    }
    const storeList = [...stores.entries()].sort((a, b) => b[1].qty - a[1].qty);
    const shown = storeList.slice(0, 24);
    const T = storeList.reduce((a, [, s]) => a + s.qty, 0);
    const checked = r.rows.reduce((a, x) => (x.checked < a ? x.checked : a), r.rows[0].checked);
    return {
      figures: [
        { label: 'Pieces in branches', value: T, fmt: 'int' },
        { label: 'Branches holding stock', value: stores.size, fmt: 'int' },
        { label: 'Styles in stock', value: styles.size, fmt: 'int' },
        { label: 'Read from Lucida', value: checked.slice(0, 16).replace('T', ' '), fmt: 'text', note: last?.ok ? `${last.calls} calls` : undefined },
      ],
      charts: [{ kind: 'bars', title: 'Pieces by branch', rows: storeList.map(([, s]) => ({ label: s.name, value: s.qty, units: s.qty, sub: `${s.styles.size} styles · ${Math.round((s.qty / T) * 100)}%` })), fmt: 'int' }],
      tables: [
        {
          title: 'Style by branch',
          sub: `Pieces per branch${storeList.length > shown.length ? `, the ${shown.length} biggest branches as columns (export has all)` : ''}`,
          columns: [
            { key: 'style', label: 'Style', fmt: 'text', wide: true },
            { key: 'brand', label: 'Brand', fmt: 'text' },
            { key: 'total', label: 'Total', fmt: 'int', total: true },
            ...storeList.map<Col>(([code, s], i) => ({ key: `b:${code}`, label: s.name, fmt: 'int', total: true, ...(i >= shown.length ? { exportOnly: true } : {}) }) as Col),
          ],
          rows: [...styles.values()]
            .sort((a, b) => b.qty - a.qty)
            .map((s) => ({ style: s.title, brand: s.brand, total: s.qty, ...Object.fromEntries(storeList.map(([code]) => [`b:${code}`, s.by.get(code) ?? null])) })),
        },
        {
          title: 'Size by branch',
          sub: 'One line per barcode and branch, for export and search',
          columns: [
            { key: 'style', label: 'Style', fmt: 'text', wide: true },
            { key: 'brand', label: 'Brand', fmt: 'text' },
            { key: 'size', label: 'Size', fmt: 'text' },
            { key: 'barcode', label: 'Barcode', fmt: 'text' },
            { key: 'branch', label: 'Branch', fmt: 'text' },
            { key: 'qty', label: 'Pieces', fmt: 'int', total: true },
          ],
          rows: r.rows
            .sort((a, b) => String(a.title).localeCompare(String(b.title)) || String(a.size).localeCompare(String(b.size)))
            .map((x) => ({ style: x.title, brand: x.brand, size: x.size, barcode: x.barcode, branch: stores.get(x.store)?.name ?? x.store, qty: n(x.qty) })),
          limit: 200,
        },
      ],
    };
  },
};

const value: Report = {
  id: 'stock-value',
  group: 'stock',
  title: 'Stock value',
  blurb: 'Pieces on hand and what they are worth at retail and at cost, by brand, category and location.',
  for: ['finance', 'brand', 'management'],
  filters: ['brand', 'category'],
  snapshot: true,
  async run(c) {
    const ps = await stylesFor(c);
    type A = { styles: number; onHand: number; retail: number; cost: number; sold13: number };
    // Shopify holds no cost: until real costs are imported, the catalogue carries 40% of full price
    const estimated = (x: (typeof ps)[number]) => x.cost === Math.round((x.compareAt ?? x.price) * 0.4);
    const realShare = ratio(ps.filter((x) => x.onHand > 0 && !estimated(x)).length, ps.filter((x) => x.onHand > 0).length) ?? 0;
    const costLabel = realShare < 0.5 ? 'At cost (estimated)' : 'At cost';
    const add = (m: Map<string, A>, k: string, x: (typeof ps)[number]) => {
      const a = m.get(k) ?? (m.set(k, { styles: 0, onHand: 0, retail: 0, cost: 0, sold13: 0 }), m.get(k)!);
      a.styles += 1;
      a.onHand += x.onHand;
      a.retail += x.valueRetailEgp;
      a.cost += x.valueCostEgp;
      a.sold13 += x.sold13;
    };
    const brands = new Map<string, A>();
    const cats = new Map<string, A>();
    for (const x of ps) {
      if (x.onHand <= 0) continue;
      add(brands, x.brand, x);
      add(cats, catLabel(x.category), x);
    }
    const T = [...brands.values()].reduce((a, v) => ({ onHand: a.onHand + v.onHand, retail: a.retail + v.retail, cost: a.cost + v.cost, sold13: a.sold13 + v.sold13 }), { onHand: 0, retail: 0, cost: 0, sold13: 0 });
    const rowsOf = (m: Map<string, A>) =>
      [...m.entries()]
        .sort((a, b) => b[1].retail - a[1].retail || b[1].onHand - a[1].onHand)
        .map<Row>(([k, a]) => ({ name: k, styles: a.styles, onHand: a.onHand, share: shareOf(a.onHand, T.onHand), retail: c.money ? a.retail : null, cost: c.cost ? a.cost : null, cover: a.sold13 ? a.onHand / (a.sold13 / 13) : null }));
    const cols = (label: string): Col[] => [
      { key: 'name', label, fmt: 'text', wide: true },
      { key: 'styles', label: 'Styles', fmt: 'int', total: true },
      { key: 'onHand', label: 'Pieces', fmt: 'int', total: true },
      { key: 'share', label: 'Share', fmt: 'pct' },
      ...(c.money ? [{ key: 'retail', label: 'At retail', fmt: 'money' as const, total: true }] : []),
      ...(c.cost ? [{ key: 'cost', label: costLabel, fmt: 'money' as const, total: true }] : []),
      { key: 'cover', label: 'Cover', fmt: 'weeks' },
    ];
    const brandRows = rowsOf(brands);
    return {
      figures: [
        { label: 'Pieces on hand', value: T.onHand, fmt: 'int' },
        ...(c.money ? [{ label: 'At retail', value: T.retail, fmt: 'money' as const }] : []),
        ...(c.cost ? [{ label: costLabel, value: T.cost, fmt: 'money' as const, note: realShare < 0.5 ? '40% of full price, no real costs yet' : undefined }, { label: 'Margin in stock', value: ratio(T.retail - T.cost, T.retail), fmt: 'pct' as const, note: realShare < 0.5 ? 'estimated' : undefined }] : []),
        { label: 'Cover', value: T.sold13 ? T.onHand / (T.sold13 / 13) : null, fmt: 'weeks', note: 'at the last 13 weeks’ pace' },
      ],
      charts: [{ kind: 'bars', title: 'Stock by brand', rows: brandRows.slice(0, 15).map((r) => ({ label: String(r.name), value: n(r.retail), units: n(r.onHand), sub: `${Math.round(n(r.share) * 100)}% of pieces` })), fmt: 'money', measured: true }],
      tables: [
        { title: 'By brand', columns: cols('Brand'), rows: brandRows },
        { title: 'By category', columns: cols('Category'), rows: rowsOf(cats) },
      ],
      notes: ['The stock the console holds: the website’s own stock today; shop stock per branch is in Stock by branch once Lucida is connected.'],
      empty: T.onHand ? undefined : 'No stock on hand for these filters.',
    };
  },
};

const health: Report = {
  id: 'stock-health',
  group: 'stock',
  title: 'Stock health',
  blurb: 'Where stock is stuck or missing: styles not selling, too much cover, best sellers sold out, about to run out.',
  for: ['brand', 'ops', 'management'],
  filters: ['brand', 'category'],
  snapshot: true,
  async run(c) {
    const ps = (await stylesFor(c)).filter((x) => x.status !== 'archived');
    const cover = (x: (typeof ps)[number]) => (x.sold13 ? x.onHand / (x.sold13 / 13) : null);
    const dead = ps.filter((x) => x.onHand > 0 && (x.weeksSinceSale == null || x.weeksSinceSale >= 8)).sort((a, b) => b.valueRetailEgp - a.valueRetailEgp);
    const over = ps.filter((x) => x.onHand > 0 && (cover(x) ?? 0) > 26).sort((a, b) => (cover(b) ?? 0) - (cover(a) ?? 0));
    const out = ps.filter((x) => x.onHand <= 0 && x.sold8 > 0).sort((a, b) => b.sold8 - a.sold8);
    const low = ps.filter((x) => x.onHand > 0 && (cover(x) ?? 99) < 2 && x.sold8 > 0).sort((a, b) => (cover(a) ?? 0) - (cover(b) ?? 0));
    const row = (x: (typeof ps)[number]): Row => ({ style: x.title, brand: x.brand, season: x.season, onHand: x.onHand, sold8: x.sold8, weeks: x.weeksSinceSale, cover: cover(x), retail: c.money ? x.valueRetailEgp : null, _href: `/stock/inventory/${x.id}` });
    const cols: Col[] = [
      { key: 'style', label: 'Style', fmt: 'text', wide: true },
      { key: 'brand', label: 'Brand', fmt: 'text' },
      { key: 'season', label: 'Season', fmt: 'text' },
      { key: 'onHand', label: 'On hand', fmt: 'int', total: true },
      { key: 'sold8', label: 'Sold, 8 wk', fmt: 'int', total: true },
      { key: 'weeks', label: 'Weeks since a sale', fmt: 'int' },
      { key: 'cover', label: 'Cover', fmt: 'weeks' },
      ...(c.money ? [{ key: 'retail', label: 'At retail', fmt: 'money' as const, total: true }] : []),
    ];
    const sum = (xs: typeof ps) => xs.reduce((a, x) => a + x.valueRetailEgp, 0);
    return {
      figures: [
        { label: 'Not selling', value: dead.length, fmt: 'int', better: 'down', note: c.money ? `in stock, no sale in 8 weeks` : 'styles' },
        ...(c.money ? [{ label: 'Tied up in them', value: sum(dead), fmt: 'money' as const, better: 'down' as const }] : []),
        { label: 'Over 6 months of cover', value: over.length, fmt: 'int', better: 'down' },
        { label: 'Best sellers sold out', value: out.length, fmt: 'int', better: 'down', note: 'sold in 8 weeks, none left' },
        { label: 'Under 2 weeks left', value: low.length, fmt: 'int', better: 'down' },
      ],
      charts: [],
      tables: [
        { title: 'Best sellers sold out', sub: 'Sales being lost: reorder, transfer or take off the site', columns: cols, rows: out.map(row) },
        { title: 'About to run out', sub: 'Under two weeks of cover at the recent pace', columns: cols, rows: low.map(row) },
        { title: 'Not selling', sub: 'In stock with no sale in 8 weeks or more: mark down, move, or push', columns: cols, rows: dead.map(row), limit: 200 },
        { title: 'Too much stock', sub: 'Over 26 weeks of cover at the recent pace', columns: cols, rows: over.map(row), limit: 200 },
      ],
      empty: ps.length ? undefined : 'No styles for these filters.',
    };
  },
};

const sellThrough: Report = {
  id: 'sell-through',
  group: 'stock',
  title: 'Sell-through',
  blurb: 'Of what was available, how much sold in the last 13 weeks, by brand, category and season.',
  for: ['brand', 'management'],
  filters: ['brand', 'category'],
  snapshot: true,
  async run(c) {
    const ps = await stylesFor(c);
    const group = (key: (x: (typeof ps)[number]) => string) => {
      const m = new Map<string, { styles: number; sold: number; onHand: number }>();
      for (const x of ps) {
        if (!x.onHand && !x.sold13) continue;
        const k = key(x);
        const a = m.get(k) ?? (m.set(k, { styles: 0, sold: 0, onHand: 0 }), m.get(k)!);
        a.styles += 1;
        a.sold += x.sold13;
        a.onHand += x.onHand;
      }
      return [...m.entries()].map<Row>(([k, a]) => ({ name: k, styles: a.styles, sold: a.sold, onHand: a.onHand, st: ratio(a.sold, a.sold + a.onHand) })).sort((a, b) => n(b.st) - n(a.st));
    };
    const cols = (label: string): Col[] => [
      { key: 'name', label, fmt: 'text', wide: true },
      { key: 'styles', label: 'Styles', fmt: 'int', total: true },
      { key: 'sold', label: 'Sold, 13 wk', fmt: 'int', total: true },
      { key: 'onHand', label: 'On hand', fmt: 'int', total: true },
      { key: 'st', label: 'Sell-through', fmt: 'pct' },
    ];
    const brands = group((x) => x.brand);
    const sold = ps.reduce((a, x) => a + x.sold13, 0);
    const onHand = ps.reduce((a, x) => a + x.onHand, 0);
    return {
      figures: [
        { label: 'Sell-through', value: ratio(sold, sold + onHand), fmt: 'pct', note: 'sold in 13 weeks of sold + on hand' },
        { label: 'Pieces sold', value: sold, fmt: 'int' },
        { label: 'Pieces on hand', value: onHand, fmt: 'int' },
      ],
      charts: [{ kind: 'bars', title: 'Sell-through by brand', rows: brands.slice(0, 15).map((r) => ({ label: String(r.name), value: n(r.st), sub: `${r.sold} of ${n(r.sold) + n(r.onHand)}` })), fmt: 'pct' }],
      tables: [
        { title: 'By brand', columns: cols('Brand'), rows: brands },
        { title: 'By category', columns: cols('Category'), rows: group((x) => catLabel(x.category)) },
        { title: 'By season', columns: cols('Season'), rows: group((x) => x.season || 'No season') },
      ],
      empty: sold + onHand ? undefined : 'No stock or sales for these filters.',
    };
  },
};

export const STOCK_REPORTS: Report[] = [byBranch, value, health, sellThrough];
