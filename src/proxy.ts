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
const PUBLIC = ['/login', '/join', '/welcome', '/api/auth/google', '/api/webhooks', '/api/health', '/api/cron', '/return', '/api/returns', '/concierge', '/api/concierge', '/merch', '/api/merch'];

/**
 * A public path is the path itself or something beneath it — never merely something that starts
 * with the same letters. `/returns` is the staff queue and `/return` is the customer portal, so a
 * plain `startsWith` would hand the queue to anyone who asked.
 */
const isPublic = (pathname: string) => PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
