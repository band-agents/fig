import { VELOCITY_LABEL } from './domain/stock/classify';
import { TO_EGP } from './format';
import { moneyDecimals, type Col, type Sheet } from './sheet';
import { TIER_LABEL, type BandRow, type BrandRow, type StyleRow, type TierRow } from './brands';

/** EGP-equivalent minor units as a plain amount in the view's currency, for a spreadsheet cell. */
export const inView = (egpMinor: number | null | undefined, currency: string) => (egpMinor == null ? null : Math.round((egpMinor / 100 / (TO_EGP[currency] ?? 1)) * 10 ** moneyDecimals(currency)) / 10 ** moneyDecimals(currency));

const m = (key: string, label: string, currency: string): Col => ({ key, label: `${label} (${currency})`, kind: 'num', decimals: moneyDecimals(currency) });
const i = (key: string, label: string): Col => ({ key, label, kind: 'int' });
const p = (key: string, label: string): Col => ({ key, label, kind: 'pct' });

export function brandSheet(rows: BrandRow[], o: { money: boolean; currency: string; weeks: number }): Sheet {
  const c = o.currency;
  const columns: Col[] = [
    { key: 'brand', label: 'Brand' },
    ...(o.money ? [{ key: 'tier', label: 'Price tier' }] : []),
    i('units', `Pieces sold (${o.weeks} weeks)`),
    ...(o.money ? [m('value', `Sales (${o.weeks} weeks)`, c)] : []),
    p('shareUnits', 'Share of pieces'),
    ...(o.money ? [p('shareValue', 'Share of sales')] : []),
    i('prevUnits', 'Pieces, period before'),
    ...(o.money ? [m('prevValue', 'Sales, period before', c), m('asp', 'Average selling price', c), m('fullPrice', 'Median full price', c)] : []),
    i('styles', 'Styles'),
    i('live', 'Live styles'),
    i('onHand', 'Pieces on hand'),
    ...(o.money ? [m('stockValue', 'Stock at retail', c)] : []),
    { key: 'cover', label: 'Weeks of cover', kind: 'num', decimals: 0 },
    p('sellThrough', 'Sell-through'),
    i('fast', 'Fast movers'),
    i('slow', 'Slow movers'),
    i('dead', 'Not selling'),
    i('newIn', 'New in'),
    p('markdownShare', 'Sold on markdown'),
    p('returnRate', 'Returned'),
    i('webLive', 'Website: live styles'),
    i('webSoldOut', 'Website: live but sold out'),
    i('webStock', 'Website: stock but not live'),
    i('webNoPhoto', 'Website: live without a photo'),
  ];
  return {
    name: 'Brands',
    columns,
    rows: rows.map((r) => ({
      brand: r.brand,
      tier: TIER_LABEL[r.tier],
      units: r.units,
      value: inView(r.value, c),
      shareUnits: r.shareUnits,
      shareValue: r.shareValue,
      prevUnits: r.prevUnits,
      prevValue: inView(r.prevValue, c),
      asp: inView(r.asp, c),
      fullPrice: inView(r.fullPrice, c),
      styles: r.styles,
      live: r.live,
      onHand: r.onHand,
      stockValue: inView(r.stockValue, c),
      cover: r.cover == null ? null : Math.round(r.cover),
      sellThrough: r.sellThrough,
      fast: r.fast,
      slow: r.slow,
      dead: r.dead,
      newIn: r.newIn,
      markdownShare: r.markdownShare,
      returnRate: r.returnRate,
      webLive: r.web?.live ?? null,
      webSoldOut: r.web?.soldOutLive ?? null,
      webStock: r.web?.stockNotLive ?? null,
      webNoPhoto: r.web?.noPhoto ?? null,
    })),
  };
}

export function styleSheet(rows: StyleRow[], o: { money: boolean; currency: string; weeks: number; name?: string }): Sheet {
  const c = o.currency;
  return {
    name: o.name ?? 'Styles',
    columns: [
      { key: 'title', label: 'Style' },
      { key: 'styleCode', label: 'Style code' },
      { key: 'brand', label: 'Brand' },
      { key: 'category', label: 'Category' },
      { key: 'season', label: 'Season' },
      ...(o.money ? [m('price', 'Full price', c)] : []),
      i('units', `Pieces sold (${o.weeks} weeks)`),
      ...(o.money ? [m('value', `Sales (${o.weeks} weeks)`, c)] : []),
      i('prevUnits', 'Pieces, period before'),
      { key: 'perWeek', label: 'Pieces a week', kind: 'num', decimals: 2 },
      i('onHand', 'Pieces on hand'),
      { key: 'cover', label: 'Weeks of cover', kind: 'num', decimals: 0 },
      p('sellThrough', 'Sell-through'),
      i('weeksSinceSale', 'Weeks since last sale'),
      { key: 'pace', label: 'Pace' },
      ...(o.money ? [m('stockValue', 'Stock at retail', c)] : []),
      { key: 'status', label: 'Status' },
    ],
    rows: rows.map((r) => ({
      title: r.title,
      styleCode: r.styleCode,
      brand: r.brand,
      category: r.category,
      season: r.season,
      price: inView(r.price, c),
      units: r.units,
      value: inView(r.value, c),
      prevUnits: r.prevUnits,
      perWeek: Math.round(r.perWeek * 100) / 100,
      onHand: r.onHand,
      cover: r.cover == null ? null : Math.round(r.cover),
      sellThrough: r.sellThrough,
      weeksSinceSale: r.weeksSinceSale,
      pace: VELOCITY_LABEL[r.velocity],
      stockValue: inView(r.stockValue, c),
      status: r.status,
    })),
  };
}

export function tierSheet(rows: TierRow[], o: { currency: string; weeks: number }): Sheet {
  const c = o.currency;
  return {
    name: 'Price tiers',
    columns: [{ key: 'tier', label: 'Price tier' }, { key: 'brands', label: 'Brands' }, i('units', `Pieces sold (${o.weeks} weeks)`), m('value', `Sales (${o.weeks} weeks)`, c), p('shareUnits', 'Share of pieces'), p('shareValue', 'Share of sales'), m('asp', 'Average selling price', c), i('onHand', 'Pieces on hand'), p('stockShare', 'Share of stock'), p('sellThrough', 'Sell-through')],
    rows: rows.map((r) => ({ tier: TIER_LABEL[r.tier], brands: r.brands.join(', '), units: r.units, value: inView(r.value, c), shareUnits: r.shareUnits, shareValue: r.shareValue, asp: inView(r.asp, c), onHand: r.onHand, stockShare: r.stockShare, sellThrough: r.sellThrough })),
  };
}

export function bandSheet(rows: BandRow[], o: { currency: string; weeks: number; money: boolean; name?: string }): Sheet {
  const c = o.currency;
  return {
    name: o.name ?? 'Price bands',
    columns: [{ key: 'label', label: 'Full price' }, i('styles', 'Styles'), i('units', `Pieces sold (${o.weeks} weeks)`), ...(o.money ? [m('value', `Sales (${o.weeks} weeks)`, c)] : []), p('shareUnits', 'Share of pieces'), ...(o.money ? [p('shareValue', 'Share of sales')] : []), i('onHand', 'Pieces on hand'), p('sellThrough', 'Sell-through')],
    rows: rows.map((r) => ({ ...r, value: inView(r.value, c) })),
  };
}

