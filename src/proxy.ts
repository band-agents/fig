import { NextResponse, type NextRequest } from 'next/server';

// Cheap gate: no session cookie, no console. The real check (session row, active account, scopes)
// happens on the server for every page and action.
// `/return` and `/api/returns` are the customer's self-service portal: no account, by design. They
// carry their own protection — the order number must be paired with the email on the order, and
// both endpoints are rate limited per address. `/concierge` and `/api/concierge` are the shopping
// advisor on the storefront: public for the same reason, read-only, and rate limited per address.
// `/merch` and `/api/merch` are the website placements the shops load: read-only product cards, and
// a per-day counter of views and clicks, both rate limited. `/welcome` is the landing page and
// `/api/auth/google` the Google sign-in round trip (it only ever signs in an existing teammate).
const PUBLIC = ['/login', '/join', '/welcome', '/api/auth/google', '/api/webhooks', '/api/health', '/api/cron', '/return', '/api/returns', '/concierge', '/api/concierge', '/merch', '/api/merch', '/track', '/api/track'];

/**
 * A public path is the path itself or something beneath it — never merely something that starts
 * with the same letters. `/returns` is the staff queue and `/return` is the customer portal, so a
 * plain `startsWith` would hand the queue to anyone who asked.
 */
const isPublic = (pathname: string) => PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/*
 * Who may put the customer pages in a frame: each shop embeds /return, /track and /concierge in one of
 * its own pages. Set here, per request, from RETURNS_EMBED_ORIGINS ("https://labesny.com https://figeg.com"),
 * not in next.config: config headers are fixed when the image is built, and the server's settings are
 * only read when it runs, so the live console was sending frame-ancestors 'self' and the shops' frames
 * stayed blank. With nothing set, only the console itself may frame them.
 */
const EMBEDDED = ['/return', '/track', '/concierge'];
const isEmbedded = (pathname: string) => EMBEDDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
export const frameAncestors = (origins = process.env.RETURNS_EMBED_ORIGINS ?? '') => {
  const list = origins.trim().split(/\s+/).filter((o) => /^https?:\/\/[^\s;,'"]+$/.test(o));
  return list.length ? `frame-ancestors 'self' ${list.join(' ')}` : "frame-ancestors 'self'";
};

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isEmbedded(pathname)) {
    const res = NextResponse.next();
    res.headers.set('Content-Security-Policy', frameAncestors());
    return res;
  }
  if (isPublic(pathname)) return NextResponse.next();
  if (!req.cookies.get('relay_session')?.value) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
    // the front door: a signed-out visitor to the home address sees the landing page, the address unchanged
    if (pathname === '/') return NextResponse.rewrite(new URL('/welcome', req.url));
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|webp|woff2)$).*)'],
};
