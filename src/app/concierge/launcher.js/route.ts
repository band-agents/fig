export const dynamic = 'force-dynamic';

/**
 * The launcher a storefront loads to offer the client advisor:
 *
 *   <script src="https://<relay>/concierge/launcher.js" data-store="labesny-web" defer></script>
 *
 * It draws the "Customer Service" button (a round icon on phones), opens the advisor in a frame when it is pressed, and
 * tells the advisor which page the shopper is on, so "does this come in a medium?" on a product
 * page means that product. Served from Relay rather than pasted into the theme, so a change to the
 * launcher does not need a theme release.
 *
 * A signed-in customer is passed on from the script tag's data-customer-* attributes, which the
 * theme fills and signs (storefront/shopify/fig-concierge.liquid). Relay checks the signature; the
 * launcher only carries it.
 *
 * Plain ES2017, no dependencies, scoped under one class prefix so it cannot collide with the theme.
 */
export async function GET(req: Request) {
  const origin = process.env.RELAY_PUBLIC_URL?.replace(/\/$/, '') || new URL(req.url).origin;
  return new Response(LAUNCHER.replace('__ORIGIN__', JSON.stringify(origin)), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

const LAUNCHER = String.raw`(function () {
  if (window.__labesnyConcierge) return;
  window.__labesnyConcierge = true;

  var ORIGIN = __ORIGIN__;
  var me = document.currentScript || document.querySelector('script[src*="/concierge/launcher.js"]');
  var store = (me && me.getAttribute('data-store')) || 'labesny-web';
  var rtl = (document.documentElement.getAttribute('dir') || '').toLowerCase() === 'rtl';
  var lang = /^ar/i.test(document.documentElement.lang || '') ? 'ar' : 'en';
  var KEY = 'concierge:open:' + store;
  var label = lang === 'ar' ? 'خدمة العملاء' : 'Customer Service';
  var customer = null;
  if (me && me.getAttribute('data-customer-email') && me.getAttribute('data-customer-sig')) {
    customer = {
      email: me.getAttribute('data-customer-email'),
      id: me.getAttribute('data-customer-id'),
      sig: me.getAttribute('data-customer-sig'),
      name: me.getAttribute('data-customer-name') || undefined
    };
  }

  var css = [
    '.lcg-btn{position:fixed;bottom:22px;' + (rtl ? 'left' : 'right') + ':22px;z-index:2147483000;display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 20px 0 16px;border:0;border-radius:999px;background:#0f0f10;color:#fff;cursor:pointer;box-shadow:0 10px 30px rgba(15,15,16,.18);font:500 11px/1 Jost,Futura,"Avenir Next",system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;transition:transform .25s cubic-bezier(.2,.7,.2,1),opacity .2s}',
    '.lcg-btn:hover{transform:translateY(-2px)}',
    '.lcg-btn[hidden]{display:none}',
    '.lcg-btn svg{width:18px;height:18px;flex:none}',
    '.lcg-btn[lang=ar]{letter-spacing:0;font-size:14px;font-family:"IBM Plex Sans Arabic",system-ui,sans-serif}',
    '.lcg-frame{position:fixed;bottom:22px;' + (rtl ? 'left' : 'right') + ':22px;z-index:2147483001;width:400px;height:min(680px,calc(100vh - 44px));border:1px solid #ebe5dd;background:#fff;box-shadow:0 24px 60px rgba(15,15,16,.18);opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .25s,transform .3s cubic-bezier(.2,.7,.2,1)}',
    '.lcg-frame[data-open]{opacity:1;transform:none;pointer-events:auto}',
    /* Phones: the panel takes the screen, and the button becomes a round icon that keeps out of the way. */
    '@media (max-width:520px){.lcg-frame{inset:0;width:100%;height:100%;border:0}.lcg-btn{bottom:16px;' + (rtl ? 'left' : 'right') + ':16px;width:56px;height:56px;padding:0;justify-content:center}.lcg-btn span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}',
    '@media (prefers-reduced-motion:reduce){.lcg-btn,.lcg-frame{transition:none}}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lcg-btn';
  btn.setAttribute('lang', lang);
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a7.5 7.5 0 0 1-11.2 6.5L4 20l1.4-4.3A7.5 7.5 0 1 1 20 12Z"/><path d="M9 11h6M9 14h4"/></svg><span></span>';
  btn.querySelector('span').textContent = label;
  document.body.appendChild(btn);

  var frame = null;

  function pageContext() {
    var m = location.pathname.match(/\/products\/([^/?#]+)/);
    return { type: 'concierge:page', url: location.href.split('#')[0], title: document.title, productHandle: m ? decodeURIComponent(m[1]) : undefined, lang: lang, customer: customer };
  }

  function ensureFrame() {
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.className = 'lcg-frame';
    frame.title = label;
    frame.setAttribute('role', 'dialog');
    frame.setAttribute('aria-label', label);
    frame.allow = 'clipboard-write';
    frame.src = ORIGIN + '/concierge?embed=1&store=' + encodeURIComponent(store) + '&lang=' + lang;
    document.body.appendChild(frame);
    return frame;
  }

  function open() {
    var f = ensureFrame();
    requestAnimationFrame(function () { f.setAttribute('data-open', ''); });
    btn.hidden = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    try { f.contentWindow && f.contentWindow.postMessage(pageContext(), ORIGIN); } catch (e) {}
  }

  function close() {
    if (frame) frame.removeAttribute('data-open');
    btn.hidden = false;
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    btn.focus();
  }

  btn.addEventListener('click', open);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && frame && frame.hasAttribute('data-open')) close(); });
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data) return;
    if (e.data.type === 'concierge:close') close();
    if (e.data.type === 'concierge:ready' && frame) frame.contentWindow.postMessage(pageContext(), ORIGIN);
  });

  /* Still open from the previous page: open again on this one, where the conversation continues. */
  try { if (sessionStorage.getItem(KEY) === '1') open(); } catch (e) {}
})();`;
