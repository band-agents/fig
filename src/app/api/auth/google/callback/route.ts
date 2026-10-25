import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { createSession } from '@/lib/auth/session';
import { emailFromCode, NEXT_COOKIE, safeNext, STATE_COOKIE } from '@/lib/auth/google';

/**
 * Back from Google. The state must match the cookie set on the way out; the email must be one Google
 * verified and must belong to an active teammate. Then the same session a password sign-in makes.
 */
export async function GET(req: NextRequest) {
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  if (!state || !code || state !== req.cookies.get(STATE_COOKIE)?.value) return fail('google_state');
  const email = await emailFromCode(req.url, code);
  if (!email) return fail('google_failed');
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u) return fail('google_no_account');
  if (!u.active) return fail('google_inactive');
  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  await createSession(u.id);
  const res = NextResponse.redirect(new URL(safeNext(req.cookies.get(NEXT_COOKIE)?.value), req.url));
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(NEXT_COOKIE);
  return res;
}
