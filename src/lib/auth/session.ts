import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { effectiveScopes, landingFor, READ_ONLY_ROLES, ROLES, scopesFor, type Principal, type Role, type Scopes } from '../domain/perms';
import { RelayError } from '../errors';
import { BUSINESS_COOKIE, businessesFor, channelsIn, readView, type Business, type BusinessView } from '../business';

export const COOKIE = 'relay_session';
/** An admin's "View as": the job whose screens they are looking at. Honoured for admins only, and read-only. */
export const VIEW_AS = 'relay_view_as';
/** With View as on Brand manager: the brand being looked at. */
export const VIEW_AS_BRAND = 'relay_view_brand';
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

export type SessionUser = Principal & {
  email: string;
  title: string | null;
  hue: number;
  previewing?: Role;
  mustChangePassword?: boolean;
  /** The business being looked at (the switch at the top of every page), and the ones on offer. */
  business?: BusinessView;
  businesses?: Business[];
};

/**
 * The signed-in teammate for this request, or null. Cached per request. An admin with View as on
 * gets that job's access and screens (their own name and stores), marked `previewing` so nothing
 * can be changed while they look; realUser() is the account itself. Their stores are then narrowed to
 * the business picked at the top of the page (FIG or Labesny), so every query follows the switch.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const u = await realUser();
  if (!u) return u;
  const jar = await cookies();
  let v: SessionUser = u;
  const as = u.role === 'admin' ? (jar.get(VIEW_AS)?.value as Role | undefined) : undefined;
  if (as && as !== 'admin' && as in ROLES) {
    // a brand manager is previewed for one brand at a time, so the screens show what that manager sees
    const brand = as === 'brand' ? jar.get(VIEW_AS_BRAND)?.value?.trim() : undefined;
    v = { ...u, role: as, scopes: scopesFor(as), brands: brand ? [brand] : [], previewing: as };
  }
  return inBusiness(v, jar.get(BUSINESS_COOKIE)?.value);
});

/**
 * One business when only one is connected or one is picked; both ('all', amounts in EGP terms) only for
 * someone who covers both and chose to see them together. A pick they cannot see falls back to all.
 */
function inBusiness(u: SessionUser, picked: string | undefined): SessionUser {
  const businesses = businessesFor(u);
  const want = readView(picked);
  const business: BusinessView = businesses.length === 1 ? businesses[0] : businesses.length > 1 && want !== 'all' && businesses.includes(want) ? want : 'all';
  return { ...u, channels: business === 'all' ? u.channels : channelsIn(u, business), business, businesses };
}

/** Refuses a change while an admin is looking through someone else's eyes, from a job that only looks, or before a temporary password is replaced. */
export function assertCanAct(u: Pick<SessionUser, 'previewing' | 'role' | 'mustChangePassword'>) {
  if (u.mustChangePassword) throw new RelayError('forbidden', 'Choose your own password first.');
  if (u.previewing) throw new RelayError('forbidden', `You are viewing as ${ROLES[u.previewing].label}, which is read-only. Switch back to Admin to make changes.`);
  if (READ_ONLY_ROLES.includes(u.role)) throw new RelayError('forbidden', `${ROLES[u.role]?.label ?? 'This access'} is view-only.`);
}

/** The account behind the session, ignoring View as. Cached per request. */
export const realUser = cache(async (): Promise<SessionUser | null> => {
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
  return { id: u.id, name: u.name, email: u.email, title: u.title, hue: u.hue, role: u.role as Role, scopes: effectiveScopes(u.role, u.scopes), channels: u.channels, brands: u.brands ?? [], mustChangePassword: u.mustChangePassword };
});

export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect('/login');
  // signed in with a temporary password: their own password comes first
  if (u.mustChangePassword) redirect('/set-password');
  return u;
}

/**
 * A page this person may not open: send them to their own first page rather than a dead end. Going
 * Back after switching View as, or an old link, lands somewhere useful instead of on a 404.
 */
export function sendHome(p: { role?: string; scopes: Scopes }): never {
  redirect(landingFor(p) ?? '/');
}
