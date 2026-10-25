import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { CHANNEL } from '../../channels';
import { can, seesCost, type Area, type Principal } from '../../domain/perms';
import { brandMatch } from '../../queries';
import type { Market } from '../../domain/stock/calendar';

/** The markets a person's store scope covers: the Kuwait team sees Kuwait stock, and only that. */
export function marketsFor(p: Pick<Principal, 'channels'>): Market[] {
  if (!p.channels.length) return ['EG', 'KW'];
  const m = new Set<Market>();
  for (const c of p.channels) {
    const country = CHANNEL[c]?.country;
    if (country === 'EG' || country === 'KW') m.add(country);
  }
  return m.size ? [...m] : ['EG', 'KW'];
}

/**
 * Rows in these markets and, for someone limited to brands, of those brands: `brand` names a product's
 * brand column, `po` the alias of a purchase_orders row (a purchase order is theirs when it holds one of
 * their styles, or its supplier carries one of their brands).
 */
export const inMarkets = (markets: Market[], col: SQL, scope?: { who: Pick<Principal, 'brands'>; brand?: SQL; po?: 'po' }) => {
  const m = sql`${col} in (${sql.join(markets.map((x) => sql`${x}`), sql`, `)})`;
  const brands = scope?.who.brands;
  if (!brands?.length) return m;
  if (scope?.brand) return sql`(${m} and ${brandMatch(brands, scope.brand)})`;
  if (scope?.po) return sql`(${m} and ${poOfBrands(brands, sql.raw(`${scope.po}.id`), sql.raw(`${scope.po}.supplier_id`))})`;
  return m;
};

/** A purchase order holding one of these brands' styles, or placed with a supplier of one of them. */
export const poOfBrands = (brands: string[], poId: SQL, supplierId: SQL) =>
  sql`(exists (select 1 from po_lines bl join products bp on bp.id = bl.product_id where bl.po_id = ${poId} and ${brandMatch(brands, sql`bp.brand`)})
    or exists (select 1 from suppliers bs, jsonb_array_elements_text(bs.brands) as bb(name) where bs.id = ${supplierId} and ${brandMatch(brands, sql`bb.name`)}))`;

export type Sees = { money: boolean; cost: boolean; act: (a: Area) => boolean; view: (a: Area) => boolean; manage: (a: Area) => boolean };

export function sees(p: Principal): Sees {
  return {
    money: can(p, 'money', 1),
    cost: seesCost(p),
    act: (a) => can(p, a, 2),
    view: (a) => can(p, a, 1),
    manage: (a) => can(p, a, 3),
  };
}

export const AREA_TEAM: Record<string, string> = { procurement: 'Buying', stock: 'Stock & planning', warehouse: 'Warehouse & shops', merch: 'Websites' };

/** The time this request was served, for server pages that draw something against now. */
export const servedAt = () => Date.now();

/** The currency a person's totals read in: KWD for a Kuwait-only view, EGP across markets. */
export const viewCurrency = (p: Pick<Principal, 'channels'>) => {
  const m = marketsFor(p);
  return m.length === 1 && m[0] === 'KW' ? 'KWD' : 'EGP';
};
