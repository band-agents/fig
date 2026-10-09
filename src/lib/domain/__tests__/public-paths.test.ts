import { describe, expect, it } from 'vitest';

/* The proxy's public list, kept in step with src/proxy.ts. The rule it encodes matters more than
   the list: a public entry covers that path and what sits beneath it, never a different path that
   merely begins with the same letters. `/returns` is the staff queue and `/return` is the customer
   portal, and a plain startsWith would publish the queue. */
const PUBLIC = ['/login', '/join', '/api/webhooks', '/api/health', '/api/cron', '/return', '/api/returns'];
const isPublic = (pathname: string) => PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

describe('which paths skip the session gate', () => {
  it('opens the customer portal and its endpoints', () => {
    expect(isPublic('/return')).toBe(true);
    expect(isPublic('/api/returns')).toBe(true);
    expect(isPublic('/api/returns/lookup')).toBe(true);
  });

  it('keeps the staff returns queue behind the gate', () => {
    // The whole reason the match is not a startsWith.
    expect(isPublic('/returns')).toBe(false);
    expect(isPublic('/returns/ret_123')).toBe(false);
  });

  it('keeps the rest of the console behind the gate', () => {
    for (const p of ['/', '/orders', '/finance', '/api/search', '/api/stream', '/team', '/rules']) {
      expect(isPublic(p)).toBe(false);
    }
  });

  it('keeps the customers’ own photographs behind it too', () => {
    // Why they are served from /api/photos and not from under the customer's /api/returns.
    expect(isPublic('/api/photos/abc123')).toBe(false);
  });

  it('is not fooled by a path that merely shares a prefix', () => {
    expect(isPublic('/logins')).toBe(false);
    expect(isPublic('/joinery')).toBe(false);
    expect(isPublic('/api/returns-export')).toBe(false);
  });
});
