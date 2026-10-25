import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { googleMode } from '@/lib/auth/google';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Development only (GOOGLE_MOCK=1, never in production): a plain page that stands in for Google's
 * account chooser, so the whole round trip can be tried without a Google Cloud client. Each account
 * goes back to the real callback with a test code the callback accepts only in this mode.
 */
export async function GET(req: NextRequest) {
  if (googleMode() !== 'mock') return new NextResponse('Not found', { status: 404 });
  const state = req.nextUrl.searchParams.get('state') ?? '';
  const db = await getDb();
  const people = await db.select({ email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.active, true)).orderBy(schema.users.name).limit(40);
  const rows = [...people, { email: 'nobody@example.com', name: 'An account with no access' }]
    .map((p) => `<a href="/api/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`mock:${p.email}`)}"><b>${esc(p.name)}</b><span>${esc(p.email)}</span></a>`)
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose an account (test)</title>
<style>body{font:13px -apple-system,'Segoe UI',Roboto,sans-serif;background:#f8f8f7;color:#262626;margin:0;display:grid;place-items:center;min-height:100vh}
main{width:min(420px,92vw);background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:22px}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 14px;color:#8a8a8a}
a{display:flex;flex-direction:column;padding:9px 10px;border-radius:6px;color:inherit;text-decoration:none}a:hover{background:#f4f4f3}span{color:#8a8a8a;font-size:12px}</style>
<main><h1>Choose an account</h1><p>Test stand-in for Google. Development only.</p>${rows}</main>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
