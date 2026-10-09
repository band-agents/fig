// Pulls a sample of each storefront's PUBLIC catalogue (no credentials) into src/seed/catalog.json,
// so demo orders carry real FIG products, prices and photos until the live connectors are switched on.
// Run: node scripts/fetch-catalog.mjs
import fs from 'node:fs';
import path from 'node:path';

const UA = { 'user-agent': 'Mozilla/5.0 (Relay catalogue sampler)' };
const out = path.resolve('src/seed/catalog.json');

const shopifyThumb = (url) => (url ? `${url}${url.includes('?') ? '&' : '?'}width=240` : null);
const NAMED = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };
const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : NAMED[e.toLowerCase()] ?? m));

async function json(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

async function shopify(host, pages, currency) {
  const items = [];
  for (let page = 1; page <= pages; page++) {
    const { products } = await json(`https://${host}/products.json?limit=250&page=${page}`);
    if (!products?.length) break;
    for (const p of products) {
      const v = p.variants?.find((x) => x.available) ?? p.variants?.[0];
      if (!v || !p.images?.length) continue;
      const sizeIdx = (p.options ?? []).findIndex((o) => /size|talla|المقاس/i.test(o.name));
      const sizes = sizeIdx >= 0 ? [...new Set(p.variants.map((x) => x[`option${sizeIdx + 1}`]))].slice(0, 8) : [];
      items.push({
        title: decode(p.title),
        brand: p.vendor || 'Unknown',
        type: p.product_type || '',
        tags: (Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',')).map((t) => t.trim()).filter(Boolean).slice(0, 12),
        price: Number(v.price),
        compareAt: v.compare_at_price ? Number(v.compare_at_price) : null,
        currency,
        sku: v.sku || `${p.handle}`.slice(0, 24),
        sizes,
        image: shopifyThumb(p.images[0].src),
      });
    }
  }
  return items;
}

async function woo(host, pages) {
  const items = [];
  for (let page = 1; page <= pages; page++) {
    const list = await json(`https://${host}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!list?.length) break;
    for (const p of list) {
      if (!p.images?.length || !p.prices?.price) continue;
      const minor = Number(p.prices.currency_minor_unit ?? 2);
      const toMajor = (x) => (x ? Number(x) / 10 ** minor : null);
      const sizeAttr = (p.attributes ?? []).find((a) => /size/i.test(a.name));
      const brandAttr = (p.brands ?? [])[0]?.name || (p.attributes ?? []).find((a) => /brand/i.test(a.name))?.terms?.[0]?.name;
      items.push({
        title: decode(p.name),
        brand: decode(brandAttr || p.name.split(' ').slice(0, 2).join(' ')),
        type: (p.categories ?? []).at(-1)?.name || '',
        tags: (p.categories ?? []).map((c) => c.name).slice(0, 8),
        price: toMajor(p.prices.sale_price || p.prices.price),
        compareAt: p.prices.regular_price !== p.prices.sale_price ? toMajor(p.prices.regular_price) : null,
        currency: 'EGP',
        sku: p.sku || p.slug.slice(0, 24),
        sizes: (sizeAttr?.terms ?? []).map((t) => decode(t.name)).slice(0, 8),
        image: p.images[0].thumbnail || p.images[0].src,
      });
    }
  }
  return items;
}

// Keep the sample varied: cap each brand so one vendor's upload does not dominate.
function spread(items, total, perBrand) {
  const byBrand = new Map();
  for (const it of items) {
    const list = byBrand.get(it.brand) ?? [];
    if (list.length < perBrand) list.push(it);
    byBrand.set(it.brand, list);
  }
  const picked = [];
  let round = 0;
  while (picked.length < total) {
    let added = false;
    for (const list of byBrand.values()) {
      if (list[round]) { picked.push(list[round]); added = true; }
      if (picked.length >= total) break;
    }
    if (!added) break;
    round++;
  }
  return picked;
}

const [labesny, wsEg, fig] = await Promise.all([
  shopify('labesny.com', 16, 'KWD'),
  shopify('gcrmsf-rh.myshopify.com', 2, 'EGP'),
  woo('figeg.com', 12),
]);

const catalog = {
  fetchedAt: new Date().toISOString(),
  fig: spread(fig, 140, 18),
  wsEg: spread(wsEg, 110, 110),
  labesny: spread(labesny, 160, 22),
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(catalog, null, 1));
for (const [k, v] of Object.entries(catalog)) if (Array.isArray(v)) console.log(k, v.length, [...new Set(v.map((x) => x.brand))].slice(0, 12).join(', '));
