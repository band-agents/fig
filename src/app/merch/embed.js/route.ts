export const dynamic = 'force-dynamic';

/**
 * The script a storefront loads once, in its theme, to show what the console publishes:
 *
 *   <script src="https://<console>/merch/embed.js" data-store="labesny-web" defer></script>
 *
 * On a product page it draws the cross-sell, bundle or upgrade row under the add-to-bag form (or
 * inside an element with data-dh-merch, where the theme wants it); on any page it may show the
 * store's pop-up, once a session, to a returning visitor. Publishing, pausing or ending a placement
 * in the console changes the shop within a minute, with no theme release.
 *
 * Plain ES2017, no dependencies, styles scoped under one class prefix, Arabic when the page is RTL.
 */
export async function GET(req: Request) {
  const origin = process.env.RELAY_PUBLIC_URL?.replace(/\/$/, '') || new URL(req.url).origin;
  return new Response(EMBED.replace('__ORIGIN__', JSON.stringify(origin)), {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  });
}

const EMBED = String.raw`(function () {
  if (window.__dhMerch) return;
  window.__dhMerch = true;
  var ORIGIN = __ORIGIN__;
  var me = document.currentScript || document.querySelector('script[src*="/merch/embed.js"]');
  var store = me && me.getAttribute('data-store');
  if (!store) return;
  var rtl = (document.documentElement.getAttribute('dir') || '').toLowerCase() === 'rtl' || /^ar/i.test(document.documentElement.lang || '');
  var m = location.pathname.match(/\/products\/([^/?#]+)/);
  var product = (me.getAttribute('data-product') || (m && decodeURIComponent(m[1])) || '');

  var css = [
    '.dhm{margin:28px 0;font-family:inherit;color:inherit}',
    '.dhm h3{font-size:15px;font-weight:500;letter-spacing:.02em;margin:0 0 12px}',
    '.dhm-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px}',
    '.dhm-card{display:block;text-decoration:none;color:inherit}',
    '.dhm-card img{width:100%;aspect-ratio:3/4;object-fit:cover;background:#f2f0ec;display:block}',
    '.dhm-t{font-size:12.5px;margin-top:6px;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.dhm-p{font-size:12.5px;opacity:.7;margin-top:2px}',
    '.dhm-pop{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(15,15,16,.35);opacity:0;transition:opacity .25s}',
    '.dhm-pop[data-open]{opacity:1}',
    '.dhm-box{background:#fff;color:#111;width:min(440px,calc(100vw - 32px));padding:22px;box-shadow:0 24px 60px rgba(0,0,0,.25);position:relative}',
    '.dhm-x{position:absolute;top:10px;' + (rtl ? 'left' : 'right') + ':12px;border:0;background:none;font-size:20px;cursor:pointer;color:#666}',
    '.dhm-o{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;opacity:.6}',
    '.dhm-box h3{font-size:22px;font-weight:400;margin:6px 0 14px}',
    '.dhm-box .dhm-row{grid-template-columns:repeat(3,1fr)}',
    '.dhm-go{display:block;margin-top:16px;background:#111;color:#fff;text-align:center;padding:12px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;text-decoration:none}',
    '@media (prefers-reduced-motion:reduce){.dhm-pop{transition:none}}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function send(placement, event) {
    try {
      var data = JSON.stringify({ placement: placement, event: event, store: store });
      if (navigator.sendBeacon) navigator.sendBeacon(ORIGIN + '/api/merch/track', new Blob([data], { type: 'text/plain' }));
      else fetch(ORIGIN + '/api/merch/track', { method: 'POST', body: data, keepalive: true });
    } catch (e) {}
  }

  function card(p, placement) {
    var a = document.createElement('a');
    a.className = 'dhm-card';
    a.href = p.url;
    a.addEventListener('click', function () { send(placement, 'click'); });
    var img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    if (p.image) img.src = p.image;
    var t = document.createElement('div');
    t.className = 'dhm-t';
    t.textContent = p.title;
    var pr = document.createElement('div');
    pr.className = 'dhm-p';
    pr.textContent = p.price;
    a.appendChild(img); a.appendChild(t); a.appendChild(pr);
    return a;
  }

  function row(pl) {
    var wrap = document.createElement('section');
    wrap.className = 'dhm';
    wrap.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    var h = document.createElement('h3');
    h.textContent = (rtl && pl.headlineAr) || pl.headline;
    var grid = document.createElement('div');
    grid.className = 'dhm-row';
    pl.items.forEach(function (p) { grid.appendChild(card(p, pl.id)); });
    wrap.appendChild(h); wrap.appendChild(grid);
    var seenOnce = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es, o) { es.forEach(function (e) { if (e.isIntersecting && !seenOnce) { seenOnce = true; send(pl.id, 'view'); o.disconnect(); } }); }, { threshold: 0.4 }).observe(wrap);
    } else send(pl.id, 'view');
    return wrap;
  }

  function place(nodes) {
    var slot = document.querySelector('[data-dh-merch]');
    if (slot) { nodes.forEach(function (n) { slot.appendChild(n); }); return; }
    var form = document.querySelector('form[action*="/cart/add"]');
    var anchor = (form && (form.closest('section') || form.parentElement)) || document.querySelector('main') || document.body;
    nodes.forEach(function (n) { anchor.appendChild(n); });
  }

  function popup(pl) {
    try {
      if (sessionStorage.getItem('dhm:pop')) return;
      var back = localStorage.getItem('dhm:visit');
      localStorage.setItem('dhm:visit', '1');
      if (!back) return; // returning visitors only
    } catch (e) { return; }
    setTimeout(function () {
      try { sessionStorage.setItem('dhm:pop', '1'); } catch (e) {}
      var o = document.createElement('div');
      o.className = 'dhm-pop';
      o.setAttribute('role', 'dialog');
      o.setAttribute('aria-modal', 'true');
      o.setAttribute('dir', rtl ? 'rtl' : 'ltr');
      var box = document.createElement('div');
      box.className = 'dhm-box';
      var x = document.createElement('button');
      x.className = 'dhm-x';
      x.setAttribute('aria-label', rtl ? 'إغلاق' : 'Close');
      x.textContent = '×';
      var close = function () { o.remove(); };
      x.onclick = close;
      o.addEventListener('click', function (e) { if (e.target === o) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); }, { once: true });
      if (pl.offer) { var of = document.createElement('div'); of.className = 'dhm-o'; of.textContent = pl.offer; box.appendChild(of); }
      var h = document.createElement('h3');
      h.textContent = (rtl && pl.headlineAr) || pl.headline;
      var grid = document.createElement('div');
      grid.className = 'dhm-row';
      pl.items.slice(0, 3).forEach(function (p) { grid.appendChild(card(p, pl.id)); });
      var go = document.createElement('a');
      go.className = 'dhm-go';
      go.href = pl.items[0] ? pl.items[0].url : '#';
      go.textContent = rtl ? 'تسوقي الآن' : 'Shop now';
      go.addEventListener('click', function () { send(pl.id, 'click'); });
      box.appendChild(x); box.appendChild(h); box.appendChild(grid); box.appendChild(go);
      o.appendChild(box);
      document.body.appendChild(o);
      requestAnimationFrame(function () { o.setAttribute('data-open', ''); });
      send(pl.id, 'view');
    }, 6000);
  }

  fetch(ORIGIN + '/api/merch/' + encodeURIComponent(store) + (product ? '?product=' + encodeURIComponent(product) : ''))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      if (d.placements && d.placements.length) place(d.placements.map(row));
      if (d.popup && d.popup.items.length) popup(d.popup);
    })
    .catch(function () {});
})();`;
