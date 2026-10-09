import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { Principal, Role } from '../domain/perms';

export const COOKIE = 'relay_session';
const DAYS = 14;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const db = await getDb();
  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;
  await db.insert(schema.sessions).values({ id: sha(token), userId, expiresAt: new Date(Date.now() + DAYS * 86400000), userAgent: ua });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sha(token)));
  }
  jar.delete(COOKIE);
}

export type SessionUser = Principal & { email: string; title: string | null; hue: number };

/** The signed-in teammate for this request, or null. Cached per request. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || !row.u.active) return null;
  const u = row.u;
  if (!u.lastSeenAt || Date.now() - u.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, u.id));
  }
  return { id: u.id, name: u.name, email: u.email, title: u.title, hue: u.hue, role: u.role as Role, scopes: u.scopes, channels: u.channels };
});

export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}
